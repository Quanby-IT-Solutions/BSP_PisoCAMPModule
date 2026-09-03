import 'dart:async';

import 'package:flutter_tts/flutter_tts.dart';

/// DR-002/DR-007. The words the module says about what a scan can and cannot
/// tell you.
///
/// One constant, used by the screen and by the speech, so the sentence a person
/// hears and the sentence they read are the same sentence. Nothing here may be
/// softened into implying the module checked anything: it did not.
const String kAuthenticityDisclaimer =
    'This does not verify authenticity. If in doubt, submit the banknote to an '
    'authorized agent bank or the Bangko Sentral ng Pilipinas.';

/// Speaks short pieces of text.
///
/// A port so the screen can be proven to say the right things in the right
/// order without a speech engine running, and so a device that has no engine
/// degrades to the on-screen text rather than failing.
abstract interface class SpeechAnnouncer {
  /// Replaces anything currently being spoken with [text].
  Future<void> speak(String text);

  /// Stops immediately.
  Future<void> stop();

  Future<void> dispose();
}

/// The platform's own speech engine.
///
/// Every call is guarded: a device with no engine installed, or one that
/// refuses mid-sentence, must leave the visible result untouched. The
/// criteria require the text to stand on its own, so a silent failure here is
/// a degraded experience, not a broken one.
final class PlatformSpeechAnnouncer implements SpeechAnnouncer {
  PlatformSpeechAnnouncer({FlutterTts? tts}) : _tts = tts ?? FlutterTts();

  final FlutterTts _tts;
  var _configured = false;

  Future<void> _configure() async {
    if (_configured) return;
    _configured = true;
    // Filipino English, falling back to whatever the device has: the words are
    // English, and forcing an unavailable voice is how a device ends up silent
    // when it did not have to be.
    await _tts.setLanguage('en-PH');
    await _tts.setSpeechRate(0.45);
    await _tts.awaitSpeakCompletion(true);
  }

  @override
  Future<void> speak(String text) async {
    try {
      await _configure();
      await _tts.stop();
      await _tts.speak(text);
    } on Object {
      // Nothing to recover: the screen already shows the same words.
    }
  }

  @override
  Future<void> stop() async {
    try {
      await _tts.stop();
    } on Object {
      // Already silent, as far as anyone can tell.
    }
  }

  @override
  Future<void> dispose() => stop();
}

/// The announcer used when audio is off, muted, or unavailable.
final class SilentSpeechAnnouncer implements SpeechAnnouncer {
  const SilentSpeechAnnouncer();

  @override
  Future<void> speak(String text) async {}

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() async {}
}
