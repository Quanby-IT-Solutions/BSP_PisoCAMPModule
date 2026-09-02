import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/trivia_question_document.dart';
import 'package:mobile/features/pisocamp/data/trivia_selection.dart';
import 'package:mobile/features/pisocamp/presentation/providers/trivia_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/trivia_prompt.dart';

import '../data/trivia_selection_test.dart' show questionBytes;

const _itemId = '11111111-1111-4111-8111-111111111111';
const _topicId = '44444444-4444-4444-8444-444444444444';

TriviaQuestionDocument buildQuestion({bool withTopic = true}) {
  return TriviaQuestionDocument.parsePublished(
    questionBytes(
      itemId: _itemId,
      relatedLinks: withTopic
          ? [
              {
                'id': '33333333-3333-4333-8333-333333333333',
                'position': 0,
                'kind': 'topic',
                'label': 'Embossed print',
                'targetContentItemId': _topicId,
              },
            ]
          : const [],
    ),
  );
}

final class _RecordingTriviaAnalytics implements TriviaAnalytics {
  final List<String> events = [];

  @override
  Future<void> recordShown(TriviaQuestionDocument question) async =>
      events.add('shown:${question.contentItemId}');

  @override
  Future<void> recordAnswered(
    TriviaQuestionDocument question, {
    required bool correct,
    required bool openedTopic,
  }) async => events.add('answered:$correct:$openedTopic');

  @override
  Future<void> recordSkipped(TriviaQuestionDocument question) async =>
      events.add('skipped:${question.contentItemId}');
}

final class _MemoryHistory implements TriviaHistoryStore {
  final List<TriviaSighting> sightings = [];

  @override
  Future<List<TriviaSighting>> readSightings() async => sightings;

  @override
  Future<void> recordShown(String contentItemId, DateTime shownAt) async {
    sightings.add(
      TriviaSighting(contentItemId: contentItemId, shownAt: shownAt),
    );
  }
}

