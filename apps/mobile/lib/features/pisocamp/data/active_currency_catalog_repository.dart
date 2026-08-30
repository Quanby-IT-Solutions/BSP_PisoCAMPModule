import 'bundle_store.dart';

/// Opens immutable catalog snapshots. Existing callers retain their pinned
/// manifest and object identities when a later sync activates another bundle.
final class ActiveCurrencyCatalogRepository {
  const ActiveCurrencyCatalogRepository(this._store);

  final BundleStore _store;

  Future<ActiveCurrencyCatalog> openSnapshot() => _store.readActive();
}
