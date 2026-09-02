import 'dart:io';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/encrypted_record_queue.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';

const analyticsQueueKeyName = 'pisocamp.analytics.queue-key.v1';
const _defaultMaxEvents = 100;
const _defaultMaxBytes = 512 * 1024;

/// AN-1's names for the shared queue's collaborators, kept so the ticket's
/// published surface does not move when the implementation is shared.
typedef AnalyticsKeyStore = RecordQueueKeyStore;
typedef AnalyticsQueueKeyGenerator = RecordQueueKeyGenerator;
typedef AnalyticsQueueDirectoryExistsProbe = RecordQueueDirectoryExistsProbe;
typedef AnalyticsQueueFileReader = RecordQueueFileReader;

final class SecureStorageAnalyticsKeyStore implements AnalyticsKeyStore {
  SecureStorageAnalyticsKeyStore(this._storage);

  final SecureStorageService _storage;

  @override
  Future<String?> readKey() => _storage.readValue(analyticsQueueKeyName);

  @override
  Future<void> writeKey(String value) =>
      _storage.writeValue(analyticsQueueKeyName, value);
}

final class AnalyticsQueueException implements Exception {
  const AnalyticsQueueException(this.code);

  final String code;

  @override
  String toString() => 'AnalyticsQueueException($code)';
}

const _analyticsLayout = RecordQueueLayout(
  directorySegments: ['pisocamp', 'analytics', 'v1'],
  fileExtension: 'event',
  aadPrefix: 'PCAQ:1',
  batchEnvelopeKey: 'events',
  invalidIdCode: 'invalidEventId',
  keyUnavailableCode: 'analyticsKeyUnavailable',
  recordTooLargeCode: 'eventTooLarge',
  maxRecords: _defaultMaxEvents,
  maxBytes: _defaultMaxBytes,
);

final _analyticsCodec = RecordQueueCodec<AnalyticsEvent>(
  idOf: (event) => event.eventId,
  encode: (event) => event.toJson(),
  // The queue quarantines what it cannot read, and it recognises that by
  // FormatException; an event that fails the catalog is exactly that case.
  decode: (json) {
    try {
      return AnalyticsEvent.fromJson(json);
    } on AnalyticsValidationException {
      throw const FormatException();
    }
  },
);

/// Durable, one-file-per-event authenticated queue rooted below app support.
///
/// The store itself is [EncryptedRecordQueue]; this is AN-1's face on it, so
/// the codes and method names the ticket published stay put.
final class EncryptedAnalyticsQueue {
  EncryptedAnalyticsQueue._(this._queue);

  final EncryptedRecordQueue<AnalyticsEvent> _queue;

  static Future<EncryptedAnalyticsQueue> initialize({
    required Directory applicationSupportDirectory,
    required AnalyticsKeyStore keyStore,
    DateTime Function()? clock,
    AnalyticsQueueKeyGenerator? createSecretKey,
    AnalyticsQueueDirectoryExistsProbe? queueDirectoryExists,
    AnalyticsQueueFileReader? readFile,
  }) async {
    return EncryptedAnalyticsQueue._(
      await _translate(
        () => EncryptedRecordQueue.initialize<AnalyticsEvent>(
          applicationSupportDirectory: applicationSupportDirectory,
          layout: _analyticsLayout,
          codec: _analyticsCodec,
          keyStore: keyStore,
          clock: clock,
          createSecretKey: createSecretKey,
          queueDirectoryExists: queueDirectoryExists,
          readFile: readFile,
        ),
      ),
    );
  }

  Future<void> enqueue(AnalyticsEvent event) =>
      _translate(() => _queue.enqueue(event));

  Future<List<AnalyticsEvent>> readBatch({
    int maxEvents = _defaultMaxEvents,
    int maxBytes = _defaultMaxBytes,
  }) => _translate(
    () => _queue.readBatch(maxRecords: maxEvents, maxBytes: maxBytes),
  );

  Future<void> acknowledge(Iterable<String> eventIds) =>
      _translate(() => _queue.acknowledge(eventIds));

  Future<int> pendingCount() => _translate(_queue.pendingCount);

  static Future<T> _translate<T>(Future<T> Function() action) async {
    try {
      return await action();
    } on RecordQueueException catch (error) {
      throw AnalyticsQueueException(error.code);
    }
  }
}

/// Kept for callers that hold raw bytes; the queue owns the envelope format.
typedef AnalyticsQueueBytes = Uint8List;

/// Re-exported so AN-1's tests can keep constructing a key the same way.
typedef AnalyticsSecretKey = SecretKey;
