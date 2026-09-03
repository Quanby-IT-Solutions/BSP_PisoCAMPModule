import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:path/path.dart' as paths;

import 'bundle_client.dart';
import 'bundle_protocol.dart';

typedef BundleAssetLoader = Future<Uint8List> Function(String assetPath);

final class BundleStoreException implements Exception {
  const BundleStoreException(this.code, {this.transient = false});

  final String code;
  final bool transient;

  @override
  String toString() => 'BundleStoreException($code)';
}

enum BundleActivationCheckpoint { beforePointerReplace, afterPointerReplace }

final class BundleStoreFaults {
  const BundleStoreFaults({
    this.activationCheckpoint,
    this.beforeObjectWrite,
    this.beforeResumeJournalWrite,
    this.afterEntityDeleteFailure,
  });

  final void Function(BundleActivationCheckpoint checkpoint)?
  activationCheckpoint;
  final void Function()? beforeObjectWrite;
  final void Function()? beforeResumeJournalWrite;
  final void Function(int attempt)? afterEntityDeleteFailure;
}

/// The part of an active snapshot a reader needs: what is in it, and the bytes
/// of one entry.
///
/// Narrow on purpose. A caller that only reads one resource has no business
/// holding a whole store, and this is the seam that lets one be tested without
/// a bundle on disk.
abstract interface class ActiveCurrencyCatalogReader {
  List<BundleManifestEntry> get entries;

  /// Throws if the bytes do not match the signed manifest's digest.
  Future<Uint8List> readBytes(BundleManifestEntry entry);
}

final class ActiveCurrencyCatalog implements ActiveCurrencyCatalogReader {
  ActiveCurrencyCatalog._({
    required this.manifest,
    required this.manifestDigest,
    required Directory objectDirectory,
  }) : _objectDirectory = objectDirectory;

  final BundleManifest manifest;
  final String manifestDigest;
  final Directory _objectDirectory;

  String get version => manifest.bundleVersion;

  @override
  List<BundleManifestEntry> get entries => manifest.entries;

  @override
  Future<Uint8List> readBytes(BundleManifestEntry entry) async {
    if (!entries.any(
      (candidate) =>
          candidate.logicalId == entry.logicalId &&
          candidate.sha256 == entry.sha256,
    )) {
      throw const BundleStoreException('entry_not_in_snapshot');
    }
    final bytes = await File(
      paths.join(_objectDirectory.path, '${entry.sha256}.blob'),
    ).readAsBytes();
    await entry.validateResource(bytes);
    return Uint8List.fromList(bytes);
  }
}

/// Whether an on-demand entry's bytes are already on this device.
///
/// Exposed on the catalogue because that is what a screen holds: asking "can I
/// open this offline?" should not require reaching for the store.
extension ActiveCatalogOnDemand on ActiveCurrencyCatalog {
  bool carries(BundleManifestEntry entry) => entries.any(
    (candidate) =>
        candidate.logicalId == entry.logicalId &&
        candidate.sha256 == entry.sha256,
  );
}

final class StagedBundle {
  const StagedBundle._({
    required this.version,
    required this.manifestDigest,
    required this.envelopeBytes,
  });

  final String version;
  final String manifestDigest;
  final Uint8List envelopeBytes;
}

/// What a downloader needs from the store: whether an object is already here,
/// and a way to fetch one that is not.
///
/// Narrow on purpose. A screen that downloads AR assets has no business holding
/// the whole store, and this is the seam that lets one be tested without a
/// bundle on disk.
abstract interface class OnDemandObjectStore {
  Future<bool> hasVerifiedObject(BundleManifestEntry entry);

  Future<void> fetchOnDemand({
    required BundleManifestEntry entry,
    required String version,
    required BundleClient client,
    BundleCancellationToken? cancellation,
    void Function(int received, int total)? onBytes,
  });
}

/// Content-addressed, crash-recoverable storage rooted below app documents.
final class BundleStore implements OnDemandObjectStore {
  BundleStore({
    required Directory documentsRoot,
    BundleAssetLoader? loadAsset,
    required BundleKeyRing networkKeyRing,
    required Uri versionedUrl,
    this.faults = const BundleStoreFaults(),
  }) : _documentsRoot = Directory(paths.absolute(documentsRoot.path)),
       _loadAsset = loadAsset ?? _loadRootBundleAsset,
       _networkKeyRing = networkKeyRing,
       _versionedUrl = normalizeBundleVersionedUrl(versionedUrl);

