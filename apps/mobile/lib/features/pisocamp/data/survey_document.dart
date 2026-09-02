import 'dart:typed_data';

import 'bundle_protocol.dart';

/// What a survey is for, as the approved vocabulary names it.
enum SurveyPurpose {
  topic,
  satisfaction,
  feature,
  application,
  nps,
  usefulness,
}

/// How a question is answered.
enum SurveyQuestionKind { rating, nps, text }

/// One question, with the wording at each end of its scale.
final class SurveyQuestion {
  const SurveyQuestion({
    required this.id,
    required this.kind,
    required this.prompt,
    required this.required,
    this.lowLabel,
    this.highLabel,
  });

  /// The question's own id, which a response references.
  final String id;
  final SurveyQuestionKind kind;
  final String prompt;
  final bool required;

  /// Null for a written answer, and set for both ends of a scale.
  final String? lowLabel;
  final String? highLabel;

  /// The inclusive bounds a score must fall within, per the SRD.
  int get scaleMin => kind == SurveyQuestionKind.nps ? 0 : 1;
  int get scaleMax => kind == SurveyQuestionKind.nps ? 10 : 5;
}

/// A published survey, read from the offline bundle.
///
/// The whole survey travels with the bundle because EV-2 presents it offline:
/// a guest with no connection is still asked, still answers, and the answer
/// waits in the queue.
final class SurveyDocument {
  SurveyDocument._({
    required this.logicalId,
    required this.contentItemId,
    required this.contentVersionId,
    required this.versionNo,
    required this.title,
    required this.summary,
    required this.body,
    required this.purpose,
    required this.subjectContentItemId,
    required List<SurveyQuestion> questions,
  }) : questions = List.unmodifiable(questions);

  final String logicalId;
  final String contentItemId;
  final String contentVersionId;
  final int versionNo;

  /// What a person is invited to take part in.
  final String title;
  final String summary;

  /// Why they are being asked, and what it costs them.
  final String body;

  final SurveyPurpose purpose;

  /// The topic or feature this survey is about, when it is about one.
  final String? subjectContentItemId;

  final List<SurveyQuestion> questions;

  static const _maximumDocumentBytes = 128 * 1024;

  /// Parses a published survey, or throws [BundleValidationException].
  ///
  /// Strict for the same reason the question reader is: a survey is what a
  /// person's answers are attached to, and a malformed one would attach them
  /// to something nobody can report on.
  static SurveyDocument parsePublished(Uint8List bytes) {
    final json = decodeStrictJsonObject(
      bytes,
      maximumBytes: _maximumDocumentBytes,
      context: 'published survey',
    );
    requireExactJsonKeys(json, const {
      'schemaVersion',
      'logicalId',
      'contentItemId',
      'contentVersionId',
      'versionNo',
      'contentType',
      'title',
      'summary',
      'body',
      'seriesCode',
      'denominationCode',
      'primaryUrl',
      'featureLevel',
      'hotspot',
      'purpose',
      'subjectContentItemId',
      'questions',
      'relatedLinks',
    }, context: 'published survey');

    if (json['schemaVersion'] != 1) {
      throw const BundleValidationException('Survey schemaVersion must be 1.');
    }
    if (json['contentType'] != 'survey') {
      throw const BundleValidationException(
        'Published content is not a survey.',
      );
    }
    for (final key in const [
      'seriesCode',
      'denominationCode',
      'primaryUrl',
      'featureLevel',
      'hotspot',
    ]) {
      if (json[key] != null) {
        throw BundleValidationException('Survey $key must be null.');
      }
    }

    final contentItemId = _uuid(json, 'contentItemId');
    final logicalId = _string(json, 'logicalId', maximum: 160);
    if (logicalId != 'content.$contentItemId') {
      throw const BundleValidationException(
        'Survey logicalId does not match its content item.',
      );
    }
    final subject = json['subjectContentItemId'];
    if (subject != null && subject is! String) {
      throw const BundleValidationException('Survey subject is invalid.');
    }

    return SurveyDocument._(
      logicalId: logicalId,
      contentItemId: contentItemId,
      contentVersionId: _uuid(json, 'contentVersionId'),
      versionNo: _positiveInt(json, 'versionNo'),
      title: _plainText(json, 'title', maximum: 160),
      summary: _plainText(json, 'summary', maximum: 500),
      body: _plainText(json, 'body', maximum: 10000),
      purpose: _purpose(json['purpose']),
      subjectContentItemId: subject == null
          ? null
          : _uuid(json, 'subjectContentItemId'),
      questions: _questions(json['questions']),
    );
  }
}

