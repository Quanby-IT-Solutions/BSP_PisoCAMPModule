import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/features/auth/data/models/user_model.dart';
import 'package:mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/analytics_repository.dart';
import 'package:mobile/features/pisocamp/data/analytics_sync_controller.dart';
import 'package:mobile/features/pisocamp/data/encrypted_analytics_queue.dart';
import 'package:mobile/features/pisocamp/data/guest_identity_service.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_provider.dart';
import 'package:mobile/services/api/api_client.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';
import 'package:package_info_plus/package_info_plus.dart';

void main() {
  test(
    'emit waits for the durable queue write before scheduling sync',
    () async {
      final committed = Completer<void>();
      final queue = _RecordingEventQueue(enqueueFuture: committed.future);
      var syncs = 0;
      final sdk = AnalyticsSdk(
        context: () async => const AnalyticsEventContext(
          subjectPseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
          sessionId: '123e4567-e89b-42d3-a456-426614174000',
          accountType: AnalyticsAccountType.guest,
          appVersion: '1.2.3+45',
          osName: AnalyticsOsName.android,
          osVersion: '14',
          deviceCategory: AnalyticsDeviceCategory.phone,
          networkState: AnalyticsNetworkState.online,
        ),
        queue: () async => queue,
        scheduleSync: () async => syncs += 1,
        createEventId: () => '123e4567-e89b-42d3-a456-426614174001',
        clock: () => DateTime.utc(2026, 8, 31, 1, 2, 3, 4),
      );

      final emitted = sdk.emit(
        const ModuleEntryIntent(ModuleEntryPoint.navigation),
      );
      await Future<void>.delayed(Duration.zero);

      expect(queue.events, hasLength(1));
      expect(syncs, 0);

      committed.complete();
      await emitted;
      await Future<void>.delayed(Duration.zero);

      expect(queue.events.single.context.appVersion, '1.2.3+45');
      expect(syncs, 1);
    },
  );

  test(
    'context keeps the persisted pseudonym and launch session metadata',
    () async {
      FlutterSecureStorage.setMockInitialValues(<String, String>{
        'device_pseudo_id': 'AbCdEfGhIjKlMnOpQrSt_-',
      });
      final container = ProviderContainer(
        overrides: [
          currentUserProvider.overrideWith((ref) => null),
          analyticsNetworkStateProvider.overrideWithValue(
            AnalyticsNetworkState.online,
          ),
          analyticsSessionIdProvider.overrideWithValue(
            '123e4567-e89b-42d3-a456-426614174002',
          ),
          analyticsPackageInfoProvider.overrideWith(
            (ref) async => PackageInfo(
              appName: 'Piso CAMP',
              packageName: 'test.mobile',
              version: '2.4.6',
              buildNumber: '8',
            ),
          ),
          analyticsOperatingSystemProvider.overrideWithValue('ANDROID'),
          analyticsOperatingSystemVersionProvider.overrideWithValue(' 14 '),
          analyticsLogicalShortestSideProvider.overrideWithValue(600),
          guestIdentityServiceProvider.overrideWithValue(
            GuestIdentityService(SecureStorageService()),
          ),
        ],
      );
      addTearDown(container.dispose);

      final context = await container.read(analyticsContextResolverProvider)();

      expect(context.subjectPseudoId, 'AbCdEfGhIjKlMnOpQrSt_-');
      expect(context.sessionId, '123e4567-e89b-42d3-a456-426614174002');
      expect(context.accountType, AnalyticsAccountType.guest);
      expect(context.appVersion, '2.4.6+8');
      expect(context.osName, AnalyticsOsName.android);
      expect(context.osVersion, '14');
      expect(context.deviceCategory, AnalyticsDeviceCategory.tablet);
      expect(context.networkState, AnalyticsNetworkState.online);
    },
  );

  test('debug diagnostics use stable queue and repository codes', () {
    final reports = <(String, String)>[];
    final original = analyticsFailureReporter;
    addTearDown(() => analyticsFailureReporter = original);
    analyticsFailureReporter = (eventName, reason) =>
        reports.add((eventName, reason));

    reportAnalyticsFailure(
      const ContentViewIntent('catalog.php-1'),
      const AnalyticsQueueException('enqueueFailed'),
    );
    reportAnalyticsFailure(
      const ContentViewIntent('catalog.php-1'),
      const AnalyticsRepositoryException(
        AnalyticsRepositoryFailureKind.transient,
        'timeout',
      ),
    );

    expect(reports, <(String, String)>[
      ('content_view', 'enqueueFailed'),
      ('content_view', 'timeout'),
    ]);
  });

  test('network metadata maps loading and errors to unknown', () {
    expect(
      analyticsNetworkStateFor(const AsyncData(true)),
      AnalyticsNetworkState.online,
    );
    expect(
      analyticsNetworkStateFor(const AsyncData(false)),
      AnalyticsNetworkState.offline,
    );
    expect(
      analyticsNetworkStateFor(const AsyncLoading<bool>()),
      AnalyticsNetworkState.unknown,
    );
    expect(
      analyticsNetworkStateFor(
        AsyncError<bool>(StateError('raw value'), StackTrace.empty),
      ),
      AnalyticsNetworkState.unknown,
    );
  });

  test('queue failure leaves an event unscheduled', () async {
    var schedules = 0;
    final sdk = AnalyticsSdk(
      context: _context,
      queue: () async => _FailingEventQueue(),
      scheduleSync: () async => schedules += 1,
      createEventId: () => '123e4567-e89b-42d3-a456-426614174077',
    );
    await expectLater(
      sdk.emit(const AccountPromptShownIntent()),
      throwsA(isA<AnalyticsQueueException>()),
    );
    expect(schedules, 0);
  });

  test(
    'context failure leaves the queue untouched and does not schedule',
    () async {
      final queue = _RecordingEventQueue(enqueueFuture: Future<void>.value());
      var schedules = 0;
      final sdk = AnalyticsSdk(
        context: () => Future<AnalyticsEventContext>.error(
          StateError('private context failure'),
        ),
        queue: () async => queue,
        scheduleSync: () async => schedules += 1,
      );

      await expectLater(
        sdk.emit(const AccountPromptShownIntent()),
        throwsStateError,
      );

      expect(queue.events, isEmpty);
      expect(schedules, 0);
    },
  );

  test(
    'validation failure leaves the queue untouched and does not schedule',
    () async {
      final queue = _RecordingEventQueue(enqueueFuture: Future<void>.value());
      var schedules = 0;
      final sdk = AnalyticsSdk(
        context: _context,
        queue: () async => queue,
        scheduleSync: () async => schedules += 1,
        createEventId: () => '123e4567-e89b-42d3-a456-426614174075',
      );

      await expectLater(
        sdk.emit(const ContentViewIntent('')),
        throwsA(isA<AnalyticsValidationException>()),
      );

      expect(queue.events, isEmpty);
      expect(schedules, 0);
    },
  );

  test('schedule failure is reported after a committed emit', () async {
    final queue = _RecordingEventQueue(enqueueFuture: Future<void>.value());
    final reports = <(String, String)>[];
    final original = analyticsFailureReporter;
    addTearDown(() => analyticsFailureReporter = original);
    analyticsFailureReporter = (eventName, reason) =>
        reports.add((eventName, reason));
    final sdk = AnalyticsSdk(
      context: _context,
      queue: () async => queue,
      scheduleSync: () => Future<void>.error(
        const AnalyticsRepositoryException(
          AnalyticsRepositoryFailureKind.transient,
          'timeout',
        ),
      ),
      createEventId: () => '123e4567-e89b-42d3-a456-426614174076',
    );
    await sdk.emit(const AccountPromptShownIntent());
    await Future<void>.delayed(Duration.zero);
    expect(queue.events, hasLength(1));
    expect(reports, <(String, String)>[('account_prompt_shown', 'timeout')]);
  });

  test('diagnostics close event names and arbitrary external reason codes', () {
    final reports = <(String, String)>[];
    final original = analyticsFailureReporter;
    addTearDown(() => analyticsFailureReporter = original);
    analyticsFailureReporter = (eventName, reason) {
      reports.add((eventName, reason));
    };

    reportAnalyticsFailure(
      const AccountPromptGuestIntent(),
      const AnalyticsQueueException('private-path-and-id'),
    );
    reportAnalyticsFailure(
      const ContentViewIntent('catalog.php-1'),
      const AnalyticsRepositoryException(
        AnalyticsRepositoryFailureKind.permanent,
        'private-response-body',
      ),
    );
    reportAnalyticsFailure(
      const ModuleEntryIntent(ModuleEntryPoint.navigation),
      StateError('private raw failure'),
    );

    expect(reports, <(String, String)>[
      ('account_prompt_guest', 'queueFailure'),
      ('content_view', 'repositoryFailure'),
      ('module_entry', 'unexpected'),
    ]);
    expect(reports.toString(), isNot(contains('private')));
  });

  test(
    'launch session is stable per container and fresh across containers',
    () {
      final first = ProviderContainer();
      final second = ProviderContainer();
      addTearDown(first.dispose);
      addTearDown(second.dispose);

      final firstId = first.read(analyticsSessionIdProvider);
      expect(first.read(analyticsSessionIdProvider), firstId);
      expect(second.read(analyticsSessionIdProvider), isNot(firstId));
      expect(
        firstId,
        matches(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab]')),
      );
    },
  );

  test(
    'account category is derived from user presence without user fields',
    () async {
      FlutterSecureStorage.setMockInitialValues(<String, String>{
        'device_pseudo_id': 'AbCdEfGhIjKlMnOpQrSt_-',
      });
      final container = ProviderContainer(
        overrides: [
          currentUserProvider.overrideWith(
            (ref) => const UserModel(
              id: 'private-user-id',
              email: 'private@example.test',
              name: 'Private Name',
            ),
          ),
          analyticsNetworkStateProvider.overrideWithValue(
            AnalyticsNetworkState.offline,
          ),
          analyticsSessionIdProvider.overrideWithValue(
            '123e4567-e89b-42d3-a456-426614174099',
          ),
          analyticsPackageInfoProvider.overrideWith(
            (ref) async => PackageInfo(
              appName: 'Piso CAMP',
              packageName: 'test.mobile',
              version: '1',
              buildNumber: '1',
            ),
          ),
          analyticsOperatingSystemProvider.overrideWithValue('ios'),
          analyticsOperatingSystemVersionProvider.overrideWithValue('17'),
          analyticsLogicalShortestSideProvider.overrideWithValue(599),
          guestIdentityServiceProvider.overrideWithValue(
            GuestIdentityService(SecureStorageService()),
          ),
        ],
      );
      addTearDown(container.dispose);
      final context = await container.read(analyticsContextResolverProvider)();
      expect(context.accountType, AnalyticsAccountType.registered);
      final wire = AnalyticsEvent.build(
        intent: const ModuleEntryIntent(ModuleEntryPoint.navigation),
        context: context,
        createEventId: () => '123e4567-e89b-42d3-a456-426614174098',
      ).toJson().toString();
      expect(wire, isNot(contains('private-user-id')));
      expect(wire, isNot(contains('private@example.test')));
      expect(wire, isNot(contains('Private Name')));
    },
  );

  test(
    'platform and package metadata normalize at contract boundaries',
    () async {
      final cases = <({String platform, AnalyticsOsName expected})>[
        (platform: ' ANDROID ', expected: AnalyticsOsName.android),
        (platform: ' iOS ', expected: AnalyticsOsName.ios),
        (platform: 'windows', expected: AnalyticsOsName.other),
      ];

      for (final item in cases) {
        final container = _contextContainer(
          platform: item.platform,
          platformVersion: '  ${List.filled(120, 'v').join()}  ',
          version: '  ${List.filled(60, 'a').join()}  ',
          buildNumber: ' ${List.filled(20, '7').join()} ',
          shortestSide: 599.999,
        );
        final context = await container.read(
          analyticsContextResolverProvider,
        )();
        container.dispose();

        expect(context.osName, item.expected);
        expect(context.osVersion, hasLength(96));
        expect(context.osVersion, isNot(startsWith(' ')));
        expect(context.osVersion, isNot(endsWith(' ')));
        expect(context.appVersion, hasLength(63));
        expect(context.appVersion, contains('+'));
        expect(context.deviceCategory, AnalyticsDeviceCategory.phone);
      }

      final tablet = _contextContainer(shortestSide: 600);
      final tabletContext = await tablet.read(
        analyticsContextResolverProvider,
      )();
      tablet.dispose();
      expect(tabletContext.deviceCategory, AnalyticsDeviceCategory.tablet);

      final normalized = _contextContainer(
        version: ' 2.4   beta ',
        buildNumber: ' 8 ',
        platformVersion: ' Android   16 ',
      );
      final normalizedContext = await normalized.read(
        analyticsContextResolverProvider,
      )();
      normalized.dispose();
      expect(normalizedContext.appVersion, '2.4 beta+8');
      expect(normalizedContext.osVersion, 'Android 16');
    },
  );

  test('provider container owns one queue repository and controller', () async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final directory = await Directory.systemTemp.createTemp(
      'analytics-provider-owner-',
    );
    addTearDown(() async {
      if (await directory.exists()) await directory.delete(recursive: true);
    });
    final dio = Dio();
    addTearDown(dio.close);
    final container = ProviderContainer(
      overrides: [
        analyticsApplicationSupportDirectoryProvider.overrideWith(
          (ref) async => directory,
        ),
        connectivityStatusProvider.overrideWith((ref) => Stream.value(false)),
        dioProvider.overrideWithValue(dio),
      ],
    );

    final firstQueue = await container.read(
      analyticsQueueAdapterProvider.future,
    );
    final secondQueue = await container.read(
      analyticsQueueAdapterProvider.future,
    );
    final firstRepository = container.read(analyticsRepositoryProvider);
    final secondRepository = container.read(analyticsRepositoryProvider);
    final firstController = await container.read(
      analyticsSyncControllerProvider.future,
    );
    final secondController = await container.read(
      analyticsSyncControllerProvider.future,
    );

    expect(identical(firstQueue, secondQueue), isTrue);
    expect(identical(firstRepository, secondRepository), isTrue);
    expect(identical(firstController, secondController), isTrue);
    container.dispose();
  });

  test(
    'container disposal cancels controller retry and disposes notifier',
    () async {
      FlutterSecureStorage.setMockInitialValues(<String, String>{});
      final directory = await Directory.systemTemp.createTemp(
        'analytics-provider-dispose-',
      );
      addTearDown(() async {
        if (await directory.exists()) await directory.delete(recursive: true);
      });
      final dio = Dio()..httpClientAdapter = const _AlwaysServerErrorAdapter();
      addTearDown(dio.close);
      final connectivity = StreamController<bool>();
      addTearDown(connectivity.close);
      final container = ProviderContainer(
        overrides: [
          analyticsApplicationSupportDirectoryProvider.overrideWith(
            (ref) async => directory,
          ),
          connectivityStatusProvider.overrideWith((ref) => connectivity.stream),
          dioProvider.overrideWithValue(dio),
        ],
      );
      final connectivitySubscription = container.listen(
        connectivityStatusProvider,
        (_, _) {},
        fireImmediately: true,
      );
      connectivity.add(true);
      await container
          .read(connectivityStatusProvider.future)
          .timeout(const Duration(seconds: 2));
      final queue = await container.read(analyticsQueueAdapterProvider.future);
      await queue.enqueue(
        AnalyticsEvent.build(
          intent: const AccountPromptShownIntent(),
          context: await _context(),
          createEventId: () => '123e4567-e89b-42d3-a456-426614174074',
        ),
      );
      final controller = await container.read(
        analyticsSyncControllerProvider.future,
      );
      final phases = <AnalyticsSyncPhase>[];
      final retrying = Completer<void>();
      void listener() {
        final phase = controller.state.value.phase;
        phases.add(phase);
        if (phase == AnalyticsSyncPhase.retrying && !retrying.isCompleted) {
          retrying.complete();
        }
      }

      controller.state.addListener(listener);
      final syncing = controller.sync(AnalyticsSyncTrigger.startup);
      await retrying.future.timeout(const Duration(seconds: 2));

      connectivitySubscription.close();
      container.dispose();
      await syncing.timeout(const Duration(seconds: 2));

      expect(phases, contains(AnalyticsSyncPhase.disposed));
      expect(() => controller.state.addListener(() {}), throwsFlutterError);
    },
  );
}