  static const _seedEnvelopeAsset =
      'assets/pisocamp/bundle/seed/manifest.envelope.json';
  static const _seedIndexAsset =
      'assets/pisocamp/bundle/seed/resource-index.json';
  static final _digestPattern = RegExp(r'^[a-f0-9]{64}$');
  static final _versionPattern = RegExp(r'^(?:0|[1-9][0-9]*)$');
  static final _strongEtagPattern = RegExp(r'^"[^"\r\n]{1,200}"$');

  final Directory _documentsRoot;
  final BundleAssetLoader _loadAsset;
  final BundleKeyRing _networkKeyRing;
  final Uri _versionedUrl;
  final BundleStoreFaults faults;

  Directory get _bundleRoot =>
      Directory(paths.join(_documentsRoot.path, 'pisocamp', 'bundles'));
  Directory get _objects => Directory(paths.join(_bundleRoot.path, 'objects'));
  Directory get _staging => Directory(paths.join(_bundleRoot.path, 'staging'));
  Directory get _ready => Directory(paths.join(_bundleRoot.path, 'ready'));
  File get _activePointer => File(paths.join(_bundleRoot.path, 'active.json'));
  File get _previousPointer =>
      File(paths.join(_bundleRoot.path, 'previous.json'));
  File get _highWaterFile =>
      File(paths.join(_bundleRoot.path, 'high-water.json'));

  Future<ActiveCurrencyCatalog> bootstrap() async {
    await _ensureLayout();
    try {
      return await readActive();
    } on Object {
      return _installSeed();
    }
  }

  Future<ActiveCurrencyCatalog> recover() async {
    await _ensureLayout();
    await _removePointerTemps();
    await _cleanStaging();

    final verified = await _verifiedReadyBundles();
    final highWater = await _readHighWaterOrNull();
    _VerifiedBundle? selected;
    if (highWater != null) {
      for (final bundle in verified) {
        if (bundle.catalog.version == highWater.version &&
            bundle.catalog.manifestDigest == highWater.manifestDigest) {
          selected = bundle;
        }
      }
    } else if (verified.isNotEmpty) {
      selected = verified.last;
      await _writeHighWater(
        version: selected.catalog.version,
        digest: selected.catalog.manifestDigest,
      );
    }

    if (selected == null) {
      return _installSeed(preserveNewerHighWater: highWater != null);
    }
    await _atomicJsonWrite(
      _activePointer,
      _pointerJson(selected.catalog.version, selected.catalog.manifestDigest),
    );
    final completedStage = _stagingDirectory(selected.catalog.version);
    if (await completedStage.exists()) {
      await completedStage.delete(recursive: true);
    }
    return selected.catalog;
  }

  Future<ActiveCurrencyCatalog> readActive() async {
    await _ensureLayout();
    final pointer = await _readPointer(_activePointer);
    if (pointer == null) {
      throw const BundleStoreException('active_pointer_invalid');
    }
    final readyFile = _readyManifest(pointer.version);
    if (!await readyFile.exists()) {
      throw const BundleStoreException('active_ready_missing');
    }
    final catalog = await _verifyEnvelopeAndObjects(
      await readyFile.readAsBytes(),
      expectedVersion: pointer.version,
      expectedDigest: pointer.digest,
    );
    return catalog;
  }

  @override
  Future<bool> hasVerifiedObject(BundleManifestEntry entry) async {
    if (!_digestPattern.hasMatch(entry.sha256)) return false;
    final object = _objectFile(entry.sha256);
    if (!await object.exists()) return false;
    try {
      final stat = await object.stat();
      if (stat.type != FileSystemEntityType.file ||
          stat.size != entry.byteLength) {
        return false;
      }
      await entry.validateResource(await object.readAsBytes());
      return true;
    } on Object {
      return false;
    }
  }

