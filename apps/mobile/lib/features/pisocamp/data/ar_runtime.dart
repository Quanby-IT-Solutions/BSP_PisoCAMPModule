import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_sceneview/flutter_sceneview.dart';
import 'package:mobile/features/pisocamp/data/ar_session.dart';
import 'package:path/path.dart' as paths;
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';

/// AR-001's runtime, on ARCore.
///
/// The module talks to this through [ArCapabilityProbe] and [ArSessionFactory]
/// exactly as it talked to the unavailable pair before it, so a build without
/// ARCore, a phone without ARCore, and a person who declines the camera all
/// still reach the same fallback. What changes here is only that the supported
/// case now has somewhere to go.

/// Asks the platform whether ARCore can run here.
///
/// The renderer plugin answers no such question, so this is our own channel
/// over `ArCoreApk.checkAvailability`. Three outcomes matter and they are kept
/// apart, because AR-001 requires the screen to say *which* of them happened:
/// an unsupported phone, a declined permission and a build with no runtime are
/// three different sentences to the person holding it.
class SceneViewArCapabilityProbe implements ArCapabilityProbe {
  const SceneViewArCapabilityProbe({
    MethodChannel channel = _defaultChannel,
    TargetPlatform? platformOverride,
  }) : _channel = channel,
       _platformOverride = platformOverride;

  static const MethodChannel _defaultChannel = MethodChannel(
    'pisocamp/ar_availability',
  );

  final MethodChannel _channel;
  final TargetPlatform? _platformOverride;

  @override
  Future<ArCapability> check() async {
    final platform = _platformOverride ?? defaultTargetPlatform;
    // This build ships an Android AR runtime and nothing else. Saying so is
    // more useful than letting the channel fail and reporting a device
    // problem the device does not have.
    if (platform != TargetPlatform.android) {
      return const ArCapability.unsupported(ArUnavailableReason.runtimeMissing);
    }

    final String status;
    try {
      status = await _channel.invokeMethod<String>('checkAvailability') ?? '';
    } on MissingPluginException {
      // The Dart side is present but nothing answered: the build was assembled
      // without the native half.
      return const ArCapability.unsupported(ArUnavailableReason.runtimeMissing);
    } on PlatformException {
      return const ArCapability.unsupported(
        ArUnavailableReason.deviceUnsupported,
      );
    }

    return switch (status) {
      'supported' => const ArCapability.supported(),
      // ARCore is supported but its services are missing or out of date. The
      // device could run AR after an install the module is not going to start
      // on somebody's behalf, so this is reported as unsupported today rather
      // than as a state with no way out of it.
      'needsUpdate' || 'unsupported' => const ArCapability.unsupported(
        ArUnavailableReason.deviceUnsupported,
      ),
      _ => const ArCapability.unsupported(ArUnavailableReason.runtimeMissing),
    };
  }
}

/// Reads one experience's approved model, already checked against the bundle
/// manifest. Injected rather than imported so the factory does not depend on
/// the catalog, and so a test can supply bytes without a bundle.
typedef ArModelBytesLoader = Future<Uint8List> Function(String logicalId);

/// Starts an ARCore session for one experience.
///
/// Permission is requested here, never earlier: AR-001 wants the module's own
/// explanation on screen before the system dialog, and the screen has shown it
/// by the time this runs. A refusal is reported as [ArUnavailableReason
/// .permissionDenied] rather than as a failure, because the person did not
/// fail at anything — they answered.
class SceneViewArSessionFactory implements ArSessionFactory {
  const SceneViewArSessionFactory({
    required ArModelBytesLoader loadModelBytes,
    Future<PermissionStatus> Function()? requestCamera,
    Future<Directory> Function()? cacheDirectory,
  }) : _loadModelBytes = loadModelBytes,
       _requestCamera = requestCamera,
       _cacheDirectory = cacheDirectory;

  final ArModelBytesLoader _loadModelBytes;
  final Future<PermissionStatus> Function()? _requestCamera;
  final Future<Directory> Function()? _cacheDirectory;

