import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/ar_narration.dart';

/// A player whose position the test controls, standing in for a recording.
class _FakePlayer implements ArNarrationPlayer {
  Duration _position = Duration.zero;
  final List<String> log = <String>[];

  /// Where the recording drifts to, relative to where it was told to be.
  Duration drift = Duration.zero;

  @override
  Duration get position => _position + drift;

  set position(Duration value) => _position = value;

  @override
  Future<void> play({Duration position = Duration.zero}) async {
    log.add('play:${position.inMilliseconds}');
    _position = position;
    drift = Duration.zero;
  }

  @override
  Future<void> pause() async => log.add('pause');

  @override
  Future<void> stop() async => log.add('stop');

  @override
  Future<void> dispose() async => log.add('dispose');
}

void main() {
  late _FakePlayer player;
  late ArNarrationSync sync;

  setUp(() {
    player = _FakePlayer();
    sync = ArNarrationSync(
      player: player,
      animationDuration: const Duration(seconds: 12),
    );
  });

  group('AR-001 narration follows the animation', () {
    test('starts with the animation, from the beginning', () async {
      await sync.start();

      expect(player.log, <String>['play:0']);
    });

    test('leaves a difference inside the tolerance alone', () async {
      await sync.start();
      player.log.clear();
      // The narration has played to roughly where the animation is, 80 ms
      // ahead — inside ±100 ms. Correcting this would be audible and would fix
      // nothing.
      player.position = const Duration(seconds: 4);
      player.drift = const Duration(milliseconds: 80);

      await sync.onAnimationPosition(const Duration(seconds: 4));

      expect(player.log, isEmpty);
      expect(sync.corrections, 0);
    });

    test('pulls the narration back when it drifts past the tolerance', () async {
      await sync.start();
      player.log.clear();
      player.position = const Duration(seconds: 4);
      player.drift = const Duration(milliseconds: 240);

      await sync.onAnimationPosition(const Duration(seconds: 4));

      // The animation is what somebody is looking at, so the narration is the
      // one that moves.
      expect(player.log, <String>['play:4000']);
      expect(sync.corrections, 1);
      expect(
        (player.position - const Duration(seconds: 4)).abs(),
        lessThanOrEqualTo(kNarrationSyncTolerance),
      );
    });

    test('corrects a narration running early as well as late', () async {
      await sync.start();
      player.log.clear();
      player.position = const Duration(seconds: 6);
      player.drift = const Duration(milliseconds: -300);

      await sync.onAnimationPosition(const Duration(seconds: 6));

      expect(sync.corrections, 1);
      expect(
        (player.position - const Duration(seconds: 6)).abs(),
        lessThanOrEqualTo(kNarrationSyncTolerance),
      );
    });

    test('stops when the animation ends', () async {
      await sync.start();
      player.log.clear();

      await sync.onAnimationPosition(const Duration(seconds: 12));

      // Audio still talking over a finished scene is the same defect as audio
      // that started late.
      expect(player.log, <String>['stop']);
      // And it stays stopped rather than being nudged back into a timeline
      // that is over.
      player.drift = const Duration(seconds: 5);
      await sync.onAnimationPosition(const Duration(seconds: 13));
      expect(player.log, <String>['stop']);
    });
  });

  group('AR-3 audio controls', () {
    test('muting silences the narration and unmuting resumes it', () async {
      await sync.start();
      player.log.clear();

      await sync.setMuted(true);
      expect(sync.muted, isTrue);
      expect(player.log, <String>['pause']);

      // And nothing is nudged while muted: there is nothing playing to nudge.
      player.position = const Duration(seconds: 2);
      player.drift = const Duration(seconds: 3);
      await sync.onAnimationPosition(const Duration(seconds: 2));
      expect(player.log, <String>['pause']);

      await sync.setMuted(false);
      expect(player.log.last, startsWith('play:'));
    });

    test('replaying starts the narration again', () async {
      await sync.start();
      await sync.onAnimationPosition(const Duration(seconds: 12));
      player.log.clear();

      await sync.replay();

      expect(player.log, <String>['play:0']);
    });

    test('replaying while muted stays silent', () async {
      await sync.setMuted(true);
      player.log.clear();

      await sync.replay();

      // Muted means muted. A replay button that overrides it is a device that
      // starts talking in a quiet room.
      expect(player.log, isEmpty);
    });

    test('leaving the experience stops the narration at once', () async {
      await sync.start();
      player.log.clear();

      await sync.stopForExit();

      expect(player.log, <String>['stop']);
    });
  });
}
