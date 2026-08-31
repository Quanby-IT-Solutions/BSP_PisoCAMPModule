import 'dart:convert';
import 'dart:io';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/encrypted_analytics_queue.dart';
import 'package:path/path.dart' as paths;

void main() {
  late Directory root;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('an1-analytics-queue-');
  });

  tearDown(() async {
    if (await root.exists()) await root.delete(recursive: true);
  });

  test(
    'initialization creates one unpadded 32-byte key and reuses it',
    () async {
      final keys = _MemoryAnalyticsKeyStore();

      await _queue(root, keys);
      final first = keys.value;
      await _queue(root, keys);

      expect(first, isNotNull);
      expect(first, isNot(contains('=')));
      expect(_decodeBase64Url(first!).length, 32);
      expect(keys.writeCount, 1);
    },
  );

  test(
    'committed files and unavailable keys preserve the entire existing layout',
    () async {
      for (final keyStore in <AnalyticsKeyStore>[
        _MemoryAnalyticsKeyStore(),
        _MemoryAnalyticsKeyStore('not-a-32-byte-key'),
        _ThrowingAnalyticsKeyStore(),
      ]) {
        final caseRoot = await Directory.systemTemp.createTemp(
          'an1-queue-fail-closed-',
        );
        addTearDown(() async {
          if (await caseRoot.exists()) await caseRoot.delete(recursive: true);
        });
        final committed = File(
          paths.join(
            caseRoot.path,
            'pisocamp',
            'analytics',
            'v1',
            'queue',
            '${_id(1)}.event',
          ),
        );
        await committed.parent.create(recursive: true);
        await committed.writeAsBytes(<int>[9, 8, 7], flush: true);
        final before = await _snapshotTree(caseRoot);

        await expectLater(
          _queue(caseRoot, keyStore),
          throwsA(
            isA<AnalyticsQueueException>().having(
              (error) => error.code,
              'stable code',
              'analyticsKeyUnavailable',
            ),
          ),
        );

        expect(await _snapshotTree(caseRoot), before);
        expect(_writeCount(keyStore), 0);
      }
    },
  );

  test(
    'key generation and extraction failures expose only a stable code',
    () async {
      for (final generator in <AnalyticsQueueKeyGenerator>[
        () => Future<SecretKey>.error(StateError('key generation secret')),
        () async => _ThrowingSecretKey(),
      ]) {
        final keys = _MemoryAnalyticsKeyStore();

        await expectLater(
          _queue(root, keys, createSecretKey: generator),
          throwsA(
            isA<AnalyticsQueueException>().having(
              (error) => error.code,
              'stable code',
              'analyticsKeyUnavailable',
            ),
          ),
        );

        expect(keys.writeCount, 0);
      }
    },
  );

  test(
    'a pre-key directory probe error is masked by a stable queue code',
    () async {
      final pathBearingError = FileSystemException(
        'directory probe failed',
        paths.join(root.path, 'sensitive-local-path'),
      );

      await expectLater(
        _queue(
          root,
          _MemoryAnalyticsKeyStore(),
          queueDirectoryExists: (_) => Future<bool>.error(pathBearingError),
        ),
        throwsA(
          isA<AnalyticsQueueException>()
              .having((error) => error.code, 'stable code', 'initializeFailed')
              .having(
                (error) => error.toString(),
                'redacted error text',
                'AnalyticsQueueException(initializeFailed)',
              ),
        ),
      );
    },
  );

  test(
    'ciphertext has no event plaintext and fresh nonces encrypt identical events differently',
    () async {
      final keys = _MemoryAnalyticsKeyStore();
      final left = await _queue(root, keys);
      final otherRoot = await Directory.systemTemp.createTemp(
        'an1-analytics-queue-other-',
      );
      addTearDown(() async {
        if (await otherRoot.exists()) await otherRoot.delete(recursive: true);
      });
      final right = await _queue(otherRoot, keys);
      final event = _event(1, logicalId: 'currency.ngc.php-20');
      await left.enqueue(event);
      await right.enqueue(event);

      final leftBytes = await (await _eventFiles(root)).single.readAsBytes();
      final rightBytes = await (await _eventFiles(
        otherRoot,
      )).single.readAsBytes();
      final text = latin1.decode(leftBytes, allowInvalid: true);

      expect(leftBytes.sublist(5, 17), isNot(rightBytes.sublist(5, 17)));
      expect(leftBytes, isNot(rightBytes));
      for (final sentinel in <String>[
        event.eventId,
        'f6635d24-b4d1-4f63-8a06-4026fa4e8fd6',
        event.occurredAt.toIso8601String(),
        'content_view',
        'AbCdEfGhIjKlMnOpQrStUv',
        'currency.ngc.php-20',
        '1.0.0+1',
        'android',
        'Android 15',
        jsonEncode(event.toJson()),
        '{"schemaVersion":1',
      ]) {
        expect(text, isNot(contains(sentinel)));
      }
    },
  );

  test(
    'tampered envelope fields and filename-bound AAD quarantine corrupt files',
    () async {
      for (final tamper in <String>['tag', 'nonce', 'version', 'filename']) {
        final caseRoot = await Directory.systemTemp.createTemp(
          'an1-queue-tamper-',
        );
        addTearDown(() async {
          if (await caseRoot.exists()) await caseRoot.delete(recursive: true);
        });
        final queue = await _queue(caseRoot, _MemoryAnalyticsKeyStore());
        await queue.enqueue(_event(1));
        final file = (await _eventFiles(caseRoot)).single;
        final bytes = await file.readAsBytes();
        switch (tamper) {
          case 'tag':
            bytes[bytes.length - 1] ^= 1;
            await file.writeAsBytes(bytes, flush: true);
          case 'nonce':
            bytes[5] ^= 1;
            await file.writeAsBytes(bytes, flush: true);
          case 'version':
            bytes[4] = 2;
            await file.writeAsBytes(bytes, flush: true);
          case 'filename':
            await file.rename(paths.join(file.parent.path, '${_id(2)}.event'));
        }

        expect(await queue.readBatch(), isEmpty, reason: tamper);
        expect(await _eventFiles(caseRoot), isEmpty, reason: tamper);
        expect(await _quarantineFiles(caseRoot), hasLength(1), reason: tamper);
      }
    },
  );

  test(
    'validly encrypted malformed JSON and embedded ID mismatch quarantine',
    () async {
      final keys = _MemoryAnalyticsKeyStore();
      final queue = await _queue(root, keys);
      final malformedId = _id(1);
      final mismatchedId = _id(2);
      await _writeEnvelope(root, keys.value!, malformedId, utf8.encode('{'));
      final mismatched = _event(3).toJson()..['eventId'] = _id(4);
      await _writeEnvelope(
        root,
        keys.value!,
        mismatchedId,
        utf8.encode(jsonEncode(mismatched)),
      );

      expect(await queue.readBatch(), isEmpty);
      expect(await _quarantineFiles(root), hasLength(2));
    },
  );

  test(
    'validly encrypted UTF-8 and event-validation corruption quarantine',
    () async {
      final keys = _MemoryAnalyticsKeyStore();
      final queue = await _queue(root, keys);
      await _writeEnvelope(root, keys.value!, _id(5), <int>[0xff]);
      final invalidEvent = _event(7).toJson()
        ..['eventId'] = _id(6)
        ..['appVersion'] = 'private@example.test';
      await _writeEnvelope(
        root,
        keys.value!,
        _id(6),
        utf8.encode(jsonEncode(invalidEvent)),
      );

      expect(await queue.readBatch(), isEmpty);
      expect(await _eventFiles(root), isEmpty);
      expect(await _quarantineFiles(root), hasLength(2));
    },
  );

  test(
    'transient read failure preserves a valid committed event and exposes only a stable code',
    () async {
      var shouldFail = true;
      final queue = await _queue(
        root,
        _MemoryAnalyticsKeyStore(),
        readFile: (file) async {
          if (shouldFail) {
            shouldFail = false;
            throw FileSystemException('transient read failure', file.path);
          }
          return file.readAsBytes();
        },
      );
      await queue.enqueue(_event(1));

      await expectLater(
        queue.readBatch(),
        throwsA(
          isA<AnalyticsQueueException>()
              .having((error) => error.code, 'stable code', 'readFailed')
              .having(
                (error) => error.toString(),
                'redacted error text',
                'AnalyticsQueueException(readFailed)',
              ),
        ),
      );

      expect(await queue.pendingCount(), 1);
      expect(await _eventFiles(root), hasLength(1));
      expect(await _quarantineFiles(root), isEmpty);
      expect((await queue.readBatch()).single.eventId, _id(1));
    },
  );

  test('initialization removes only stale .part files', () async {
    final now = DateTime.utc(2026, 8, 31, 12);
    final tmp = Directory(
      paths.join(root.path, 'pisocamp', 'analytics', 'v1', 'tmp'),
    );
    await tmp.create(recursive: true);
    final stale = File(paths.join(tmp.path, '${_id(1)}.old.part'));
    final fresh = File(paths.join(tmp.path, '${_id(2)}.new.part'));
    await stale.writeAsBytes(<int>[1]);
    await fresh.writeAsBytes(<int>[2]);
    await stale.setLastModified(now.subtract(const Duration(hours: 24)));
    await fresh.setLastModified(
      now.subtract(const Duration(hours: 23, minutes: 59)),
    );

    await _queue(root, _MemoryAnalyticsKeyStore(), clock: () => now);

    expect(await stale.exists(), isFalse);
    expect(await fresh.exists(), isTrue);
  });

  test(
    '100 concurrent enqueues commit 100 complete unique files with no visible parts',
    () async {
      final queue = await _queue(root, _MemoryAnalyticsKeyStore());

      await Future.wait(
        List<Future<void>>.generate(
          100,
          (index) => queue.enqueue(_event(index)),
        ),
      );

      final files = await _eventFiles(root);
      expect(files, hasLength(100));
      expect(
        files.map((file) => paths.basename(file.path)).toSet(),
        hasLength(100),
      );
      expect(await _partFiles(root), isEmpty);
      expect(await queue.pendingCount(), 100);
      final batch = await queue.readBatch(maxEvents: 100, maxBytes: 512 * 1024);
      expect(batch, hasLength(100));
      expect(
        utf8
            .encode(
              jsonEncode(<String, Object?>{
                'events': batch
                    .map((event) => event.toJson())
                    .toList(growable: false),
              }),
            )
            .length,
        lessThanOrEqualTo(512 * 1024),
      );
    },
  );

  test(
    'batches are lexicographic and honor event and exact request byte limits',
    () async {
      final queue = await _queue(root, _MemoryAnalyticsKeyStore());
      for (final index in <int>[9, 1, 4]) {
        await queue.enqueue(_event(index));
      }

      final firstTwo = await queue.readBatch(maxEvents: 2);
      expect(firstTwo.map((event) => event.eventId), <String>[_id(1), _id(4)]);
      final one = _event(1).toJson();
      final exactOneSize = utf8
          .encode(
            jsonEncode(<String, Object?>{
              'events': <Object?>[one],
            }),
          )
          .length;
      final exactOne = await queue.readBatch(maxBytes: exactOneSize);
      expect(exactOne, hasLength(1));
      await expectLater(
        queue.readBatch(maxBytes: exactOneSize - 1),
        throwsA(
          isA<AnalyticsQueueException>().having(
            (error) => error.code,
            'stable code',
            'eventTooLarge',
          ),
        ),
      );
    },
  );

  test(
    'batch limits reject global cap bypasses and default to 100 events',
    () async {
      final queue = await _queue(root, _MemoryAnalyticsKeyStore());
      for (var index = 0; index < 101; index++) {
        await queue.enqueue(_event(index));
      }

      expect(await queue.readBatch(), hasLength(100));
      for (final future in <Future<List<AnalyticsEvent>>>[
        queue.readBatch(maxEvents: 101),
        queue.readBatch(maxBytes: 512 * 1024 + 1),
      ]) {
        await expectLater(
          future,
          throwsA(
            isA<AnalyticsQueueException>().having(
              (error) => error.code,
              'stable code',
              'invalidBatchLimit',
            ),
          ),
        );
      }
    },
  );

  test(
    'acknowledgement deletes only valid exact IDs and is idempotent',
    () async {
      final queue = await _queue(root, _MemoryAnalyticsKeyStore());
      await queue.enqueue(_event(1));
      await queue.enqueue(_event(2));

      await queue.acknowledge(<String>[_id(1)]);
      await queue.acknowledge(<String>[_id(1)]);

      expect(await queue.pendingCount(), 1);
      await expectLater(
        queue.acknowledge(<String>['../${_id(2)}']),
        throwsA(
          isA<AnalyticsQueueException>().having(
            (error) => error.code,
            'stable code',
            'invalidEventId',
          ),
        ),
      );
      expect(await queue.pendingCount(), 1);
    },
  );

  test(
    'a corrupt sibling is quarantined without blocking valid events',
    () async {
      final queue = await _queue(root, _MemoryAnalyticsKeyStore());
      await queue.enqueue(_event(1));
      await queue.enqueue(_event(2));
      final corrupt = (await _eventFiles(
        root,
      )).firstWhere((file) => paths.basename(file.path).startsWith(_id(1)));
      final bytes = await corrupt.readAsBytes();
      bytes[bytes.length - 1] ^= 1;
      await corrupt.writeAsBytes(bytes, flush: true);

      final batch = await queue.readBatch();

      expect(batch.map((event) => event.eventId), <String>[_id(2)]);
      expect(await _quarantineFiles(root), hasLength(1));
    },
  );

  test(
    'quarantine collision preserves its file and suffixes a corrupt sibling',
    () async {
      final queue = await _queue(root, _MemoryAnalyticsKeyStore());
      await queue.enqueue(_event(1));
      await queue.enqueue(_event(2));
      final corrupt = (await _eventFiles(
        root,
      )).firstWhere((file) => paths.basename(file.path) == '${_id(1)}.event');
      final corruptBytes = await corrupt.readAsBytes();
      corruptBytes[corruptBytes.length - 1] ^= 1;
      await corrupt.writeAsBytes(corruptBytes, flush: true);
      final existing = File(
        paths.join(
          root.path,
          'pisocamp',
          'analytics',
          'v1',
          'quarantine',
          '${_id(1)}.event',
        ),
      );
      await existing.writeAsBytes(<int>[1, 2, 3], flush: true);

      final batch = await queue.readBatch();
      final quarantined = await _quarantineFiles(root);

      expect(batch.map((event) => event.eventId), <String>[_id(2)]);
      expect(await existing.readAsBytes(), <int>[1, 2, 3]);
      expect(quarantined, hasLength(2));
      expect(
        quarantined.map((file) => paths.basename(file.path)),
        contains(startsWith('${_id(1)}.')),
      );
    },
  );
}