void main() {
  Widget subject({
    required ValueChanged<TriviaPromptResult> onFinished,
    bool keepResult = false,
    bool reduceMotion = false,
    bool withTopic = true,
    void Function(TriviaRelatedTopic topic)? onOpenTopic,
  }) {
    return MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(disableAnimations: reduceMotion),
        child: Scaffold(
          body: TriviaPrompt(
            question: buildQuestion(withTopic: withTopic),
            onFinished: onFinished,
            keepResult: keepResult,
            onOpenTopic: onOpenTopic,
          ),
        ),
      ),
    );
  }

  testWidgets('offers the question and every choice', (tester) async {
    await tester.pumpWidget(subject(onFinished: (_) {}));

    expect(find.text('Which feature is raised to the touch?'), findsOneWidget);
    expect(find.text('The embossed value'), findsOneWidget);
    expect(find.text('The serial number'), findsOneWidget);
    expect(find.widgetWithText(TextButton, 'Skip'), findsOneWidget);
  });

  testWidgets('skips without answering, and the module carries on', (
    tester,
  ) async {
    TriviaPromptResult? result;
    await tester.pumpWidget(subject(onFinished: (value) => result = value));

    await tester.tap(find.widgetWithText(TextButton, 'Skip'));
    await tester.pumpAndSettle();

    expect(result?.outcome, TriviaPromptOutcome.skipped);
    expect(result?.openedTopic, isFalse);
  });

  testWidgets(
    'congratulates a correct answer and closes itself after five seconds',
    (tester) async {
      TriviaPromptResult? result;
      await tester.pumpWidget(subject(onFinished: (value) => result = value));

      await tester.tap(find.text('The embossed value'));
      await tester.pump();
      expect(find.text('Correct. Well done.'), findsOneWidget);
      expect(result, isNull, reason: 'the result is readable first');

      await tester.pump(const Duration(seconds: 4));
      expect(result, isNull);
      await tester.pump(const Duration(seconds: 1));

      expect(result?.outcome, TriviaPromptOutcome.answeredCorrectly);
    },
  );

  testWidgets('keeps a correct result on screen when asked to', (tester) async {
    TriviaPromptResult? result;
    await tester.pumpWidget(
      subject(onFinished: (value) => result = value, keepResult: true),
    );

    await tester.tap(find.text('The embossed value'));
    await tester.pump(const Duration(seconds: 30));

    // Five seconds is not long for everyone, and the people it is shortest for
    // are exactly the ones an auto-close hurts.
    expect(result, isNull);
    expect(find.text('Correct. Well done.'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Close'));
    await tester.pumpAndSettle();
    expect(result?.outcome, TriviaPromptOutcome.answeredCorrectly);
  });

  testWidgets('reduced motion also stops the prompt closing under you', (
    tester,
  ) async {
    TriviaPromptResult? result;
    await tester.pumpWidget(
      subject(onFinished: (value) => result = value, reduceMotion: true),
    );

    await tester.tap(find.text('The embossed value'));
    await tester.pump(const Duration(seconds: 30));

    expect(result, isNull);
  });

  testWidgets('shows the answer, the explanation and the topic when wrong', (
    tester,
  ) async {
    await tester.pumpWidget(subject(onFinished: (_) {}));

    await tester.tap(find.text('The serial number'));
    await tester.pumpAndSettle();

    expect(find.text('Not quite.'), findsOneWidget);
    expect(find.text('The answer is: The embossed value'), findsOneWidget);
    expect(find.textContaining('raised, so it can be felt'), findsOneWidget);
    expect(find.textContaining('Read about Embossed print'), findsOneWidget);
  });

  testWidgets('an incorrect answer never closes itself', (tester) async {
    TriviaPromptResult? result;
    await tester.pumpWidget(subject(onFinished: (value) => result = value));

    await tester.tap(find.text('The serial number'));
    await tester.pump(const Duration(seconds: 30));

    // There is more to read after a wrong answer, so the prompt waits.
    expect(result, isNull);
  });

  testWidgets('opening the topic is the guest choice, and is reported', (
    tester,
  ) async {
    TriviaPromptResult? result;
    TriviaRelatedTopic? opened;
    await tester.pumpWidget(
      subject(
        onFinished: (value) => result = value,
        onOpenTopic: (topic) => opened = topic,
      ),
    );

    await tester.tap(find.text('The serial number'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Read about Embossed print'));
    await tester.pumpAndSettle();

    expect(opened?.contentItemId, _topicId);
    expect(result?.outcome, TriviaPromptOutcome.answeredIncorrectly);
    expect(result?.openedTopic, isTrue);
  });

  testWidgets('a question with no topic simply offers none', (tester) async {
    await tester.pumpWidget(subject(onFinished: (_) {}, withTopic: false));

    await tester.tap(find.text('The serial number'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Read about'), findsNothing);
    expect(find.text('The answer is: The embossed value'), findsOneWidget);
  });

  testWidgets('answers once, however many times a choice is pressed', (
    tester,
  ) async {
    var finished = 0;
    await tester.pumpWidget(subject(onFinished: (_) => finished += 1));

    await tester.tap(find.text('The serial number'));
    await tester.pumpAndSettle();
    // The choices are disabled once answered, so a second press changes
    // nothing rather than re-marking the guest.
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'The embossed value'),
          )
          .onPressed,
      isNull,
    );

    await tester.tap(find.widgetWithText(TextButton, 'Close'));
    await tester.tap(
      find.widgetWithText(TextButton, 'Close'),
      warnIfMissed: false,
    );
    await tester.pumpAndSettle();
    expect(finished, 1);
  });

  group('TriviaPromptCoordinator', () {
    test(
      'records the sighting when the question is shown, not when answered',
      () async {
        // A guest who skips has still seen the question; offering it again
        // tomorrow is the repeat the window exists to prevent.
        final history = _MemoryHistory();
        final analytics = _RecordingTriviaAnalytics();
        final coordinator = TriviaPromptCoordinator(
          selector: TriviaSelector(clock: () => DateTime.utc(2026, 9, 2)),
          history: history,
          analytics: analytics,
          repeatDays: kDefaultTriviaRepeatDays,
          clock: () => DateTime.utc(2026, 9, 2),
        );

        final question = await coordinator.next([buildQuestion()]);

        expect(question, isNotNull);
        expect(history.sightings.single.contentItemId, _itemId);
        expect(analytics.events, ['shown:$_itemId']);
      },
    );

    test('reports an empty pool without recording anything', () async {
      final history = _MemoryHistory();
      final analytics = _RecordingTriviaAnalytics();
      final coordinator = TriviaPromptCoordinator(
        selector: TriviaSelector(),
        history: history,
        analytics: analytics,
        repeatDays: kDefaultTriviaRepeatDays,
      );

      expect(await coordinator.next(const []), isNull);
      expect(history.sightings, isEmpty);
      expect(analytics.events, isEmpty);
    });

    test('reports each outcome as its own event', () async {
      final analytics = _RecordingTriviaAnalytics();
      final coordinator = TriviaPromptCoordinator(
        selector: TriviaSelector(),
        history: _MemoryHistory(),
        analytics: analytics,
        repeatDays: kDefaultTriviaRepeatDays,
      );
      final question = buildQuestion();

      await coordinator.record(
        question,
        const TriviaPromptResult(
          outcome: TriviaPromptOutcome.skipped,
          openedTopic: false,
        ),
      );
      await coordinator.record(
        question,
        const TriviaPromptResult(
          outcome: TriviaPromptOutcome.answeredCorrectly,
          openedTopic: false,
        ),
      );
      await coordinator.record(
        question,
        const TriviaPromptResult(
          outcome: TriviaPromptOutcome.answeredIncorrectly,
          openedTopic: true,
        ),
      );

      expect(analytics.events, [
        'skipped:$_itemId',
        'answered:true:false',
        'answered:false:true',
      ]);
    });
  });
}
