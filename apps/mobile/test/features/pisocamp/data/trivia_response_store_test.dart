import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/trivia_question_document.dart';
import 'package:mobile/features/pisocamp/data/trivia_response.dart';
import 'package:mobile/features/pisocamp/data/trivia_response_store.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/trivia_prompt.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'trivia_selection_test.dart' show questionBytes;

TriviaResponseRecord record(
  int index, {
  bool correct = true,
  bool skipped = false,
  bool linkOpened = false,
  int points = 1,
  TriviaDifficulty difficulty = TriviaDifficulty.easy,
  bool synced = false,
  DateTime? answeredAt,
}) {
  return TriviaResponseRecord(
    responseId: '8e2a4a6c-6d0b-4a1a-9d1e-${index.toString().padLeft(12, '0')}',
    contentItemId: '3f3d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61',
    contentVersionId: '0d5b0a3f-1c88-4f27-8f0e-2d0d0a6f9b74',
    category: 'security-features',
    difficulty: difficulty,
    correct: correct,
    skipped: skipped,
    linkOpened: linkOpened,
    points: points,
    answeredAt: answeredAt ?? DateTime.utc(2026, 9, 2, 4, index),
    synced: synced,
  );
}

void main() {
  late SharedPreferences preferences;
  late PreferencesTriviaResponseStore store;

  setUp(() async {
    SharedPreferences.setMockInitialValues(const {});
    preferences = await SharedPreferences.getInstance();
    store = PreferencesTriviaResponseStore(preferences);
  });

  group('scoring', () {
    test('pays a correct answer by difficulty and a wrong one nothing', () {
      expect(triviaPointsFor(TriviaDifficulty.easy), 1);
      expect(triviaPointsFor(TriviaDifficulty.medium), 2);
      expect(triviaPointsFor(TriviaDifficulty.hard), 3);
    });

    test('builds each outcome from the prompt result', () {
      final question = TriviaQuestionDocument.parsePublished(
        questionBytes(
          itemId: '11111111-1111-4111-8111-111111111111',
          difficulty: 'hard',
        ),
      );
      final at = DateTime.utc(2026, 9, 2, 4);

      final correct = TriviaResponseRecord.fromPrompt(
        question: question,
        result: const TriviaPromptResult(
          outcome: TriviaPromptOutcome.answeredCorrectly,
          openedTopic: false,
        ),
        answeredAt: at,
      );
      final wrong = TriviaResponseRecord.fromPrompt(
        question: question,
        result: const TriviaPromptResult(
          outcome: TriviaPromptOutcome.answeredIncorrectly,
          openedTopic: true,
        ),
        answeredAt: at,
      );
      final skip = TriviaResponseRecord.fromPrompt(
        question: question,
        result: const TriviaPromptResult(
          outcome: TriviaPromptOutcome.skipped,
          openedTopic: false,
        ),
        answeredAt: at,
      );

      expect(correct.points, 3);
      expect(correct.correct, isTrue);
      expect(correct.linkOpened, isFalse);
      expect(wrong.points, 0);
      expect(wrong.linkOpened, isTrue);
      expect(skip.skipped, isTrue);
      expect(skip.points, 0);
      expect(skip.linkOpened, isFalse);
      // Every record carries the question and the version it was answered
      // against, so a later reconciliation knows which wording was marked.
      expect(correct.contentItemId, question.contentItemId);
      expect(correct.contentVersionId, question.contentVersionId);
      expect(correct.category, question.category);
    });

    test('mints a distinct response id for every recorded answer', () {
      final question = TriviaQuestionDocument.parsePublished(
        questionBytes(itemId: '11111111-1111-4111-8111-111111111111'),
      );
      final ids = {
        for (var index = 0; index < 20; index += 1)
          TriviaResponseRecord.fromPrompt(
            question: question,
            result: const TriviaPromptResult(
              outcome: TriviaPromptOutcome.skipped,
              openedTopic: false,
            ),
            answeredAt: DateTime.utc(2026, 9, 2),
          ).responseId,
      };

      expect(ids, hasLength(20));
    });
  });

  group('recording', () {
    test('keeps every field of an answer, a skip and a wrong answer', () async {
      await store.record(record(1));
      await store.record(record(2, correct: false, skipped: true, points: 0));
      await store.record(
        record(3, correct: false, points: 0, linkOpened: true),
      );

      final stored = await store.readAll();
      expect(stored, hasLength(3));
      expect(stored[0].correct, isTrue);
      expect(stored[0].points, 1);
      expect(stored[1].skipped, isTrue);
      expect(stored[2].linkOpened, isTrue);
      expect(stored.every((entry) => !entry.synced), isTrue);
    });

    test('records the same response id once', () async {
      // A retried write is the ordinary case after an interrupted save, and
      // counting the answer twice would be a defect the server never sees.
      await store.record(record(1));
      await store.record(record(1, correct: false, points: 0, skipped: true));

      final stored = await store.readAll();
      expect(stored, hasLength(1));
      expect(stored.single.correct, isTrue);
    });

    test('survives a restart, because the device is the only copy', () async {
      await store.record(record(1));

      final reopened = PreferencesTriviaResponseStore(preferences);

      expect(await reopened.readPending(), hasLength(1));
    });
  });

  group('pending and acknowledgement', () {
    test('offers only what the server has not acknowledged', () async {
      await store.record(record(1));
      await store.record(record(2));

      await store.markSynced([record(1).responseId]);

      final pending = await store.readPending();
      expect(pending.map((entry) => entry.responseId), [
        record(2).responseId,
      ]);
      // The acknowledged answer is kept, not deleted: it is the person's own
      // history, and GM-5 will show it.
      expect(await store.readAll(), hasLength(2));
    });

    test('never proposes more than the server will take in one batch', () async {
      for (var index = 0; index < 120; index += 1) {
        await store.record(record(index));
      }

      expect(await store.readPending(), hasLength(100));
      expect(await store.readAll(), hasLength(120));
    });

    test('acknowledging an id it does not hold changes nothing', () async {
      await store.record(record(1));

      await store.markSynced(['11111111-1111-4111-8111-111111111111']);

      expect(await store.readPending(), hasLength(1));
    });

    test('keeps pending answers even past the synced history cap', () async {
      for (var index = 0; index < 600; index += 1) {
        await store.record(record(index, synced: true));
      }
      await store.record(record(900));

      final all = await store.readAll();
      // Synced history is trimmed; the unacknowledged answer is not, because
      // nobody else holds it.
      expect(all.where((entry) => entry.synced), hasLength(500));
      expect(await store.readPending(), hasLength(1));
    });
  });

  group('reading what is on disk', () {
    Future<List<TriviaResponseRecord>> readStored(Object? stored) async {
      SharedPreferences.setMockInitialValues({
        PreferencesTriviaResponseStore.storageKey: jsonEncode(stored),
      });
      return PreferencesTriviaResponseStore(
        await SharedPreferences.getInstance(),
      ).readAll();
    }

    test('skips one unreadable entry rather than the whole history', () async {
      final stored = await readStored([
        record(1).toStorageJson(),
        'not a record',
        {'responseId': 'incomplete'},
      ]);

      expect(stored, hasLength(1));
    });

    test('returns nothing for a file that is not a list', () async {
      expect(await readStored({'responses': []}), isEmpty);
    });

    test('refuses combinations the server would reject for the batch', () async {
      // One hand-edited row must not be able to poison every upload it is
      // part of, so the impossible outcomes are refused on the way in.
      final stored = await readStored([
        {...record(1).toStorageJson(), 'skipped': true},
        {...record(2).toStorageJson(), 'linkOpened': true},
        {...record(3).toStorageJson(), 'points': 0},
        {...record(4).toStorageJson(), 'difficulty': 'impossible'},
        {...record(5).toStorageJson(), 'answeredAt': 'not a time'},
        record(6).toStorageJson(),
      ]);

      expect(stored.map((entry) => entry.responseId), [record(6).responseId]);
    });
  });

  group('the merge marker', () {
    test('is unset until an account claims the backlog', () async {
      expect(await store.readMergedAccountId(), isNull);

      await store.recordMerged('account-one');

      expect(await store.readMergedAccountId(), 'account-one');
    });
  });
}
