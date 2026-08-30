import 'dart:async';

import 'bundle_client.dart';
import 'bundle_protocol.dart';
import 'bundle_store.dart';

enum BundleSyncTrigger { startup, connectivity, manual }

enum BundleSyncPhase { idle, checking, downloading, paused, failed, active }

final class BundleSyncState {
  const BundleSyncState({required this.phase, this.code, this.version});

  const BundleSyncState.idle()
    : phase = BundleSyncPhase.idle,
      code = null,
      version = null;

  final BundleSyncPhase phase;
  final String? code;
  final String? version;

  @override
  String toString() {
    return 'BundleSyncState(phase: ${phase.name}, code: $code, version: $version)';
  }
}

/// Serializes public bundle checks and never clears the store's active pointer.
final class BundleSyncController {
  BundleSyncController({
    required BundleStore store,
    required BundleClient client,
    required BundleKeyRing networkKeyRing,
  }) : _store = store,
       _client = client,
       _networkKeyRing = networkKeyRing;

  final BundleStore _store;
  final BundleClient _client;
  final BundleKeyRing _networkKeyRing;
  final StreamController<BundleSyncState> _states =
      StreamController<BundleSyncState>.broadcast(sync: true);
  final StreamController<ActiveCurrencyCatalog> _activeCatalogs =
      StreamController<ActiveCurrencyCatalog>.broadcast(sync: true);
  BundleSyncState _state = const BundleSyncState.idle();
  Future<void>? _inFlight;
  BundleCancellationToken? _operationCancellation;
  bool _disposed = false;

  BundleSyncState get state => _state;
  Stream<BundleSyncState> get states => _states.stream;
  Stream<ActiveCurrencyCatalog> get activeCatalogs => _activeCatalogs.stream;

  Future<void> sync(
    BundleSyncTrigger trigger, {
    BundleCancellationToken? cancellation,
  }) {
    if (_disposed) return Future.error(StateError('controller_disposed'));
    final existing = _inFlight;
    if (existing != null) return existing;
    final operationCancellation = BundleCancellationToken();
    final cancellationLink = cancellation == null
        ? null
        : BundleCancellationLink(cancellation, operationCancellation);
    _operationCancellation = operationCancellation;
    final operation = _runSync(trigger, operationCancellation);
    _inFlight = operation;
    operation.whenComplete(() {
      cancellationLink?.unlink();
      if (identical(_inFlight, operation)) {
        _inFlight = null;
        _operationCancellation = null;
      }
    });
    return operation;
  }

  Future<void> _runSync(
    BundleSyncTrigger trigger,
    BundleCancellationToken? cancellation,
  ) async {
    _emit(const BundleSyncState(phase: BundleSyncPhase.checking));
    try {
      ActiveCurrencyCatalog active;
      try {
        active = await _store.readActive();
      } on Object {
        active = await _store.recover();
      }
      final response = await _client.fetchManifest(
        ifNoneMatch: '"${active.manifestDigest}"',
        cancellation: cancellation,
      );
      if (response.notModified) {
        _emit(
          BundleSyncState(
            phase: BundleSyncPhase.active,
            version: active.version,
          ),
        );
        return;
      }
      final bytes = response.bytes;
      if (bytes == null) {
        throw const BundleClientException('manifest_response_invalid');
      }
      BundleEnvelope envelope;
      try {
        envelope = await BundleEnvelope.parseAndVerify(bytes, _networkKeyRing);
      } on Object {
        throw const BundleStoreException('manifest_verification_failed');
      }
      if (envelope.manifest.bundleVersion == active.version &&
          envelope.payloadSha256 == active.manifestDigest) {
        _emit(
          BundleSyncState(
            phase: BundleSyncPhase.active,
            version: active.version,
          ),
        );
        return;
      }
      _emit(
        BundleSyncState(
          phase: BundleSyncPhase.downloading,
          version: active.version,
        ),
      );
      final staged = await _store.stage(
        envelope: envelope,
        envelopeBytes: bytes,
        client: _client,
        cancellation: cancellation,
        onProgress: (_, _) {
          if (!_disposed && _state.phase != BundleSyncPhase.downloading) {
            _emit(
              BundleSyncState(
                phase: BundleSyncPhase.downloading,
                version: active.version,
              ),
            );
          }
        },
      );
      cancellation?.throwIfCancelled();
      final activated = await _store.activate(staged);
      if (!_disposed) _activeCatalogs.add(activated);
      _emit(
        BundleSyncState(phase: BundleSyncPhase.active, version: staged.version),
      );
    } on BundleClientException catch (error) {
      if (error.code == 'cancelled') {
        _emit(
          const BundleSyncState(
            phase: BundleSyncPhase.paused,
            code: 'cancelled',
          ),
        );
      } else {
        _emit(
          BundleSyncState(
            phase: error.transient
                ? BundleSyncPhase.paused
                : BundleSyncPhase.failed,
            code: error.code,
          ),
        );
      }
    } on BundleStoreException catch (error) {
      _emit(
        BundleSyncState(
          phase: error.code == 'cancelled' || error.transient
              ? BundleSyncPhase.paused
              : BundleSyncPhase.failed,
          code: error.code,
        ),
      );
    } on Object {
      _emit(
        const BundleSyncState(
          phase: BundleSyncPhase.failed,
          code: 'storage_failed',
        ),
      );
    }
  }

  void _emit(BundleSyncState next) {
    _state = next;
    if (!_disposed) _states.add(next);
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _operationCancellation?.cancel();
    await _inFlight;
    await _states.close();
    await _activeCatalogs.close();
  }
}
