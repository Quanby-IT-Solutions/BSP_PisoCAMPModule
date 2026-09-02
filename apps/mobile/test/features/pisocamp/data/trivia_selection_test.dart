import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/trivia_question_document.dart';
import 'package:mobile/features/pisocamp/data/trivia_selection.dart';

Uint8List questionBytes({
  required String itemId,
  String title = "Which feature is raised to the touch?",
  String category = "security-features",
  String difficulty = "easy",
  List<Map<String, Object?>>? choices,
  List<Map<String, Object?>> relatedLinks = const [],
  Map<String, Object?> overrides = const {},
}) {
  return Uint8List.fromList(
    utf8.encode(
      jsonEncode({
        'schemaVersion': 1,
        'logicalId': 'content.$itemId',
        'contentItemId': itemId,
        'contentVersionId': '22222222-2222-4222-8222-222222222222',
        'versionNo': 4,
        'contentType': 'trivia_question',
        'title': title,
        'summary': 'A question about a banknote.',
        'body': 'The embossed value is raised, so it can be felt.',
        'seriesCode': null,
        'denominationCode': null,
        'primaryUrl': null,
        'featureLevel': null,
        'hotspot': null,
        'category': category,
        'difficulty': difficulty,
        'choices':
            choices ??
            [
              {'label': 'The embossed value', 'correct': true},
              {'label': 'The serial number', 'correct': false},
            ],
        'relatedLinks': relatedLinks,
        ...overrides,
      }),
    ),
  );
}

String itemId(int index) =>
    '11111111-1111-4111-8111-${index.toString().padLeft(12, '0')}';

TriviaQuestionDocument question(int index) =>
    TriviaQuestionDocument.parsePublished(questionBytes(itemId: itemId(index)));