  Future<StagedBundle> stage({
    required BundleEnvelope envelope,
    required Uint8List envelopeBytes,
    required BundleClient client,
    BundleCancellationToken? cancellation,
    void Function(int completed, int total)? onProgress,
  }) async {
    await _ensureLayout();
    cancellation?.throwIfCancelled();
    if (client.versionedUrl != _versionedUrl) {
      throw const BundleStoreException('bundle_origin_mismatch');
    }
    final reparsed = await BundleEnvelope.parseAndVerify(
      envelopeBytes,
      _networkKeyRing,
    );
    if (reparsed.payloadSha256 != envelope.payloadSha256 ||
        reparsed.manifest.bundleVersion != envelope.manifest.bundleVersion) {
      throw const BundleStoreException('envelope_identity_mismatch');
    }
    final highWater = await _readHighWaterOrNull();
    if (highWater != null) {
      try {
        highWater.evaluate(
          version: envelope.manifest.bundleVersion,
          manifestDigest: envelope.payloadSha256,
        );
      } on BundleValidationException {
        throw const BundleStoreException('bundle_version_rejected');
      }
    }

    final version = envelope.manifest.bundleVersion;
    final stageDirectory = _stagingDirectory(version);
    final downloads = Directory(paths.join(stageDirectory.path, 'downloads'));
    await downloads.create(recursive: true);
    await _atomicBytesWrite(
      File(paths.join(stageDirectory.path, 'manifest.envelope.json')),
      envelopeBytes,
    );

    final coreEntries = envelope.manifest.entries
        .where((entry) => entry.delivery == BundleEntryDelivery.core)
        .toList(growable: false);
    final missing = <BundleManifestEntry>[];
    final seen = <String>{};
    for (final entry in coreEntries) {
      if (seen.add(entry.sha256) && !await hasVerifiedObject(entry)) {
        missing.add(entry);
      }
    }
    var completed = coreEntries.length - missing.length;
    onProgress?.call(completed, coreEntries.length);
    await _boundedForEach(missing, client.retryPolicy.maximumConcurrency, (
      entry,
    ) async {
      cancellation?.throwIfCancelled();
      await _downloadObjectWithRetry(
        entry: entry,
        version: version,
        client: client,
        cancellation: cancellation,
      );
      completed += 1;
      onProgress?.call(completed, coreEntries.length);
    });

    for (final entry in coreEntries) {
      if (!await hasVerifiedObject(entry)) {
        throw const BundleStoreException('resource_verification_failed');
      }
    }
    final readyManifest = _readyManifest(version);
    await readyManifest.parent.create(recursive: true);
    await _atomicBytesWrite(readyManifest, envelopeBytes);
    return StagedBundle._(
      version: version,
      manifestDigest: envelope.payloadSha256,
      envelopeBytes: Uint8List.fromList(envelopeBytes),
    );
  }

  /// AR-005. Fetches one on-demand object into the content-addressed store.
  ///
  /// The same download path the core objects use, so an AR asset resumes after
  /// an interruption exactly as they do (RF-6): the part file and its journal
  /// survive, and the next attempt continues from the byte it reached.
  ///
  /// Nothing is installed until the digest matches, so a half-downloaded
  /// experience is never one a device will try to open.
  @override
  Future<void> fetchOnDemand({
    required BundleManifestEntry entry,
    required String version,
    required BundleClient client,
    BundleCancellationToken? cancellation,
    void Function(int received, int total)? onBytes,
  }) async {
    if (entry.delivery != BundleEntryDelivery.onDemand) {
      // Core objects arrive with the bundle. Fetching one here would be a
      // second, unmanaged copy of something the sync already owns.
      throw const BundleStoreException('entry_not_on_demand');
    }
    await _ensureLayout();
    if (await hasVerifiedObject(entry)) {
      onBytes?.call(entry.byteLength, entry.byteLength);
      return;
    }
    await Directory(
      paths.join(_stagingDirectory(version).path, 'downloads'),
    ).create(recursive: true);
    await _downloadObjectWithRetry(
      entry: entry,
      version: version,
      client: client,
      cancellation: cancellation,
      onBytes: onBytes,
    );
  }

  Future<ActiveCurrencyCatalog> activate(StagedBundle staged) async {
    await _ensureLayout();
    final readyFile = _readyManifest(staged.version);
    final catalog = await _verifyEnvelopeAndObjects(
      await readyFile.readAsBytes(),
      expectedVersion: staged.version,
      expectedDigest: staged.manifestDigest,
    );
    final highWater = await _readHighWaterOrNull();
    if (highWater != null) {
      try {
        highWater.evaluate(
          version: catalog.version,
          manifestDigest: catalog.manifestDigest,
        );
      } on BundleValidationException {
        throw const BundleStoreException('bundle_version_rejected');
      }
    }
    await _writeHighWater(
      version: catalog.version,
      digest: catalog.manifestDigest,
    );

    final oldPointer = await _readPointer(_activePointer);
    if (oldPointer != null) {
      await _atomicJsonWrite(
        _previousPointer,
        _pointerJson(oldPointer.version, oldPointer.digest),
      );
    }
    final temporary = File('${_activePointer.path}.tmp');
    await _writeFlushed(
      temporary,
      utf8.encode(
        jsonEncode(_pointerJson(catalog.version, catalog.manifestDigest)),
      ),
    );
    faults.activationCheckpoint?.call(
      BundleActivationCheckpoint.beforePointerReplace,
    );
    await temporary.rename(_activePointer.path);
    faults.activationCheckpoint?.call(
      BundleActivationCheckpoint.afterPointerReplace,
    );
    final stageDirectory = _stagingDirectory(staged.version);
    if (await stageDirectory.exists()) {
      await stageDirectory.delete(recursive: true);
    }
    return catalog;
  }

