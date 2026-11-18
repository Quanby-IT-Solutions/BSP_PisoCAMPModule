import 'dart:async';

import 'package:mobile/features/pisocamp/data/ar_narration.dart';
import 'package:mobile/features/pisocamp/data/speech_announcer.dart';

/// AR-3's narration, spoken by the platform's own engine.
///
/// The published experience carries a *transcript*, not a recording — the
/// module ships no audio and needs none, which is the same decision DR-1 made
/// for the spoken denomination. It therefore reuses DR-1's [SpeechAnnouncer]
/// rather than opening a second route to the speech engine: that port already
/// swallows a missing or refusing engine, and AR-3 needs exactly that, because
/// the captions have to carry the meaning on their own regardless.
///
/// The cost of speaking rather than playing is stated rather than hidden.
/// Engines do not seek, and none will say "start 4.2 seconds in". So:
///
///  * [position] is measured from when speaking began, not from where the
///    voice actually is;
///  * [play] with a position restarts at the word boundary nearest that
///    fraction of the transcript.
///
/// Both are approximations, and both are good enough for the only question
/// [ArNarrationSync] asks: are the words more than a tolerance ahead of or
/// behind the animation. A seekable recording would replace this class and
/// nothing around it.
class TtsArNarrationPlayer implements ArNarrationPlayer {
  TtsArNarrationPlayer({
    required String transcript,
    required Duration animationDuration,
    required SpeechAnnouncer announcer,
    DateTime Function()? clock,
  }) : _transcript = transcript,
       _animationDuration = animationDuration,
       _announcer = announcer,
       _clock = clock ?? DateTime.now;

  final String _transcript;
  final Duration _animationDuration;
  final SpeechAnnouncer _announcer;
  final DateTime Function() _clock;

  /// When the current utterance began, and how far into the timeline it began.
  DateTime? _spokeAt;
  Duration _spokeFrom = Duration.zero;
  bool _disposed = false;

  @override
  Duration get position {
    final startedAt = _spokeAt;
    if (startedAt == null) return _spokeFrom;
    return _spokeFrom + _clock().difference(startedAt);
  }

  @override
  Future<void> play({Duration position = Duration.zero}) async {
    if (_disposed) return;
    final text = _remainderFrom(position);
    _spokeFrom = position;
    _spokeAt = _clock();
    if (text.isEmpty) {
      // Past the end of the transcript. The clock still moves so a later
      // correction is measured against something real.
      await _announcer.stop();
      return;
    }
    // `speak` replaces whatever is in flight; queueing would play a correction
    // *after* the words it was meant to replace.
    await _announcer.speak(text);
  }

  @override
  Future<void> pause() async {
    if (_disposed) return;
    // Freeze where it had reached, so unmuting resumes the timeline instead of
    // restarting the sentence.
    _spokeFrom = position;
    _spokeAt = null;
    await _announcer.stop();
  }

  @override
  Future<void> stop() async {
    if (_disposed) return;
    _spokeFrom = Duration.zero;
    _spokeAt = null;
    await _announcer.stop();
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _spokeAt = null;
    await _announcer.dispose();
  }

  /// The transcript from [position] onwards, cut at a word boundary.
  ///
  /// Proportional to the animation's length, because that is the only mapping
  /// there is: a transcript carries no timestamps and the engine will not say
  /// where its voice has reached. Cutting mid-word would be audible, so the
  /// cut moves forward to the next space.
  String _remainderFrom(Duration position) {
    if (position <= Duration.zero || _animationDuration <= Duration.zero) {
      return _transcript;
    }
    if (position >= _animationDuration) return '';

    final fraction =
        position.inMilliseconds / _animationDuration.inMilliseconds;
    final estimate = (_transcript.length * fraction).floor().clamp(
      0,
      _transcript.length,
    );
    if (estimate >= _transcript.length) return '';

    final boundary = _transcript.indexOf(' ', estimate);
    return boundary < 0
        ? _transcript.substring(estimate)
        : _transcript.substring(boundary + 1);
  }
}
