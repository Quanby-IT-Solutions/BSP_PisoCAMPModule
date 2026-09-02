import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/data/tactile_patterns.dart';

import 'bundle_test_support.dart';

/// CE-4 AC5: every mandatory banknote has a tactile map.
///
/// Checked against the bundle a device actually reads, so a note that would
/// offer nothing to touch on a phone fails here instead.
///
/// Annex H names fifteen mandatory banknotes: four in the First Philippine
/// Polymer series, five in the Enhanced New Generation Currency series, and six
/// in the New Generation Currency series.
const _mandatoryBanknoteSeries = <String, int>{
  'fpp-banknotes': 4,
  'engc-banknotes': 5,
  'ngc-banknotes': 6,
};

const _envelopeAsset = 'assets/pisocamp/bundle/seed/manifest.envelope.json';
const _indexAsset = 'assets/pisocamp/bundle/seed/resource-index.json';

void main() {
  late List<CurrencyContentDocument> documents;

  setUpAll(() async {
    final envelope = await BundleEnvelope.parseAndVerify(
      await loadSeedAsset(_envelopeAsset),
      BundleKeyRing.packagedSeed(),
    );
    final index = decodeStrictJsonObject(
      await loadSeedAsset(_indexAsset),
      maximumBytes: 65536,
      context: 'tactile coverage resource index',
    );
    documents = <CurrencyContentDocument>[
      for (final entry in envelope.manifest.entries)
        if (entry.kind == BundleEntryKind.content)
          CurrencyContentDocument.parseSeed(
            await loadSeedAsset(index[entry.sha256]! as String),
          ),
    ];
  });

  List<CurrencyContentDocument> banknotes() => documents
      .where((document) => document.kind == CurrencyContentKind.banknote)
      .toList(growable: false);

  test('the bundle carries all fifteen mandatory banknotes', () {
    expect(banknotes(), hasLength(15));
    for (final series in _mandatoryBanknoteSeries.entries) {
      expect(
        banknotes().where((note) => note.seriesCode == series.key),
        hasLength(series.value),
        reason: '${series.key} must carry ${series.value} denominations',
      );
    }
    expect(
      banknotes()
          .map((note) => '${note.seriesCode}/${note.denominationCode}')
          .toSet(),
      hasLength(15),
    );
  });

  test('every mandatory banknote has a usable tactile map', () {
    for (final note in banknotes()) {
      expect(note.hasTactileMap, isTrue, reason: note.logicalId);
      expect(note.tactileRegions, isNotEmpty, reason: note.logicalId);

      final ids = <String>{};
      for (final region in note.tactileRegions) {
        expect(
          ids.add(region.id),
          isTrue,
          reason: '${note.logicalId} ${region.id}',
        );

        // The pattern the bundle names must be one this build can play, or
        // touching the region would do nothing at all.
        final pattern = kApprovedTactilePatterns[region.pattern];
        expect(
          pattern,
          isNotNull,
          reason:
              '${note.logicalId} names unapproved pattern ${region.pattern}',
        );
        expect(pattern!.pulses, isNotEmpty, reason: region.pattern);
        expect(
          pattern.pulses.length,
          lessThanOrEqualTo(kMaximumTactilePulses),
          reason: region.pattern,
        );
        expect(
          pattern.duration,
          lessThanOrEqualTo(kMaximumTactilePatternDuration),
          reason: region.pattern,
        );

        // Every region is inside the illustration it is anchored to.
        expect(
          region.x + region.width,
          lessThanOrEqualTo(1000),
          reason: region.id,
        );
        expect(
          region.y + region.height,
          lessThanOrEqualTo(1000),
          reason: region.id,
        );
        expect(region.width, greaterThan(0), reason: region.id);
        expect(region.height, greaterThan(0), reason: region.id);
      }
    }
  });

  test('the regions of a note do not overlap each other', () {
    for (final note in banknotes()) {
      final regions = note.tactileRegions;
      for (var first = 0; first < regions.length; first += 1) {
        for (var second = first + 1; second < regions.length; second += 1) {
          final a = regions[first].fraction;
          final b = regions[second].fraction;
          expect(
            a.overlaps(b),
            isFalse,
            // Overlapping regions would make one of them unreachable by touch.
            reason:
                '${note.logicalId}: ${regions[first].id} overlaps ${regions[second].id}',
          );
        }
      }
    }
  });

  test('coins and security features carry no tactile map', () {
    final others = documents.where(
      (document) => document.kind != CurrencyContentKind.banknote,
    );

    expect(others, isNotEmpty);
    for (final document in others) {
      expect(document.hasTactileMap, isFalse, reason: document.logicalId);
      expect(document.tactileRegions, isEmpty, reason: document.logicalId);
    }
  });

  test('every approved pattern stays inside the vibration limits', () {
    expect(kApprovedTactilePatterns, isNotEmpty);
    for (final pattern in kApprovedTactilePatterns.values) {
      expect(pattern.pulses, isNotEmpty, reason: pattern.id);
      expect(pattern.pulses.length, lessThanOrEqualTo(kMaximumTactilePulses));
      expect(
        pattern.duration,
        lessThanOrEqualTo(kMaximumTactilePatternDuration),
      );
    }
  });
}
