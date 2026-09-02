import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/bundle_client.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';

import 'bundle_test_support.dart';

void main() {
  late Directory root;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('ce1-bundle-store-');
  });

  tearDown(() async {
    if (await root.exists()) await root.delete(recursive: true);
  });

  BundleStore seedStore({
    BundleStoreFaults faults = const BundleStoreFaults(),
  }) {
    return BundleStore(
      documentsRoot: root,
      loadAsset: loadSeedAsset,
      networkKeyRing: BundleKeyRing.packagedSeed(),
      versionedUrl: Uri.parse('https://example.test/api/v1'),
      faults: faults,
    );
  }

  test('bootstraps all 29 content, 2 image and 1 model seed objects below root', () async {
    final catalog = await seedStore().bootstrap();

    expect(catalog.version, '0');
    expect(
      catalog.entries.where((entry) => entry.kind == BundleEntryKind.content),
      hasLength(29),
    );
    expect(
      catalog.entries.where((entry) => entry.kind == BundleEntryKind.image),
      hasLength(2),
    );
    final objects = Directory(
      '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}objects',
    );
    expect(await objects.list().where((item) => item is File).length, 32);
    for (final entry in catalog.entries) {
      expect(await seedStore().hasVerifiedObject(entry), isTrue);
    }
    final active =
        jsonDecode(
              await File(
                '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}active.json',
              ).readAsString(),
            )
            as Map<String, dynamic>;
    expect(active.keys.toSet(), {
      'schemaVersion',
      'bundleVersion',
      'manifestDigest',
    });
    expect(active['bundleVersion'], '0');
  });

  test(
    'recovery ignores corrupt pointers and removes orphan temporary state',
    () async {
      final store = seedStore();
      final original = await store.bootstrap();
      final bundleRoot = Directory(
        '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles',
      );
      await File(
        '${bundleRoot.path}${Platform.pathSeparator}active.json',
      ).writeAsString('{"schemaVersion":1,"bundleVersion":"../escape"}');
      await File(
        '${bundleRoot.path}${Platform.pathSeparator}active.json.tmp',
      ).writeAsString('orphan');
      final invalidStage = Directory(
        '${bundleRoot.path}${Platform.pathSeparator}staging${Platform.pathSeparator}9',
      );
      await invalidStage.create(recursive: true);
      await File(
        '${invalidStage.path}${Platform.pathSeparator}junk',
      ).writeAsString('junk');

      final recovered = await seedStore().recover();

      expect(recovered.version, original.version);
      expect(
        await File(
          '${bundleRoot.path}${Platform.pathSeparator}active.json.tmp',
        ).exists(),
        isFalse,
      );
      expect(await invalidStage.exists(), isFalse);
      expect(
        Directory(
          '${bundleRoot.path}${Platform.pathSeparator}ready${Platform.pathSeparator}0',
        ).existsSync(),
        isTrue,
      );
    },
  );

  test('detects a corrupt immutable object and bootstrap replaces it', () async {
    final store = seedStore();
    final active = await store.bootstrap();
    final entry = active.entries.first;
    final object = File(
      '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}objects${Platform.pathSeparator}${entry.sha256}.blob',
    );
    await object.writeAsBytes(const [0, 1, 2], flush: true);

    expect(await store.hasVerifiedObject(entry), isFalse);
    final recovered = await store.bootstrap();

    expect(await store.hasVerifiedObject(entry), isTrue);
    expect(recovered.version, '0');
  });

  test(
    'stages changed objects only and pins readers across atomic activation',
    () async {
      final oldStore = seedStore();
      final oldSnapshot = await oldStore.bootstrap();
      final retainedEntry = oldSnapshot.entries.first;
      final removedEntry = oldSnapshot.entries[1];
      final newBytes = Uint8List.fromList(utf8.encode('{"new":true}'));
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [
          TestBundleResource(
            logicalId: retainedEntry.logicalId,
            bytes: await oldSnapshot.readBytes(retainedEntry),
          ),
          TestBundleResource(logicalId: 'content.new', bytes: newBytes),
        ],
      );
      final server = await LoopbackBundleServer.start();
      addTearDown(server.close);
      server.resources.addAll(update.resources);
      final store = BundleStore(
        documentsRoot: root,
        loadAsset: loadSeedAsset,
        networkKeyRing: update.keyRing,
        versionedUrl: server.versionedUrl,
      );
      final client = BundleClient(
        dio: Dio(),
        versionedUrl: server.versionedUrl,
      );

      final staged = await store.stage(
        envelope: update.envelope,
        envelopeBytes: update.envelopeBytes,
        client: client,
      );
      expect(
        server.requests.where(
          (request) => request.path.contains('/resources/'),
        ),
        hasLength(1),
      );
      expect((await store.readActive()).version, '0');
      await store.activate(staged);
      final current = await store.readActive();

      expect(current.version, '1');
      expect(
        current.entries.map((entry) => entry.logicalId),
        contains('content.new'),
      );
      expect(
        current.entries.map((entry) => entry.logicalId),
        isNot(contains(removedEntry.logicalId)),
      );
      expect(oldSnapshot.version, '0');
      expect(oldSnapshot.entries, hasLength(32));
      expect(
        oldSnapshot.entries.map((entry) => entry.logicalId),
        isNot(contains('content.new')),
      );
      expect(await oldSnapshot.readBytes(oldSnapshot.entries.last), isNotEmpty);
      final bundleRoot =
          '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles';
      expect(
        File('$bundleRoot${Platform.pathSeparator}previous.json').existsSync(),
        isTrue,
      );
      expect(
        Directory(
          '$bundleRoot${Platform.pathSeparator}ready${Platform.pathSeparator}0',
        ).existsSync(),
        isTrue,
      );
    },
  );

  test(
    'rejects rollback and equal-version digest conflicts before download',
    () async {
      final bootstrapStore = seedStore();
      await bootstrapStore.bootstrap();
      final server = await LoopbackBundleServer.start();
      addTearDown(server.close);
      final client = BundleClient(
        dio: Dio(),
        versionedUrl: server.versionedUrl,
      );
      final conflicting = await TestSignedBundle.create(
        version: '0',
        resources: [
          TestBundleResource(
            logicalId: 'content.conflict',
            bytes: Uint8List.fromList(utf8.encode('{"conflict":true}')),
          ),
        ],
      );
      final store = BundleStore(
        documentsRoot: root,
        loadAsset: loadSeedAsset,
        networkKeyRing: conflicting.keyRing,
        versionedUrl: server.versionedUrl,
      );

      await expectLater(
        store.stage(
          envelope: conflicting.envelope,
          envelopeBytes: conflicting.envelopeBytes,
          client: client,
        ),
        throwsA(isA<BundleStoreException>()),
      );
      expect(server.requests, isEmpty);
      expect((await store.readActive()).version, '0');
    },
  );

  test(
    'crashes immediately before and after pointer replacement recover safely',
    () async {
      for (final checkpoint in BundleActivationCheckpoint.values) {
        final caseRoot = await Directory.systemTemp.createTemp('ce1-crash-');
        addTearDown(() => caseRoot.delete(recursive: true));
        final initial = BundleStore(
          documentsRoot: caseRoot,
          loadAsset: loadSeedAsset,
          networkKeyRing: BundleKeyRing.packagedSeed(),
          versionedUrl: Uri.parse('https://example.test/api/v1'),
        );
        await initial.bootstrap();
        final resource = TestBundleResource(
          logicalId: 'content.update',
          bytes: Uint8List.fromList(utf8.encode('{"version":1}')),
        );
        final update = await TestSignedBundle.create(
          version: '1',
          resources: [resource],
        );
        final server = await LoopbackBundleServer.start();
        addTearDown(server.close);
        server.resources.addAll(update.resources);
        final crashing = BundleStore(
          documentsRoot: caseRoot,
          loadAsset: loadSeedAsset,
          networkKeyRing: update.keyRing,
          versionedUrl: server.versionedUrl,
          faults: BundleStoreFaults(
            activationCheckpoint: (value) {
              if (value == checkpoint) throw const FileSystemException('crash');
            },
          ),
        );
        final staged = await crashing.stage(
          envelope: update.envelope,
          envelopeBytes: update.envelopeBytes,
          client: BundleClient(dio: Dio(), versionedUrl: server.versionedUrl),
        );

        await expectLater(
          crashing.activate(staged),
          throwsA(isA<FileSystemException>()),
        );
        final recovered = await BundleStore(
          documentsRoot: caseRoot,
          loadAsset: loadSeedAsset,
          networkKeyRing: update.keyRing,
          versionedUrl: server.versionedUrl,
        ).recover();

        expect(recovered.version, '1');
        expect(recovered.entries.single.logicalId, 'content.update');
        expect(
          Directory(
            '${caseRoot.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}staging${Platform.pathSeparator}1',
          ).existsSync(),
          isFalse,
        );
      }
    },
  );
}
