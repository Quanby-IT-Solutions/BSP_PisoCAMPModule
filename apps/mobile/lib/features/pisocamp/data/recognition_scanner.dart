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

/// DR-004. A Philippine note from a series that no longer circulates.
///
/// [series] is what the approved class list calls it. There is deliberately no
/// denomination: the class list is not allowed to carry one for this outcome,
/// so there is none to say by accident.
final class RecognitionDemonetized extends RecognitionScanState {
  const RecognitionDemonetized({required this.series, required this.elapsedMs});

  final String series;
  final int elapsedMs;
}

/// DR-005. Not Philippine currency.
///
/// Carries nothing at all. Which currency it is is outside this module
/// (section 17), and a state with nowhere to put the answer cannot give one.
final class RecognitionForeign extends RecognitionScanState {
  const RecognitionForeign({required this.elapsedMs});

  final int elapsedMs;
}

/// DR-006. The scan ran and could not read the note confidently.
///
/// Deliberately not a denomination and deliberately not a failure of the
/// feature: the camera worked, the model ran, and it was not sure. Saying so is
/// the only honest answer, and the tips that come with it are what turns a
/// second attempt into a better one.
final class RecognitionUnrecognized extends RecognitionScanState {
  const RecognitionUnrecognized({required this.elapsedMs});

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

/// How long the module keeps trying before it says it cannot read the note.
///
/// Long enough to move the phone and let the light change, short enough that
/// somebody is not left holding a note at a blank screen wondering whether it
/// is working. DR-4 owns the approved value along with the threshold; this is
/// the value used until it is configured.
const Duration kRecognitionDwell = Duration(seconds: 8);

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
    Duration dwell = kRecognitionDwell,
    DateTime Function()? clock,
  }) : _modelSource = modelSource,
       _engine = engine,
       _camera = camera,
       _confidenceThreshold = confidenceThreshold,
       _dwell = dwell,
       _clock = clock ?? DateTime.now;

  final RecognitionModelSource _modelSource;
  final RecognitionEngine _engine;
  final CameraFrameSource _camera;
  final double _confidenceThreshold;
  final Duration _dwell;
  final DateTime Function() _clock;

  final _states = StreamController<RecognitionScanState>();
  StreamSubscription<RecognitionFrame>? _frames;
  Timer? _dwellTimer;
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
    // A timer rather than a frame count, so a camera that stops delivering
    // frames ends the same way as one that delivers unreadable ones: somebody
    // is not left holding a note at a screen that will never answer.
    _dwellTimer = Timer(_dwell, _giveUp);
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
        // Below the threshold nothing is said and nothing is shown. The dwell
        // timer decides when a run of these becomes "cannot read this note".
        return;
      }
      final match = model.classFor(inference.classId);
      if (match == null) {
        // A class the descriptor does not account for is not a denomination.
        return;
      }
      // What the class says it is, never what a caller assumed. A demonetized
      // or foreign class reaching the denomination branch is exactly the wrong
      // claim BR-007/008 exist to prevent.
      _finish(switch (match.outcome) {
        RecognitionClassOutcome.denomination => RecognitionRecognized(
          label: match.label!,
          denominationCode: match.denominationCode!,
          confidence: inference.confidence,
          elapsedMs: _elapsedMs,
        ),
        RecognitionClassOutcome.demonetized => RecognitionDemonetized(
          series: match.label!,
          elapsedMs: _elapsedMs,
        ),
        RecognitionClassOutcome.foreign => RecognitionForeign(
          elapsedMs: _elapsedMs,
        ),
      });
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

  void _giveUp() {
    _finish(RecognitionUnrecognized(elapsedMs: _elapsedMs));
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
    _dwellTimer?.cancel();
    _dwellTimer = null;
    final frames = _frames;
    _frames = null;
    await frames?.cancel();
    await _engine.dispose();
    if (!_states.isClosed) await _states.close();
  }
}