ProviderContainer _contextContainer({
  String platform = 'android',
  String platformVersion = '14',
  String version = '1.0.0',
  String buildNumber = '1',
  double shortestSide = 400,
}) {
  FlutterSecureStorage.setMockInitialValues(<String, String>{
    'device_pseudo_id': 'AbCdEfGhIjKlMnOpQrSt_-',
  });
  return ProviderContainer(
    overrides: [
      currentUserProvider.overrideWith((ref) => null),
      analyticsNetworkStateProvider.overrideWithValue(
        AnalyticsNetworkState.unknown,
      ),
      analyticsSessionIdProvider.overrideWithValue(
        '123e4567-e89b-42d3-a456-426614174003',
      ),
      analyticsPackageInfoProvider.overrideWith(
        (ref) async => PackageInfo(
          appName: 'Piso CAMP',
          packageName: 'test.mobile',
          version: version,
          buildNumber: buildNumber,
        ),
      ),
      analyticsOperatingSystemProvider.overrideWithValue(platform),
      analyticsOperatingSystemVersionProvider.overrideWithValue(
        platformVersion,
      ),
      analyticsLogicalShortestSideProvider.overrideWithValue(shortestSide),
      guestIdentityServiceProvider.overrideWithValue(
        GuestIdentityService(SecureStorageService()),
      ),
    ],
  );
}

Future<AnalyticsEventContext> _context() async => const AnalyticsEventContext(
  subjectPseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
  sessionId: '123e4567-e89b-42d3-a456-426614174000',
  accountType: AnalyticsAccountType.guest,
  appVersion: '1.0.0+1',
  osName: AnalyticsOsName.android,
  osVersion: '14',
  deviceCategory: AnalyticsDeviceCategory.phone,
  networkState: AnalyticsNetworkState.online,
);

final class _RecordingEventQueue implements AnalyticsEventQueue {
  _RecordingEventQueue({required this.enqueueFuture});

  final Future<void> enqueueFuture;
  final List<AnalyticsEvent> events = <AnalyticsEvent>[];

  @override
  Future<void> enqueue(AnalyticsEvent event) {
    events.add(event);
    return enqueueFuture;
  }
}

final class _FailingEventQueue implements AnalyticsEventQueue {
  @override
  Future<void> enqueue(AnalyticsEvent event) =>
      Future<void>.error(const AnalyticsQueueException('writeFailed'));
}

final class _AlwaysServerErrorAdapter implements HttpClientAdapter {
  const _AlwaysServerErrorAdapter();

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async => ResponseBody.fromString('private response body', 500);

  @override
  void close({bool force = false}) {}
}
