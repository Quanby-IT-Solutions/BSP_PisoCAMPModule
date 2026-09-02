import 'dart:typed_data';

import 'bundle_protocol.dart';

/// One answer a question offers.
final class TriviaChoice {
  const TriviaChoice({required this.label, required this.correct});

  final String label;
  final bool correct;
}

/// How hard a question is, as the approved vocabulary names it.
enum TriviaDifficulty { easy, medium, hard }

/// A published trivia question, read from the offline bundle.
///
/// The correct answer travels with the question because selection and marking
/// both happen on the device: a guest with no connection still gets told
/// whether they were right, and why.
///
/// Only published *and active* questions ever reach a device — the bundle
/// withholds the rest — so there is no active flag here to check. A document
/// that arrived with one would be a bundle that broke its promise, and the
/// reader refuses it rather than filtering it.
final class TriviaQuestionDocument {
  TriviaQuestionDocument._({
    required this.logicalId,
    required this.contentItemId,
    required this.contentVersionId,
    required this.versionNo,
    required this.question,
    required this.summary,
    required this.explanation,
    required this.category,
    required this.difficulty,
    required List<TriviaChoice> choices,
    required List<TriviaRelatedTopic> relatedTopics,
  }) : choices = List.unmodifiable(choices),
       relatedTopics = List.unmodifiable(relatedTopics);

  final String logicalId;
  final String contentItemId;
  final String contentVersionId;
  final int versionNo;

  /// The question itself, which is the content item's title.
  final String question;
  final String summary;

  /// Why the correct answer is correct, which is the item's body.
  final String explanation;

  final String category;
  final TriviaDifficulty difficulty;
  final List<TriviaChoice> choices;

  /// Topics an incorrect answer may offer to open.
  final List<TriviaRelatedTopic> relatedTopics;

  TriviaChoice get correctChoice =>
      choices.firstWhere((choice) => choice.correct);

  static const _maximumDocumentBytes = 64 * 1024;

  /// Parses a published question, or throws [BundleValidationException].
  ///
  /// Strict in the same way the currency reader is: a question is the thing a
  /// guest is marked against, so a malformed one is refused rather than shown
  /// with a missing or ambiguous answer.
  static TriviaQuestionDocument parsePublished(Uint8List bytes) {
    final json = decodeStrictJsonObject(
      bytes,
      maximumBytes: _maximumDocumentBytes,
      context: 'published trivia question',
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
      'category',
      'difficulty',
      'choices',
      'relatedLinks',
    }, context: 'published trivia question');

    if (json['schemaVersion'] != 1) {
      throw const BundleValidationException(
        'Trivia question schemaVersion must be 1.',
      );
    }
    if (json['contentType'] != 'trivia_question') {
      throw const BundleValidationException(
        'Published content is not a trivia question.',
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
        throw BundleValidationException('Trivia question $key must be null.');
      }
    }

    final contentItemId = _uuid(json, 'contentItemId');
    final logicalId = _string(json, 'logicalId', maximum: 160);
    if (logicalId != 'content.$contentItemId') {
      throw const BundleValidationException(
        'Trivia question logicalId does not match its content item.',
      );
    }

    return TriviaQuestionDocument._(
      logicalId: logicalId,
      contentItemId: contentItemId,
      contentVersionId: _uuid(json, 'contentVersionId'),
      versionNo: _positiveInt(json, 'versionNo'),
      question: _plainText(json, 'title', maximum: 160),
      summary: _plainText(json, 'summary', maximum: 500),
      explanation: _plainText(json, 'body', maximum: 10000),
      category: _code(json, 'category'),
      difficulty: _difficulty(json['difficulty']),
      choices: _choices(json['choices']),
      relatedTopics: _relatedTopics(json['relatedLinks']),
    );
  }
}

/// A topic an incorrect answer may offer to open.
final class TriviaRelatedTopic {
  const TriviaRelatedTopic({required this.label, required this.contentItemId});

  final String label;
  final String contentItemId;
}

TriviaDifficulty _difficulty(Object? value) {
  return switch (value) {
    'easy' => TriviaDifficulty.easy,
    'medium' => TriviaDifficulty.medium,
    'hard' => TriviaDifficulty.hard,
    _ => throw const BundleValidationException(
      'Trivia question difficulty is not supported.',
    ),
  };
}

List<TriviaChoice> _choices(Object? value) {
  if (value is! List<Object?> || value.length < 2 || value.length > 6) {
    throw const BundleValidationException(
      'A trivia question must offer two to six choices.',
    );
  }
  final choices = <TriviaChoice>[];
  final labels = <String>{};
  var correct = 0;
  for (final item in value) {
    if (item is! Map<String, Object?>) {
      throw const BundleValidationException('Trivia choice is invalid.');
    }
    requireExactJsonKeys(item, const {
      'label',
      'correct',
    }, context: 'trivia choice');
    final label = _plainText(item, 'label', maximum: 200);
    if (!labels.add(label)) {
      throw const BundleValidationException(
        'A trivia question cannot repeat a choice.',
      );
    }
    final isCorrect = item['correct'];
    if (isCorrect is! bool) {
      throw const BundleValidationException('Trivia choice is invalid.');
    }
    if (isCorrect) correct += 1;
    choices.add(TriviaChoice(label: label, correct: isCorrect));
  }
  if (correct != 1) {
    throw const BundleValidationException(
      'A trivia question must have exactly one correct answer.',
    );
  }
  return choices;
}

/// Topic links only. An external or internal link on a question is refused
/// rather than ignored: the prompt offers to open "the related topic", and a
/// destination that is not one would be a different promise.
List<TriviaRelatedTopic> _relatedTopics(Object? value) {
  if (value is! List<Object?> || value.length > 10) {
    throw const BundleValidationException(
      'Trivia question relatedLinks is invalid.',
    );
  }
  final topics = <TriviaRelatedTopic>[];
  for (final item in value) {
    if (item is! Map<String, Object?>) {
      throw const BundleValidationException(
        'Trivia question related link is invalid.',
      );
    }
    if (item['kind'] != 'topic') {
      throw const BundleValidationException(
        'A trivia question may only link to a topic.',
      );
    }
    requireExactJsonKeys(item, const {
      'id',
      'position',
      'kind',
      'label',
      'targetContentItemId',
    }, context: 'trivia related topic');
    topics.add(
      TriviaRelatedTopic(
        label: _plainText(item, 'label', maximum: 100),
        contentItemId: _uuid(item, 'targetContentItemId'),
      ),
    );
  }
  return topics;
}

final _codePattern = RegExp(r'^[a-z0-9]+(?:-[a-z0-9]+)*$');
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
    throw BundleValidationException('Trivia question $key is invalid.');
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
    throw BundleValidationException('Trivia question $key must be plain text.');
  }
  return value;
}

String _code(Map<String, Object?> json, String key) {
  final value = _string(json, key, maximum: 64);
  if (!_codePattern.hasMatch(value)) {
    throw BundleValidationException('Trivia question $key is invalid.');
  }
  return value;
}

String _uuid(Map<String, Object?> json, String key) {
  final value = _string(json, key, maximum: 36);
  if (!_uuidPattern.hasMatch(value)) {
    throw BundleValidationException('Trivia question $key is invalid.');
  }
  return value;
}

int _positiveInt(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! int || value <= 0) {
    throw BundleValidationException('Trivia question $key is invalid.');
  }
  return value;
}
