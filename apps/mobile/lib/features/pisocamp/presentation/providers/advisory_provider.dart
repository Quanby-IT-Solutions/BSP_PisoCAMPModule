import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/pisocamp/data/advisory_document.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_provider.dart';
import 'package:mobile/services/storage/theme_storage_service.dart';

/// How long before the exit advisory is shown again.
///
/// Configuration, with the contract's default standing until it has been read:
/// a device that has never reached the server still advises, which is the
/// point of an advisory that renders from the bundle.
final advisoryIntervalHoursProvider = Provider<int>((ref) {
  return ref
          .watch(pisoCampHomeProvider)
          .asData
          ?.value
          .exitAdvisoryIntervalHours ??
      24;
});

final advisoryDisplayStoreProvider = Provider<AdvisoryDisplayStore>((ref) {
  return PreferencesAdvisoryDisplayStore(ref.watch(sharedPreferencesProvider));
});

/// Records that the advisory was shown.
abstract interface class AdvisoryAnalytics {
  Future<void> recordShown(AdvisoryDocument advisory);
}

final advisoryAnalyticsProvider = Provider<AdvisoryAnalytics>(
  (ref) => _SdkAdvisoryAnalytics(ref.watch(analyticsSdkProvider)),
);

final class _SdkAdvisoryAnalytics implements AdvisoryAnalytics {
  const _SdkAdvisoryAnalytics(this._sdk);

  final AnalyticsSdk _sdk;

  @override
  Future<void> recordShown(AdvisoryDocument advisory) =>
      _sdk.emit(AdvisoryShownIntent(logicalId: advisory.logicalId));
}

/// Decides whether the exit advisory is due, and records that it was shown.
///
/// The interval is enforced on the device because the exit happens there, with
/// or without a connection.
class ExitAdvisoryCoordinator {
  const ExitAdvisoryCoordinator({
    required this.store,
    required this.analytics,
    required this.intervalHours,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final AdvisoryDisplayStore store;
  final AdvisoryAnalytics analytics;
  final int intervalHours;
  final DateTime Function() _clock;

  /// The advisory to show on the way out, or null when none is due.
  Future<AdvisoryDocument?> onExit(List<AdvisoryDocument> advisories) async {
    final advisory = exitAdvisoryFrom(advisories);
    if (advisory == null) return null;
    final now = _clock().toUtc();
    if (!advisoryIsDue(
      now: now,
      lastShown: await store.readLastShown(),
      intervalHours: intervalHours,
    )) {
      return null;
    }
    // Recorded when it is shown, so the interval counts from being advised
    // rather than from being dismissed.
    await store.recordShown(now);
    await analytics.recordShown(advisory);
    return advisory;
  }
}

final exitAdvisoryCoordinatorProvider = Provider<ExitAdvisoryCoordinator>((
  ref,
) {
  return ExitAdvisoryCoordinator(
    store: ref.watch(advisoryDisplayStoreProvider),
    analytics: ref.watch(advisoryAnalyticsProvider),
    intervalHours: ref.watch(advisoryIntervalHoursProvider),
  );
});