Future<EncryptedAnalyticsQueue> _queue(
  Directory root,
  AnalyticsKeyStore keys, {
  DateTime Function()? clock,
  AnalyticsQueueKeyGenerator? createSecretKey,
  AnalyticsQueueDirectoryExistsProbe? queueDirectoryExists,
  AnalyticsQueueFileReader? readFile,
}) => EncryptedAnalyticsQueue.initialize(
  applicationSupportDirectory: root,
  keyStore: keys,
  clock: clock,
  createSecretKey: createSecretKey,
  queueDirectoryExists: queueDirectoryExists,
  readFile: readFile,
);

AnalyticsEvent _event(int value, {String logicalId = 'currency.ngc.php-20'}) =>
    AnalyticsEvent.build(
      intent: ContentViewIntent(logicalId),
      context: const AnalyticsEventContext(
        subjectPseudoId: 'AbCdEfGhIjKlMnOpQrStUv',
        sessionId: 'f6635d24-b4d1-4f63-8a06-4026fa4e8fd6',
        accountType: AnalyticsAccountType.guest,
        appVersion: '1.0.0+1',
        osName: AnalyticsOsName.android,
        osVersion: 'Android 15',
        deviceCategory: AnalyticsDeviceCategory.phone,
        networkState: AnalyticsNetworkState.offline,
      ),
      createEventId: () => _id(value),
      clock: () => DateTime.utc(2026, 8, 30, 1, 2, 3, value),
    );

