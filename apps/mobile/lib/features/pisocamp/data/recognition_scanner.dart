import 'dart:async';

import 'recognition_engine.dart';
import 'recognition_model.dart';

/// Why a scan could not be attempted.
enum RecognitionUnavailableReason {
  /// No recognition model in the synced bundle.
  modelMissing,

  /// A model is there but does not read as one.
  modelCorrupt,

  /// This build has no inference runtime, or it refused the model.
  engineMissing,

  /// The person did not grant camera access.
  permissionDenied,

  /// The camera could not be opened.
  cameraUnavailable,
}

/// What the scanner is doing, and what it concluded.
sealed class RecognitionScanState {
  const RecognitionScanState();
}

final class RecognitionPreparing extends RecognitionScanState {
  const RecognitionPreparing();
}

final class RecognitionScanning extends RecognitionScanState {
  const RecognitionScanning();
}

/// The one state that names a denomination, and only above the threshold.
final class RecognitionRecognized extends RecognitionScanState {
  const RecognitionRecognized({
    required this.label,
    required this.denominationCode,
    required this.confidence,
    required this.elapsedMs,
  });

  final String label;
  final String denominationCode;
  final double confidence;
  final int elapsedMs;
}

final class RecognitionUnavailable extends RecognitionScanState {
  const RecognitionUnavailable({required this.reason, required this.elapsedMs});

  final RecognitionUnavailableReason reason;
  final int elapsedMs;
}

/// The contract's default, used until public configuration is read.
///
/// A device that has never reached the server still has to be as careful as
/// one that has: without a threshold there is no such thing as "confident
/// enough", and the module would be naming notes on a coin flip.
const double kDefaultRecognitionConfidenceThreshold = 0.8;

/// DR-1's scan loop: frames in, at most one denomination out.
///
/// Everything the criteria are strict about lives here rather than in the
/// screen, so it can be proven without a camera: a frame is released the moment
/// it has been classified — including when classification throws — and nothing
/// below the configured threshold is ever allowed to become a denomination.
final class RecognitionScanner {
  RecognitionScanner({
    required RecognitionModelSource modelSource,
    required RecognitionEngine engine,
    required CameraFrameSource camera,
    required double confidenceThreshold,
    DateTime Function()? clock,
  }) : _modelSource = modelSource,
       _engine = engine,
       _camera = camera,
       _confidenceThreshold = confidenceThreshold,
       _clock = clock ?? DateTime.now;

  final RecognitionModelSource _modelSource;
  final RecognitionEngine _engine;
  final CameraFrameSource _camera;
  final double _confidenceThreshold;
  final DateTime Function() _clock;

  final _states = StreamController<RecognitionScanState>();
  StreamSubscription<RecognitionFrame>? _frames;
  DateTime? _startedAt;
  var _busy = false;
  var _finished = false;

  Stream<RecognitionScanState> get states => _states.stream;

  /// How many frames were dropped because inference was still running.
  ///
  /// Visible so a test can prove the loop does not queue frames it cannot keep
  /// up with: a queue of camera buffers is the memory leak this feature would
  /// otherwise have.
  var droppedFrames = 0;

  Future<void> start() async {
    _startedAt = _clock();
    _emit(const RecognitionPreparing());

    final RecognitionModelDocument model;
    try {
      model = await _modelSource.load();
    } on RecognitionModelException catch (error) {
      _finish(
        RecognitionUnavailable(
          reason: switch (error.problem) {
            RecognitionModelProblem.missing =>
              RecognitionUnavailableReason.modelMissing,
            RecognitionModelProblem.corrupt =>
              RecognitionUnavailableReason.modelCorrupt,
          },
          elapsedMs: _elapsedMs,
        ),
      );
      return;
    } on Object {
      _finish(
        RecognitionUnavailable(
          reason: RecognitionUnavailableReason.modelCorrupt,
          elapsedMs: _elapsedMs,
        ),
      );
      return;
    }

    try {
      await _engine.load(model);
    } on Object {
      // Including a runtime that is not in this build at all. Either way the
      // module has nothing to classify with, and guessing is the one thing it
      // must not do.
      _finish(
        RecognitionUnavailable(
          reason: RecognitionUnavailableReason.engineMissing,
          elapsedMs: _elapsedMs,
        ),
      );
      return;
    }

    _emit(const RecognitionScanning());
    _frames = _camera.frames().listen(
      (frame) => _onFrame(frame, model),
      onError: _onCameraError,
      cancelOnError: true,
    );
  }

  int get _elapsedMs {
    final startedAt = _startedAt;
    if (startedAt == null) return 0;
    // Clamped to the contract's two minutes: a scanner left pointing at a
    // table for an hour is not an hour of scanning.
    return _clock().difference(startedAt).inMilliseconds.clamp(0, 120000);
  }

  Future<void> _onFrame(
    RecognitionFrame frame,
    RecognitionModelDocument model,
  ) async {
    if (_finished || _busy) {
      // Dropped rather than queued, and released immediately: an unread frame
      // is still pixels held in memory.
      droppedFrames += 1;
      frame.release();
      return;
    }
    _busy = true;
    try {
      final inference = await _engine.classify(frame);
      if (_finished) return;
      if (inference.confidence < _confidenceThreshold) {
        // Below the threshold nothing is said and nothing is shown. DR-2 owns
        // what happens when that goes on for a while.
        return;
      }
      final match = model.classFor(inference.classId);
      if (match == null) {
        // A class the descriptor does not account for is not a denomination.
        return;
      }
      _finish(
        RecognitionRecognized(
          label: match.label,
          denominationCode: match.denominationCode,
          confidence: inference.confidence,
          elapsedMs: _elapsedMs,
        ),
      );
    } on Object {
      // One frame the runtime could not read is not a failure of the feature;
      // the next frame gets its turn.
    } finally {
      // DR-003. Always, including on the paths above that return early and the
      // one that throws: the frame does not outlive the attempt to read it.
      frame.release();
      _busy = false;
    }
  }

  void _onCameraError(Object error) {
    final problem = error is CameraFrameException
        ? error.problem
        : CameraProblem.unavailable;
    _finish(
      RecognitionUnavailable(
        reason: switch (problem) {
          CameraProblem.permissionDenied =>
            RecognitionUnavailableReason.permissionDenied,
          CameraProblem.unavailable =>
            RecognitionUnavailableReason.cameraUnavailable,
        },
        elapsedMs: _elapsedMs,
      ),
    );
  }

  void _emit(RecognitionScanState state) {
    if (_states.isClosed) return;
    _states.add(state);
  }

  void _finish(RecognitionScanState state) {
    if (_finished) return;
    _finished = true;
    _emit(state);
    unawaited(dispose());
  }

  /// Releases the camera and the runtime. Safe to call more than once.
  Future<void> dispose() async {
    _finished = true;
    final frames = _frames;
    _frames = null;
    await frames?.cancel();
    await _engine.dispose();
    if (!_states.isClosed) await _states.close();
  }
}
