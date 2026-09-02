import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/core/utils/uuid_v4.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_repository.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/data/survey_document.dart';
import 'package:mobile/features/pisocamp/data/survey_repository.dart';
import 'package:mobile/features/pisocamp/data/survey_response.dart';
import 'package:mobile/features/pisocamp/data/survey_response_queue.dart';
import 'package:mobile/features/pisocamp/data/survey_sync_controller.dart';
import 'package:mobile/features/pisocamp/data/survey_triggers.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/bundle_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/consent_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/survey_prompt.dart';
import 'package:mobile/services/api/api_client.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';
import 'package:mobile/services/storage/theme_storage_service.dart';

/// The encrypted store queued responses wait in.
final surveyQueueProvider = FutureProvider<SurveyQueuePort>((ref) async {
  return EncryptedSurveyQueue.initialize(
    applicationSupportDirectory: await ref.watch(
      bundleDocumentsRootProvider.future,
    ),
    keyStore: SecureStorageSurveyKeyStore(ref.watch(secureStorageProvider)),
  );
});

final surveyRepositoryProvider = Provider<SurveyUploadPort>(
  (ref) => SurveyRepository(ref.watch(dioProvider)),
);

final surveySyncControllerProvider = FutureProvider<SurveySyncController>((
  ref,
) async {
  final controller = SurveySyncController(
    queue: await ref.watch(surveyQueueProvider.future),
    uploader: ref.watch(surveyRepositoryProvider),
    isOnline: () => ref.read(connectivityStatusProvider).asData?.value ?? false,
  );
  ref.onDispose(controller.dispose);
  return controller;
});

/// Records what a survey prompt did.
abstract interface class SurveyAnalytics {
  Future<void> recordShown(SurveyDocument survey);
  Future<void> recordDeclined(SurveyDocument survey, SurveyOutcome outcome);
  Future<void> recordSubmitted(SurveyDocument survey, int answeredCount);
}

final surveyAnalyticsProvider = Provider<SurveyAnalytics>(
  (ref) => _SdkSurveyAnalytics(ref.watch(analyticsSdkProvider)),
);

final class _SdkSurveyAnalytics implements SurveyAnalytics {
  const _SdkSurveyAnalytics(this._sdk);

  final AnalyticsSdk _sdk;

  @override
  Future<void> recordShown(SurveyDocument survey) => _sdk.emit(
    SurveyPromptShownIntent(
      logicalId: survey.logicalId,
      purpose: survey.purpose.name,
    ),
  );

  @override
  Future<void> recordDeclined(SurveyDocument survey, SurveyOutcome outcome) =>
      _sdk.emit(
        SurveyDeclinedIntent(
          logicalId: survey.logicalId,
          purpose: survey.purpose.name,
          stage: outcome == SurveyOutcome.declinedNotice
              ? SurveyDeclineStage.notice
              : SurveyDeclineStage.prompt,
        ),
      );

  @override
  Future<void> recordSubmitted(SurveyDocument survey, int answeredCount) =>
      _sdk.emit(
        SurveySubmittedIntent(
          logicalId: survey.logicalId,
          purpose: survey.purpose.name,
          answeredCount: answeredCount,
        ),
      );
}

/// Whether a current survey grant exists, and the notice to show if it does not.
final class SurveyConsentStanding {
  const SurveyConsentStanding({
    required this.granted,
    required this.consentRecordId,
    this.notice,
  });

  final bool granted;

  /// The grant a response will name. Null when there is nothing to name yet.
  final String? consentRecordId;

  final PrivacyNotice? notice;
}

/// Decides whether a survey may be offered and answered.
///
/// The consent rules are F4's and are not restated here: this asks the consent
/// service what the standing is and records a decision through it, so a
/// withdrawal or a re-consent is handled in one place for the whole module.
class SurveyConsentCoordinator {
  const SurveyConsentCoordinator({
    required this.consent,
    required this.store,
    required this.isOnline,
  });

  final ConsentService consent;
  final ConsentLocalStore store;
  final bool Function() isOnline;

  Future<SurveyConsentStanding> standing() async {
    final requirement = await consent.check(
      ConsentPurpose.survey,
      online: isOnline(),
    );
    final notice = requirement.notice;
    final granted =
        requirement.state == ConsentRequirementState.grantedSynced ||
        requirement.state == ConsentRequirementState.grantedQueued;
    if (!granted || notice == null) {
      return SurveyConsentStanding(
        granted: false,
        consentRecordId: null,
        notice: notice,
      );
    }
    final recordId = await _grantIdFor(notice);
    // A grant the device cannot name is a grant a response cannot reference,
    // so the person is asked again rather than answering into nothing.
    return SurveyConsentStanding(
      granted: recordId != null,
      consentRecordId: recordId,
      notice: notice,
    );
  }

  Future<String?> _grantIdFor(PrivacyNotice notice) async {
    final records = await store.readRecords();
    for (final record in records.reversed) {
      if (record.purpose != ConsentPurpose.survey) continue;
      if (record.noticeId != notice.id ||
          record.noticeVersion != notice.version) {
        continue;
      }
      if (record.syncState == ConsentSyncState.stale) return null;
      return record.decision == ConsentDecision.granted
          ? record.recordId
          : null;
    }
    return null;
  }

