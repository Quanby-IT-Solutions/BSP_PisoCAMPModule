import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/recognition_engine.dart';
import 'package:mobile/features/pisocamp/data/recognition_model.dart';
import 'package:mobile/features/pisocamp/data/speech_announcer.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/screens/recognition_scanner_screen.dart';

class _RecordingQueue implements AnalyticsEventQueue {
  final List<AnalyticsEvent> events = <AnalyticsEvent>[];

  @override
  Future<void> enqueue(AnalyticsEvent event) async => events.add(event);
}

class _RecordingAnnouncer implements SpeechAnnouncer {
  final List<String> spoken = <String>[];
  var stops = 0;

  @override
  Future<void> speak(String text) async => spoken.add(text);

  @override
  Future<void> stop() async => stops += 1;

  @override
  Future<void> dispose() async => stops += 1;
}

Uint8List _pixels() => Uint8List.fromList(List<int>.filled(32, 9));

RecognitionModelDocument _model() => RecognitionModelDocument.parse(
  utf8.encode(
    jsonEncode(<String, Object?>{
      'schemaVersion': 1,
      'version': '2026.09.1',
      'classes': <Object?>[
        {
          'classId': 0,
          'outcome': 'denomination',
          'label': 'One thousand pesos',
          'denominationCode': 'PHP1000',
        },
      ],
    }),
  ),
  _pixels(),
);

RecognitionModelDocument _mixedModel() => RecognitionModelDocument.parse(
  utf8.encode(
    jsonEncode(<String, Object?>{
      'schemaVersion': 1,
      'version': '2026.09.1',
      'classes': <Object?>[
        {
          'classId': 0,
          'outcome': 'denomination',
          'label': 'One thousand pesos',
          'denominationCode': 'PHP1000',
        },
        {'classId': 1, 'outcome': 'demonetized', 'label': 'New Design Series'},
        {'classId': 2, 'outcome': 'foreign'},
      ],
    }),
  ),
  _pixels(),
);

class _FixedModelSource implements RecognitionModelSource {
  _FixedModelSource(this.document);

  final RecognitionModelDocument document;
  var loads = 0;

  @override
  Future<RecognitionModelDocument> load() async {
    loads += 1;
    return document;
  }
}

class _MissingModelSource implements RecognitionModelSource {
  const _MissingModelSource();

  @override
  Future<RecognitionModelDocument> load() async =>
      throw const RecognitionModelException(RecognitionModelProblem.missing);
}

class _ConfidentEngine implements RecognitionEngine {
  _ConfidentEngine({this.confidence = 0.96, this.classId = 0});

  final double confidence;
  final int classId;

  @override
  Future<void> load(RecognitionModelDocument model) async {}

  @override
  Future<RecognitionInference> classify(RecognitionFrame frame) async =>
      RecognitionInference(classId: classId, confidence: confidence);

  @override
  Future<void> dispose() async {}
}

/// Delivers a short burst of frames as soon as somebody listens.
class _SteadyCamera implements CameraFrameSource {
  var opened = 0;

  @override
  Stream<RecognitionFrame> frames() {
    opened += 1;
    final controller = StreamController<RecognitionFrame>();
    controller.onListen = () {
      for (var index = 0; index < 5; index += 1) {
        controller.add(
          RecognitionFrame(
            bytes: _pixels(),
            width: 4,
            height: 8,
            rotationDegrees: 0,
          ),
        );
      }
    };
    return controller.stream;
  }
}

class _RefusedCamera implements CameraFrameSource {
  var opened = 0;

  @override
  Stream<RecognitionFrame> frames() {
    opened += 1;
    return Stream<RecognitionFrame>.error(
      const CameraFrameException(CameraProblem.permissionDenied),
    );
  }
}

