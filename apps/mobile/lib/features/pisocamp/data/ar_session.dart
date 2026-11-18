import 'dart:async';

import 'package:flutter/widgets.dart';

/// Why an AR session cannot run on this device.
enum ArUnavailableReason {
  /// The build ships no AR runtime, so nothing could start it.
  runtimeMissing,

  /// The device has no ARCore or ARKit support.
  deviceUnsupported,

  /// The person said no to the camera or motion prompt.
  permissionDenied,

  /// The experience's assets are not on the device yet.
  assetsMissing,
}

/// What a capability probe found.
class ArCapability {
  const ArCapability({required this.supported, this.reason});

  const ArCapability.supported() : supported = true, reason = null;

  const ArCapability.unsupported(ArUnavailableReason this.reason)
    : supported = false;

  final bool supported;
  final ArUnavailableReason? reason;
}

/// Whether this device and build can run an AR experience at all (AR-001).
///
/// A port rather than a plugin call, because the AR runtime is BSP's choice
/// (`ar_flutter_plugin` or platform views) and the module has to behave the
/// same on a device that has none. A build with no runtime answers
/// `runtimeMissing` and the screen offers CE-2's 3D viewer instead — which is
/// exactly what an unsupported device gets.
abstract interface class ArCapabilityProbe {
  Future<ArCapability> check();
}

/// The probe a build with no AR runtime uses.
final class UnavailableArCapabilityProbe implements ArCapabilityProbe {
  const UnavailableArCapabilityProbe();

  @override
  Future<ArCapability> check() async =>
      const ArCapability.unsupported(ArUnavailableReason.runtimeMissing);
}

/// A running AR session.
///
/// `ready` completes when the scene is placed and the approved animation has
/// started; `dispose` must release the camera and the renderer. The screen
/// calls `dispose` on exit and on every rebuild that ends a session, which is
/// what keeps ten open-and-close cycles from accumulating anything.
///
/// [view] is the camera surface the runtime draws into. It exists because a
/// Flutter AR runtime renders through a platform view in the widget tree, not
/// into a window it owns: there is no session to be ready *until* something
/// has mounted that view. The screen therefore mounts it as soon as the
/// session exists and only then awaits [ready] — awaiting first would wait on
/// a view that was never built. A runtime that needs no surface returns an
/// empty box, which is what the fakes in tests do.
abstract interface class ArSession {
  Future<void> get ready;

  /// The camera surface, mounted by the screen behind its own controls.
  Widget get view;

  Future<void> dispose();
}

/// Starts a session for one experience.
abstract interface class ArSessionFactory {
  /// Asks for camera and motion access **after** the module has explained why,
  /// then starts the session. Throws [ArSessionException] when it cannot.
  Future<ArSession> start({required String logicalId});
}

class ArSessionException implements Exception {
  const ArSessionException(this.reason);

  final ArUnavailableReason reason;

  @override
  String toString() => 'ArSessionException(${reason.name})';
}

/// The factory a build with no AR runtime uses: it refuses rather than
/// pretending to start, so the screen shows the fallback instead of a blank
/// camera view.
final class UnavailableArSessionFactory implements ArSessionFactory {
  const UnavailableArSessionFactory();

  @override
  Future<ArSession> start({required String logicalId}) async =>
      throw const ArSessionException(ArUnavailableReason.runtimeMissing);
}
