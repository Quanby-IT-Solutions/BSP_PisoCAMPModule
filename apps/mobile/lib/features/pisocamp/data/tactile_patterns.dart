import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// One impulse of an approved pattern: how hard, and how long to wait before
/// the next one.
@immutable
final class TactilePulse {
  const TactilePulse({required this.strength, required this.gap});

  final TactileStrength strength;
  final Duration gap;
}

/// The impulses a device can actually produce. Flutter offers discrete
/// impacts rather than an arbitrary waveform, so an approved pattern is a
/// bounded sequence of them rather than a curve.
enum TactileStrength { light, medium, heavy }

/// A named, approved haptic pattern.
@immutable
final class TactilePattern {
  const TactilePattern({required this.id, required this.pulses});

  final String id;
  final List<TactilePulse> pulses;

  /// How long the whole pattern takes. Nothing may vibrate for longer.
  Duration get duration =>
      pulses.fold(Duration.zero, (total, pulse) => total + pulse.gap);
}

/// The longest any approved pattern may run. A simulation that outlasts this
/// is continuous vibration, which CE-4 rules out.
const Duration kMaximumTactilePatternDuration = Duration(milliseconds: 900);

/// The most impulses any approved pattern may contain.
const int kMaximumTactilePulses = 8;

const _shortGap = Duration(milliseconds: 70);
const _longGap = Duration(milliseconds: 140);

/// The BSP-approved pattern catalog.
///
/// Held in the app rather than in the bundle because what a device can play is
/// a property of the device, not of the content; the bundle names a pattern and
/// this table decides what that name feels like. A bundle naming a pattern that
/// is not here is refused by the coverage test rather than silently ignored.
const Map<String, TactilePattern> kApprovedTactilePatterns = {
  'embossed': TactilePattern(
    id: 'embossed',
    pulses: [
      TactilePulse(strength: TactileStrength.heavy, gap: _longGap),
      TactilePulse(strength: TactileStrength.heavy, gap: _longGap),
    ],
  ),
  'bars': TactilePattern(
    id: 'bars',
    pulses: [
      TactilePulse(strength: TactileStrength.medium, gap: _shortGap),
      TactilePulse(strength: TactileStrength.medium, gap: _shortGap),
      TactilePulse(strength: TactileStrength.medium, gap: _shortGap),
      TactilePulse(strength: TactileStrength.medium, gap: _longGap),
    ],
  ),
  'intaglio': TactilePattern(
    id: 'intaglio',
    pulses: [
      TactilePulse(strength: TactileStrength.light, gap: _shortGap),
      TactilePulse(strength: TactileStrength.light, gap: _shortGap),
      TactilePulse(strength: TactileStrength.light, gap: _shortGap),
      TactilePulse(strength: TactileStrength.light, gap: _shortGap),
      TactilePulse(strength: TactileStrength.light, gap: _shortGap),
      TactilePulse(strength: TactileStrength.light, gap: _longGap),
    ],
  ),
};

/// Whether this build can produce haptics at all.
///
/// Flutter cannot read the operating system's "vibration off" accessibility
/// setting, so the app does not pretend to: a platform without haptics is
/// treated as off here, and the viewer offers its own switch for the rest. A
/// user who has turned vibration off at the system level simply feels nothing,
/// and the visual alternative plays regardless.
bool tactileHapticsAvailable({TargetPlatform? platform}) {
  final target = platform ?? defaultTargetPlatform;
  return target == TargetPlatform.android || target == TargetPlatform.iOS;
}

/// Plays approved patterns, one at a time and never for longer than the
/// pattern lasts.
///
/// The limit is structural rather than advisory: a request that arrives while a
/// pattern is playing is dropped, so holding a finger on a region replays
/// nothing and a drag across regions cannot chain into continuous vibration.
class TactilePlayer {
  TactilePlayer({
    Future<void> Function(TactileStrength strength)? impact,
    Future<void> Function(Duration delay)? wait,
  }) : _impact = impact ?? _platformImpact,
       _wait = wait ?? _realWait;

  final Future<void> Function(TactileStrength strength) _impact;
  final Future<void> Function(Duration delay) _wait;

  bool _playing = false;

  bool get isPlaying => _playing;

  static Future<void> _platformImpact(TactileStrength strength) {
    return switch (strength) {
      TactileStrength.light => HapticFeedback.lightImpact(),
      TactileStrength.medium => HapticFeedback.mediumImpact(),
      TactileStrength.heavy => HapticFeedback.heavyImpact(),
    };
  }

  static Future<void> _realWait(Duration delay) => Future<void>.delayed(delay);

  /// Plays [pattern] unless one is already playing.
  ///
  /// Returns whether it played, so a caller can tell a dropped request from a
  /// completed one instead of assuming.
  Future<bool> play(TactilePattern pattern) async {
    if (_playing) return false;
    if (pattern.pulses.isEmpty ||
        pattern.pulses.length > kMaximumTactilePulses ||
        pattern.duration > kMaximumTactilePatternDuration) {
      throw StateError('Pattern ${pattern.id} is outside the approved limits.');
    }

    _playing = true;
    try {
      for (final pulse in pattern.pulses) {
        await _impact(pulse.strength);
        await _wait(pulse.gap);
      }
    } finally {
      _playing = false;
    }
    return true;
  }
}