  Future<ActiveCurrencyCatalog> _installSeed({
    bool preserveNewerHighWater = false,
  }) async {
    final envelopeBytes = await _loadAsset(_seedEnvelopeAsset);
    final envelope = await BundleEnvelope.parseAndVerify(
      envelopeBytes,
      BundleKeyRing.packagedSeed(),
    );
    if (envelope.manifest.bundleVersion != '0') {
      throw const BundleStoreException('seed_version_invalid');
    }
    final indexBytes = await _loadAsset(_seedIndexAsset);
    final index = decodeStrictJsonObject(
      indexBytes,
      maximumBytes: 65536,
      context: 'packaged resource index',
    );
    for (final item in index.entries) {
      if (!_digestPattern.hasMatch(item.key) ||
          item.value is! String ||
          !_isRegisteredSeedAsset(item.key, item.value! as String)) {
        throw const BundleStoreException('seed_index_invalid');
      }
    }
    for (final entry in envelope.manifest.entries.where(
      (entry) => entry.delivery == BundleEntryDelivery.core,
    )) {
      final assetPath = index[entry.sha256];
      if (assetPath is! String) {
        throw const BundleStoreException('seed_index_entry_missing');
      }
      if (await hasVerifiedObject(entry)) continue;
      final bytes = await _loadAsset(assetPath);
      try {
        await entry.validateResource(bytes);
      } on BundleValidationException {
        throw const BundleStoreException('seed_resource_invalid');
      }
      await _installObject(entry, bytes);
    }
    final readyFile = _readyManifest('0');
    await readyFile.parent.create(recursive: true);
    await _atomicBytesWrite(readyFile, envelopeBytes);
    final existingHighWater = await _readHighWaterOrNull();
    if (!preserveNewerHighWater &&
        (existingHighWater == null || existingHighWater.version == '0')) {
      await _writeHighWater(version: '0', digest: envelope.payloadSha256);
    }
    await _atomicJsonWrite(
      _activePointer,
      _pointerJson('0', envelope.payloadSha256),
    );
    return _verifyEnvelopeAndObjects(
      envelopeBytes,
      expectedVersion: '0',
      expectedDigest: envelope.payloadSha256,
    );
  }

  Future<void> _downloadObjectWithRetry({
    required BundleManifestEntry entry,
    required String version,
    required BundleClient client,
    BundleCancellationToken? cancellation,
    void Function(int received, int total)? onBytes,
  }) async {
    for (
      var attempt = 1;
      attempt <= client.retryPolicy.maximumAttempts;
      attempt++
    ) {
      cancellation?.throwIfCancelled();
      try {
        await _downloadObject(
          entry: entry,
          version: version,
          client: client,
          cancellation: cancellation,
          onBytes: onBytes,
        );
        return;
      } on BundleStoreException catch (error) {
        if (!error.transient || attempt == client.retryPolicy.maximumAttempts) {
          rethrow;
        }
        await client.waitBeforeRetry(attempt, cancellation);
      }
    }
  }