  @override
  Future<ArSession> start({required String logicalId}) async {
    final status = await (_requestCamera ?? Permission.camera.request)();
    if (!status.isGranted) {
      throw const ArSessionException(ArUnavailableReason.permissionDenied);
    }

    final Uint8List bytes;
    try {
      bytes = await _loadModelBytes(logicalId);
    } on Object {
      // The experience is published but its model is not on the device. That
      // is a sync state, not a broken phone, and the screen has a sentence for
      // it that does not blame the hardware.
      throw const ArSessionException(ArUnavailableReason.assetsMissing);
    }
    if (bytes.isEmpty) {
      throw const ArSessionException(ArUnavailableReason.assetsMissing);
    }

    // The renderer loads from a path, and the verified bytes may never have
    // been a file: a seed experience lives inside the APK as a Flutter asset.
    // Materialising here keeps one path through the renderer for both, and the
    // bytes being written are the ones the manifest digest already covered.
    final File model;
    try {
      model = await _materialise(logicalId, bytes);
    } on Object {
      throw const ArSessionException(ArUnavailableReason.assetsMissing);
    }

    return SceneViewArSession(modelPath: model.path);
  }

  Future<File> _materialise(String logicalId, Uint8List bytes) async {
    final directory = await (_cacheDirectory ?? getApplicationCacheDirectory)();
    final target = Directory(paths.join(directory.path, 'pisocamp', 'ar'));
    await target.create(recursive: true);
    // Named for the experience rather than for the moment: reopening the same
    // coin rewrites one file instead of filling the cache with copies.
    final file = File(paths.join(target.path, '${_safeName(logicalId)}.glb'));
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  /// A logical id is a dotted content key, not a file name. Anything outside
  /// the safe set becomes an underscore so no id can walk out of the cache
  /// directory it is written into.
  ///
  /// The dot has to stay — content keys are dotted — so `..` is flattened
  /// separately. Stripping separators alone already prevents traversal, but a
  /// file literally named `..something` is a trap for the next person who
  /// globs this directory, and there is no reason to leave one.
  static String _safeName(String logicalId) => logicalId
      .replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_')
      .replaceAll('..', '__');
}

/// One ARCore session, rendered by `flutter_sceneview`.
///
/// The session is created by mounting [view]; nothing happens before that.
/// [ready] completes once the renderer reports the view is up and the model
/// has been handed to it, which is the point the screen may stop showing a
/// spinner over the camera.
class SceneViewArSession implements ArSession {
  SceneViewArSession({required this.modelPath, SceneViewController? controller})
    : _controller = controller ?? SceneViewController();

  final String modelPath;
  final SceneViewController _controller;
  final Completer<void> _ready = Completer<void>();
  bool _disposed = false;

  @override
  Future<void> get ready => _ready.future;

  @override
  Widget get view => ARSceneView(
    controller: _controller,
    planeDetection: true,
    onViewCreated: _onViewCreated,
  );

  Future<void> _onViewCreated() async {
    // A session disposed while its view was still being created must not go on
    // to load a model into a renderer that is being torn down.
    if (_disposed) return;
    try {
      await _controller.loadModel(ModelNode(modelPath: 'file://$modelPath'));
      if (!_ready.isCompleted) _ready.complete();
    } on Object catch (error, stack) {
      if (!_ready.isCompleted) _ready.completeError(error, stack);
    }
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    // A session that never became ready still has to release whoever is
    // awaiting it, or leaving during placement would hang the screen.
    if (!_ready.isCompleted) {
      _ready.completeError(
        const ArSessionException(ArUnavailableReason.deviceUnsupported),
      );
      // Often nobody is: the screen disposes sessions it never got as far as
      // awaiting, and an unobserved error on a completer is a crash in its own
      // right. Observing it here keeps the failure for whoever does await and
      // silences it for everyone who does not.
      unawaited(_ready.future.catchError((Object _) {}));
    }
    _controller.dispose();
  }
}
