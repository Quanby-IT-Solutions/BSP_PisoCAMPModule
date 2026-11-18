import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/ar_runtime.dart';
import 'package:mobile/features/pisocamp/data/ar_session.dart';
import 'package:permission_handler/permission_handler.dart';

/// Answers the availability channel with whatever the test wants, including
/// by throwing, so every branch the probe claims to distinguish is exercised.
MethodChannel _channelAnswering(Object? Function() answer) {
  const channel = MethodChannel('pisocamp/ar_availability');
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(channel, (call) async {
        final value = answer();
        if (value is Exception) throw value;
        return value;
      });
  return channel;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SceneViewArCapabilityProbe', () {
    tearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            const MethodChannel('pisocamp/ar_availability'),
            null,
          );
    });

    test('a supported phone is supported', () async {
      final probe = SceneViewArCapabilityProbe(
        channel: _channelAnswering(() => 'supported'),
        platformOverride: TargetPlatform.android,
      );

      final capability = await probe.check();

      expect(capability.supported, isTrue);
      expect(capability.reason, isNull);
    });

    test('ARCore missing or out of date is an unsupported device', () async {
      for (final answer in <String>['needsUpdate', 'unsupported']) {
        final probe = SceneViewArCapabilityProbe(
          channel: _channelAnswering(() => answer),
          platformOverride: TargetPlatform.android,
        );

        final capability = await probe.check();

        expect(capability.supported, isFalse, reason: answer);
        expect(
          capability.reason,
          ArUnavailableReason.deviceUnsupported,
          reason: answer,
        );
      }
    });

    test('a build with no native half reports a missing runtime', () async {
      final probe = SceneViewArCapabilityProbe(
        channel: _channelAnswering(
          () => MissingPluginException('no native half'),
        ),
        platformOverride: TargetPlatform.android,
      );

      final capability = await probe.check();

      expect(capability.reason, ArUnavailableReason.runtimeMissing);
    });

    test('a platform error is a device that cannot run it', () async {
      final probe = SceneViewArCapabilityProbe(
        channel: _channelAnswering(() => PlatformException(code: 'boom')),
        platformOverride: TargetPlatform.android,
      );

      final capability = await probe.check();

      expect(capability.reason, ArUnavailableReason.deviceUnsupported);
    });

    test('a platform this build has no runtime for says so', () async {
      // The channel would answer, and is deliberately not asked: this build
      // ships an Android runtime only, and reporting a device fault for an
      // iPhone would be the wrong sentence on the fallback screen.
      final probe = SceneViewArCapabilityProbe(
        channel: _channelAnswering(() => 'supported'),
        platformOverride: TargetPlatform.iOS,
      );

      final capability = await probe.check();

      expect(capability.reason, ArUnavailableReason.runtimeMissing);
    });

    test(
      'an answer it does not recognise is not treated as supported',
      () async {
        final probe = SceneViewArCapabilityProbe(
          channel: _channelAnswering(() => 'something-new'),
          platformOverride: TargetPlatform.android,
        );

        expect((await probe.check()).supported, isFalse);
      },
    );
  });

  group('SceneViewArSessionFactory', () {
    late Directory cache;

    setUp(() async {
      cache = await Directory.systemTemp.createTemp('ar-runtime-');
    });

    tearDown(() async {
      if (await cache.exists()) await cache.delete(recursive: true);
    });

    SceneViewArSessionFactory factory({
      PermissionStatus permission = PermissionStatus.granted,
      ArModelBytesLoader? loader,
    }) {
      return SceneViewArSessionFactory(
        requestCamera: () async => permission,
        cacheDirectory: () async => cache,
        loadModelBytes:
            loader ?? (id) async => Uint8List.fromList(<int>[1, 2, 3, 4]),
      );
    }

    test('a refused camera is reported as a refusal, not a fault', () async {
      await expectLater(
        factory(permission: PermissionStatus.denied).start(logicalId: 'a'),
        throwsA(
          isA<ArSessionException>().having(
            (error) => error.reason,
            'reason',
            ArUnavailableReason.permissionDenied,
          ),
        ),
      );
    });

    test('a permanently refused camera is still a refusal', () async {
      await expectLater(
        factory(
          permission: PermissionStatus.permanentlyDenied,
        ).start(logicalId: 'a'),
        throwsA(
          isA<ArSessionException>().having(
            (error) => error.reason,
            'reason',
            ArUnavailableReason.permissionDenied,
          ),
        ),
      );
    });

    test(
      'a model that will not load is a sync state, not a broken phone',
      () async {
        await expectLater(
          factory(
            loader: (id) async => throw Exception('not synced'),
          ).start(logicalId: 'a'),
          throwsA(
            isA<ArSessionException>().having(
              (error) => error.reason,
              'reason',
              ArUnavailableReason.assetsMissing,
            ),
          ),
        );
      },
    );

    test('an empty model is missing rather than rendered as nothing', () async {
      await expectLater(
        factory(loader: (id) async => Uint8List(0)).start(logicalId: 'a'),
        throwsA(
          isA<ArSessionException>().having(
            (error) => error.reason,
            'reason',
            ArUnavailableReason.assetsMissing,
          ),
        ),
      );
    });

    test('the verified bytes reach a file the renderer can open', () async {
      final session =
          await factory().start(logicalId: 'catalog.ngc-coins.php-1')
              as SceneViewArSession;

      final written = File(session.modelPath);
      expect(await written.exists(), isTrue);
      expect(await written.readAsBytes(), <int>[1, 2, 3, 4]);
      expect(session.modelPath, endsWith('.glb'));
      await session.dispose();
    });

    test('a logical id cannot walk out of the cache directory', () async {
      final session =
          await factory().start(logicalId: '../../etc/passwd')
              as SceneViewArSession;

      // The separators are gone, so the file lands inside the directory it was
      // given rather than above it.
      expect(session.modelPath, contains('pisocamp'));
      expect(session.modelPath, isNot(contains('..')));
      expect(
        File(session.modelPath).parent.path,
        endsWith('${Platform.pathSeparator}ar'),
      );
      await session.dispose();
    });

    test(
      'reopening the same coin reuses one file rather than piling up',
      () async {
        final first =
            await factory().start(logicalId: 'coin') as SceneViewArSession;
        final second =
            await factory().start(logicalId: 'coin') as SceneViewArSession;

        expect(second.modelPath, first.modelPath);
        final directory = File(first.modelPath).parent;
        expect(directory.listSync().whereType<File>(), hasLength(1));
        await first.dispose();
        await second.dispose();
      },
    );
  });

  group('SceneViewArSession', () {
    test('leaving during placement releases whoever awaited ready', () async {
      final session = SceneViewArSession(modelPath: '/tmp/none.glb');

      // Nothing ever mounted the view, so `ready` would otherwise never
      // settle and the screen would sit on its spinner for good.
      await session.dispose();

      await expectLater(session.ready, throwsA(isA<ArSessionException>()));
    });

    test('disposing twice is harmless', () async {
      final session = SceneViewArSession(modelPath: '/tmp/none.glb');
      await session.dispose();
      await expectLater(session.dispose(), completes);
    });
  });
}
