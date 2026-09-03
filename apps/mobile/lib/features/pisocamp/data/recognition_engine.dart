import 'dart:async';
import 'dart:typed_data';

import 'recognition_model.dart';

/// One camera frame, held only for as long as it takes to classify it.
///
/// DR-003: a frame is never written to disk and never sent anywhere. The type
/// exists to make that visible — it owns its bytes, it is released the moment
/// inference is done, and reading a released frame throws rather than handing
/// out a buffer somebody could still persist.
final class RecognitionFrame {
  RecognitionFrame({
    required Uint8List bytes,
    required this.width,
    required this.height,
    required this.rotationDegrees,
  }) : _bytes = bytes;

  Uint8List? _bytes;
  final int width;
  final int height;
  final int rotationDegrees;

  bool get isReleased => _bytes == null;

  Uint8List get bytes {
    final bytes = _bytes;
    if (bytes == null) {
      throw StateError('A released camera frame cannot be read again');
    }
    return bytes;
  }

  /// Drops the pixels. Called in a `finally` by whoever asked for the frame,
  /// so a classifier that throws still leaves nothing behind.
  void release() {
    final bytes = _bytes;
    if (bytes != null) {
      // Overwritten rather than only dropped: the list may be a reused
      // platform buffer, and leaving the last frame legible in it is exactly
      // the residue the criterion is about.
      bytes.fillRange(0, bytes.length, 0);
    }
    _bytes = null;
  }
}

/// What the model made of one frame.
final class RecognitionInference {
  const RecognitionInference({required this.classId, required this.confidence});

  final int classId;

  /// 0..1.
  final double confidence;
}

/// Why inference cannot run.
enum RecognitionEngineProblem {
  /// This build ships no inference runtime.
  runtimeMissing,

  /// The runtime is here but would not load the model.
  modelRejected,
}

final class RecognitionEngineException implements Exception {
  const RecognitionEngineException(this.problem);

  final RecognitionEngineProblem problem;

  @override
  String toString() => 'RecognitionEngineException(${problem.name})';
}

/// Runs the approved model over camera frames.
///
/// A port because the runtime and the model are both BSP deliverables: the
/// model is trained and approved outside this repository (DR-008), and the
/// inference plugin is chosen with it. What the module owes either way is the
/// same, and is what the scanner around this interface implements: never name
/// a note below the threshold, never keep a frame, always say the disclaimer.
abstract interface class RecognitionEngine {
  /// Prepares the model. Throws [RecognitionEngineException] when it cannot.
  Future<void> load(RecognitionModelDocument model);

  /// Classifies one frame. The frame is released by the caller.
  Future<RecognitionInference> classify(RecognitionFrame frame);

  Future<void> dispose();
}

/// The engine a build with no inference runtime uses.
///
/// It refuses rather than returning a low-confidence guess, so the scanner
/// reports the feature as unavailable instead of opening a camera that could
/// never conclude anything.
final class UnavailableRecognitionEngine implements RecognitionEngine {
  const UnavailableRecognitionEngine();

  @override
  Future<void> load(RecognitionModelDocument model) async =>
      throw const RecognitionEngineException(
        RecognitionEngineProblem.runtimeMissing,
      );

  @override
  Future<RecognitionInference> classify(RecognitionFrame frame) async =>
      throw const RecognitionEngineException(
        RecognitionEngineProblem.runtimeMissing,
      );

  @override
  Future<void> dispose() async {}
}

/// Where camera frames come from.
///
/// A port for the same reason: the camera plugin arrives with the runtime.
/// Nothing downstream may retain what this yields.
abstract interface class CameraFrameSource {
  /// Asks for camera access — after the module has explained why — and yields
  /// frames until the subscription is cancelled.
  Stream<RecognitionFrame> frames();
}

/// Why the camera cannot be opened.
enum CameraProblem { permissionDenied, unavailable }

final class CameraFrameException implements Exception {
  const CameraFrameException(this.problem);

  final CameraProblem problem;

  @override
  String toString() => 'CameraFrameException(${problem.name})';
}

/// The frame source a build with no camera runtime uses.
final class UnavailableCameraFrameSource implements CameraFrameSource {
  const UnavailableCameraFrameSource();

  @override
  Stream<RecognitionFrame> frames() =>
      Stream<RecognitionFrame>.error(
        const CameraFrameException(CameraProblem.unavailable),
      );
}