  Future<void> _downloadObject({
    required BundleManifestEntry entry,
    required String version,
    required BundleClient client,
    BundleCancellationToken? cancellation,
    void Function(int received, int total)? onBytes,
  }) async {
    final downloadDirectory = Directory(
      paths.join(_stagingDirectory(version).path, 'downloads'),
    );
    final part = File(
      paths.join(downloadDirectory.path, '${entry.sha256}.part'),
    );
    final journal = File(
      paths.join(downloadDirectory.path, '${entry.sha256}.resume.json'),
    );
    final url = client.resourceUrl(entry.sha256);
    var resume = await _readResume(journal, part, url: url, entry: entry);
    BundleResourceHttpResponse response;
    try {
      response = await client.openResource(
        digest: entry.sha256,
        start: resume?.downloadedLength,
        ifRange: resume?.etag,
        cancellation: cancellation,
      );
    } on BundleClientException catch (error) {
      throw BundleStoreException(error.code, transient: error.transient);
    }
    if (resume != null && response.statusCode == 416) {
      final validCompletion =
          response.mediaType == entry.mediaType &&
          response.contentRange == 'bytes */${entry.byteLength}' &&
          resume.downloadedLength == entry.byteLength &&
          response.etag == resume.etag &&
          await _verifyPart(part, entry);
      await response.discard();
      if (validCompletion) {
        await _moveVerifiedPart(part, journal, entry);
        return;
      }
      await _discardPartial(part, journal);
      throw const BundleStoreException('range_not_satisfiable');
    }

    if (resume != null) {
      final validResume =
          response.statusCode == 206 &&
          response.mediaType == entry.mediaType &&
          response.etag == resume.etag &&
          _strongEtagPattern.hasMatch(response.etag ?? '') &&
          _validContentRange(
            response.contentRange,
            start: resume.downloadedLength,
            total: entry.byteLength,
            contentLength: response.contentLength,
          );
      if (!validResume) {
        await response.discard();
        await _discardPartial(part, journal);
        resume = null;
        if (response.statusCode != 200) {
          try {
            response = await client.openResource(
              digest: entry.sha256,
              cancellation: cancellation,
            );
          } on BundleClientException catch (error) {
            throw BundleStoreException(error.code, transient: error.transient);
          }
        }
      }
    }

    if (resume == null &&
        (response.statusCode != 200 || response.mediaType != entry.mediaType)) {
      await response.discard();
      if (response.mediaType != entry.mediaType) {
        throw const BundleStoreException('resource_mime_mismatch');
      }
      throw const BundleStoreException('resource_status_invalid');
    }
    final append = resume != null;
    var downloaded = resume?.downloadedLength ?? 0;
    // Reported from what is already on disk, so a resumed download starts its
    // progress bar where the last attempt stopped rather than at zero.
    onBytes?.call(downloaded, entry.byteLength);
    final etag = response.etag;
    final resumable = _strongEtagPattern.hasMatch(etag ?? '');
    if (!append && await part.exists()) await part.delete();
    final sink = part.openWrite(
      mode: append ? FileMode.append : FileMode.write,
    );
    try {
      await for (final chunk in response.stream) {
        cancellation?.throwIfCancelled();
        downloaded += chunk.length;
        if (downloaded > entry.byteLength) {
          throw const BundleStoreException('resource_length_exceeded');
        }
        sink.add(chunk);
        await sink.flush();
        onBytes?.call(downloaded, entry.byteLength);
        if (resumable) {
          faults.beforeResumeJournalWrite?.call();
          await _writeResume(
            journal,
            url: url,
            entry: entry,
            downloadedLength: downloaded,
            etag: etag!,
          );
        }
      }
      await sink.flush();
      await sink.close();
    } on BundleStoreException {
      await _closeSink(sink);
      await _discardPartial(part, journal);
      rethrow;
    } on BundleClientException catch (error) {
      await _closeSink(sink);
      await _retainOnlyValidPartial(part, journal, url: url, entry: entry);
      throw BundleStoreException(error.code, transient: true);
    } on Object {
      await _closeSink(sink);
      await _retainOnlyValidPartial(part, journal, url: url, entry: entry);
      throw const BundleStoreException(
        'resource_transport_failed',
        transient: true,
      );
    }
    if (downloaded != entry.byteLength || !await _verifyPart(part, entry)) {
      await _discardPartial(part, journal);
      throw const BundleStoreException('resource_verification_failed');
    }
    await _moveVerifiedPart(part, journal, entry);
  }

  Future<void> _moveVerifiedPart(
    File part,
    File journal,
    BundleManifestEntry entry,
  ) async {
    final object = _objectFile(entry.sha256);
    if (await hasVerifiedObject(entry)) {
      await _discardPartial(part, journal);
      return;
    }
    faults.beforeObjectWrite?.call();
    await part.rename(object.path);
    if (await journal.exists()) await journal.delete();
  }

  Future<void> _installObject(
    BundleManifestEntry entry,
    Uint8List bytes,
  ) async {
    final object = _objectFile(entry.sha256);
    final temporary = File('${object.path}.tmp');
    faults.beforeObjectWrite?.call();
    await _writeFlushed(temporary, bytes);
    await temporary.rename(object.path);
  }