String _id(int value) =>
    '00000000-0000-4000-8000-${value.toString().padLeft(12, '0')}';

Future<List<File>> _eventFiles(Directory root) =>
    _files(root, 'queue', '.event');
Future<List<File>> _quarantineFiles(Directory root) =>
    _files(root, 'quarantine', '.event');
Future<List<File>> _partFiles(Directory root) => _files(root, 'tmp', '.part');

Future<List<File>> _files(
  Directory root,
  String directory,
  String suffix,
) async {
  final path = paths.join(root.path, 'pisocamp', 'analytics', 'v1', directory);
  final target = Directory(path);
  if (!await target.exists()) return <File>[];
  final files = <File>[];
  await for (final entity in target.list()) {
    if (entity is File && entity.path.endsWith(suffix)) files.add(entity);
  }
  return files;
}

Future<Map<String, String>> _snapshotTree(Directory root) async {
  final analyticsRoot = Directory(
    paths.join(root.path, 'pisocamp', 'analytics', 'v1'),
  );
  if (!await analyticsRoot.exists()) return <String, String>{};
  final snapshot = <String, String>{};
  await for (final entity in analyticsRoot.list(
    recursive: true,
    followLinks: false,
  )) {
    final relative = paths.relative(entity.path, from: analyticsRoot.path);
    final stat = await entity.stat();
    if (entity is File) {
      snapshot[relative] = jsonEncode(<String, Object?>{
        'type': 'file',
        'modified': stat.modified.toUtc().microsecondsSinceEpoch,
        'bytes': base64.encode(await entity.readAsBytes()),
      });
    } else if (entity is Directory) {
      snapshot[relative] = jsonEncode(<String, Object?>{
        'type': 'directory',
        'modified': stat.modified.toUtc().microsecondsSinceEpoch,
      });
    }
  }
  return snapshot;
}