SurveyPurpose _purpose(Object? value) {
  return switch (value) {
    'topic' => SurveyPurpose.topic,
    'satisfaction' => SurveyPurpose.satisfaction,
    'feature' => SurveyPurpose.feature,
    'application' => SurveyPurpose.application,
    'nps' => SurveyPurpose.nps,
    'usefulness' => SurveyPurpose.usefulness,
    _ => throw const BundleValidationException(
      'Survey purpose is not supported.',
    ),
  };
}

List<SurveyQuestion> _questions(Object? value) {
  if (value is! List<Object?> || value.isEmpty || value.length > 20) {
    throw const BundleValidationException(
      'A survey must ask between one and twenty questions.',
    );
  }
  final questions = <SurveyQuestion>[];
  final prompts = <String>{};
  var npsCount = 0;
  for (final item in value) {
    if (item is! Map<String, Object?>) {
      throw const BundleValidationException('Survey question is invalid.');
    }
    final kind = switch (item['kind']) {
      'rating' => SurveyQuestionKind.rating,
      'nps' => SurveyQuestionKind.nps,
      'text' => SurveyQuestionKind.text,
      _ => throw const BundleValidationException(
        'Survey question kind is not supported.',
      ),
    };
    // A scaled question is worded at both ends and a written one at neither,
    // so the key set is what tells the two apart before anything is read.
    requireExactJsonKeys(
      item,
      kind == SurveyQuestionKind.text
          ? const {'id', 'kind', 'prompt', 'required'}
          : const {'id', 'kind', 'prompt', 'required', 'lowLabel', 'highLabel'},
      context: 'survey question',
    );
    final prompt = _plainText(item, 'prompt', maximum: 300);
    if (!prompts.add(prompt)) {
      throw const BundleValidationException(
        'A survey cannot repeat a question.',
      );
    }
    final isRequired = item['required'];
    if (isRequired is! bool) {
      throw const BundleValidationException('Survey question is invalid.');
    }
    if (kind == SurveyQuestionKind.nps) npsCount += 1;
    questions.add(
      SurveyQuestion(
        id: _uuid(item, 'id'),
        kind: kind,
        prompt: prompt,
        required: isRequired,
        lowLabel: kind == SurveyQuestionKind.text
            ? null
            : _plainText(item, 'lowLabel', maximum: 100),
        highLabel: kind == SurveyQuestionKind.text
            ? null
            : _plainText(item, 'highLabel', maximum: 100),
      ),
    );
  }
  if (npsCount > 1) {
    throw const BundleValidationException(
      'A survey asks the NPS question at most once.',
    );
  }
  final ids = questions.map((question) => question.id).toSet();
  if (ids.length != questions.length) {
    throw const BundleValidationException(
      'A survey cannot repeat a question id.',
    );
  }
  return questions;
}

final _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
);
final _htmlPattern = RegExp(
  r'<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|<![^>]*>|<\?[\s\S]*?\?>',
);

String _string(Map<String, Object?> json, String key, {required int maximum}) {
  final value = json[key];
  if (value is! String ||
      value.isEmpty ||
      value.length > maximum ||
      value != value.trim()) {
    throw BundleValidationException('Survey $key is invalid.');
  }
  return value;
}

String _plainText(
  Map<String, Object?> json,
  String key, {
  required int maximum,
}) {
  final value = _string(json, key, maximum: maximum);
  if (_htmlPattern.hasMatch(value)) {
    throw BundleValidationException('Survey $key must be plain text.');
  }
  return value;
}

String _uuid(Map<String, Object?> json, String key) {
  final value = _string(json, key, maximum: 36);
  if (!_uuidPattern.hasMatch(value)) {
    throw BundleValidationException('Survey $key is invalid.');
  }
  return value;
}

int _positiveInt(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! int || value <= 0) {
    throw BundleValidationException('Survey $key is invalid.');
  }
  return value;
}
