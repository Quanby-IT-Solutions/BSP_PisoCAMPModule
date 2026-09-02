import 'dart:io';

import 'package:mobile/features/pisocamp/data/encrypted_record_queue.dart';
import 'package:mobile/features/pisocamp/data/survey_response.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';

const surveyQueueKeyName = 'pisocamp.surveys.queue-key.v1';

/// A survey response is a person's own words about the module, so it is kept
/// the way analytics is kept: encrypted at rest, in its own store with its own
/// key, and readable only by this app on this device.
const surveyQueueLayout = RecordQueueLayout(
  directorySegments: ['pisocamp', 'surveys', 'v1'],
  fileExtension: 'response',
  aadPrefix: 'PCSQ:1',
  batchEnvelopeKey: 'responses',
  invalidIdCode: 'invalidResponseId',
  keyUnavailableCode: 'surveyKeyUnavailable',
  recordTooLargeCode: 'responseTooLarge',
  maxRecords: 20,
  maxBytes: 256 * 1024,
);

final surveyQueueCodec = RecordQueueCodec<SurveyResponse>(
  idOf: (response) => response.responseId,
  encode: (response) => response.toJson(),
  decode: SurveyResponse.fromJson,
);

final class SecureStorageSurveyKeyStore implements RecordQueueKeyStore {
  SecureStorageSurveyKeyStore(this._storage);

  final SecureStorageService _storage;

  @override
  Future<String?> readKey() => _storage.readValue(surveyQueueKeyName);

  @override
  Future<void> writeKey(String value) =>
      _storage.writeValue(surveyQueueKeyName, value);
}

/// What a sync needs from the queue, so a controller can be tested without one.
abstract interface class SurveyQueuePort {
  Future<void> enqueue(SurveyResponse response);
  Future<List<SurveyResponse>> readBatch();
  Future<void> acknowledge(Iterable<String> responseIds);
  Future<int> pendingCount();
}

final class EncryptedSurveyQueue implements SurveyQueuePort {
  EncryptedSurveyQueue._(this._queue);

  final EncryptedRecordQueue<SurveyResponse> _queue;

  static Future<EncryptedSurveyQueue> initialize({
    required Directory applicationSupportDirectory,
    required RecordQueueKeyStore keyStore,
    DateTime Function()? clock,
    RecordQueueKeyGenerator? createSecretKey,
    RecordQueueDirectoryExistsProbe? queueDirectoryExists,
    RecordQueueFileReader? readFile,
  }) async {
    return EncryptedSurveyQueue._(
      await EncryptedRecordQueue.initialize<SurveyResponse>(
        applicationSupportDirectory: applicationSupportDirectory,
        layout: surveyQueueLayout,
        codec: surveyQueueCodec,
        keyStore: keyStore,
        clock: clock,
        createSecretKey: createSecretKey,
        queueDirectoryExists: queueDirectoryExists,
        readFile: readFile,
      ),
    );
  }

  @override
  Future<void> enqueue(SurveyResponse response) => _queue.enqueue(response);

  @override
  Future<List<SurveyResponse>> readBatch() => _queue.readBatch();

  @override
  Future<void> acknowledge(Iterable<String> responseIds) =>
      _queue.acknowledge(responseIds);

  @override
  Future<int> pendingCount() => _queue.pendingCount();
}
