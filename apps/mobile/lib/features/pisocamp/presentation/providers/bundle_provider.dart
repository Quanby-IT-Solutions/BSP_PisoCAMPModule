import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/features/pisocamp/data/active_currency_catalog_repository.dart';
import 'package:mobile/features/pisocamp/data/bundle_client.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/data/bundle_sync_controller.dart';
import 'package:path_provider/path_provider.dart';

final bundleNetworkKeyRingProvider = Provider<BundleKeyRing>(
  (ref) => BundleKeyRing.forCurrentBuild(),
);

final bundleVersionedUrlProvider = Provider<Uri>(
  (ref) => Uri.parse(ApiConstants.versionedUrl),
);

final bundleDocumentsRootProvider = FutureProvider<Directory>((ref) {
  return getApplicationDocumentsDirectory();
});

final bundleAssetLoaderProvider = Provider<BundleAssetLoader?>((ref) => null);

final bundleClientProvider = Provider<BundleClient>((ref) {
  final client = BundleClient(
    dio: Dio(),
    versionedUrl: ref.watch(bundleVersionedUrlProvider),
  );
  ref.onDispose(client.close);
  return client;
});

final bundleStoreProvider = FutureProvider<BundleStore>((ref) async {
  final store = BundleStore(
    documentsRoot: await ref.watch(bundleDocumentsRootProvider.future),
    loadAsset: ref.watch(bundleAssetLoaderProvider),
    networkKeyRing: ref.watch(bundleNetworkKeyRingProvider),
    versionedUrl: ref.watch(bundleVersionedUrlProvider),
  );
  await store.recover();
  return store;
});

final activeCurrencyCatalogRepositoryProvider =
    FutureProvider<ActiveCurrencyCatalogRepository>((ref) async {
      return ActiveCurrencyCatalogRepository(
        await ref.watch(bundleStoreProvider.future),
      );
    });

typedef ActiveCurrencyCatalogRead = Future<ActiveCurrencyCatalog> Function();

final class ActiveCatalogPublicationReconciler {
  const ActiveCatalogPublicationReconciler();

  static final RegExp _canonicalVersion = RegExp(r'^(?:0|[1-9][0-9]*)$');

  bool shouldPublish({
    required String lastVersion,
    required String lastManifestDigest,
    required String candidateVersion,
    required String candidateManifestDigest,
  }) {
    if (!_canonicalVersion.hasMatch(lastVersion) ||
        !_canonicalVersion.hasMatch(candidateVersion)) {
      throw const BundleStoreException('active_catalog_invariant_failed');
    }
    final comparison = BigInt.parse(
      candidateVersion,
    ).compareTo(BigInt.parse(lastVersion));
    if (comparison < 0) return false;
    if (comparison > 0) return true;
    if (candidateManifestDigest == lastManifestDigest) return false;
    throw const BundleStoreException('active_catalog_invariant_failed');
  }
}

final activeCurrencyCatalogReadProvider =
    FutureProvider<ActiveCurrencyCatalogRead>((ref) async {
      final repository = await ref.watch(
        activeCurrencyCatalogRepositoryProvider.future,
      );
      return repository.openSnapshot;
    });

final activeCurrencyCatalogProvider = StreamProvider<ActiveCurrencyCatalog>((
  ref,
) async* {
  const reconciler = ActiveCatalogPublicationReconciler();
  final controller = await ref.watch(bundleSyncControllerProvider.future);
  final readActive = await ref.watch(activeCurrencyCatalogReadProvider.future);
  final queued = StreamController<ActiveCurrencyCatalog>();
  final subscription = controller.activeCatalogs.listen(
    queued.add,
    onError: queued.addError,
    onDone: queued.close,
  );
  ref.onDispose(() => unawaited(subscription.cancel()));
  try {
    final initial = await readActive();
    var lastVersion = initial.version;
    var lastManifestDigest = initial.manifestDigest;
    yield initial;
    await for (final activated in queued.stream) {
      if (!reconciler.shouldPublish(
        lastVersion: lastVersion,
        lastManifestDigest: lastManifestDigest,
        candidateVersion: activated.version,
        candidateManifestDigest: activated.manifestDigest,
      )) {
        continue;
      }
      lastVersion = activated.version;
      lastManifestDigest = activated.manifestDigest;
      yield activated;
    }
  } finally {
    await subscription.cancel();
    if (!queued.isClosed) await queued.close();
  }
});

final bundleSyncControllerProvider = FutureProvider<BundleSyncController>((
  ref,
) async {
  final controller = BundleSyncController(
    store: await ref.watch(bundleStoreProvider.future),
    client: ref.watch(bundleClientProvider),
    networkKeyRing: ref.watch(bundleNetworkKeyRingProvider),
  );
  ref.onDispose(() => unawaited(controller.dispose()));
  return controller;
});
