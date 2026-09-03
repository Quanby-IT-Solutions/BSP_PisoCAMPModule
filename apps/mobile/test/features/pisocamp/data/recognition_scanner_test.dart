import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/recognition_engine.dart';
import 'package:mobile/features/pisocamp/data/recognition_model.dart';
import 'package:mobile/features/pisocamp/data/recognition_scanner.dart';

Uint8List _pixels([int value = 200]) =>
    Uint8List.fromList(List<int>.filled(64, value));

RecognitionFrame _frame([int value = 200]) => RecognitionFrame(
  bytes: _pixels(value),
  width: 8,
  height: 8,
  rotationDegrees: 0,
);

List<int> _descriptor({String version = '2026.09.1'}) => utf8.encode(
  jsonEncode(<String, Object?>{
    'schemaVersion': 1,
    'version': version,
    'classes': <Object?>[
      {
        'classId': 0,
        'outcome': 'denomination',
        'label': 'One thousand pesos',
        'denominationCode': 'PHP1000',
      },
      {
        'classId': 1,
        'outcome': 'denomination',
        'label': 'Twenty pesos',
        'denominationCode': 'PHP20',
      },
    ],
  }),
);

class _FixedModelSource implements RecognitionModelSource {
  _FixedModelSource(this.document);

  final RecognitionModelDocument document;

  @override
  Future<RecognitionModelDocument> load() async => document;
}

class _FailingModelSource implements RecognitionModelSource {
  const _FailingModelSource(this.problem);

  final RecognitionModelProblem problem;

  @override
  Future<RecognitionModelDocument> load() async =>
      throw RecognitionModelException(problem);
}

class _ScriptedEngine implements RecognitionEngine {
  _ScriptedEngine(this.script);

  /// Confidence and class per frame, in order. A null entry throws.
  final List<RecognitionInference?> script;
  final List<RecognitionFrame> seen = <RecognitionFrame>[];
  var loaded = 0;
  var disposals = 0;
  Duration delay = Duration.zero;

  @override
  Future<void> load(RecognitionModelDocument model) async => loaded += 1;

  @override
  Future<RecognitionInference> classify(RecognitionFrame frame) async {
    seen.add(frame);
    if (delay > Duration.zero) await Future<void>.delayed(delay);
    final next = seen.length <= script.length
        ? script[seen.length - 1]
        : const RecognitionInference(classId: 0, confidence: 0.1);
    if (next == null) throw StateError('unreadable frame');
    return next;
  }

  @override
  Future<void> dispose() async => disposals += 1;
}

class _RefusingEngine implements RecognitionEngine {
  const _RefusingEngine();

  @override
  Future<void> load(RecognitionModelDocument model) async =>
      throw const RecognitionEngineException(
        RecognitionEngineProblem.modelRejected,
      );

  @override
  Future<RecognitionInference> classify(RecognitionFrame frame) async =>
      throw const RecognitionEngineException(
        RecognitionEngineProblem.runtimeMissing,
      );

  @override
  Future<void> dispose() async {}
}

class _ScriptedCamera implements CameraFrameSource {
  _ScriptedCamera(this.controller);

  final StreamController<RecognitionFrame> controller;

  @override
  Stream<RecognitionFrame> frames() => controller.stream;
}

class _FailingCamera implements CameraFrameSource {
  const _FailingCamera(this.problem);

  final CameraProblem problem;

  @override
  Stream<RecognitionFrame> frames() =>
      Stream<RecognitionFrame>.error(CameraFrameException(problem));
}

/// A file system that refuses every operation, so any attempt to persist a
/// frame becomes a test failure rather than a file nobody notices.
final class _NoWritesFileSystem extends IOOverrides {
  final List<String> attempts = <String>[];

  @override
  File createFile(String path) {
    attempts.add('createFile $path');
    return super.createFile(path);
  }

