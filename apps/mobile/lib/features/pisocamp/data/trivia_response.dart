import 'package:mobile/core/utils/uuid_v4.dart';
import 'package:mobile/features/pisocamp/data/trivia_question_document.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/trivia_prompt.dart';

/// What a correct answer is worth, by difficulty.
///
/// The same table the contract states. Scoring happens on the device because
/// marking does: a guest with no connection has already been told they were
/// right, and the server would only be repeating the arithmetic.
const Map<TriviaDifficulty, int> kTriviaPoints = {
  TriviaDifficulty.easy: 1,
  TriviaDifficulty.medium: 2,
  TriviaDifficulty.hard: 3,
};

int triviaPointsFor(TriviaDifficulty difficulty) =>
    kTriviaPoints[difficulty] ?? 0;

/// Somewhere an answer can be recorded.
///
/// An interface so the prompt's coordinator depends on "the answer is kept"
/// rather than on how, and so a guest's device and a registered user's device
/// take exactly the same path.
abstract interface class TriviaResponseSink {
  Future<void> record(TriviaResponseRecord response);
}

/// One recorded presentation and its outcome.
///
/// [responseId] is minted on the device and is the server's primary key, so a
/// batch re-sent after a dropped connection lands once. Nothing here names the
/// person: identity is the account the batch is uploaded under, and a guest
/// has none.
final class TriviaResponseRecord {
  const TriviaResponseRecord({
    required this.responseId,
    required this.contentItemId,
    required this.contentVersionId,
    required this.category,
    required this.difficulty,
    required this.correct,
    required this.skipped,
    required this.linkOpened,
    required this.points,
    required this.answeredAt,
    this.synced = false,
  });

  /// Builds the record for a finished prompt.
  ///
  /// The outcome decides every derived field, so a caller cannot record a
  /// skipped question that scored or a correct answer that opened a link —
  /// combinations the contract and the database both refuse.
  factory TriviaResponseRecord.fromPrompt({
    required TriviaQuestionDocument question,
    required TriviaPromptResult result,
    required DateTime answeredAt,
    String? responseId,
  }) {
    final correct = result.outcome == TriviaPromptOutcome.answeredCorrectly;
    final skipped = result.outcome == TriviaPromptOutcome.skipped;
    return TriviaResponseRecord(
      responseId: responseId ?? createUuidV4(),
      contentItemId: question.contentItemId,
      contentVersionId: question.contentVersionId,
      category: question.category,
      difficulty: question.difficulty,
      correct: correct,
      skipped: skipped,
      linkOpened: !correct && !skipped && result.openedTopic,
      points: correct ? triviaPointsFor(question.difficulty) : 0,
      answeredAt: answeredAt.toUtc(),
    );
  }

  final String responseId;
  final String contentItemId;
  final String contentVersionId;
  final String category;
  final TriviaDifficulty difficulty;
  final bool correct;
  final bool skipped;
  final bool linkOpened;
  final int points;
  final DateTime answeredAt;

  /// Whether the server has acknowledged holding this response.
  final bool synced;

  TriviaResponseRecord asSynced() => TriviaResponseRecord(
    responseId: responseId,
    contentItemId: contentItemId,
    contentVersionId: contentVersionId,
    category: category,
    difficulty: difficulty,
    correct: correct,
    skipped: skipped,
    linkOpened: linkOpened,
    points: points,
    answeredAt: answeredAt,
    synced: true,
  );

  /// The upload shape. `synced` is device bookkeeping and is not sent.
  Map<String, Object?> toUploadJson() => {
    'responseId': responseId,
    'contentItemId': contentItemId,
    'contentVersionId': contentVersionId,
    'category': category,
    'difficulty': difficulty.name,
    'correct': correct,
    'skipped': skipped,
    'linkOpened': linkOpened,
    'points': points,
    'answeredAt': answeredAt.toUtc().toIso8601String(),
  };

  Map<String, Object?> toStorageJson() => {...toUploadJson(), 'synced': synced};

  /// Reads a stored record, or returns null if it is not one.
  ///
  /// Null rather than an exception: one corrupt entry should cost that entry,
  /// not the whole history.
  static TriviaResponseRecord? tryFromStorageJson(Object? value) {
    if (value is! Map) return null;
    final map = Map<Object?, Object?>.from(value);
    final responseId = map['responseId'];
    final contentItemId = map['contentItemId'];
    final contentVersionId = map['contentVersionId'];
    final category = map['category'];
    final difficulty = map['difficulty'];
    final correct = map['correct'];
    final skipped = map['skipped'];
    final linkOpened = map['linkOpened'];
    final points = map['points'];
    final answeredAt = map['answeredAt'];
    if (responseId is! String ||
        contentItemId is! String ||
        contentVersionId is! String ||
        category is! String ||
        difficulty is! String ||
        correct is! bool ||
        skipped is! bool ||
        linkOpened is! bool ||
        points is! int ||
        answeredAt is! String) {
      return null;
    }
    TriviaDifficulty? parsedDifficulty;
    for (final candidate in TriviaDifficulty.values) {
      if (candidate.name == difficulty) parsedDifficulty = candidate;
    }
    final parsedAnsweredAt = DateTime.tryParse(answeredAt);
    if (parsedDifficulty == null || parsedAnsweredAt == null) return null;
    // The impossible combinations are refused here too, so a hand-edited
    // preferences file cannot make the device upload something the server
    // will reject for every batch it is part of.
    if (skipped && (correct || points > 0 || linkOpened)) return null;
    if (correct && linkOpened) return null;
    if (correct != points > 0) return null;
    return TriviaResponseRecord(
      responseId: responseId,
      contentItemId: contentItemId,
      contentVersionId: contentVersionId,
      category: category,
      difficulty: parsedDifficulty,
      correct: correct,
      skipped: skipped,
      linkOpened: linkOpened,
      points: points,
      answeredAt: parsedAnsweredAt.toUtc(),
      synced: map['synced'] == true,
    );
  }
}
