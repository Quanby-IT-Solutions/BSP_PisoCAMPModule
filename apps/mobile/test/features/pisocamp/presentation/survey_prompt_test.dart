import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/survey_document.dart';
import 'package:mobile/features/pisocamp/data/survey_response.dart';
import 'package:mobile/features/pisocamp/presentation/providers/survey_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/survey_prompt.dart';

import '../data/survey_document_test.dart'
    show npsQuestion, ratingQuestion, surveyBytes, textQuestion;

SurveyDocument buildSurvey({List<Map<String, Object?>>? questions}) {
  return SurveyDocument.parsePublished(
    surveyBytes(questions: questions ?? [ratingQuestion(), textQuestion()]),
  );
}

final class _RecordingAnalytics implements SurveyAnalytics {
  final List<String> events = [];

  @override
  Future<void> recordShown(SurveyDocument survey) =>
      Future.sync(() => events.add('shown:${survey.purpose.name}'));

  @override
  Future<void> recordDeclined(SurveyDocument survey, SurveyOutcome outcome) =>
      Future.sync(() => events.add('declined:${outcome.name}'));

  @override
  Future<void> recordSubmitted(SurveyDocument survey, int answeredCount) =>
      Future.sync(() => events.add('submitted:$answeredCount'));
}

void main() {
  Widget subject({
    required ValueChanged<SurveyPromptResult> onFinished,
    bool alreadyGranted = true,
    Future<bool> Function({required bool granted})? onDecision,
    List<Map<String, Object?>>? questions,
  }) {
    return MaterialApp(
      home: Scaffold(
        body: SurveyPrompt(
          survey: buildSurvey(questions: questions),
          consent: SurveyConsentGate(
            alreadyGranted: alreadyGranted,
            noticeTitle: 'How we use your answers',
            noticeBody: 'Your answers are kept apart from anything that names you.',
            onDecision: onDecision ?? ({required bool granted}) async => granted,
          ),
          onFinished: onFinished,
        ),
      ),
    );
  }

  group('AC1 — declining is always available and costs nothing', () {
    testWidgets('declines the prompt with one tap and no confirmation', (
      tester,
    ) async {
      SurveyPromptResult? result;
      await tester.pumpWidget(subject(onFinished: (value) => result = value));

      await tester.tap(find.widgetWithText(TextButton, 'Not now'));
      await tester.pumpAndSettle();

      expect(result?.outcome, SurveyOutcome.declinedPrompt);
      expect(result?.answers, isEmpty);
      // No dialog appeared between the tap and the outcome.
      expect(find.byType(AlertDialog), findsNothing);
    });

    testWidgets('cancels part-way through without collecting the answers', (
      tester,
    ) async {
      SurveyPromptResult? result;
      await tester.pumpWidget(subject(onFinished: (value) => result = value));

      await tester.tap(find.text('Answer the survey'));
      await tester.pumpAndSettle();
      await tester.tap(find.bySemanticsLabel('How clear was this topic?: 4'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
      await tester.pumpAndSettle();

      expect(result?.outcome, SurveyOutcome.declinedPrompt);
      expect(result?.answers, isEmpty);
    });
  });

  group('AC2 — the notice comes first, and declining collects nothing', () {
    testWidgets('shows the notice before any question', (tester) async {
      await tester.pumpWidget(
        subject(onFinished: (_) {}, alreadyGranted: false),
      );

      await tester.tap(find.text('Answer the survey'));
      await tester.pumpAndSettle();

      expect(find.text('How we use your answers'), findsOneWidget);
      expect(find.text('How clear was this topic?'), findsNothing);
    });

    testWidgets('declining the notice ends it with nothing collected', (
      tester,
    ) async {
      SurveyPromptResult? result;
      var recorded = <bool>[];
      await tester.pumpWidget(
        subject(
          onFinished: (value) => result = value,
          alreadyGranted: false,
          onDecision: ({required bool granted}) async {
            recorded.add(granted);
            return granted;
          },
        ),
      );

      await tester.tap(find.text('Answer the survey'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'No thanks'));
      await tester.pumpAndSettle();

      expect(result?.outcome, SurveyOutcome.declinedNotice);
      expect(result?.answers, isEmpty);
      // The refusal is recorded as a refusal; nothing else is.
      expect(recorded, [false]);
      expect(find.text('How clear was this topic?'), findsNothing);
    });

    testWidgets('agreeing opens the questions', (tester) async {
      await tester.pumpWidget(
        subject(onFinished: (_) {}, alreadyGranted: false),
      );

      await tester.tap(find.text('Answer the survey'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'I agree'));
      await tester.pumpAndSettle();

      expect(find.text('How clear was this topic? *'), findsOneWidget);
    });

    testWidgets('a consent that could not be recorded starts nothing', (
      tester,
    ) async {
      SurveyPromptResult? result;
      await tester.pumpWidget(
        subject(
          onFinished: (value) => result = value,
          alreadyGranted: false,
          onDecision: ({required bool granted}) async => false,
        ),
      );

      await tester.tap(find.text('Answer the survey'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'I agree'));
      await tester.pumpAndSettle();

      expect(result?.outcome, SurveyOutcome.declinedNotice);
      expect(find.text('How clear was this topic? *'), findsNothing);
    });

    testWidgets('an existing grant skips the notice entirely', (tester) async {
      await tester.pumpWidget(subject(onFinished: (_) {}));

      await tester.tap(find.text('Answer the survey'));
      await tester.pumpAndSettle();

      expect(find.text('How we use your answers'), findsNothing);
      expect(find.text('How clear was this topic? *'), findsOneWidget);
    });
  });

  group('answering', () {
    testWidgets('reports a score and a written answer', (tester) async {
      SurveyPromptResult? result;
      await tester.pumpWidget(subject(onFinished: (value) => result = value));

      await tester.tap(find.text('Answer the survey'));
      await tester.pumpAndSettle();
      await tester.tap(find.bySemanticsLabel('How clear was this topic?: 4'));
      await tester.enterText(find.byType(TextField), 'Nothing, it was clear.');
      await tester.tap(find.widgetWithText(FilledButton, 'Submit'));
      await tester.pumpAndSettle();

      expect(result?.outcome, SurveyOutcome.submitted);
      final answers = result!.answers;
      expect((answers.first as SurveyScaleAnswer).value, 4);
      expect(
        (answers.last as SurveyTextAnswer).value,
        'Nothing, it was clear.',
      );
    });

    testWidgets('offers the scale the question actually uses', (tester) async {
      await tester.pumpWidget(
        subject(onFinished: (_) {}, questions: [npsQuestion(), textQuestion()]),
      );

      await tester.tap(find.text('Answer the survey'));
      await tester.pumpAndSettle();

      // An NPS runs 0 to 10, and a rating 1 to 5; the prompt asks for what the
      // question actually uses rather than a scale of its own.
      expect(
        find.bySemanticsLabel(
          'How likely are you to recommend Piso CAMP?: 0',
        ),
        findsOneWidget,
      );
      expect(
        find.bySemanticsLabel(
          'How likely are you to recommend Piso CAMP?: 10',
        ),
        findsOneWidget,
      );
    });

    testWidgets('skips an optional question that was left alone', (
      tester,
    ) async {
      SurveyPromptResult? result;
      await tester.pumpWidget(subject(onFinished: (value) => result = value));

      await tester.tap(find.text('Answer the survey'));
      await tester.pumpAndSettle();
      await tester.tap(find.bySemanticsLabel('How clear was this topic?: 1'));
      await tester.tap(find.widgetWithText(FilledButton, 'Submit'));
      await tester.pumpAndSettle();

      expect(result?.answers.last, isA<SurveySkippedAnswer>());
    });

    testWidgets('will not submit a required question left unanswered', (
      tester,
    ) async {
      SurveyPromptResult? result;
      await tester.pumpWidget(subject(onFinished: (value) => result = value));

      await tester.tap(find.text('Answer the survey'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Submit'));
      await tester.pumpAndSettle();

      expect(result, isNull);
      expect(
        find.text('Please answer: How clear was this topic?'),
        findsOneWidget,
      );
    });

    testWidgets('finishes once, however many times Submit is pressed', (
      tester,
    ) async {
      var finished = 0;
      await tester.pumpWidget(subject(onFinished: (_) => finished += 1));

      await tester.tap(find.text('Answer the survey'));
      await tester.pumpAndSettle();
      await tester.tap(find.bySemanticsLabel('How clear was this topic?: 5'));
      await tester.tap(find.widgetWithText(FilledButton, 'Submit'));
      await tester.pumpAndSettle();

      expect(finished, 1);
      expect(find.text('Thank you. Your answers have been recorded.'),
          findsOneWidget);
    });
  });

  group('SurveyPromptCoordinator', () {
    SurveyPromptCoordinator coordinator(
      _RecordingAnalytics analytics,
      List<SurveyResponse> queued,
    ) {
      return SurveyPromptCoordinator(
        analytics: analytics,
        queueResponse: (response) async => queued.add(response),
        clock: () => DateTime.utc(2026, 9, 2, 4, 5, 6),
        createId: () => '7c1f9a2e-3b4d-4e5f-8a6b-9c0d1e2f3a4b',
      );
    }

    test('queues a submission with its grant, version and answers', () async {
      final analytics = _RecordingAnalytics();
      final queued = <SurveyResponse>[];
      final survey = buildSurvey();

      await coordinator(analytics, queued).record(
        survey,
        SurveyPromptResult.submitted([
          SurveyScaleAnswer(questionId: survey.questions.first.id, value: 4),
          SurveySkippedAnswer(questionId: survey.questions.last.id),
        ]),
        consentRecordId: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      );

      expect(queued, hasLength(1));
      expect(queued.single.consentRecordId, '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d');
      expect(queued.single.contentVersionId, survey.contentVersionId);
      expect(queued.single.submittedAt, DateTime.utc(2026, 9, 2, 4, 5, 6));
      // One answer and one skip: the count is what was answered.
      expect(analytics.events, ['submitted:1']);
    });

    test('stores nothing at all when the prompt was declined', () async {
      final analytics = _RecordingAnalytics();
      final queued = <SurveyResponse>[];

      await coordinator(analytics, queued).record(
        buildSurvey(),
        const SurveyPromptResult.declinedPrompt(),
      );

      expect(queued, isEmpty);
      expect(analytics.events, ['declined:declinedPrompt']);
    });

    test('stores nothing when there is no grant to name', () async {
      final analytics = _RecordingAnalytics();
      final queued = <SurveyResponse>[];
      final survey = buildSurvey();

      await coordinator(analytics, queued).record(
        survey,
        SurveyPromptResult.submitted([
          SurveyScaleAnswer(questionId: survey.questions.first.id, value: 4),
          SurveySkippedAnswer(questionId: survey.questions.last.id),
        ]),
      );

      expect(queued, isEmpty);
      expect(analytics.events, ['declined:declinedNotice']);
    });

    test('reports the three events the ticket names', () async {
      final analytics = _RecordingAnalytics();
      final queued = <SurveyResponse>[];
      final survey = buildSurvey();
      final subject = coordinator(analytics, queued);

      await subject.recordShown(survey);
      await subject.record(survey, const SurveyPromptResult.declinedNotice());
      await subject.record(
        survey,
        SurveyPromptResult.submitted([
          SurveyScaleAnswer(questionId: survey.questions.first.id, value: 4),
          SurveyTextAnswer(
            questionId: survey.questions.last.id,
            value: 'Clearer maps.',
          ),
        ]),
        consentRecordId: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      );

      expect(analytics.events, [
        'shown:satisfaction',
        'declined:declinedNotice',
        'submitted:2',
      ]);
    });
  });

  group('the seeded topic-completion trigger', () {
    test('offers the survey whose subject is the topic just read', () {
      final about = SurveyDocument.parsePublished(
        surveyBytes(subject: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
      );
      final general = buildSurvey();

      expect(
        surveyForCompletedTopic([
          general,
          about,
        ], 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')?.subjectContentItemId,
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      );
      expect(
        surveyForCompletedTopic([general, about], 'a-different-topic'),
        isNull,
      );
    });
  });
}
