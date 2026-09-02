import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/core/utils/uuid_v4.dart';
import 'package:mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/analytics_repository.dart';
import 'package:mobile/features/pisocamp/data/analytics_sync_controller.dart';
import 'package:mobile/features/pisocamp/data/encrypted_analytics_queue.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_provider.dart';
import 'package:mobile/services/api/api_client.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

abstract interface class AnalyticsEventQueue {
  Future<void> enqueue(AnalyticsEvent event);
}

/// Bridges Task 5's encrypted queue to the Task 6 queue contract.
final class EncryptedAnalyticsQueueAdapter
    implements AnalyticsEventQueue, AnalyticsQueuePort {
  const EncryptedAnalyticsQueueAdapter(this._queue);

  final EncryptedAnalyticsQueue _queue;

  @override
  Future<void> acknowledge(Iterable<String> eventIds) =>
      _queue.acknowledge(eventIds);

  @override
  Future<void> enqueue(AnalyticsEvent event) => _queue.enqueue(event);

  @override
  Future<List<AnalyticsEvent>> readBatch({
    int maxEvents = 100,
    int maxBytes = 512 * 1024,
  }) => _queue.readBatch(maxEvents: maxEvents, maxBytes: maxBytes);
}

typedef AnalyticsContextResolver = Future<AnalyticsEventContext> Function();
typedef AnalyticsSyncScheduler = Future<void> Function();
typedef AnalyticsFailureReporter = void Function(String eventName, String code);

final analyticsApplicationSupportDirectoryProvider = FutureProvider<Directory>(
  (ref) => getApplicationSupportDirectory(),
);

final analyticsPackageInfoProvider = FutureProvider<PackageInfo>(
  (ref) => PackageInfo.fromPlatform(),
);

final analyticsOperatingSystemProvider = Provider<String>(
  (ref) => Platform.operatingSystem,
);

final analyticsOperatingSystemVersionProvider = Provider<String>(
  (ref) => Platform.operatingSystemVersion,
);

final analyticsLogicalShortestSideProvider = Provider<double>((ref) {
  final views = WidgetsBinding.instance.platformDispatcher.views;
  if (views.isEmpty) return 0;
  final view = views.first;
  final size = view.physicalSize / view.devicePixelRatio;
  return min(size.width, size.height);
});

final analyticsSessionIdProvider = Provider<String>((ref) => createUuidV4());

final analyticsNetworkStateProvider = Provider<AnalyticsNetworkState>((ref) {
  return analyticsNetworkStateFor(ref.watch(connectivityStatusProvider));
});

final analyticsContextResolverProvider = Provider<AnalyticsContextResolver>((
  ref,
) {
  final sessionId = ref.watch(analyticsSessionIdProvider);
  return () async {
    final package = await ref.read(analyticsPackageInfoProvider.future);
    final pseudoId = await ref
        .read(guestIdentityServiceProvider)
        .getOrCreateId();
    final accountType = ref.read(currentUserProvider) == null
        ? AnalyticsAccountType.guest
        : AnalyticsAccountType.registered;
    final platform = ref
        .read(analyticsOperatingSystemProvider)
        .trim()
        .toLowerCase();
    final version = ref.read(analyticsOperatingSystemVersionProvider).trim();
    final shortestSide = ref.read(analyticsLogicalShortestSideProvider);
    return AnalyticsEventContext(
      subjectPseudoId: pseudoId,
      sessionId: sessionId,
      accountType: accountType,
      appVersion: _appVersion(package),
      osName: switch (platform) {
        'android' => AnalyticsOsName.android,
        'ios' => AnalyticsOsName.ios,
        _ => AnalyticsOsName.other,
      },
      osVersion: _boundedPlatformVersion(version),
      deviceCategory: shortestSide >= 600
          ? AnalyticsDeviceCategory.tablet
          : AnalyticsDeviceCategory.phone,
      networkState: ref.read(analyticsNetworkStateProvider),
    );
  };
});

final analyticsQueueAdapterProvider =
    FutureProvider<EncryptedAnalyticsQueueAdapter>((ref) async {
      final directory = await ref.watch(
        analyticsApplicationSupportDirectoryProvider.future,
      );
      final queue = await EncryptedAnalyticsQueue.initialize(
        applicationSupportDirectory: directory,
        keyStore: SecureStorageAnalyticsKeyStore(
          ref.watch(secureStorageProvider),
        ),
      );
      return EncryptedAnalyticsQueueAdapter(queue);
    });

final analyticsRepositoryProvider = Provider<AnalyticsRepository>(
  (ref) => AnalyticsRepository(ref.watch(dioProvider)),
);

final analyticsSyncControllerProvider = FutureProvider<AnalyticsSyncController>(
  (ref) async {
    final queue = await ref.watch(analyticsQueueAdapterProvider.future);
    final controller = AnalyticsSyncController(
      queue: queue,
      uploader: ref.watch(analyticsRepositoryProvider),
      isOnline: () =>
          ref.read(connectivityStatusProvider).asData?.value ?? false,
    );
    ref.onDispose(controller.dispose);
    return controller;
  },
);

final analyticsSdkProvider = Provider<AnalyticsSdk>((ref) {
  return AnalyticsSdk(
    context: ref.watch(analyticsContextResolverProvider),
    queue: () => ref.read(analyticsQueueAdapterProvider.future),
    scheduleSync: () async {
      final controller = await ref.read(analyticsSyncControllerProvider.future);
      await controller.sync(AnalyticsSyncTrigger.startup);
    },
  );
});

final contentViewAnalyticsProvider = Provider<ContentViewAnalytics>(
  (ref) => _SdkContentViewAnalytics(ref.watch(analyticsSdkProvider)),
);