  @override
  Directory createDirectory(String path) {
    attempts.add('createDirectory $path');
    return super.createDirectory(path);
  }

  @override
  Future<Socket> socketConnect(
    Object? host,
    int port, {
    Object? sourceAddress,
    int sourcePort = 0,
    Duration? timeout,
  }) {
    attempts.add('socketConnect $host:$port');
    return super.socketConnect(
      host,
      port,
      sourceAddress: sourceAddress,
      sourcePort: sourcePort,
      timeout: timeout,
    );
  }
}

class _NoNetwork extends HttpOverrides {
  final List<String> attempts = <String>[];

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    attempts.add('createHttpClient');
    return super.createHttpClient(context);
  }
}

void main() {
  late RecognitionModelDocument model;

  setUp(() {
    model = RecognitionModelDocument.parse(_descriptor(), _pixels(7));
  });

  Future<List<RecognitionScanState>> collect(
    RecognitionScanner scanner, {
    Future<void> Function()? feed,
  }) async {
    final states = <RecognitionScanState>[];
    final done = scanner.states.listen(states.add).asFuture<void>();
    await scanner.start();
    if (feed != null) await feed();
    await done;
    return states;
  }

  group('DR-1 reading a denomination', () {
    test('names the note the model was confident about', () async {
      final camera = StreamController<RecognitionFrame>();
      final engine = _ScriptedEngine(<RecognitionInference?>[
        const RecognitionInference(classId: 1, confidence: 0.94),
      ]);
      final scanner = RecognitionScanner(
        modelSource: _FixedModelSource(model),
        engine: engine,
        camera: _ScriptedCamera(camera),
        confidenceThreshold: 0.8,
      );

      final states = await collect(
        scanner,
        feed: () async {
          camera.add(_frame());
          await Future<void>.delayed(Duration.zero);
        },
      );

      expect(states.first, isA<RecognitionPreparing>());
      expect(states[1], isA<RecognitionScanning>());
      final recognized = states.last as RecognitionRecognized;
      expect(recognized.label, 'Twenty pesos');
      expect(recognized.denominationCode, 'PHP20');
      expect(engine.disposals, 1);
    });

    test('never names a note the model was unsure about', () async {
      final camera = StreamController<RecognitionFrame>();
      final engine = _ScriptedEngine(<RecognitionInference?>[
        // Just under the threshold. A near miss is still a wrong answer
        // waiting to be read as a right one.
        const RecognitionInference(classId: 0, confidence: 0.79),
        const RecognitionInference(classId: 0, confidence: 0.5),
      ]);
      final scanner = RecognitionScanner(
        modelSource: _FixedModelSource(model),
        engine: engine,
        camera: _ScriptedCamera(camera),
        confidenceThreshold: 0.8,
      );
      final states = <RecognitionScanState>[];
      scanner.states.listen(states.add);
      await scanner.start();
      camera
        ..add(_frame())
        ..add(_frame());
      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(states.whereType<RecognitionRecognized>(), isEmpty);
      expect(states.last, isA<RecognitionScanning>());
      await scanner.dispose();
    });

    test('refuses a class the approved list does not account for', () async {
      final camera = StreamController<RecognitionFrame>();
      final engine = _ScriptedEngine(<RecognitionInference?>[
        // Confident, and about a class this descriptor never declared: a model
        // and a descriptor that disagree must not produce a denomination.
        const RecognitionInference(classId: 42, confidence: 0.99),
      ]);
      final scanner = RecognitionScanner(
        modelSource: _FixedModelSource(model),
        engine: engine,
        camera: _ScriptedCamera(camera),
        confidenceThreshold: 0.8,
      );
      final states = <RecognitionScanState>[];
      scanner.states.listen(states.add);
      await scanner.start();
      camera.add(_frame());
      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(states.whereType<RecognitionRecognized>(), isEmpty);
      await scanner.dispose();
    });
  });

  group('DR-1 frames never leave the device', () {
    test('releases every frame it is given, including one that throws', () async {
      final camera = StreamController<RecognitionFrame>();
      final engine = _ScriptedEngine(<RecognitionInference?>[
        null,
        const RecognitionInference(classId: 0, confidence: 0.2),
        const RecognitionInference(classId: 0, confidence: 0.95),
      ]);
      final scanner = RecognitionScanner(
        modelSource: _FixedModelSource(model),
        engine: engine,
        camera: _ScriptedCamera(camera),
        confidenceThreshold: 0.8,
      );
      final frames = <RecognitionFrame>[];
      scanner.states.listen((_) {});
      await scanner.start();
      for (var index = 0; index < 3; index += 1) {
        final frame = _frame();
        frames.add(frame);
        camera.add(frame);
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }

      expect(frames.every((frame) => frame.isReleased), isTrue);
      // Released means the pixels are gone, not merely unreferenced.
      expect(() => frames.first.bytes, throwsStateError);
      await scanner.dispose();
    });

    test('drops frames it cannot keep up with instead of queueing them', () async {
      final camera = StreamController<RecognitionFrame>();
      final engine = _ScriptedEngine(<RecognitionInference?>[])
        ..delay = const Duration(milliseconds: 40);
      final scanner = RecognitionScanner(
        modelSource: _FixedModelSource(model),
        engine: engine,
        camera: _ScriptedCamera(camera),
        confidenceThreshold: 0.8,
      );
      scanner.states.listen((_) {});
      await scanner.start();

      final frames = List<RecognitionFrame>.generate(6, (_) => _frame());
      for (final frame in frames) {
        camera.add(frame);
      }
      await Future<void>.delayed(const Duration(milliseconds: 80));

      // A queue of camera buffers is the memory leak this feature would
      // otherwise have; the dropped ones are released on the spot.
      expect(scanner.droppedFrames, greaterThan(0));
      expect(engine.seen.length, lessThan(frames.length));
      expect(frames.every((frame) => frame.isReleased), isTrue);
      await scanner.dispose();
    });

    test('writes no file and opens no connection while scanning', () async {
      final files = _NoWritesFileSystem();
      final network = _NoNetwork();

      await IOOverrides.runZoned(
        () => HttpOverrides.runZoned(() async {
          final camera = StreamController<RecognitionFrame>();
          final engine = _ScriptedEngine(<RecognitionInference?>[
            const RecognitionInference(classId: 0, confidence: 0.3),
            const RecognitionInference(classId: 0, confidence: 0.97),
          ]);
          final scanner = RecognitionScanner(
            modelSource: _FixedModelSource(model),
            engine: engine,
            camera: _ScriptedCamera(camera),
            confidenceThreshold: 0.8,
          );
          final states = <RecognitionScanState>[];
          scanner.states.listen(states.add);
          await scanner.start();
          camera
            ..add(_frame())
            ..add(_frame(120));
          await Future<void>.delayed(const Duration(milliseconds: 20));
          expect(states.whereType<RecognitionRecognized>(), hasLength(1));
          await scanner.dispose();
        }, createHttpClient: network.createHttpClient),
        createFile: files.createFile,
        createDirectory: files.createDirectory,
        socketConnect: files.socketConnect,
      );

      // DR-003 in the plainest terms available to a test: the scan ran end to
      // end and touched neither the disk nor the network.
      expect(files.attempts, isEmpty);
      expect(network.attempts, isEmpty);
    });
  });

  group('DR-3 notes that are not circulating legal tender', () {
    RecognitionModelDocument mixedModel() => RecognitionModelDocument.parse(
      utf8.encode(
        jsonEncode(<String, Object?>{
          'schemaVersion': 1,
          'version': '2026.09.1',
          'classes': <Object?>[
            {
              'classId': 0,
              'outcome': 'denomination',
              'label': 'Twenty pesos',
              'denominationCode': 'PHP20',
            },
            {
              'classId': 1,
              'outcome': 'demonetized',
              'label': 'New Design Series',
            },
            {'classId': 2, 'outcome': 'foreign'},
          ],
        }),
      ),
      _pixels(7),
    );

    Future<RecognitionScanState> conclude(int classId) async {
      final camera = StreamController<RecognitionFrame>();
      final scanner = RecognitionScanner(
        modelSource: _FixedModelSource(mixedModel()),
        engine: _ScriptedEngine(<RecognitionInference?>[
          RecognitionInference(classId: classId, confidence: 0.97),
        ]),
        camera: _ScriptedCamera(camera),
        confidenceThreshold: 0.8,
      );
      final states = <RecognitionScanState>[];
      scanner.states.listen(states.add);
      await scanner.start();
      camera.add(_frame());
      await Future<void>.delayed(const Duration(milliseconds: 10));
      await scanner.dispose();
      return states.last;
    }

    test('a demonetized class never becomes a denomination', () async {
      final state = await conclude(1);

      expect(state, isA<RecognitionDemonetized>());
      expect((state as RecognitionDemonetized).series, 'New Design Series');
      // The same class, confidently read, must not have reached the branch
      // that names money.
      expect(state, isNot(isA<RecognitionRecognized>()));
    });

    test('a foreign class carries nothing that could name a currency', () async {
      final state = await conclude(2);

      expect(state, isA<RecognitionForeign>());
    });

    test('a circulating class still reads as its denomination', () async {
      final state = await conclude(0);

      expect((state as RecognitionRecognized).denominationCode, 'PHP20');
    });
  });

  group('DR-2 a note it cannot read', () {
    test('gives up after the dwell time and claims nothing', () async {
      final camera = StreamController<RecognitionFrame>();
      final engine = _ScriptedEngine(<RecognitionInference?>[])
        // Every frame below the threshold, for as long as it takes.
        ..script.addAll(<RecognitionInference?>[]);
      final scanner = RecognitionScanner(
        modelSource: _FixedModelSource(model),
        engine: engine,
        camera: _ScriptedCamera(camera),
        confidenceThreshold: 0.8,
        dwell: const Duration(milliseconds: 40),
      );
      final states = <RecognitionScanState>[];
      scanner.states.listen(states.add);
      await scanner.start();
      camera
        ..add(_frame())
        ..add(_frame());
      await Future<void>.delayed(const Duration(milliseconds: 80));

      expect(states.whereType<RecognitionRecognized>(), isEmpty);
      expect(states.last, isA<RecognitionUnrecognized>());
      // The camera and the runtime are released with the answer, not left
      // running behind a screen that has stopped looking.
      expect(engine.disposals, 1);
    });

    test('gives up when the camera stops delivering frames at all', () async {
      final camera = StreamController<RecognitionFrame>();
      final scanner = RecognitionScanner(
        modelSource: _FixedModelSource(model),
        engine: _ScriptedEngine(<RecognitionInference?>[]),
        camera: _ScriptedCamera(camera),
        confidenceThreshold: 0.8,
        dwell: const Duration(milliseconds: 30),
      );
      final states = <RecognitionScanState>[];
      scanner.states.listen(states.add);
      await scanner.start();
      // Nothing is fed. A silent camera must end the same way as an unreadable
      // note: somebody is not left holding a note at a screen that will never
      // answer.
      await Future<void>.delayed(const Duration(milliseconds: 60));

      expect(states.last, isA<RecognitionUnrecognized>());
    });

    test('a confident reading before the dwell expires wins', () async {
      final camera = StreamController<RecognitionFrame>();
      final scanner = RecognitionScanner(
        modelSource: _FixedModelSource(model),
        engine: _ScriptedEngine(<RecognitionInference?>[
          const RecognitionInference(classId: 0, confidence: 0.3),
          const RecognitionInference(classId: 1, confidence: 0.95),
        ]),
        camera: _ScriptedCamera(camera),
        confidenceThreshold: 0.8,
        dwell: const Duration(milliseconds: 200),
      );
      final states = <RecognitionScanState>[];
      scanner.states.listen(states.add);
      await scanner.start();
      camera
        ..add(_frame())
        ..add(_frame());
      await Future<void>.delayed(const Duration(milliseconds: 250));

      // And the dwell timer does not then fire on top of it: one scan, one
      // answer.
      expect(states.whereType<RecognitionUnrecognized>(), isEmpty);
      expect(states.last, isA<RecognitionRecognized>());
    });
  });

  group('DR-1 when it cannot run', () {
    test('says the model is missing rather than guessing', () async {
      final scanner = RecognitionScanner(
        modelSource: const _FailingModelSource(RecognitionModelProblem.missing),
        engine: _ScriptedEngine(<RecognitionInference?>[]),
        camera: _ScriptedCamera(StreamController<RecognitionFrame>()),
        confidenceThreshold: 0.8,
      );
      final states = await collect(scanner);

      expect(
        (states.last as RecognitionUnavailable).reason,
        RecognitionUnavailableReason.modelMissing,
      );
      expect(states.whereType<RecognitionScanning>(), isEmpty);
    });

    test('never opens the camera when the model is corrupt', () async {
      final camera = _CountingCamera();
      final scanner = RecognitionScanner(
        modelSource: const _FailingModelSource(RecognitionModelProblem.corrupt),
        engine: _ScriptedEngine(<RecognitionInference?>[]),
        camera: camera,
        confidenceThreshold: 0.8,
      );
      final states = await collect(scanner);

      expect(
        (states.last as RecognitionUnavailable).reason,
        RecognitionUnavailableReason.modelCorrupt,
      );
      // Asking for the camera to then say the feature does not work is a
      // permission prompt spent for nothing.
      expect(camera.opened, 0);
    });

    test('reports a runtime that will not take the model', () async {
      final scanner = RecognitionScanner(
        modelSource: _FixedModelSource(model),
        engine: const _RefusingEngine(),
        camera: _ScriptedCamera(StreamController<RecognitionFrame>()),
        confidenceThreshold: 0.8,
      );
      final states = await collect(scanner);

      expect(
        (states.last as RecognitionUnavailable).reason,
        RecognitionUnavailableReason.engineMissing,
      );
    });

    test('tells a refused camera apart from a broken one', () async {
      for (final pair in <(CameraProblem, RecognitionUnavailableReason)>[
        (CameraProblem.permissionDenied, RecognitionUnavailableReason.permissionDenied),
        (CameraProblem.unavailable, RecognitionUnavailableReason.cameraUnavailable),
      ]) {
        final scanner = RecognitionScanner(
          modelSource: _FixedModelSource(model),
          engine: _ScriptedEngine(<RecognitionInference?>[]),
          camera: _FailingCamera(pair.$1),
          confidenceThreshold: 0.8,
        );
        final states = await collect(scanner);
        expect(
          (states.last as RecognitionUnavailable).reason,
          pair.$2,
          reason: pair.$1.name,
        );
      }
    });

    test('a build with no runtime says so instead of scanning', () async {
      final scanner = RecognitionScanner(
        modelSource: _FixedModelSource(model),
        engine: const UnavailableRecognitionEngine(),
        camera: const UnavailableCameraFrameSource(),
        confidenceThreshold: 0.8,
      );
      final states = await collect(scanner);

      expect(
        (states.last as RecognitionUnavailable).reason,
        RecognitionUnavailableReason.engineMissing,
      );
    });
  });
}

class _CountingCamera implements CameraFrameSource {
  var opened = 0;

  @override
  Stream<RecognitionFrame> frames() {
    opened += 1;
    return const Stream<RecognitionFrame>.empty();
  }
}
