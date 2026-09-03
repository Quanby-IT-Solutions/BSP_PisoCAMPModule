import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/ar_downloads.dart';
import 'package:mobile/features/pisocamp/data/bundle_client.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';

Uint8List _bytes(int length, [int fill = 3]) =>
    Uint8List.fromList(List<int>.filled(length, fill));

BundleManifestEntry _entry(String logicalId, Uint8List bytes) =>
    BundleManifestEntry.forTest(
      logicalId: logicalId,
      kind: BundleEntryKind.model,
      mediaType: 'model/gltf-binary',
      bytes: bytes,
      delivery: BundleEntryDelivery.onDemand,
    );

/// A store that records what was asked for and can be told to fail part way.
class _RecordingStore implements OnDemandObjectStore {
  final Set<String> present = <String>{};
  final List<String> fetched = <String>[];

  /// Digest that fails the first time it is asked for, as an interruption.
  String? failOnce;

  @override
  Future<bool> hasVerifiedObject(BundleManifestEntry entry) async =>
      present.contains(entry.sha256);

  @override
  Future<void> fetchOnDemand({
    required BundleManifestEntry entry,
    required String version,
    required BundleClient client,
    BundleCancellationToken? cancellation,
    void Function(int received, int total)? onBytes,
  }) async {
    fetched.add(entry.logicalId);
    if (failOnce == entry.sha256) {
      failOnce = null;
      // Half of it arrived, and the store keeps it.
      onBytes?.call(entry.byteLength ~/ 2, entry.byteLength);
      throw const BundleStoreException('resource_transport_failed', transient: true);
    }
    onBytes?.call(entry.byteLength, entry.byteLength);
    present.add(entry.sha256);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not used here');
}

void main() {
  late _RecordingStore store;
  late ArDownloadManager manager;
  late BundleManifestEntry model;
  late BundleManifestEntry audio;

  ArDownloadManager buildManager() {
    model = _entry('asset.item-one.model', _bytes(600));
    audio = _entry('asset.item-one.audio', _bytes(400, 5));
    return ArDownloadManager(
      store: store,
      // Never reached: the fake store answers every fetch itself.
      client: BundleClient(
        dio: Dio(),
        versionedUrl: Uri.parse('https://example.test/api/v1'),
      ),
      bundleVersion: '7',
      items: <ArDownloadItem>[
        ArDownloadItem(
          logicalId: 'content.item-one',
          title: 'The 20-piso coin',
          entries: <BundleManifestEntry>[model, audio],
          status: ArDownloadStatus.absent,
          receivedBytes: 0,
          totalBytes: 1000,
        ),
      ],
    );
  }

  setUp(() {
    store = _RecordingStore();
    manager = buildManager();
  });

  tearDown(() async => manager.dispose());

  group('AR-005 downloading an experience for offline use', () {
    test('reports progress as the assets arrive, and readiness at the end', () async {
      final seen = <int>[];
      manager.changes.listen((items) => seen.add(items.single.receivedBytes));

      await manager.download('content.item-one');
      await Future<void>.delayed(Duration.zero);

      expect(manager.items.single.status, ArDownloadStatus.ready);
      expect(manager.items.single.progress, 1);
      // Progress that only ever shows 0% and 100% tells somebody on a slow
      // connection nothing about whether it is working.
      expect(seen, contains(600));
      expect(store.fetched, <String>['asset.item-one.model', 'asset.item-one.audio']);
    });

    test('an experience is ready only when every asset is here', () async {
      store.present.add(model.sha256);

      await manager.refresh();

      // The model without its narration is not an experience anybody can use,
      // and calling it ready would be a promise the AR screen cannot keep.
      expect(manager.items.single.status, ArDownloadStatus.interrupted);
      expect(manager.items.single.receivedBytes, 600);
    });

    test('reports what is already downloaded rather than assuming', () async {
      store.present.addAll(<String>[model.sha256, audio.sha256]);

      await manager.refresh();

      expect(manager.items.single.status, ArDownloadStatus.ready);
      expect(store.fetched, isEmpty);
    });

    test('skips what is already here when downloading everything', () async {
      store.present.add(model.sha256);
      await manager.refresh();

      await manager.downloadAll();

      // Re-downloading a verified object costs somebody their data for a file
      // they already have.
      expect(store.fetched, <String>['asset.item-one.audio']);
      expect(manager.items.single.status, ArDownloadStatus.ready);
    });
  });

  group('RF-6 an interrupted download', () {
    test('keeps what arrived and says the download is unfinished', () async {
      store.failOnce = model.sha256;

      await expectLater(
        manager.download('content.item-one'),
        throwsA(isA<BundleStoreException>()),
      );

      expect(manager.items.single.status, ArDownloadStatus.interrupted);
      // The narration was never started: the run stops at the failure rather
      // than carrying on and leaving a gap in the middle.
      expect(store.fetched, <String>['asset.item-one.model']);
    });

    test('carries on from where it stopped when asked again', () async {
      store.failOnce = model.sha256;
      await expectLater(
        manager.download('content.item-one'),
        throwsA(isA<BundleStoreException>()),
      );
      store.fetched.clear();

      await manager.download('content.item-one');

      expect(manager.items.single.status, ArDownloadStatus.ready);
      expect(store.fetched, <String>['asset.item-one.model', 'asset.item-one.audio']);
    });
  });
}
