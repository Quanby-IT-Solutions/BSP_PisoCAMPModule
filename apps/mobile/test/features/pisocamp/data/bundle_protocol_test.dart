import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';

void main() {
  final fixture =
      jsonDecode(
            File(
              '../../packages/contracts/src/modules/v1/pisocamp/fixtures/ce1-ed25519-vector.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;

  Uint8List envelopeBytes({
    Object schemaVersion = 1,
    String? algorithm,
    String? keyId,
    String? payload,
    String? signature,
  }) => Uint8List.fromList(
    utf8.encode(
      jsonEncode({
        'schemaVersion': schemaVersion,
        'algorithm': algorithm ?? 'Ed25519',
        'keyId': keyId ?? fixture['keyId'],
        'payload': payload ?? fixture['payloadBase64url'],
        'signature': signature ?? fixture['signatureBase64url'],
      }),
    ),
  );

  test('verifies the Task 1 exact-byte Ed25519 golden vector', () async {
    final envelope = await BundleEnvelope.parseAndVerify(
      envelopeBytes(),
      BundleKeyRing.forTests({
        fixture['keyId'] as String: fixture['publicKeySpkiPem'] as String,
      }),
    );

    expect(envelope.manifest.bundleVersion, '0');
    expect(envelope.manifest.entries, isEmpty);
    expect(envelope.payloadSha256, fixture['sha256']);
  });

  test('verifies the checked-in packaged seed envelope', () async {
    final envelope = await BundleEnvelope.parseAndVerify(
      File(
        'assets/pisocamp/bundle/seed/manifest.envelope.json',
      ).readAsBytesSync(),
      BundleKeyRing.packagedSeed(),
    );

    expect(envelope.keyId, 'ce5-seed-v4');
    expect(envelope.manifest.bundleVersion, '0');
  });

  test('keeps authenticated envelope bytes immutable to callers', () async {
    final envelope = await BundleEnvelope.parseAndVerify(
      envelopeBytes(),
      BundleKeyRing.forTests({
        fixture['keyId'] as String: fixture['publicKeySpkiPem'] as String,
      }),
    );
    final originalPayload = List<int>.from(envelope.payload);
    final originalSignature = List<int>.from(envelope.signature);
    final exposedPayload = envelope.payload;
    final exposedSignature = envelope.signature;

    exposedPayload[0] ^= 0xff;
    exposedSignature[0] ^= 0xff;

    expect(envelope.payload, orderedEquals(originalPayload));
    expect(envelope.signature, orderedEquals(originalSignature));
    expect(envelope.payloadSha256, fixture['sha256']);
    expect(envelope.manifest.bundleVersion, '0');
    expect(envelope.manifest.entries, isEmpty);
  });

  test(
    'rejects altered payloads, signatures, unknown keys, and algorithms',
    () async {
      final ring = BundleKeyRing.forTests({
        fixture['keyId'] as String: fixture['publicKeySpkiPem'] as String,
      });
      final payload = fixture['payloadBase64url'] as String;
      final signature = fixture['signatureBase64url'] as String;

      await expectLater(
        BundleEnvelope.parseAndVerify(
          envelopeBytes(
            payload: '${payload.substring(0, payload.length - 1)}A',
          ),
          ring,
        ),
        throwsA(isA<BundleValidationException>()),
      );
      await expectLater(
        BundleEnvelope.parseAndVerify(
          envelopeBytes(
            signature: '${signature.substring(0, signature.length - 1)}A',
          ),
          ring,
        ),
        throwsA(isA<BundleValidationException>()),
      );
      await expectLater(
        BundleEnvelope.parseAndVerify(envelopeBytes(keyId: 'unknown-v1'), ring),
        throwsA(isA<BundleValidationException>()),
      );
      await expectLater(
        BundleEnvelope.parseAndVerify(envelopeBytes(algorithm: 'RSA'), ring),
        throwsA(isA<BundleValidationException>()),
      );
    },
  );

  test(
    'rejects noncanonical base64url, duplicate keys, extra keys, and malformed JSON',
    () async {
      final ring = BundleKeyRing.forTests({
        fixture['keyId'] as String: fixture['publicKeySpkiPem'] as String,
      });
      for (final bytes in <Uint8List>[
        envelopeBytes(payload: '${fixture['payloadBase64url']}='),
        envelopeBytes(signature: '${fixture['signatureBase64url']}='),
        envelopeBytes(
          signature:
              '${(fixture['signatureBase64url'] as String).substring(0, (fixture['signatureBase64url'] as String).length - 1)}x',
        ),
        Uint8List.fromList(
          utf8.encode(
            '{"schemaVersion":1,"schemaVersion":1,"algorithm":"Ed25519","keyId":"ce1-test-v1","payload":"AA","signature":"AA"}',
          ),
        ),
        Uint8List.fromList(
          utf8.encode(
            '{"schemaVersion":1,"algorithm":"Ed25519","keyId":"ce1-test-v1","payload":"AA","signature":"AA","extra":true}',
          ),
        ),
        Uint8List.fromList(utf8.encode('{')),
      ]) {
        await expectLater(
          BundleEnvelope.parseAndVerify(bytes, ring),
          throwsA(isA<BundleValidationException>()),
        );
      }
    },
  );

  test(
    'parses fail-closed build configuration into purpose-bound network rings',
    () async {
      const publicKey = '5m0MbmDjnT8FfA_NNZWdLoOYssEmpyUPp-kO7IpPu2Q';
      final releaseRing = BundleKeyRing.fromBuildConfigurationForTests(
        isProduct: true,
        debugPublicKeyBase64url: publicKey,
        productionPublicKeysJson: jsonEncode({'ce1-prod-v1': publicKey}),
      );
      final debugRing = BundleKeyRing.fromBuildConfigurationForTests(
        isProduct: false,
        debugPublicKeyBase64url: publicKey,
        productionPublicKeysJson: jsonEncode({'ce1-prod-v1': publicKey}),
      );

      expect(BundleKeyRing.packagedSeed().accepts('ce5-seed-v4'), isTrue);
      expect(releaseRing.accepts('ce5-seed-v4'), isFalse);
      expect(releaseRing.accepts('ce1-test-v1'), isFalse);
      expect(releaseRing.accepts('ce1-dev-2026-01'), isFalse);
      expect(releaseRing.accepts('ce1-prod-v1'), isTrue);
      expect(debugRing.accepts('ce1-dev-2026-01'), isTrue);
      expect(debugRing.accepts('ce1-prod-v1'), isFalse);
      await expectLater(
        BundleEnvelope.parseAndVerify(
          File(
            'assets/pisocamp/bundle/seed/manifest.envelope.json',
          ).readAsBytesSync(),
          releaseRing,
        ),
        throwsA(isA<BundleValidationException>()),
      );
      await expectLater(
        BundleEnvelope.parseAndVerify(envelopeBytes(), releaseRing),
        throwsA(isA<BundleValidationException>()),
      );
      expect(
        () => BundleKeyRing.forCurrentBuild(),
        throwsA(isA<BundleConfigurationException>()),
      );

      for (final configuration in <String>[
        '',
        '{}',
        '[]',
        '{',
        '{"ce1-prod-v1":null}',
        '{"ce1-test-v1":"$publicKey"}',
        '{"ce1-prod-v1":"AA"}',
        '{"ce1-prod-v1":"$publicKey","ce1-prod-v1":"$publicKey"}',
      ]) {
        expect(
          () => BundleKeyRing.fromBuildConfigurationForTests(
            isProduct: true,
            debugPublicKeyBase64url: publicKey,
            productionPublicKeysJson: configuration,
          ),
          throwsA(isA<BundleConfigurationException>()),
        );
      }
      for (final debugKey in <String>['', 'AA', '$publicKey=']) {
        expect(
          () => BundleKeyRing.fromBuildConfigurationForTests(
            isProduct: false,
            debugPublicKeyBase64url: debugKey,
            productionPublicKeysJson: jsonEncode({'ce1-prod-v1': publicKey}),
          ),
          throwsA(isA<BundleConfigurationException>()),
        );
      }
      expect(
        () => BundleKeyRing.fromBuildConfigurationForTests(
          isProduct: true,
          debugPublicKeyBase64url: publicKey,
        ),
        throwsA(isA<BundleConfigurationException>()),
      );
    },
  );

  test('rejects oversized envelope, payload, and schema input', () async {
    final ring = BundleKeyRing.forTests({
      fixture['keyId'] as String: fixture['publicKeySpkiPem'] as String,
    });
    final oversizedPayload = base64Url
        .encode(Uint8List(2 * 1024 * 1024 + 1))
        .replaceAll('=', '');

    await expectLater(
      BundleEnvelope.parseAndVerify(Uint8List(3000001), ring),
      throwsA(isA<BundleValidationException>()),
    );
    await expectLater(
      BundleEnvelope.parseAndVerify(
        envelopeBytes(payload: oversizedPayload),
        ring,
      ),
      throwsA(isA<BundleValidationException>()),
    );
    await expectLater(
      BundleEnvelope.parseAndVerify(
        envelopeBytes(schemaVersion: 1 << 62),
        ring,
      ),
      throwsA(isA<BundleValidationException>()),
    );
  });

  test(
    'rejects rollback and equal-version digest conflicts but accepts unchanged',
    () {
      const highWater = BundleHighWaterMark(
        version: '12',
        manifestDigest:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );

      expect(
        highWater.evaluate(
          version: '13',
          manifestDigest:
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ),
        BundleVersionDecision.update,
      );
      expect(
        highWater.evaluate(
          version: '12',
          manifestDigest: highWater.manifestDigest,
        ),
        BundleVersionDecision.unchanged,
      );
      expect(
        () => highWater.evaluate(
          version: '11',
          manifestDigest: highWater.manifestDigest,
        ),
        throwsA(isA<BundleValidationException>()),
      );
      expect(
        () => highWater.evaluate(
          version: '12',
          manifestDigest:
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ),
        throwsA(isA<BundleValidationException>()),
      );
    },
  );

  test(
    'validates resource digest, length, MIME, path, and image magic',
    () async {
      final png = Uint8List.fromList(<int>[137, 80, 78, 71, 13, 10, 26, 10, 0]);
      final entry = BundleManifestEntry.forTest(
        logicalId: 'image.seed.test',
        kind: BundleEntryKind.image,
        mediaType: 'image/png',
        bytes: png,
      );

      await expectLater(entry.validateResource(png), completes);
      await expectLater(
        entry.validateResource(Uint8List.fromList(png.skip(1).toList())),
        throwsA(
          isA<BundleValidationException>().having(
            (error) => error.message,
            'message',
            contains('length'),
          ),
        ),
      );
      await expectLater(
        entry.validateResource(
          Uint8List.fromList(<int>[...png.take(png.length - 1), 1]),
        ),
        throwsA(
          isA<BundleValidationException>().having(
            (error) => error.message,
            'message',
            contains('digest'),
          ),
        ),
      );
      final wrongMagic = Uint8List.fromList(<int>[
        0,
        80,
        78,
        71,
        13,
        10,
        26,
        10,
        0,
      ]);
      final wrongMagicEntry = BundleManifestEntry.forTest(
        logicalId: 'image.seed.wrong-magic',
        kind: BundleEntryKind.image,
        mediaType: 'image/png',
        bytes: wrongMagic,
      );
      await expectLater(
        wrongMagicEntry.validateResource(wrongMagic),
        throwsA(
          isA<BundleValidationException>().having(
            (error) => error.message,
            'message',
            contains('media type'),
          ),
        ),
      );
      expect(
        () => entry.copyWith(downloadPath: '../escape'),
        throwsA(isA<BundleValidationException>()),
      );
      expect(
        () => entry.copyWith(mediaType: 'image/svg+xml'),
        throwsA(isA<BundleValidationException>()),
      );
    },
  );

  test(
    'rejects manifest ordering, ownership, count, and core byte-limit violations',
    () {
      final bytes = Uint8List.fromList(<int>[1]);
      final first = BundleManifestEntry.forTest(
        logicalId: 'content.b',
        kind: BundleEntryKind.content,
        mediaType: 'application/json',
        bytes: bytes,
      );
      final second = BundleManifestEntry.forTest(
        logicalId: 'content.a',
        kind: BundleEntryKind.content,
        mediaType: 'application/json',
        bytes: bytes,
      );

      expect(
        () => BundleManifest.forTest(entries: [first, second]),
        throwsA(isA<BundleValidationException>()),
      );
      expect(
        () => first.copyWith(
          contentItemId: '11111111-1111-4111-8111-111111111111',
        ),
        throwsA(isA<BundleValidationException>()),
      );
      expect(
        () => BundleManifest.forTest(entries: List.filled(2001, first)),
        throwsA(isA<BundleValidationException>()),
      );
      expect(
        () => first.copyWith(byteLength: 5 * 1024 * 1024 + 1),
        throwsA(isA<BundleValidationException>()),
      );

      final sharedResourceEntries = [
        first.copyWith(logicalId: 'content.a'),
        first.copyWith(logicalId: 'content.b'),
      ];
      expect(
        BundleManifest.forTest(entries: sharedResourceEntries).entries,
        hasLength(2),
      );

      final maximumSizeEntries = List.generate(
        10,
        (index) => first.copyWith(
          logicalId: 'content.${index.toString().padLeft(2, '0')}',
          byteLength: 5 * 1024 * 1024,
        ),
      );
      expect(
        BundleManifest.forTest(entries: maximumSizeEntries).entries,
        hasLength(10),
      );
      expect(
        () => BundleManifest.forTest(
          entries: [
            ...maximumSizeEntries,
            BundleManifestEntry.forTest(
              logicalId: 'content.10',
              kind: BundleEntryKind.content,
              mediaType: 'application/json',
              bytes: Uint8List.fromList(const [2]),
            ),
          ],
        ),
        throwsA(isA<BundleValidationException>()),
      );
    },
  );
}
