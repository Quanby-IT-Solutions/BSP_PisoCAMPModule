import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/trivia_history_store.dart';
import 'package:mobile/features/pisocamp/data/trivia_question_document.dart';
import 'package:mobile/features/pisocamp/data/trivia_repository.dart';
import 'package:mobile/features/pisocamp/data/trivia_response.dart';
import 'package:mobile/features/pisocamp/data/trivia_response_store.dart';
import 'package:mobile/features/pisocamp/data/trivia_selection.dart';
import 'package:mobile/features/pisocamp/data/trivia_sync_controller.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/trivia_prompt.dart';
import 'package:mobile/services/api/api_client.dart';
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

final triviaResponseStoreProvider = Provider<TriviaResponseStore>((ref) {
  return PreferencesTriviaResponseStore(ref.watch(sharedPreferencesProvider));
});

final triviaRepositoryProvider = Provider<TriviaUploadPort>(
  (ref) => TriviaRepository(ref.watch(dioProvider)),
);

/// The account a sync would be for, or null for a guest.
final triviaSyncAccountProvider = Provider<TriviaSyncAccount?>((ref) {
  final id = ref.watch(currentUserProvider)?.id;
  return id == null || id.isEmpty ? null : TriviaSyncAccount(accountId: id);
});

/// Uploads answers, and merges a guest's backlog the first time an account
/// appears on the device.
///
/// The merge is driven from the account itself rather than from the sign-up
/// screen, so it also covers a guest who registers, is interrupted, and
/// arrives with a session on the next launch.
final triviaSyncControllerProvider = Provider<TriviaSyncController>((ref) {
  final controller = TriviaSyncController(
    // Resolved when a sync actually happens, not when the app starts: the
    // root watches this controller so an offline answer still reaches the
    // account, and paying for an HTTP client at launch to do nothing would be
    // the wrong trade.
    store: _LazyResponseStore(ref),
    uploader: _LazyUploader(ref),
    isOnline: () => ref.read(connectivityStatusProvider).asData?.value ?? false,
    currentAccount: () => ref.read(triviaSyncAccountProvider),
  );
  ref.listen<TriviaSyncAccount?>(triviaSyncAccountProvider, (previous, next) {
    if (next != null) unawaited(controller.mergeIntoAccount(next.accountId));
  }, fireImmediately: true);
  // fireImmediately subscribes to connectivity now rather than at the first
  // change, so a device that is already online when the module opens uploads
  // without waiting for the radio to change state.
  ref.listen<AsyncValue<bool>>(connectivityStatusProvider, (previous, next) {
    if (next.asData?.value ?? false) {
      unawaited(controller.sync(TriviaSyncTrigger.reconnect));
    }
  }, fireImmediately: true);
  ref.onDispose(controller.dispose);
  return controller;
});

final class _LazyResponseStore implements TriviaResponseStore {
  const _LazyResponseStore(this._ref);

  final Ref _ref;

  TriviaResponseStore get _store => _ref.read(triviaResponseStoreProvider);

  @override
  Future<List<TriviaResponseRecord>> readAll() => _store.readAll();

  @override
  Future<void> record(TriviaResponseRecord response) => _store.record(response);

  @override
  Future<List<TriviaResponseRecord>> readPending({int limit = 100}) =>
      _store.readPending(limit: limit);

  @override
  Future<void> markSynced(Iterable<String> responseIds) =>
      _store.markSynced(responseIds);

  @override
  Future<String?> readMergedAccountId() => _store.readMergedAccountId();

  @override
  Future<void> recordMerged(String accountId) => _store.recordMerged(accountId);
}

final class _LazyUploader implements TriviaUploadPort {
  const _LazyUploader(this._ref);

  final Ref _ref;

  @override
  Future<List<String>> upload(List<TriviaResponseRecord> responses) =>
      _ref.read(triviaRepositoryProvider).upload(responses);
}

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
    this.responses,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final TriviaSelector selector;
  final TriviaHistoryStore history;
  final TriviaAnalytics analytics;
  final int repeatDays;

  /// Where the answer itself is kept. GM-3's record, alongside GM-2's event:
  /// the event says a question was answered, the response says what the answer
  /// was worth, and only the second is the person's own progress.
  final TriviaResponseSink? responses;

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
    // The response is stored before the event is emitted: the event is
    // telemetry the module can afford to lose, and the response is not.
    await responses?.record(
      TriviaResponseRecord.fromPrompt(
        question: question,
        result: result,
        answeredAt: _clock(),
      ),
    );
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
    responses: ref.watch(triviaSyncControllerProvider),
  );
});