  /// Records a decision and returns the grant a response may name.
  Future<String?> record({
    required PrivacyNotice notice,
    required bool granted,
  }) async {
    final result = await consent.recordDecision(
      purpose: ConsentPurpose.survey,
      notice: notice,
      decision: granted ? ConsentDecision.granted : ConsentDecision.declined,
      online: isOnline(),
    );
    if (result != ConsentGateResult.grantedSynced &&
        result != ConsentGateResult.grantedQueued) {
      return null;
    }
    return _grantIdFor(notice);
  }
}

final surveyConsentCoordinatorProvider = Provider<SurveyConsentCoordinator>((
  ref,
) {
  return SurveyConsentCoordinator(
    consent: ref.watch(consentServiceProvider),
    store: ref.watch(consentLocalStoreProvider),
    isOnline: () => ref.read(connectivityStatusProvider).asData?.value ?? false,
  );
});

/// Turns a finished prompt into an event and, when it was answered, a queued
/// response.
class SurveyPromptCoordinator {
  const SurveyPromptCoordinator({
    required this.analytics,
    required this.queueResponse,
    DateTime Function()? clock,
    String Function()? createId,
  }) : _clock = clock ?? DateTime.now,
       _createId = createId ?? createUuidV4;

  final SurveyAnalytics analytics;
  final Future<void> Function(SurveyResponse response) queueResponse;
  final DateTime Function() _clock;
  final String Function() _createId;

  Future<void> recordShown(SurveyDocument survey) =>
      analytics.recordShown(survey);

  /// Records the outcome. Only a submission stores anything.
  Future<void> record(
    SurveyDocument survey,
    SurveyPromptResult result, {
    String? consentRecordId,
  }) async {
    if (result.outcome != SurveyOutcome.submitted) {
      await analytics.recordDeclined(survey, result.outcome);
      return;
    }
    if (consentRecordId == null) {
      // Nothing is stored without a grant to name, and the refusal is reported
      // as what it is rather than as a submission.
      await analytics.recordDeclined(survey, SurveyOutcome.declinedNotice);
      return;
    }
    assertAnswerable(survey, result.answers);
    final response = SurveyResponse(
      responseId: _createId(),
      contentItemId: survey.contentItemId,
      contentVersionId: survey.contentVersionId,
      consentRecordId: consentRecordId,
      submittedAt: _clock().toUtc(),
      answers: result.answers,
    );
    // Queued before the event: the answer is the thing that must not be lost,
    // and telemetry the module can afford to lose.
    await queueResponse(response);
    await analytics.recordSubmitted(survey, response.answeredCount);
  }
}

final surveyPromptCoordinatorProvider = Provider<SurveyPromptCoordinator>((
  ref,
) {
  return SurveyPromptCoordinator(
    analytics: ref.watch(surveyAnalyticsProvider),
    queueResponse: (response) async {
      final controller = await ref.read(surveySyncControllerProvider.future);
      await controller.submit(response);
    },
  );
});

/// The rules BSP arranged, as the public configuration last reported them.
///
/// Empty until the configuration has been read, which is the same as "do not
/// ask": a device that has never reached the server has not been told to.
final surveyTriggerRulesProvider = Provider<List<SurveyTriggerRule>>((ref) {
  return ref.watch(pisoCampHomeProvider).asData?.value.surveyTriggers ??
      const [];
});

final surveyFrequencyStoreProvider = Provider<SurveyFrequencyStore>((ref) {
  return PreferencesSurveyFrequencyStore(ref.watch(sharedPreferencesProvider));
});

final surveyTriggerEngineProvider = Provider<SurveyTriggerEngine>(
  (ref) => const SurveyTriggerEngine(),
);

/// Fires one trigger and reports the survey to offer, if any.
///
/// The cap is enforced here, on the device, because a guest has no account for
/// the server to count against — and because the offer happens whether or not
/// there is a connection.
class SurveyTriggerCoordinator {
  const SurveyTriggerCoordinator({
    required this.engine,
    required this.rules,
    required this.frequency,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final SurveyTriggerEngine engine;
  final List<SurveyTriggerRule> rules;
  final SurveyFrequencyStore frequency;
  final DateTime Function() _clock;

  Future<SurveyDocument?> fire({
    required SurveyTriggerType trigger,
    required List<SurveyDocument> surveys,
    String? subjectContentItemId,
    int? pageDepth,
  }) async {
    final survey = engine.select(
      trigger: trigger,
      rules: rules,
      surveys: surveys,
      lastOffered: await frequency.readLastOffered(),
      subjectContentItemId: subjectContentItemId,
      pageDepth: pageDepth,
    );
    if (survey == null) return null;
    // Recorded when it is offered, not when it is answered: declining is still
    // being asked, and the cap exists so people are not asked too often.
    await frequency.recordOffered(survey.contentItemId, _clock());
    return survey;
  }
}

final surveyTriggerCoordinatorProvider = Provider<SurveyTriggerCoordinator>((
  ref,
) {
  return SurveyTriggerCoordinator(
    engine: ref.watch(surveyTriggerEngineProvider),
    rules: ref.watch(surveyTriggerRulesProvider),
    frequency: ref.watch(surveyFrequencyStoreProvider),
  );
});