  Future<ActiveCurrencyCatalog> _verifyEnvelopeAndObjects(
    Uint8List bytes, {
    required String expectedVersion,
    required String expectedDigest,
  }) async {
    if (!_versionPattern.hasMatch(expectedVersion) ||
        !_digestPattern.hasMatch(expectedDigest)) {
      throw const BundleStoreException('ready_identity_invalid');
    }
    final ring = expectedVersion == '0'
        ? BundleKeyRing.packagedSeed()
        : _networkKeyRing;
    BundleEnvelope envelope;
    try {
      envelope = await BundleEnvelope.parseAndVerify(bytes, ring);
    } on Object {
      throw const BundleStoreException('ready_manifest_invalid');
    }
    if (envelope.manifest.bundleVersion != expectedVersion ||
        envelope.payloadSha256 != expectedDigest) {
      throw const BundleStoreException('ready_identity_mismatch');
    }
    for (final entry in envelope.manifest.entries.where(
      (entry) => entry.delivery == BundleEntryDelivery.core,
    )) {
      if (!await hasVerifiedObject(entry)) {
        throw const BundleStoreException('ready_object_invalid');
      }
    }
    return ActiveCurrencyCatalog._(
      manifest: envelope.manifest,
      manifestDigest: envelope.payloadSha256,
      objectDirectory: _objects,
    );
  }

  Future<List<_VerifiedBundle>> _verifiedReadyBundles() async {
    final result = <_VerifiedBundle>[];
    await for (final entity in _ready.list()) {
      if (entity is! Directory) continue;
      final version = paths.basename(entity.path);
      if (!_versionPattern.hasMatch(version)) continue;
      final manifest = File(paths.join(entity.path, 'manifest.envelope.json'));
      if (!await manifest.exists()) continue;
      try {
        final bytes = await manifest.readAsBytes();
        final ring = version == '0'
            ? BundleKeyRing.packagedSeed()
            : _networkKeyRing;
        final envelope = await BundleEnvelope.parseAndVerify(bytes, ring);
        final catalog = await _verifyEnvelopeAndObjects(
          bytes,
          expectedVersion: version,
          expectedDigest: envelope.payloadSha256,
        );
        result.add(_VerifiedBundle(catalog));
      } on Object {
        // Invalid ready state is never selected or exposed.
      }
    }
    result.sort(
      (left, right) => BigInt.parse(
        left.catalog.version,
      ).compareTo(BigInt.parse(right.catalog.version)),
    );
    return result;
  }

  Future<void> _cleanStaging() async {
    await for (final entity in _staging.list()) {
      if (entity is! Directory ||
          !_versionPattern.hasMatch(paths.basename(entity.path)) ||
          !await _validStagingDirectory(entity)) {
        await entity.delete(recursive: true);
      }
    }
  }

  Future<bool> _validStagingDirectory(Directory directory) async {
    try {
      final version = paths.basename(directory.path);
      final manifestFile = File(
        paths.join(directory.path, 'manifest.envelope.json'),
      );
      if (!await manifestFile.exists()) return false;
      final envelope = await BundleEnvelope.parseAndVerify(
        await manifestFile.readAsBytes(),
        _networkKeyRing,
      );
      if (envelope.manifest.bundleVersion != version) return false;
      final entries = {
        for (final entry in envelope.manifest.entries) entry.sha256: entry,
      };
      final downloads = Directory(paths.join(directory.path, 'downloads'));
      if (!await downloads.exists()) return true;
      await for (final entity in downloads.list()) {
        if (entity is! File) return false;
        final name = paths.basename(entity.path);
        final match = RegExp(
          r'^([a-f0-9]{64})\.(part|resume\.json)$',
        ).firstMatch(name);
        if (match == null || !entries.containsKey(match.group(1))) return false;
      }
      for (final digest in entries.keys) {
        final part = File(paths.join(downloads.path, '$digest.part'));
        final journal = File(paths.join(downloads.path, '$digest.resume.json'));
        if (await part.exists() != await journal.exists()) return false;
        if (await journal.exists() &&
            await _readResume(
                  journal,
                  part,
                  url: _resourceUrl(_versionedUrl, digest),
                  entry: entries[digest]!,
                ) ==
                null) {
          return false;
        }
      }
      return true;
    } on Object {
      return false;
    }
  }

  Future<_ResumeRecord?> _readResume(
    File journal,
    File part, {
    required Uri url,
    required BundleManifestEntry entry,
  }) async {
    if (!await journal.exists() || !await part.exists()) return null;
    try {
      final json = decodeStrictJsonObject(
        await journal.readAsBytes(),
        maximumBytes: 4096,
        context: 'bundle resume journal',
      );
      requireExactJsonKeys(json, const {
        'schemaVersion',
        'url',
        'expectedDigest',
        'expectedLength',
        'downloadedLength',
        'etag',
      }, context: 'bundle resume journal');
      final storedUrl = Uri.tryParse(
        json['url'] is String ? json['url']! as String : '',
      );
      final downloadedLength = json['downloadedLength'];
      if (json['schemaVersion'] != 1 ||
          storedUrl == null ||
          !storedUrl.hasAuthority ||
          storedUrl.userInfo.isNotEmpty ||
          storedUrl.hasQuery ||
          storedUrl.hasFragment ||
          storedUrl != url ||
          json['expectedDigest'] != entry.sha256 ||
          json['expectedLength'] != entry.byteLength ||
          downloadedLength is! int ||
          downloadedLength < 0 ||
          downloadedLength > entry.byteLength ||
          await part.length() != downloadedLength ||
          json['etag'] is! String ||
          !_strongEtagPattern.hasMatch(json['etag']! as String)) {
        throw const FormatException();
      }
      return _ResumeRecord(downloadedLength, json['etag']! as String);
    } on Object {
      await _discardPartial(part, journal);
      return null;
    }
  }

