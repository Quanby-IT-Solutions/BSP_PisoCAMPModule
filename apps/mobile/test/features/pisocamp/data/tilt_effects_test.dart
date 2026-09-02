import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/data/tilt_effects.dart';
import 'package:sensors_plus/sensors_plus.dart';

import 'bundle_test_support.dart';

const _envelopeAsset = 'assets/pisocamp/bundle/seed/manifest.envelope.json';
const _indexAsset = 'assets/pisocamp/bundle/seed/resource-index.json';

AccelerometerEvent _event(double x) =>
    AccelerometerEvent(x, 0, 9.80665, DateTime.utc(2026));

void main() {
  group('reading a tilt from the accelerometer', () {
    test('maps a level device to the middle of the range', () {
      expect(tiltFromAccelerationX(0), 0);
    });

    test('maps a full sideways tilt to each end of the range', () {
      expect(tiltFromAccelerationX(-9.80665), kApprovedTiltRange);
      expect(tiltFromAccelerationX(9.80665), -kApprovedTiltRange);
    });

    test('holds at the ends rather than continuing past them', () {
      // Turning the device right over must not wrap the effect back around.
      expect(tiltFromAccelerationX(-40), kApprovedTiltRange);
      expect(tiltFromAccelerationX(40), -kApprovedTiltRange);
    });

    test('treats an unreadable sample as level', () {
      expect(tiltFromAccelerationX(double.nan), 0);
    });

    test('is monotonic across the range', () {
      var previous = tiltFromAccelerationX(9.80665);
      for (var x = 9.0; x >= -9.80665; x -= 0.5) {
        final next = tiltFromAccelerationX(x);
        expect(next, greaterThanOrEqualTo(previous));
        previous = next;
      }
    });
  });

  group('SensorTiltSource', () {
    test('throttles the sensor to the approved rate', () async {
      // AN-025: a simulation redrawn faster than the screen refreshes costs
      // battery and shows nothing extra.
      // The clock advances per delivered sample, not per line of the test:
      // events reach the filter asynchronously, so a variable mutated up here
      // would already hold its final value by the time any of them arrived.
      final start = DateTime.utc(2026);
      const arrivals = [0, 30, 60, 160];
      var arrival = 0;
      final events = StreamController<AccelerometerEvent>();
      final source = SensorTiltSource(
        events: events.stream,
        minimumInterval: const Duration(milliseconds: 100),
        clock: () => start.add(Duration(milliseconds: arrivals[arrival++])),
      );
      final seen = <double>[];
      final subscription = source.tilts.listen(seen.add);

      for (final x in [0.0, -4.9, -9.8, 9.8]) {
        events.add(_event(x));
      }
      await Future<void>.delayed(Duration.zero);

      expect(seen, hasLength(2), reason: 'two of four samples survived');
      expect(seen.first, 0);
      expect(seen.last, closeTo(-1, 0.01));

      await subscription.cancel();
      await events.close();
      await source.dispose();
    });
  });

  group('ManualTiltSource', () {
    test('drives the same range as the sensor', () async {
      final source = ManualTiltSource();
      final seen = <double>[];
      final subscription = source.tilts.listen(seen.add);

      source.set(0.5);
      source.set(-4);
      source.set(4);
      await Future<void>.delayed(Duration.zero);

      expect(seen, [0.5, -kApprovedTiltRange, kApprovedTiltRange]);
      expect(source.value, kApprovedTiltRange);

      await subscription.cancel();
      await source.dispose();
    });

    test('stops emitting once disposed', () async {
      final source = ManualTiltSource();
      await source.dispose();

      expect(() => source.set(0.5), returnsNormally);
    });
  });

  group('sensor availability', () {
    test('is true only where a motion sensor exists', () {
      expect(tiltSensorAvailable(platform: TargetPlatform.android), isTrue);
      expect(tiltSensorAvailable(platform: TargetPlatform.iOS), isTrue);
      for (final platform in [
        TargetPlatform.windows,
        TargetPlatform.macOS,
        TargetPlatform.linux,
        TargetPlatform.fuchsia,
      ]) {
        expect(
          tiltSensorAvailable(platform: platform),
          isFalse,
          reason: '$platform',
        );
      }
    });
  });

  /// CE-5 AC5: every mandatory banknote has a tilt effect.
  group('tilt coverage across the bundle', () {
    late List<CurrencyContentDocument> documents;

    setUpAll(() async {
      final envelope = await BundleEnvelope.parseAndVerify(
        await loadSeedAsset(_envelopeAsset),
        BundleKeyRing.packagedSeed(),
      );
      final index = decodeStrictJsonObject(
        await loadSeedAsset(_indexAsset),
        maximumBytes: 65536,
        context: 'tilt coverage resource index',
      );
      documents = <CurrencyContentDocument>[
        for (final entry in envelope.manifest.entries)
          if (entry.kind == BundleEntryKind.content)
            CurrencyContentDocument.parseSeed(
              await loadSeedAsset(index[entry.sha256]! as String),
            ),
      ];
    });

    test('every mandatory banknote has an effect this build can render', () {
      final banknotes = documents
          .where((document) => document.kind == CurrencyContentKind.banknote)
          .toList(growable: false);

      expect(banknotes, hasLength(15));
      for (final note in banknotes) {
        expect(note.hasTiltEffect, isTrue, reason: note.logicalId);
        final effect = note.tiltEffect!;
        expect(
          kApprovedTiltEffects[effect.effect],
          isNotNull,
          reason: '${note.logicalId} names unapproved effect ${effect.effect}',
        );
        // Anchored inside the illustration it is drawn on.
        expect(
          effect.x + effect.width,
          lessThanOrEqualTo(1000),
          reason: effect.id,
        );
        expect(
          effect.y + effect.height,
          lessThanOrEqualTo(1000),
          reason: effect.id,
        );
        expect(effect.width, greaterThan(0), reason: effect.id);
        expect(effect.height, greaterThan(0), reason: effect.id);
        expect(effect.label, isNotEmpty, reason: effect.id);
      }
    });

    test('coins and security features carry no tilt effect', () {
      final others = documents.where(
        (document) => document.kind != CurrencyContentKind.banknote,
      );

      expect(others, isNotEmpty);
      for (final document in others) {
        expect(document.hasTiltEffect, isFalse, reason: document.logicalId);
      }
    });
  });
}