Future<void> _writeEnvelope(
  Directory root,
  String encodedKey,
  String eventId,
  List<int> plaintext,
) async {
  final cipher = AesGcm.with256bits();
  final box = await cipher.encrypt(
    plaintext,
    secretKey: SecretKeyData(_decodeBase64Url(encodedKey)),
    nonce: List<int>.filled(12, 7),
    aad: utf8.encode('PCAQ:1:$eventId'),
  );
  final file = File(
    paths.join(
      root.path,
      'pisocamp',
      'analytics',
      'v1',
      'queue',
      '$eventId.event',
    ),
  );
  await file.parent.create(recursive: true);
  await file.writeAsBytes(<int>[
    0x50,
    0x43,
    0x41,
    0x51,
    1,
    ...box.nonce,
    ...box.cipherText,
    ...box.mac.bytes,
  ], flush: true);
}

List<int> _decodeBase64Url(String value) =>
    base64Url.decode('$value${'=' * ((4 - value.length % 4) % 4)}');

final class _MemoryAnalyticsKeyStore implements AnalyticsKeyStore {
  _MemoryAnalyticsKeyStore([this.value]);

  String? value;
  var writeCount = 0;

  @override
  Future<String?> readKey() async => value;

  @override
  Future<void> writeKey(String value) async {
    this.value = value;
    writeCount++;
  }
}

int _writeCount(AnalyticsKeyStore keyStore) => switch (keyStore) {
  _MemoryAnalyticsKeyStore store => store.writeCount,
  _ThrowingAnalyticsKeyStore store => store.writeCount,
  _ => throw StateError('Unexpected test key store'),
};

final class _ThrowingAnalyticsKeyStore implements AnalyticsKeyStore {
  var writeCount = 0;

  @override
  Future<String?> readKey() => Future<String?>.error(StateError('storage'));

  @override
  Future<void> writeKey(String value) async {
    writeCount++;
  }
}

final class _ThrowingSecretKey extends SecretKey {
  _ThrowingSecretKey() : super.constructor();

  @override
  Future<SecretKeyData> extract() =>
      Future<SecretKeyData>.error(StateError('key extraction secret'));
}