void main() {
  late _RecordingQueue queue;
  late _RecordingAnnouncer announcer;

  setUp(() {
    queue = _RecordingQueue();
    announcer = _RecordingAnnouncer();
  });

  Future<void> pumpScreen(
    WidgetTester tester, {
    required RecognitionModelSource modelSource,
    required RecognitionEngine engine,
    required CameraFrameSource camera,
    double threshold = 0.8,
    Duration dwell = const Duration(seconds: 8),
    SpeechAnnouncer? speech,
    bool pushed = false,
  }) async {
    final router = GoRouter(
      initialLocation: pushed ? '/home' : '/scan',
      routes: [
        GoRoute(
          path: '/home',
          builder: (context, state) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => context.push('/scan'),
                child: const Text('Where I came from'),
              ),
            ),
          ),
        ),
        GoRoute(
          path: '/scan',
          builder: (context, state) => RecognitionScannerScreen(
            modelSource: modelSource,
            engine: engine,
            camera: camera,
            announcer: speech ?? announcer,
            confidenceThreshold: threshold,
            dwell: dwell,
          ),
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          analyticsSdkProvider.overrideWithValue(
            AnalyticsSdk(
              context: () async => const AnalyticsEventContext(
                subjectPseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
                sessionId: '123e4567-e89b-42d3-a456-426614174000',
                accountType: AnalyticsAccountType.guest,
                appVersion: '1.0.0+1',
                osName: AnalyticsOsName.android,
                osVersion: '15',
                deviceCategory: AnalyticsDeviceCategory.phone,
                networkState: AnalyticsNetworkState.online,
              ),
              queue: () async => queue,
              scheduleSync: () async {},
            ),
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
    if (pushed) {
      await tester.tap(find.text('Where I came from'));
      await tester.pumpAndSettle();
    }
  }

  List<Map<String, Object?>> events() =>
      queue.events.map((event) => event.toJson()).toList();

  testWidgets('explains the camera and the disclaimer before anything opens', (
    tester,
  ) async {
    final camera = _SteadyCamera();
    await pumpScreen(
      tester,
      modelSource: _FixedModelSource(_model()),
      engine: _ConfidentEngine(),
      camera: camera,
    );

    expect(find.text('Before the camera opens'), findsOneWidget);
    // The disclaimer is on the first screen, not only after a reading: the
    // decision somebody is about to make is why they opened this at all.
    expect(find.text(kAuthenticityDisclaimer), findsOneWidget);
    // Nothing has been started, so the OS prompt has not happened either.
    expect(camera.opened, 0);
  });

  testWidgets('shows and speaks the denomination with its disclaimer', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      modelSource: _FixedModelSource(_model()),
      engine: _ConfidentEngine(),
      camera: _SteadyCamera(),
    );

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.text('One thousand pesos'), findsOneWidget);
    expect(find.text(kAuthenticityDisclaimer), findsOneWidget);
    // Spoken as one utterance, so the reading cannot be heard without the
    // qualification that follows it.
    expect(announcer.spoken, hasLength(1));
    expect(announcer.spoken.single, startsWith('One thousand pesos.'));
    expect(announcer.spoken.single, contains(kAuthenticityDisclaimer));
  });

  testWidgets('the written result stands on its own when audio is muted', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      modelSource: _FixedModelSource(_model()),
      engine: _ConfidentEngine(),
      camera: _SteadyCamera(),
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Mute the spoken result'));
    await tester.pumpAndSettle();

    expect(announcer.stops, greaterThanOrEqualTo(1));
    // Muting silences the speech and changes nothing else: the denomination
    // and the disclaimer are both still on the screen.
    expect(find.text('One thousand pesos'), findsOneWidget);
    expect(find.text(kAuthenticityDisclaimer), findsOneWidget);

    final spokenWhileMuted = announcer.spoken.length;
    await tester.tap(find.text('Play again'));
    await tester.pumpAndSettle();
    expect(announcer.spoken, hasLength(spokenWhileMuted));
  });

  testWidgets('replays the reading on request', (tester) async {
    await pumpScreen(
      tester,
      modelSource: _FixedModelSource(_model()),
      engine: _ConfidentEngine(),
      camera: _SteadyCamera(),
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Play again'));
    await tester.pumpAndSettle();

    expect(announcer.spoken, hasLength(2));
    expect(announcer.spoken.last, contains(kAuthenticityDisclaimer));
  });

  testWidgets('says the reader is unavailable and names no note', (
    tester,
  ) async {
    final camera = _SteadyCamera();
    await pumpScreen(
      tester,
      modelSource: const _MissingModelSource(),
      engine: _ConfidentEngine(),
      camera: camera,
    );

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(
      find.text('The banknote reader has not been downloaded to this phone yet.'),
      findsOneWidget,
    );
    // Nothing that could be read as a denomination, and no camera opened for a
    // scan that could never happen.
    expect(find.text('One thousand pesos'), findsNothing);
    expect(announcer.spoken, isEmpty);
    expect(camera.opened, 0);
  });

  testWidgets('says nothing about a note when the camera is refused', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      modelSource: _FixedModelSource(_model()),
      engine: _ConfidentEngine(),
      camera: _RefusedCamera(),
    );

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Without camera access'), findsOneWidget);
    expect(announcer.spoken, isEmpty);
    final event = events().single;
    expect(event['eventName'], 'recognition_result');
    // A refusal is reported as a refusal, and as a scan that never ran.
    expect(
      (event['properties']! as Map<String, Object?>)['outcome'],
      'permission_denied',
    );
    expect(event['status'], 'failed');
  });

  testWidgets('reports one event per attempt, with no image data', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      modelSource: _FixedModelSource(_model()),
      engine: _ConfidentEngine(),
      camera: _SteadyCamera(),
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    final event = events().single;
    expect(event['eventName'], 'recognition_result');
    expect(event['status'], 'completed');
    final properties = event['properties']! as Map<String, Object?>;
    expect(properties['outcome'], 'recognized');
    // DR-4: which weights produced it, so a figure can be traced back.
    expect(properties['modelVersion'], '2026.09.1');
    // The whole property set: no denomination, no confidence, nothing from the
    // frame. What somebody is holding is not the module's business.
    expect(properties.keys.toSet(), <String>{
      'outcome',
      'elapsedMs',
      'modelVersion',
    });
  });

  testWidgets('scanning again starts a fresh attempt and reports it', (
    tester,
  ) async {
    final source = _FixedModelSource(_model());
    await pumpScreen(
      tester,
      modelSource: source,
      engine: _ConfidentEngine(),
      camera: _SteadyCamera(),
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Scan another note'));
    await tester.pumpAndSettle();

    expect(source.loads, 2);
    expect(events(), hasLength(2));
    expect(find.text('One thousand pesos'), findsOneWidget);
  });

  testWidgets('a reading below the threshold is never shown or spoken', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      modelSource: _FixedModelSource(_model()),
      engine: _ConfidentEngine(confidence: 0.6),
      camera: _SteadyCamera(),
      threshold: 0.9,
    );

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.text('One thousand pesos'), findsNothing);
    expect(announcer.spoken, isEmpty);
    expect(find.text('Point the camera at the banknote'), findsOneWidget);
  });

  group('DR-3 a note that is not circulating legal tender', () {
    Future<void> pumpFinding(WidgetTester tester, int classId) async {
      await pumpScreen(
        tester,
        modelSource: _FixedModelSource(_mixedModel()),
        engine: _ConfidentEngine(classId: classId),
        camera: _SteadyCamera(),
      );
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
    }

    testWidgets('says a demonetized note is out of circulation, in both', (
      tester,
    ) async {
      await pumpFinding(tester, 1);

      expect(
        find.text('This note is no longer in circulation'),
        findsOneWidget,
      );
      expect(find.textContaining('New Design Series'), findsOneWidget);
      expect(find.textContaining('demonetized series'), findsOneWidget);
      // DR-004 asks for both halves: what it is, and what this reader is for.
      expect(
        find.textContaining('identifies circulating legal tender only'),
        findsOneWidget,
      );

      // The same sentence aloud, and no denomination in it.
      expect(announcer.spoken, hasLength(1));
      expect(announcer.spoken.single, contains('New Design Series'));
      expect(announcer.spoken.single, isNot(contains('pesos')));
    });

    testWidgets('says a foreign note is not Philippine, and stops there', (
      tester,
    ) async {
      await pumpFinding(tester, 2);

      expect(find.text('This is not Philippine currency'), findsOneWidget);
      expect(announcer.spoken, hasLength(1));

      // Section 17: which currency it is is outside this module, and neither
      // the screen nor the speech is allowed to guess.
      for (final currency in <String>[
        'dollar',
        'euro',
        'yen',
        'ringgit',
        'USD',
      ]) {
        expect(
          find.textContaining(currency, findRichText: true),
          findsNothing,
          reason: currency,
        );
        expect(announcer.spoken.single, isNot(contains(currency)));
      }
    });

    testWidgets('keeps the disclaimer on both findings, spoken and shown', (
      tester,
    ) async {
      for (final classId in <int>[1, 2]) {
        await pumpFinding(tester, classId);

        // Somebody holding an unfamiliar note is even more likely to be asking
        // whether it is real, so the qualification travels with the answer.
        expect(find.text(kAuthenticityDisclaimer), findsOneWidget);
        expect(announcer.spoken.last, contains(kAuthenticityDisclaimer));
        announcer.spoken.clear();
      }
    });

    testWidgets('reports the finding without calling it a denomination', (
      tester,
    ) async {
      for (final (classId, outcome) in <(int, String)>[
        (1, 'demonetized'),
        (2, 'foreign'),
      ]) {
        queue.events.clear();
        await pumpFinding(tester, classId);

        final event = events().single;
        final properties = event['properties']! as Map<String, Object?>;
        expect(properties['outcome'], outcome);
        // A scan that ran and concluded, so it is a completed one.
        expect(event['status'], 'completed');
      }
    });

    testWidgets('replays and rescans like any other finding', (tester) async {
      await pumpFinding(tester, 1);

      await tester.tap(find.text('Play again'));
      await tester.pumpAndSettle();
      expect(announcer.spoken, hasLength(2));

      await tester.tap(find.text('Scan another note'));
      await tester.pumpAndSettle();
      expect(
        find.text('This note is no longer in circulation'),
        findsOneWidget,
      );
    });
  });

  group('DR-2 a note it could not read', () {
    testWidgets('says so and shows what to try, naming no note', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        modelSource: _FixedModelSource(_model()),
        engine: _ConfidentEngine(confidence: 0.4),
        camera: _SteadyCamera(),
        dwell: const Duration(milliseconds: 40),
      );
      await tester.tap(find.text('Continue'));
      await tester.pump(const Duration(milliseconds: 60));
      await tester.pumpAndSettle();

      expect(find.text('The note could not be read'), findsOneWidget);
      // The four things that actually change the next attempt.
      expect(find.textContaining('brighter'), findsOneWidget);
      expect(find.textContaining('hand-span away'), findsOneWidget);
      expect(find.textContaining('sits straight'), findsOneWidget);
      expect(find.textContaining('flat and unfolded'), findsOneWidget);

      // DR-009: no denomination is shown or spoken, not even a hedged one.
      expect(find.text('One thousand pesos'), findsNothing);
      expect(announcer.spoken, isEmpty);

      final event = events().single;
      final properties = event['properties']! as Map<String, Object?>;
      expect(properties['outcome'], 'unrecognized');
      // A scan that ran and found nothing is a completed scan: the model
      // answered, and counting it as a failure would hide its real failure
      // rate behind broken installs.
      expect(event['status'], 'completed');
    });

    testWidgets('Retry starts scanning again', (tester) async {
      final source = _FixedModelSource(_model());
      await pumpScreen(
        tester,
        modelSource: source,
        engine: _ConfidentEngine(confidence: 0.4),
        camera: _SteadyCamera(),
        dwell: const Duration(milliseconds: 40),
      );
      await tester.tap(find.text('Continue'));
      await tester.pump(const Duration(milliseconds: 60));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Retry'));
      // Pumped short of the dwell, because the point is that scanning resumed —
      // settling would run the second attempt out to its own conclusion.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 5));

      expect(source.loads, 2);
      expect(find.text('Point the camera at the banknote'), findsOneWidget);
      expect(find.text('The note could not be read'), findsNothing);
    });

    testWidgets('Exit returns to where I came from', (tester) async {
      await pumpScreen(
        tester,
        modelSource: _FixedModelSource(_model()),
        engine: _ConfidentEngine(confidence: 0.4),
        camera: _SteadyCamera(),
        dwell: const Duration(milliseconds: 40),
        pushed: true,
      );
      await tester.tap(find.text('Continue'));
      await tester.pump(const Duration(milliseconds: 60));
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(OutlinedButton, 'Exit'));
      await tester.pumpAndSettle();

      expect(find.text('Where I came from'), findsOneWidget);
    });

    testWidgets('every control is 48dp on a narrow screen', (tester) async {
      tester.view.physicalSize = const Size(320, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await pumpScreen(
        tester,
        modelSource: _FixedModelSource(_model()),
        engine: _ConfidentEngine(confidence: 0.4),
        camera: _SteadyCamera(),
        dwell: const Duration(milliseconds: 40),
      );
      await tester.tap(find.text('Continue'));
      await tester.pump(const Duration(milliseconds: 60));
      await tester.pumpAndSettle();

      // The guidance is long, so the controls sit below the fold on a small
      // phone; what matters is that they are reachable and full-size there.
      for (final label in <String>['Retry', 'Exit']) {
        final control = find.widgetWithText(SizedBox, label);
        await tester.scrollUntilVisible(control, 80);
        expect(
          tester.getSize(control.first).height,
          greaterThanOrEqualTo(48),
          reason: label,
        );
      }
      expect(tester.takeException(), isNull);
    });
  });

  testWidgets('every control is reachable and 48dp on a narrow screen', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await pumpScreen(
      tester,
      modelSource: _FixedModelSource(_model()),
      engine: _ConfidentEngine(),
      camera: _SteadyCamera(),
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    for (final label in <String>['Play again', 'Scan another note', 'Exit']) {
      final size = tester.getSize(find.widgetWithText(SizedBox, label).first);
      expect(size.height, greaterThanOrEqualTo(48), reason: label);
    }
    expect(tester.takeException(), isNull);
  });
}