void main() {
  group('reading a published question', () {
    test('reads the whole question, including which answer is correct', () {
      final parsed = TriviaQuestionDocument.parsePublished(
        questionBytes(
          itemId: itemId(1),
          difficulty: 'hard',
          relatedLinks: [
            {
              'id': '33333333-3333-4333-8333-333333333333',
              'position': 0,
              'kind': 'topic',
              'label': 'Embossed print',
              'targetContentItemId': '44444444-4444-4444-8444-444444444444',
            },
          ],
        ),
      );

      expect(parsed.question, 'Which feature is raised to the touch?');
      expect(parsed.explanation, contains('raised'));
      expect(parsed.category, 'security-features');
      expect(parsed.difficulty, TriviaDifficulty.hard);
      expect(parsed.choices, hasLength(2));
      // The correct answer travels with the question, so a device offline can
      // still mark the answer and say why.
      expect(parsed.correctChoice.label, 'The embossed value');
      expect(parsed.relatedTopics.single.label, 'Embossed print');
    });

    void rejects(String reason, Uint8List bytes) {
      test('rejects $reason', () {
        expect(
          () => TriviaQuestionDocument.parsePublished(bytes),
          throwsA(isA<BundleValidationException>()),
        );
      });
    }

    rejects(
      'a question with one choice',
      questionBytes(
        itemId: itemId(1),
        choices: [
          {'label': 'Only', 'correct': true},
        ],
      ),
    );
    rejects(
      'a question with seven choices',
      questionBytes(
        itemId: itemId(1),
        choices: List.generate(
          7,
          (index) => {'label': 'Choice $index', 'correct': index == 0},
        ),
      ),
    );
    rejects(
      'a question with no correct answer',
      questionBytes(
        itemId: itemId(1),
        choices: [
          {'label': 'A', 'correct': false},
          {'label': 'B', 'correct': false},
        ],
      ),
    );
    rejects(
      'a question with two correct answers',
      questionBytes(
        itemId: itemId(1),
        choices: [
          {'label': 'A', 'correct': true},
          {'label': 'B', 'correct': true},
        ],
      ),
    );
    rejects(
      'a repeated choice',
      questionBytes(
        itemId: itemId(1),
        choices: [
          {'label': 'Same', 'correct': true},
          {'label': 'Same', 'correct': false},
        ],
      ),
    );
    rejects(
      'a marked-up choice',
      questionBytes(
        itemId: itemId(1),
        choices: [
          {'label': '<b>A</b>', 'correct': true},
          {'label': 'B', 'correct': false},
        ],
      ),
    );
    rejects(
      'an unknown difficulty',
      questionBytes(itemId: itemId(1), difficulty: 'impossible'),
    );
    rejects(
      'a non-question document',
      questionBytes(itemId: itemId(1), overrides: {'contentType': 'advisory'}),
    );
    rejects(
      'a question carrying a disclosure level',
      questionBytes(itemId: itemId(1), overrides: {'featureLevel': 'first'}),
    );
    rejects(
      'a related link that is not a topic',
      questionBytes(
        itemId: itemId(1),
        relatedLinks: [
          {
            'id': '33333333-3333-4333-8333-333333333333',
            'position': 0,
            'kind': 'external',
            'label': 'BSP',
            'url': 'https://www.bsp.gov.ph/',
          },
        ],
      ),
    );
  });

  group('choosing the next question', () {
    TriviaSelector selectorAt(DateTime now, {int seed = 1}) =>
        TriviaSelector(random: Random(seed), clock: () => now);

    final now = DateTime.utc(2026, 9, 2, 12);

    test('offers nothing from an empty pool', () {
      expect(selectorAt(now).select(pool: const [], history: const []), isNull);
    });

    test('skips a question seen inside the window', () {
      final pool = [question(1), question(2)];
      final selected = selectorAt(now).select(
        pool: pool,
        history: [
          TriviaSighting(
            contentItemId: itemId(1),
            shownAt: now.subtract(const Duration(days: 3)),
          ),
        ],
      );

      expect(selected?.contentItemId, itemId(2));
    });

    test('offers a question again once the window has passed', () {
      final pool = [question(1)];
      final selected = selectorAt(now).select(
        pool: pool,
        history: [
          TriviaSighting(
            contentItemId: itemId(1),
            shownAt: now.subtract(const Duration(days: 8)),
          ),
        ],
      );

      expect(selected?.contentItemId, itemId(1));
    });

    test('treats the window edge as still recent', () {
      final selected = selectorAt(now).select(
        pool: [question(1), question(2)],
        history: [
          TriviaSighting(
            contentItemId: itemId(1),
            // Exactly seven days: inside the window, not outside it.
            shownAt: now.subtract(const Duration(days: 7)),
          ),
        ],
      );

      expect(selected?.contentItemId, itemId(2));
    });

    test('stands the window down rather than offering nothing', () {
      // The ticket's rule carries a condition -- "when enough questions exist"
      // -- and a pool smaller than the window cannot honour it. Repeating is
      // better than an empty prompt.
      final selected = selectorAt(now).select(
        pool: [question(1)],
        history: [TriviaSighting(contentItemId: itemId(1), shownAt: now)],
      );

      expect(selected?.contentItemId, itemId(1));
      expect(
        triviaWindowIsHonourable(poolSize: 1, recentlySeen: 1),
        isFalse,
        reason: 'and the caller can say why it repeated',
      );
      expect(triviaWindowIsHonourable(poolSize: 2, recentlySeen: 1), isTrue);
    });

    test('honours a configured window other than the default', () {
      final pool = [question(1), question(2)];
      final history = [
        TriviaSighting(
          contentItemId: itemId(1),
          shownAt: now.subtract(const Duration(days: 3)),
        ),
      ];

      expect(
        selectorAt(now).select(pool: pool, history: history, repeatDays: 1)
            is TriviaQuestionDocument,
        isTrue,
      );
      // With a one-day window the older sighting no longer excludes anything,
      // so both questions are in the running.
      final drawn = <String>{};
      for (var seed = 0; seed < 20; seed += 1) {
        drawn.add(
          selectorAt(
            now,
            seed: seed,
          ).select(pool: pool, history: history, repeatDays: 1)!.contentItemId,
        );
      }
      expect(drawn, {itemId(1), itemId(2)});
    });

    test('draws from the whole eligible pool, not just the first entry', () {
      final pool = [question(1), question(2), question(3)];
      final drawn = <String>{};
      for (var seed = 0; seed < 30; seed += 1) {
        drawn.add(
          selectorAt(
            now,
            seed: seed,
          ).select(pool: pool, history: const [])!.contentItemId,
        );
      }

      expect(drawn, hasLength(3));
    });
  });
}