  Future<void> _writeResume(
    File journal, {
    required Uri url,
    required BundleManifestEntry entry,
    required int downloadedLength,
    required String etag,
  }) {
    return _atomicJsonWrite(journal, {
      'schemaVersion': 1,
      'url': url.toString(),
      'expectedDigest': entry.sha256,
      'expectedLength': entry.byteLength,
      'downloadedLength': downloadedLength,
      'etag': etag,
    });
  }

  Future<bool> _verifyPart(File part, BundleManifestEntry entry) async {
    try {
      await entry.validateResource(await part.readAsBytes());
      return true;
    } on Object {
      return false;
    }
  }

  bool _validContentRange(
    String? value, {
    required int start,
    required int total,
    int? contentLength,
  }) {
    final match = RegExp(
      r'^bytes ([0-9]+)-([0-9]+)/([0-9]+)$',
    ).firstMatch(value ?? '');
    if (match == null) return false;
    final actualStart = int.parse(match.group(1)!);
    final end = int.parse(match.group(2)!);
    final actualTotal = int.parse(match.group(3)!);
    final expectedLength = end - actualStart + 1;
    return actualStart == start &&
        end == total - 1 &&
        actualTotal == total &&
        expectedLength >= 0 &&
        (contentLength == null || contentLength == expectedLength);
  }

  Future<void> _discardPartial(File part, File journal) async {
    await _deleteEntity(part.path);
    await _deleteEntity(journal.path);
    await _deleteEntity('${journal.path}.tmp');
  }

  Future<void> _retainOnlyValidPartial(
    File part,
    File journal, {
    required Uri url,
    required BundleManifestEntry entry,
  }) async {
    final valid = await _readResume(journal, part, url: url, entry: entry);
    if (valid == null &&
        (await part.exists() ||
            await journal.exists() ||
            await File('${journal.path}.tmp').exists())) {
      await _discardPartial(part, journal);
    }
  }

  Future<void> _closeSink(IOSink sink) async {
    try {
      await sink.close();
    } on Object {
      // Cleanup below validates the flushed journal/part pair independently.
    }
  }

  Future<void> _deleteEntity(String path) async {
    const maximumAttempts = 4;
    for (var attempt = 1; attempt <= maximumAttempts; attempt++) {
      try {
        final type = await FileSystemEntity.type(path, followLinks: false);
        switch (type) {
          case FileSystemEntityType.file:
            await File(path).delete();
          case FileSystemEntityType.directory:
            await Directory(path).delete(recursive: true);
          case FileSystemEntityType.link:
            await Link(path).delete();
          case FileSystemEntityType.notFound:
            return;
          default:
            await File(path).delete();
        }
        if (await FileSystemEntity.type(path, followLinks: false) ==
            FileSystemEntityType.notFound) {
          return;
        }
      } on FileSystemException {
        try {
          faults.afterEntityDeleteFailure?.call(attempt);
        } on Object {
          // Fault notifications cannot alter exact-file cleanup behavior.
        }
      }
      if (attempt == maximumAttempts) {
        throw const BundleStoreException('partial_cleanup_failed');
      }
      await Future<void>.delayed(Duration.zero);
    }
  }

  Future<_Pointer?> _readPointer(File file) async {
    if (!await file.exists()) return null;
    try {
      final json = decodeStrictJsonObject(
        await file.readAsBytes(),
        maximumBytes: 1024,
        context: 'bundle pointer',
      );
      requireExactJsonKeys(json, const {
        'schemaVersion',
        'bundleVersion',
        'manifestDigest',
      }, context: 'bundle pointer');
      final version = json['bundleVersion'];
      final digest = json['manifestDigest'];
      if (json['schemaVersion'] != 1 ||
          version is! String ||
          digest is! String ||
          !_versionPattern.hasMatch(version) ||
          !_digestPattern.hasMatch(digest)) {
        return null;
      }
      return _Pointer(version, digest);
    } on Object {
      return null;
    }
  }

