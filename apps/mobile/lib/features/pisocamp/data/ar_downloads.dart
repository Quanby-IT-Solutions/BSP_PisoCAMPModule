import 'dart:async';

import 'bundle_client.dart';
import 'bundle_protocol.dart';
import 'bundle_store.dart';

/// Where one AR experience's assets have got to.
enum ArDownloadStatus {
  /// Not on this device. The experience cannot be opened offline.
  absent,

  /// Being fetched now.
  downloading,

  /// Every asset is here and verified.
  ready,

  /// The last attempt did not finish. Whatever arrived is kept, and the next
  /// attempt continues from there (RF-6).
  interrupted,
}

/// One downloadable AR experience, as a screen sees it.
final class ArDownloadItem {
  const ArDownloadItem({
    required this.logicalId,
    required this.title,
    required this.entries,
    required this.status,
    required this.receivedBytes,
    required this.totalBytes,
  });

  final String logicalId;
  final String title;

  /// The on-demand entries this experience needs, in manifest order.
  final List<BundleManifestEntry> entries;

  final ArDownloadStatus status;
  final int receivedBytes;
  final int totalBytes;

  /// 0..1, or null when there is nothing to divide by.
  double? get progress => totalBytes == 0 ? null : receivedBytes / totalBytes;

  ArDownloadItem copyWith({
    ArDownloadStatus? status,
    int? receivedBytes,
  }) => ArDownloadItem(
    logicalId: logicalId,
    title: title,
    entries: entries,
    status: status ?? this.status,
    receivedBytes: receivedBytes ?? this.receivedBytes,
    totalBytes: totalBytes,
  );
}

/// AR-005. Downloading AR experiences for offline use, one at a time or all of
/// them.
///
/// Per-experience rather than per-file, because that is the unit somebody
/// chooses: nobody wants "the animation but not the narration". An experience
/// is only [ArDownloadStatus.ready] once every asset it needs is verified on
/// disk, so a partial download never advertises itself as openable offline.
final class ArDownloadManager {
  ArDownloadManager({
    required OnDemandObjectStore store,
    required BundleClient client,
    required String bundleVersion,
    required List<ArDownloadItem> items,
  }) : _store = store,
       _client = client,
       _bundleVersion = bundleVersion,
       _items = <String, ArDownloadItem>{
         for (final item in items) item.logicalId: item,
       };

  final OnDemandObjectStore _store;
  final BundleClient _client;
  final String _bundleVersion;
  final Map<String, ArDownloadItem> _items;
  final _changes = StreamController<List<ArDownloadItem>>.broadcast();

  Stream<List<ArDownloadItem>> get changes => _changes.stream;

  List<ArDownloadItem> get items => _items.values.toList(growable: false);

  /// Reconciles what the screen shows with what is actually on disk.
  ///
  /// Called before anything is offered, because the honest answer to "is this
  /// downloaded?" is on the file system, not in memory: the app may have been
  /// restarted, or the store cleared, since the last time anybody looked.
  Future<void> refresh() async {
    for (final item in items) {
      var present = 0;
      for (final entry in item.entries) {
        if (await _store.hasVerifiedObject(entry)) present += entry.byteLength;
      }
      _update(
        item.logicalId,
        (current) => current.copyWith(
          receivedBytes: present,
          status: present == current.totalBytes
              ? ArDownloadStatus.ready
              : present == 0
              ? ArDownloadStatus.absent
              : ArDownloadStatus.interrupted,
        ),
      );
    }
  }

  /// Downloads one experience. Safe to call again after an interruption.
  Future<void> download(
    String logicalId, {
    BundleCancellationToken? cancellation,
  }) async {
    final item = _items[logicalId];
    if (item == null) return;
    _update(logicalId, (current) => current.copyWith(status: ArDownloadStatus.downloading));

    // Counted from the assets already present, so an interrupted download
    // resumes its progress bar rather than restarting it.
    var settled = 0;
    for (final entry in item.entries) {
      if (await _store.hasVerifiedObject(entry)) settled += entry.byteLength;
    }
    _update(logicalId, (current) => current.copyWith(receivedBytes: settled));

    try {
      for (final entry in item.entries) {
        if (await _store.hasVerifiedObject(entry)) continue;
        final base = settled;
        await _store.fetchOnDemand(
          entry: entry,
          version: _bundleVersion,
          client: _client,
          cancellation: cancellation,
          onBytes: (received, _) => _update(
            logicalId,
            (current) => current.copyWith(receivedBytes: base + received),
          ),
        );
        settled += entry.byteLength;
        _update(logicalId, (current) => current.copyWith(receivedBytes: settled));
      }
      _update(logicalId, (current) => current.copyWith(status: ArDownloadStatus.ready));
    } on Object {
      // Whatever arrived stays on disk. The store keeps the part file and its
      // journal, so trying again continues rather than starting over.
      _update(
        logicalId,
        (current) => current.copyWith(status: ArDownloadStatus.interrupted),
      );
      rethrow;
    }
  }

  /// Downloads everything that is not already here.
  ///
  /// One at a time and in order, so a slow connection makes visible progress on
  /// one experience rather than invisible progress on all of them. A failure
  /// stops the run and leaves the rest untouched: the person asked for these,
  /// and they can ask again.
  Future<void> downloadAll({BundleCancellationToken? cancellation}) async {
    for (final item in items) {
      if (item.status == ArDownloadStatus.ready) continue;
      await download(item.logicalId, cancellation: cancellation);
    }
  }

  void _update(String logicalId, ArDownloadItem Function(ArDownloadItem) change) {
    final current = _items[logicalId];
    if (current == null) return;
    _items[logicalId] = change(current);
    if (!_changes.isClosed) _changes.add(items);
  }

  Future<void> dispose() async {
    if (!_changes.isClosed) await _changes.close();
  }
}
