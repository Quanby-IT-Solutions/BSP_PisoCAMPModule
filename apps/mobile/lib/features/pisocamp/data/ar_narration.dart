import 'dart:async';

/// Plays one experience's narration.
///
/// A port for the same reason the AR session is: the audio arrives with the
/// approved runtime. What the module owes either way is the timing, and that is
/// in [ArNarrationSync] where it can be measured.
abstract interface class ArNarrationPlayer {
  /// Starts from [position] into the recording.
  Future<void> play({Duration position = Duration.zero});

  Future<void> pause();

  Future<void> stop();

  /// Where the recording has actually reached.
  Duration get position;

  Future<void> dispose();
}

/// The player a build with no audio runtime uses.
///
/// It reports no position and plays nothing. The captions still show, which is
/// what the criteria require of the visible half regardless.
final class SilentArNarrationPlayer implements ArNarrationPlayer {
  const SilentArNarrationPlayer();

  @override
  Future<void> play({Duration position = Duration.zero}) async {}

  @override
  Future<void> pause() async {}

  @override
  Future<void> stop() async {}

  @override
  Duration get position => Duration.zero;

  @override
  Future<void> dispose() async {}
}

/// AR-001. How far the narration may drift from the animation before the
/// module does something about it.
///
/// The criterion is ±100 ms, which is roughly where a mismatch between a
/// spoken word and the thing it describes stops being invisible.
const Duration kNarrationSyncTolerance = Duration(milliseconds: 100);

/// Keeps the narration on the animation's timeline.
///
/// The animation is the clock, not the audio: the animation is what somebody is
/// looking at, so when the two disagree the narration is the one that moves.
/// Nudged only past the tolerance, because correcting a 10 ms difference is
/// audible and fixes nothing.
final class ArNarrationSync {
  ArNarrationSync({
    required ArNarrationPlayer player,
    required Duration animationDuration,
    Duration tolerance = kNarrationSyncTolerance,
  }) : _player = player,
       _animationDuration = animationDuration,
       _tolerance = tolerance;

  final ArNarrationPlayer _player;
  final Duration _animationDuration;
  final Duration _tolerance;

  var _started = false;
  var _muted = false;
  var _finished = false;

  /// How many times the narration had to be pulled back into line.
  ///
  /// Visible so a test can prove drift is corrected rather than merely
  /// tolerated, and so a device that keeps drifting is measurable.
  var corrections = 0;

  bool get muted => _muted;

  /// Starts the narration with the animation.
  Future<void> start() async {
    _started = true;
    _finished = false;
    if (_muted) return;
    await _player.play();
  }

  /// Called as the animation advances, with where the animation has reached.
  Future<void> onAnimationPosition(Duration animationPosition) async {
    if (!_started || _muted || _finished) return;
    if (animationPosition >= _animationDuration) {
      // The animation is over, so the narration is too. Audio still talking
      // over a finished scene is the same defect as audio that started late.
      _finished = true;
      await _player.stop();
      return;
    }
    final drift = _player.position - animationPosition;
    if (drift.abs() <= _tolerance) return;
    corrections += 1;
    await _player.play(position: animationPosition);
  }

  /// AR-3's mute control. Silences the narration without touching the
  /// animation, and the captions carry on.
  Future<void> setMuted(bool muted) async {
    if (_muted == muted) return;
    _muted = muted;
    if (muted) {
      await _player.pause();
      return;
    }
    if (_started && !_finished) await _player.play();
  }

  /// Plays the narration again from the beginning of the animation.
  Future<void> replay() async {
    _finished = false;
    _started = true;
    if (_muted) return;
    await _player.play();
  }

  /// Stops the narration because the experience is ending.
  ///
  /// Separate from [dispose] so leaving a screen silences the audio at once
  /// rather than whenever the widget happens to be torn down.
  Future<void> stopForExit() async {
    _finished = true;
    await _player.stop();
  }

  Future<void> dispose() async {
    await _player.dispose();
  }
}
