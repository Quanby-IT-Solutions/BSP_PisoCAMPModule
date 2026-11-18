import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/ar_narration.dart';
import 'package:mobile/features/pisocamp/data/ar_tts_narration.dart';
import 'package:mobile/features/pisocamp/data/speech_announcer.dart';

/// Records what was said rather than saying it, so the timeline can be
/// asserted without a speech engine.
final class _RecordingAnnouncer implements SpeechAnnouncer {
  final List<String> spoken = <String>[];
  int stops = 0;
  int disposals = 0;

  @override
  Future<void> speak(String text) async => spoken.add(text);

  @override
  Future<void> stop() async => stops += 1;

  @override
  Future<void> dispose() async => disposals += 1;
}

void main() {
  const transcript =
      'The one piso coin carries the national hero on its obverse side.';
  const animation = Duration(seconds: 10);

  late _RecordingAnnouncer announcer;
  late DateTime now;

  setUp(() {
    announcer = _RecordingAnnouncer();
    now = DateTime(2026, 9, 21, 12);
  });

  TtsArNarrationPlayer player() => TtsArNarrationPlayer(
    transcript: transcript,
    animationDuration: animation,
    announcer: announcer,
    clock: () => now,
  );

  test('playing from the start says the whole transcript', () async {
    final subject = player();

    await subject.play();

    expect(announcer.spoken, <String>[transcript]);
    expect(subject.position, Duration.zero);
  });

  test('the reported position follows the clock while speaking', () async {
    final subject = player();
    await subject.play();

    now = now.add(const Duration(milliseconds: 1500));

    expect(subject.position, const Duration(milliseconds: 1500));
  });

  test('a correction restarts at a word boundary, not mid-word', () async {
    final subject = player();

    await subject.play(position: const Duration(seconds: 5));

    expect(announcer.spoken, hasLength(1));
    final said = announcer.spoken.single;
    // Halfway through a ten second animation is halfway through the text, and
    // whatever it resumes with is a word the transcript actually contains.
    expect(transcript, contains(said));
    expect(said, isNot(startsWith(' ')));
    expect(transcript.split(' '), contains(said.split(' ').first));
  });

  test('a correction reports the position it was corrected to', () async {
    final subject = player();

    await subject.play(position: const Duration(seconds: 4));
    expect(subject.position, const Duration(seconds: 4));

    now = now.add(const Duration(seconds: 1));
    expect(subject.position, const Duration(seconds: 5));
  });

  test('past the end of the animation it says nothing at all', () async {
    final subject = player();

    await subject.play(position: animation);

    expect(announcer.spoken, isEmpty);
    expect(announcer.stops, 1);
  });

  test('pausing freezes the position so unmuting resumes', () async {
    final subject = player();
    await subject.play();
    now = now.add(const Duration(seconds: 3));

    await subject.pause();
    now = now.add(const Duration(seconds: 90));

    expect(
      subject.position,
      const Duration(seconds: 3),
      reason: 'a paused narration does not advance while it is silent',
    );
    expect(announcer.stops, 1);
  });

  test('stopping rewinds, because the next play is a replay', () async {
    final subject = player();
    await subject.play();
    now = now.add(const Duration(seconds: 3));

    await subject.stop();

    expect(subject.position, Duration.zero);
  });

  test('disposal releases the engine and silences later calls', () async {
    final subject = player();
    await subject.dispose();

    await subject.play();

    expect(announcer.disposals, 1);
    expect(
      announcer.spoken,
      isEmpty,
      reason: 'a disposed player must not start talking over the next screen',
    );
  });

  group('driven by ArNarrationSync', () {
    test('drift beyond the tolerance pulls the words back into line', () async {
      final subject = player();
      final sync = ArNarrationSync(
        player: subject,
        animationDuration: animation,
      );

      await sync.start();
      // The words have run a full second ahead of the picture.
      now = now.add(const Duration(seconds: 1));
      await sync.onAnimationPosition(Duration.zero);

      expect(sync.corrections, 1);
      expect(announcer.spoken, hasLength(2));
    });

    test('drift inside the tolerance is left alone', () async {
      final subject = player();
      final sync = ArNarrationSync(
        player: subject,
        animationDuration: animation,
      );

      await sync.start();
      now = now.add(const Duration(milliseconds: 40));
      await sync.onAnimationPosition(Duration.zero);

      expect(sync.corrections, 0);
      expect(
        announcer.spoken,
        hasLength(1),
        reason: 'correcting 40 ms is audible and fixes nothing',
      );
    });
  });
}