  Future<BundleHighWaterMark?> _readHighWaterOrNull() async {
    final pointer = await _readPointer(_highWaterFile);
    return pointer == null
        ? null
        : BundleHighWaterMark(
            version: pointer.version,
            manifestDigest: pointer.digest,
          );
  }

  Future<void> _writeHighWater({
    required String version,
    required String digest,
  }) {
    return _atomicJsonWrite(_highWaterFile, _pointerJson(version, digest));
  }

  Map<String, Object> _pointerJson(String version, String digest) => {
    'schemaVersion': 1,
    'bundleVersion': version,
    'manifestDigest': digest,
  };

  Future<void> _atomicJsonWrite(File target, Map<String, Object> value) {
    return _atomicBytesWrite(target, utf8.encode(jsonEncode(value)));
  }

  Future<void> _atomicBytesWrite(File target, List<int> bytes) async {
    await target.parent.create(recursive: true);
    final temporary = File('${target.path}.tmp');
    await _writeFlushed(temporary, bytes);
    await temporary.rename(target.path);
  }

  Future<void> _writeFlushed(File file, List<int> bytes) async {
    await file.parent.create(recursive: true);
    final handle = await file.open(mode: FileMode.write);
    try {
      await handle.writeFrom(bytes);
      await handle.flush();
    } finally {
      await handle.close();
    }
  }

  Future<void> _removePointerTemps() async {
    for (final file in [
      File('${_activePointer.path}.tmp'),
      File('${_previousPointer.path}.tmp'),
      File('${_highWaterFile.path}.tmp'),
    ]) {
      if (await file.exists()) await file.delete();
    }
  }

  Future<void> _ensureLayout() async {
    await _documentsRoot.create(recursive: true);
    await _objects.create(recursive: true);
    await _staging.create(recursive: true);
    await _ready.create(recursive: true);
  }

  File _objectFile(String digest) {
    if (!_digestPattern.hasMatch(digest)) {
      throw const BundleStoreException('object_digest_invalid');
    }
    return File(paths.join(_objects.path, '$digest.blob'));
  }

  Directory _stagingDirectory(String version) {
    if (!_versionPattern.hasMatch(version)) {
      throw const BundleStoreException('bundle_version_invalid');
    }
    return Directory(paths.join(_staging.path, version));
  }

  File _readyManifest(String version) {
    if (!_versionPattern.hasMatch(version)) {
      throw const BundleStoreException('bundle_version_invalid');
    }
    return File(paths.join(_ready.path, version, 'manifest.envelope.json'));
  }

  bool _isRegisteredSeedAsset(String digest, String assetPath) {
    if (assetPath.length > 256 ||
        assetPath.contains('..') ||
        assetPath.contains('\\')) {
      return false;
    }
    final content = RegExp(
      '^assets/pisocamp/bundle/seed/resources/$digest\\.json\$',
    ).hasMatch(assetPath);
    final image = RegExp(
      r'^assets/pisocamp/bundle/seed/source/neutral-(?:banknote|coin)-education\.png$',
    ).hasMatch(assetPath);
    final model = RegExp(
      r'^assets/pisocamp/bundle/seed/source/neutral-coin-education\.glb$',
    ).hasMatch(assetPath);
    return content || image || model;
  }

  Uri _resourceUrl(Uri versionedUrl, String digest) {
    final basePath = versionedUrl.path.endsWith('/')
        ? versionedUrl.path.substring(0, versionedUrl.path.length - 1)
        : versionedUrl.path;
    return versionedUrl.replace(
      path: '$basePath/pisocamp/bundle/resources/$digest',
      query: null,
      fragment: null,
    );
  }
}

final class _Pointer {
  const _Pointer(this.version, this.digest);
  final String version;
  final String digest;
}

final class _ResumeRecord {
  const _ResumeRecord(this.downloadedLength, this.etag);
  final int downloadedLength;
  final String etag;
}

final class _VerifiedBundle {
  const _VerifiedBundle(this.catalog);
  final ActiveCurrencyCatalog catalog;
}

Future<void> _boundedForEach<T>(
  List<T> values,
  int concurrency,
  Future<void> Function(T value) operation,
) async {
  var next = 0;
  Future<void> worker() async {
    while (next < values.length) {
      final index = next;
      next += 1;
      await operation(values[index]);
    }
  }

  await Future.wait([
    for (var index = 0; index < concurrency && index < values.length; index++)
      worker(),
  ]);
}

Future<Uint8List> _loadRootBundleAsset(String assetPath) async {
  final data = await rootBundle.load(assetPath);
  return data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
}
