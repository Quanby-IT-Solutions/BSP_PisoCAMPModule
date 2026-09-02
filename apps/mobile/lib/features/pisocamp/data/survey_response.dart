import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/survey_document.dart';

/// One answer, in the three shapes a question can be answered in.
sealed class SurveyAnswer {
  const SurveyAnswer({required this.questionId});

  final String questionId;

  Map<String, Object?> toJson();

  static SurveyAnswer fromJson(Map<String, Object?> json) {
    final questionId = json['questionId'];
    if (questionId is! String) throw const FormatException();
    return switch (json['kind']) {
      'scale' => SurveyScaleAnswer(
        questionId: questionId,
        value: json['value'] is int
            ? json['value']! as int
            : throw const FormatException(),
      ),
      'text' => SurveyTextAnswer(
        questionId: questionId,
        value: json['value'] is String
            ? json['value']! as String
            : throw const FormatException(),
      ),
      'skipped' => SurveySkippedAnswer(questionId: questionId),
      _ => throw const FormatException(),
    };
  }
}

final class SurveyScaleAnswer extends SurveyAnswer {
  const SurveyScaleAnswer({required super.questionId, required this.value});

  final int value;

  @override
  Map<String, Object?> toJson() => {
    'kind': 'scale',
    'questionId': questionId,
    'value': value,
  };
}

final class SurveyTextAnswer extends SurveyAnswer {
  const SurveyTextAnswer({required super.questionId, required this.value});

  final String value;

  @override
  Map<String, Object?> toJson() => {
    'kind': 'text',
    'questionId': questionId,
    'value': value,
  };
}

final class SurveySkippedAnswer extends SurveyAnswer {
  const SurveySkippedAnswer({required super.questionId});

  @override
  Map<String, Object?> toJson() => {
    'kind': 'skipped',
    'questionId': questionId,
  };
}

/// One completed survey, waiting on the device until it is acknowledged.
///
/// [responseId] is minted here and is the server's primary key, so a response
/// queued offline and re-sent lands once. [consentRecordId] names the grant it
/// was given under: a response without one is refused, and the device does not
/// keep answers it has no permission to send.
final class SurveyResponse {
  SurveyResponse({
    required this.responseId,
    required this.contentItemId,
    required this.contentVersionId,
    required this.consentRecordId,
    required this.submittedAt,
    required List<SurveyAnswer> answers,
  }) : answers = List.unmodifiable(answers);

  final String responseId;
  final String contentItemId;
  final String contentVersionId;
  final String consentRecordId;
  final DateTime submittedAt;
  final List<SurveyAnswer> answers;

  /// How many questions were actually answered, for the analytics event.
  int get answeredCount =>
      answers.where((answer) => answer is! SurveySkippedAnswer).length;

  Map<String, Object?> toJson() => {
    'responseId': responseId,
    'contentItemId': contentItemId,
    'contentVersionId': contentVersionId,
    'consentRecordId': consentRecordId,
    'submittedAt': submittedAt.toUtc().toIso8601String(),
    'answers': [for (final answer in answers) answer.toJson()],
  };

  /// Reads a queued response, throwing [FormatException] for anything else.
  ///
  /// The queue quarantines what it cannot read, and it recognises that by
  /// [FormatException] — so an unreadable response costs that response rather
  /// than the whole queue.
  static SurveyResponse fromJson(Map<String, Object?> json) {
    final answers = json['answers'];
    if (answers is! List) throw const FormatException();
    final submittedAt = json['submittedAt'];
    if (submittedAt is! String) throw const FormatException();
    final parsedAt = DateTime.tryParse(submittedAt);
    if (parsedAt == null) throw const FormatException();
    return SurveyResponse(
      responseId: _string(json, 'responseId'),
      contentItemId: _string(json, 'contentItemId'),
      contentVersionId: _string(json, 'contentVersionId'),
      consentRecordId: _string(json, 'consentRecordId'),
      submittedAt: parsedAt.toUtc(),
      answers: [
        for (final answer in answers)
          if (answer is Map<String, Object?>)
            SurveyAnswer.fromJson(answer)
          else
            throw const FormatException(),
      ],
    );
  }
}

String _string(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! String || value.isEmpty) throw const FormatException();
  return value;
}

/// What a person did with a survey they were offered.
enum SurveyOutcome {
  /// Dismissed the prompt without being asked for consent.
  declinedPrompt,

  /// Read the privacy notice and said no.
  declinedNotice,

  submitted,
}

/// Checks an answer against the question it answers, before it is queued.
///
/// The server checks the same things, and refuses the batch if they do not
/// hold. Checking here as well is what keeps one bad answer from stalling a
/// queue that will never be accepted.
void assertAnswerable(SurveyDocument survey, List<SurveyAnswer> answers) {
  final byId = {for (final question in survey.questions) question.id: question};
  final answered = <String>{};
  for (final answer in answers) {
    final question = byId[answer.questionId];
    if (question == null || !answered.add(answer.questionId)) {
      throw const BundleValidationException('Survey answer is invalid.');
    }
    switch (answer) {
      case SurveySkippedAnswer():
        if (question.required) {
          throw const BundleValidationException(
            'A required question was not answered.',
          );
        }
      case SurveyTextAnswer(value: final value):
        if (question.kind != SurveyQuestionKind.text ||
            value.trim().isEmpty ||
            value.length > 1000) {
          throw const BundleValidationException('Survey answer is invalid.');
        }
      case SurveyScaleAnswer(value: final value):
        if (question.kind == SurveyQuestionKind.text ||
            value < question.scaleMin ||
            value > question.scaleMax) {
          throw const BundleValidationException('Survey answer is invalid.');
        }
    }
  }
  if (answered.length != survey.questions.length) {
    throw const BundleValidationException(
      'Every question must be answered or skipped.',
    );
  }
}