abstract interface class ContentViewAnalytics {
  Future<void> recordOpen(String logicalId);
}

final coinViewerAnalyticsProvider = Provider<CoinViewerAnalytics>(
  (ref) => _SdkCoinViewerAnalytics(ref.watch(analyticsSdkProvider)),
);

abstract interface class CoinViewerAnalytics {
  Future<void> recordUse(String logicalId);
}

final class _SdkCoinViewerAnalytics implements CoinViewerAnalytics {
  const _SdkCoinViewerAnalytics(this._sdk);

  final AnalyticsSdk _sdk;

  @override
  Future<void> recordUse(String logicalId) => _sdk.emit(
    FeatureUseIntent(
      usedFeature: AnalyticsFeature.coin3d,
      logicalId: logicalId,
    ),
  );
}

final class _SdkContentViewAnalytics implements ContentViewAnalytics {
  const _SdkContentViewAnalytics(this._sdk);

  final AnalyticsSdk _sdk;

  @override
  Future<void> recordOpen(String logicalId) =>
      _sdk.emit(ContentViewIntent(logicalId));
}

final class AnalyticsSdk {
  AnalyticsSdk({
    required AnalyticsContextResolver context,
    required Future<AnalyticsEventQueue> Function() queue,
    required AnalyticsSyncScheduler scheduleSync,
    String Function()? createEventId,
    DateTime Function()? clock,
  }) : _context = context,
       _queue = queue,
       _scheduleSync = scheduleSync,
       _createEventId = createEventId,
       _clock = clock;

  final AnalyticsContextResolver _context;
  final Future<AnalyticsEventQueue> Function() _queue;
  final AnalyticsSyncScheduler _scheduleSync;
  final String Function()? _createEventId;
  final DateTime Function()? _clock;

  Future<void> emit(AnalyticsIntent intent) async {
    final event = AnalyticsEvent.build(
      intent: intent,
      context: await _context(),
      createEventId: _createEventId,
      clock: _clock,
    );
    await (await _queue()).enqueue(event);
    unawaited(_scheduleAfterCommit(intent.eventName));
  }

  Future<void> _scheduleAfterCommit(String eventName) async {
    try {
      await _scheduleSync();
    } on Object catch (error) {
      _reportAnalyticsFailureForEventName(eventName, error);
    }
  }
}

@visibleForTesting
AnalyticsFailureReporter analyticsFailureReporter =
    _debugAnalyticsFailureReporter;

void emitAnalytics(AnalyticsSdk sdk, AnalyticsIntent intent) {
  unawaited(_emitAnalyticsGuarded(sdk, intent));
}

void emitAnalyticsFuture(AnalyticsIntent intent, Future<void> Function() emit) {
  unawaited(_emitFutureGuarded(intent, emit));
}

Future<void> _emitAnalyticsGuarded(
  AnalyticsSdk sdk,
  AnalyticsIntent intent,
) async {
  try {
    await sdk.emit(intent);
  } on Object catch (error) {
    reportAnalyticsFailure(intent, error);
  }
}

Future<void> _emitFutureGuarded(
  AnalyticsIntent intent,
  Future<void> Function() emit,
) async {
  try {
    await emit();
  } on Object catch (error) {
    reportAnalyticsFailure(intent, error);
  }
}

void reportAnalyticsFailure(AnalyticsIntent intent, Object error) {
  _reportAnalyticsFailureForEventName(intent.eventName, error);
}

void _reportAnalyticsFailureForEventName(String eventName, Object error) {
  assert(() {
    analyticsFailureReporter(eventName, _analyticsFailureCode(error));
    return true;
  }());
}

void _debugAnalyticsFailureReporter(String eventName, String code) {
  debugPrint('analytics_emit_failed event=$eventName reason=$code');
}

String _analyticsFailureCode(Object error) => switch (error) {
  AnalyticsValidationException(:final reason) => reason.name,
  AnalyticsQueueException(:final code) =>
    _analyticsQueueFailureCodes.contains(code) ? code : 'queueFailure',
  AnalyticsRepositoryException(:final code) =>
    _analyticsRepositoryFailureCodes.contains(code)
        ? code
        : 'repositoryFailure',
  _ => 'unexpected',
};

const _analyticsQueueFailureCodes = <String>{
  'invalidEventId',
  'enqueueFailed',
  'invalidBatchLimit',
  'eventTooLarge',
  'acknowledgeFailed',
  'initializeFailed',
  'analyticsKeyUnavailable',
  'readFailed',
  'quarantineFailed',
};

const _analyticsRepositoryFailureCodes = <String>{
  'emptyBatch',
  'invalidAcknowledgement',
  'cancelled',
  'timeout',
  'http4xx',
  'http5xx',
  'network',
};

@visibleForTesting
AnalyticsNetworkState analyticsNetworkStateFor(AsyncValue<bool> status) =>
    switch (status) {
      AsyncData(value: true) => AnalyticsNetworkState.online,
      AsyncData(value: false) => AnalyticsNetworkState.offline,
      _ => AnalyticsNetworkState.unknown,
    };

String _appVersion(PackageInfo info) {
  final version = _normalizedMetadata(info.version, maximum: 48);
  final build = _normalizedMetadata(info.buildNumber, maximum: 14);
  return '${version.isEmpty ? 'unknown' : version}+${build.isEmpty ? '0' : build}';
}

String _boundedPlatformVersion(String value) {
  final normalized = _normalizedMetadata(value, maximum: 96);
  return normalized.isEmpty ? 'unknown' : normalized;
}

String _normalizedMetadata(String value, {required int maximum}) {
  final normalized = value.replaceAll(RegExp(r'\s+'), ' ').trim();
  return normalized.length <= maximum
      ? normalized
      : normalized.substring(0, maximum).trimRight();
}
