import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/ar_downloads.dart';
import 'package:mobile/features/pisocamp/data/bundle_client.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/presentation/screens/ar_downloads_screen.dart';

BundleManifestEntry _entry(String logicalId, int length) =>
    BundleManifestEntry.forTest(
      logicalId: logicalId,
      kind: BundleEntryKind.model,
      mediaType: 'model/gltf-binary',
      bytes: Uint8List.fromList(List<int>.filled(length, 4)),
      delivery: BundleEntryDelivery.onDemand,
    );

class _FakeStore implements OnDemandObjectStore {
  final Set<String> present = <String>{};
  final Set<String> refuse = <String>{};

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
    if (refuse.contains(entry.sha256)) {
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
  late _FakeStore store;
  late BundleManifestEntry coinAsset;
  late BundleManifestEntry noteAsset;
  late ArDownloadManager manager;

  setUp(() {
    store = _FakeStore();
    coinAsset = _entry('asset.coin.model', 500);
    noteAsset = _entry('asset.note.model', 300);
    manager = ArDownloadManager(
      store: store,
      client: BundleClient(
        dio: Dio(),
        versionedUrl: Uri.parse('https://example.test/api/v1'),
      ),
      bundleVersion: '7',
      items: <ArDownloadItem>[
        ArDownloadItem(
          logicalId: 'content.coin',
          title: 'The 20-piso coin',
          entries: <BundleManifestEntry>[coinAsset],
          status: ArDownloadStatus.absent,
          receivedBytes: 0,
          totalBytes: 500,
        ),
        ArDownloadItem(
          logicalId: 'content.note',
          title: 'The 1000-piso note',
          entries: <BundleManifestEntry>[noteAsset],
          status: ArDownloadStatus.absent,
          receivedBytes: 0,
          totalBytes: 300,
        ),
      ],
    );
  });

  tearDown(() async => manager.dispose());

  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(home: ArDownloadsScreen(manager: manager)),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('offers each experience and all of them together', (tester) async {
    await pumpScreen(tester);

    expect(find.text('The 20-piso coin'), findsOneWidget);
    expect(find.text('The 1000-piso note'), findsOneWidget);
    expect(find.text('Download all (2)'), findsOneWidget);
    expect(find.text('Not downloaded'), findsNWidgets(2));
  });

  testWidgets('downloads one experience without touching the other', (tester) async {
    await pumpScreen(tester);

    await tester.tap(find.widgetWithText(OutlinedButton, 'Download').first);
    await tester.pumpAndSettle();

    // Somebody on a metered connection asked for one coin, and got one coin.
    expect(store.present, <String>{coinAsset.sha256});
    expect(find.text('Downloaded'), findsOneWidget);
    expect(find.text('Not downloaded'), findsOneWidget);
    expect(find.text('Download all (1)'), findsOneWidget);
  });

  testWidgets('downloads everything on request', (tester) async {
    await pumpScreen(tester);

    await tester.tap(find.text('Download all (2)'));
    await tester.pumpAndSettle();

    expect(store.present, hasLength(2));
    expect(find.text('Everything is downloaded'), findsOneWidget);
    // And with nothing left to fetch, the button stops inviting a tap.
    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNull);
  });

  testWidgets('an interrupted download offers to carry on, and says what happened', (
    tester,
  ) async {
    store.refuse.add(coinAsset.sha256);
    await pumpScreen(tester);

    await tester.tap(find.widgetWithText(OutlinedButton, 'Download').first);
    await tester.pumpAndSettle();

    expect(find.text('Partly downloaded'), findsOneWidget);
    // The word somebody needs is "Resume", and the message says the bytes are
    // not lost rather than showing a transport code.
    expect(find.widgetWithText(OutlinedButton, 'Resume'), findsOneWidget);
    expect(find.textContaining('What arrived is kept'), findsOneWidget);

    store.refuse.clear();
    await tester.tap(find.widgetWithText(OutlinedButton, 'Resume'));
    await tester.pumpAndSettle();

    expect(find.text('Downloaded'), findsOneWidget);
  });

  testWidgets('says what is already here without downloading it again', (tester) async {
    store.present.add(coinAsset.sha256);

    await pumpScreen(tester);

    expect(find.text('Downloaded'), findsOneWidget);
    expect(find.text('Download all (1)'), findsOneWidget);
  });

  testWidgets('every control is 48dp and reachable at 320 px', (tester) async {
    tester.view.physicalSize = const Size(320, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await pumpScreen(tester);

    for (final label in <String>['Download all (2)', 'Download']) {
      final control = find.widgetWithText(SizedBox, label).first;
      await tester.scrollUntilVisible(control, 80);
      expect(
        tester.getSize(control).height,
        greaterThanOrEqualTo(48),
        reason: label,
      );
    }
    // And nothing runs off the side of a small phone.
    expect(tester.takeException(), isNull);
  });
}
