import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/trivia_history_store.dart';
import 'package:mobile/features/pisocamp/data/trivia_question_document.dart';
import 'package:mobile/features/pisocamp/data/trivia_selection.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/trivia_prompt.dart';
import 'package:mobile/services/storage/theme_storage_service.dart';

/// How many days a question stays out of the running once shown.
///
/// Configuration, with the ticket's default. Reading it through a provider is
/// what lets F2's config service supply it later without touching the selector.
final triviaRepeatDaysProvider = Provider<int>(
  (ref) => kDefaultTriviaRepeatDays,
);

/// Whether a correct result stays on screen until dismissed.
///
/// An accessibility setting: five seconds is not long for everyone, and the
/// people it is shortest for are the ones an auto-close hurts most.
final triviaKeepResultProvider = Provider<bool>((ref) => false);

final triviaHistoryStoreProvider = Provider<TriviaHistoryStore>((ref) {
  return PreferencesTriviaHistoryStore(ref.watch(sharedPreferencesProvider));
});

final triviaSelectorProvider = Provider<TriviaSelector>(
  (ref) => TriviaSelector(),
);

/// Records what a prompt did.
abstract interface class TriviaAnalytics {
  Future<void> recordShown(TriviaQuestionDocument question);
  Future<void> recordAnswered(
    TriviaQuestionDocument question, {
    required bool correct,
    required bool openedTopic,
  });
  Future<void> recordSkipped(TriviaQuestionDocument question);
}

final triviaAnalyticsProvider = Provider<TriviaAnalytics>(
  (ref) => _SdkTriviaAnalytics(ref.watch(analyticsSdkProvider)),
);

final class _SdkTriviaAnalytics implements TriviaAnalytics {
  const _SdkTriviaAnalytics(this._sdk);

  final AnalyticsSdk _sdk;

  String _difficulty(TriviaQuestionDocument question) =>
      question.difficulty.name;

  @override
  Future<void> recordShown(TriviaQuestionDocument question) => _sdk.emit(
    TriviaPromptShownIntent(
      logicalId: question.logicalId,
      category: question.category,
      difficulty: _difficulty(question),
    ),
  );

  @override
  Future<void> recordAnswered(
    TriviaQuestionDocument question, {
    required bool correct,
    required bool openedTopic,
  }) => _sdk.emit(
    TriviaPromptAnsweredIntent(
      logicalId: question.logicalId,
      category: question.category,
      difficulty: _difficulty(question),
      correct: correct,
      openedTopic: openedTopic,
    ),
  );

  @override
  Future<void> recordSkipped(TriviaQuestionDocument question) => _sdk.emit(
    TriviaPromptSkippedIntent(
      logicalId: question.logicalId,
      category: question.category,
      difficulty: _difficulty(question),
    ),
  );
}

/// Chooses a question and records that it was offered.
///
/// The sighting is written when the prompt is *shown*, not when it is answered:
/// a guest who skips has still seen the question, and offering it again
/// tomorrow would be the repeat the window exists to prevent.
class TriviaPromptCoordinator {
  const TriviaPromptCoordinator({
    required this.selector,
    required this.history,
    required this.analytics,
    required this.repeatDays,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final TriviaSelector selector;
  final TriviaHistoryStore history;
  final TriviaAnalytics analytics;
  final int repeatDays;
  final DateTime Function() _clock;

  /// Picks the next question to offer, or null when the pool is empty.
  Future<TriviaQuestionDocument?> next(
    List<TriviaQuestionDocument> pool,
  ) async {
    final question = selector.select(
      pool: pool,
      history: await history.readSightings(),
      repeatDays: repeatDays,
    );
    if (question == null) return null;
    await history.recordShown(question.contentItemId, _clock());
    await analytics.recordShown(question);
    return question;
  }

  Future<void> record(
    TriviaQuestionDocument question,
    TriviaPromptResult result,
  ) async {
    switch (result.outcome) {
      case TriviaPromptOutcome.skipped:
        await analytics.recordSkipped(question);
      case TriviaPromptOutcome.answeredCorrectly:
        await analytics.recordAnswered(
          question,
          correct: true,
          openedTopic: result.openedTopic,
        );
      case TriviaPromptOutcome.answeredIncorrectly:
        await analytics.recordAnswered(
          question,
          correct: false,
          openedTopic: result.openedTopic,
        );
    }
  }
}

final triviaPromptCoordinatorProvider = Provider<TriviaPromptCoordinator>((
  ref,
) {
  return TriviaPromptCoordinator(
    selector: ref.watch(triviaSelectorProvider),
    history: ref.watch(triviaHistoryStoreProvider),
    analytics: ref.watch(triviaAnalyticsProvider),
    repeatDays: ref.watch(triviaRepeatDaysProvider),
  );
});
