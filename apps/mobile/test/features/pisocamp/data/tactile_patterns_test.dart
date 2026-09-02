import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/tactile_patterns.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('the approved pattern catalog', () {
    test('names each pattern once and matches its own key', () {
      for (final entry in kApprovedTactilePatterns.entries) {
        expect(entry.value.id, entry.key);
      }
    });

    test('gives the three features distinguishable patterns', () {
      final embossed = kApprovedTactilePatterns['embossed']!;
      final bars = kApprovedTactilePatterns['bars']!;
      final intaglio = kApprovedTactilePatterns['intaglio']!;

      // Different counts and different strengths, so they are told apart by
      // feel rather than by label alone.
      expect({
        embossed.pulses.length,
        bars.pulses.length,
        intaglio.pulses.length,
      }, hasLength(3));
      expect(embossed.pulses.first.strength, TactileStrength.heavy);
      expect(bars.pulses.first.strength, TactileStrength.medium);
      expect(intaglio.pulses.first.strength, TactileStrength.light);
    });
  });

  group('TactilePlayer', () {
    test('plays every pulse of a pattern in order', () async {
      final played = <TactileStrength>[];
      final waits = <Duration>[];
      final player = TactilePlayer(
        impact: (strength) async => played.add(strength),
        wait: (delay) async => waits.add(delay),
      );

      expect(await player.play(kApprovedTactilePatterns['bars']!), isTrue);

      expect(played, [
        TactileStrength.medium,
        TactileStrength.medium,
        TactileStrength.medium,
        TactileStrength.medium,
      ]);
      expect(waits, hasLength(4));
    });

    test(
      'drops a request that arrives while a pattern is still playing',
      () async {
        // AC4: holding a finger down, or dragging across regions, must not chain
        // patterns into continuous vibration.
        var impacts = 0;
        late TactilePlayer player;
        var reentered = true;
        player = TactilePlayer(
          impact: (strength) async {
            impacts += 1;
            reentered = await player.play(
              kApprovedTactilePatterns['embossed']!,
            );
          },
          wait: (delay) async {},
        );

        await player.play(kApprovedTactilePatterns['embossed']!);

        expect(reentered, isFalse, reason: 're-entry must be refused');
        expect(impacts, 2, reason: 'only the first pattern played');
        expect(player.isPlaying, isFalse);
      },
    );

    test('is playable again once the pattern has finished', () async {
      var impacts = 0;
      final player = TactilePlayer(
        impact: (strength) async => impacts += 1,
        wait: (delay) async {},
      );

      await player.play(kApprovedTactilePatterns['embossed']!);
      expect(await player.play(kApprovedTactilePatterns['embossed']!), isTrue);
      expect(impacts, 4);
    });

    test('refuses a pattern that would outlast the approved limit', () async {
      final tooLong = TactilePattern(
        id: 'too-long',
        pulses: [
          TactilePulse(
            strength: TactileStrength.heavy,
            gap:
                kMaximumTactilePatternDuration +
                const Duration(milliseconds: 1),
          ),
        ],
      );
      final player = TactilePlayer(impact: (_) async {}, wait: (_) async {});

      await expectLater(player.play(tooLong), throwsStateError);
    });

    test('refuses a pattern with more pulses than the limit allows', () async {
      final tooMany = TactilePattern(
        id: 'too-many',
        pulses: List.filled(
          kMaximumTactilePulses + 1,
          const TactilePulse(
            strength: TactileStrength.light,
            gap: Duration.zero,
          ),
        ),
      );
      final player = TactilePlayer(impact: (_) async {}, wait: (_) async {});

      await expectLater(player.play(tooMany), throwsStateError);
    });

    test('releases the lock even when an impact fails', () async {
      final player = TactilePlayer(
        impact: (_) async => throw StateError('channel unavailable'),
        wait: (_) async {},
      );

      await expectLater(
        player.play(kApprovedTactilePatterns['embossed']!),
        throwsStateError,
      );
      expect(
        player.isPlaying,
        isFalse,
        reason: 'a failure must not wedge the player',
      );
    });

    test('reaches the real haptic channel with the mapped impact', () async {
      final calls = <String>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
            if (call.method == 'HapticFeedback.vibrate') {
              calls.add(call.arguments as String? ?? 'default');
            }
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.platform, null),
      );

      await TactilePlayer(
        wait: (_) async {},
      ).play(kApprovedTactilePatterns['embossed']!);

      // The default player really does drive the platform, rather than being a
      // fake all the way down.
      expect(calls, [
        'HapticFeedbackType.heavyImpact',
        'HapticFeedbackType.heavyImpact',
      ]);
    });
  });

  group('haptic availability', () {
    test('is true only where the platform can vibrate', () {
      expect(tactileHapticsAvailable(platform: TargetPlatform.android), isTrue);
      expect(tactileHapticsAvailable(platform: TargetPlatform.iOS), isTrue);
      for (final platform in [
        TargetPlatform.windows,
        TargetPlatform.macOS,
        TargetPlatform.linux,
        TargetPlatform.fuchsia,
      ]) {
        expect(
          tactileHapticsAvailable(platform: platform),
          isFalse,
          reason: '$platform',
        );
      }
    });
  });
}
