import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:sensors_plus/sensors_plus.dart';

/// How the approved effect responds to being tilted.
enum TiltEffectKind {
  /// A band of colour that slides across the region.
  movingBand,

  /// A region whose colour shifts between two approved hues.
  colourShift,
}

/// A named, approved dynamic-feature effect.
@immutable
final class TiltEffect {
  const TiltEffect({required this.id, required this.kind});

  final String id;
  final TiltEffectKind kind;
}

/// The BSP-approved effect catalog.
///
/// Held in the app for the same reason as the haptic patterns: what a device
/// can render is a property of the device, and the bundle only names the
/// effect. A bundle naming an effect that is not here fails the coverage test
/// rather than rendering nothing.
const Map<String, TiltEffect> kApprovedTiltEffects = {
  'moving-band': TiltEffect(id: 'moving-band', kind: TiltEffectKind.movingBand),
  'colour-shift': TiltEffect(
    id: 'colour-shift',
    kind: TiltEffectKind.colourShift,
  ),
};

/// The approved range of response, as a fraction of a full sideways tilt.
///
/// Beyond this the effect holds at its extreme rather than continuing, so a
/// device turned right over does not keep driving the simulation.
const double kApprovedTiltRange = 1;

/// Gravity in m/s², the scale an accelerometer reports.
const double _gravity = 9.80665;

/// Normalises a sideways accelerometer reading into the approved −1..1 range.
///
/// A phone held upright reads about zero on x; tilting it left or right moves
/// x towards ∓g. Values past the range are clamped rather than wrapped, so the
/// effect never jumps from one extreme to the other.
double tiltFromAccelerationX(double x) {
  final normalised = -x / _gravity;
  if (normalised.isNaN || normalised == 0) return 0;
  if (normalised < -kApprovedTiltRange) return -kApprovedTiltRange;
  if (normalised > kApprovedTiltRange) return kApprovedTiltRange;
  return normalised;
}

/// Where a tilt value comes from.
///
/// An interface rather than a direct sensor call, because CE-5 has to work the
/// same way when the value comes from a slider instead.
abstract interface class TiltSource {
  Stream<double> get tilts;
  Future<void> dispose();
}

/// Whether this build can read a motion sensor at all.
bool tiltSensorAvailable({TargetPlatform? platform}) {
  final target = platform ?? defaultTargetPlatform;
  return target == TargetPlatform.android || target == TargetPlatform.iOS;
}

/// The device's accelerometer, sampled no faster than the approved rate.
///
/// AN-025: the sensor is read at the platform's UI interval and then throttled
/// again here, because a simulation redrawn faster than the screen refreshes
/// costs battery and shows nothing extra.
class SensorTiltSource implements TiltSource {
  SensorTiltSource({
    Stream<AccelerometerEvent>? events,
    this.minimumInterval = const Duration(milliseconds: 33),
    DateTime Function()? clock,
  }) : _supplied = events,
       _clock = clock ?? DateTime.now;

  final Stream<AccelerometerEvent>? _supplied;

  /// Resolved lazily: constructing a source must not wake the sensor, only
  /// listening to it should.
  late final Stream<AccelerometerEvent> _events =
      _supplied ??
      accelerometerEventStream(samplingPeriod: SensorInterval.uiInterval);
  final Duration minimumInterval;
  final DateTime Function() _clock;

  DateTime? _lastEmitted;

  @override
  Stream<double> get tilts {
    return _events
        .where((event) {
          final now = _clock();
          final last = _lastEmitted;
          if (last != null && now.difference(last) < minimumInterval) {
            return false;
          }
          _lastEmitted = now;
          return true;
        })
        .map((event) => tiltFromAccelerationX(event.x));
  }

  @override
  Future<void> dispose() async {}
}

/// A tilt value driven by an on-screen control.
///
/// The fallback path is a first-class source, not a special case in the
/// renderer: the same effect is driven the same way whether the value comes
/// from a sensor or from a slider.
class ManualTiltSource implements TiltSource {
  final StreamController<double> _controller =
      StreamController<double>.broadcast();

  double _value = 0;

  double get value => _value;

  @override
  Stream<double> get tilts => _controller.stream;

  void set(double tilt) {
    _value = tilt.clamp(-kApprovedTiltRange, kApprovedTiltRange).toDouble();
    if (!_controller.isClosed) _controller.add(_value);
  }

  @override
  Future<void> dispose() => _controller.close();
}
