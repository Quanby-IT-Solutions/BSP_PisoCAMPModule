import 'dart:async';
import 'dart:convert';

import 'package:mobile/services/storage/secure_storage_service.dart';

enum ConsentPurpose {
  registration('registration'),
  survey('survey'),
  demographicAnalytics('demographic_analytics');

  const ConsentPurpose(this.wireValue);

  final String wireValue;

  static ConsentPurpose fromWire(String value) => values.firstWhere(
    (purpose) => purpose.wireValue == value,
    orElse: () => throw ConsentStoreException('Unknown consent purpose'),
  );
}

enum ConsentDecision {
  granted('granted'),
  declined('declined');

  const ConsentDecision(this.wireValue);

  final String wireValue;

  static ConsentDecision fromWire(String value) => values.firstWhere(
    (decision) => decision.wireValue == value,
    orElse: () => throw ConsentStoreException('Unknown consent decision'),
  );
}

enum ConsentSyncState {
  pending('pending'),
  synced('synced'),
  stale('stale');

  const ConsentSyncState(this.wireValue);

  final String wireValue;

  static ConsentSyncState fromWire(String value) => values.firstWhere(
    (state) => state.wireValue == value,
    orElse: () => throw ConsentStoreException('Unknown consent sync state'),
  );
}

class StoredConsentRecord {
  const StoredConsentRecord({
    required this.recordId,
    required this.noticeId,
    required this.noticeVersion,
    required this.purpose,
    required this.decision,
    required this.respondedAt,
    required this.devicePseudoId,
    required this.syncState,
  });

  final String recordId;
  final String noticeId;
  final String noticeVersion;
  final ConsentPurpose purpose;
  final ConsentDecision decision;
  final DateTime respondedAt;
  final String devicePseudoId;
  final ConsentSyncState syncState;

  StoredConsentRecord copyWith({
    String? recordId,
    ConsentSyncState? syncState,
  }) => StoredConsentRecord(
    recordId: recordId ?? this.recordId,
    noticeId: noticeId,
    noticeVersion: noticeVersion,
    purpose: purpose,
    decision: decision,
    respondedAt: respondedAt,
    devicePseudoId: devicePseudoId,
    syncState: syncState ?? this.syncState,
  );

  Map<String, Object?> toJson() => <String, Object?>{
    'recordId': recordId,
    'noticeId': noticeId,
    'noticeVersion': noticeVersion,
    'purpose': purpose.wireValue,
    'decision': decision.wireValue,
    'respondedAt': respondedAt.toUtc().toIso8601String(),
    'devicePseudoId': devicePseudoId,
    'syncState': syncState.wireValue,
  };

  factory StoredConsentRecord.fromJson(Map<String, Object?> json) {
    final recordId = json['recordId'];
    final noticeId = json['noticeId'];
    final noticeVersion = json['noticeVersion'];
    final purpose = json['purpose'];
    final decision = json['decision'];
    final respondedAt = json['respondedAt'];
    final devicePseudoId = json['devicePseudoId'];
    final syncState = json['syncState'];
    if (recordId is! String ||
        noticeId is! String ||
        noticeVersion is! String ||
        purpose is! String ||
        decision is! String ||
        respondedAt is! String ||
        devicePseudoId is! String ||
        syncState is! String) {
      throw ConsentStoreException('Invalid consent record');
    }
    if (!_uuidV4Pattern.hasMatch(recordId) ||
        !_uuidPattern.hasMatch(noticeId) ||
        noticeVersion.isEmpty ||
        !_devicePseudoIdPattern.hasMatch(devicePseudoId)) {
      throw ConsentStoreException('Invalid consent record identifiers');
    }
    final timestamp = DateTime.tryParse(respondedAt);
    if (timestamp == null) {
      throw ConsentStoreException('Invalid consent timestamp');
    }
    return StoredConsentRecord(
      recordId: recordId,
      noticeId: noticeId,
      noticeVersion: noticeVersion,
      purpose: ConsentPurpose.fromWire(purpose),
      decision: ConsentDecision.fromWire(decision),
      respondedAt: timestamp.toUtc(),
      devicePseudoId: devicePseudoId,
      syncState: ConsentSyncState.fromWire(syncState),
    );
  }

  bool hasSameDecision(StoredConsentRecord other) =>
      recordId == other.recordId &&
      noticeId == other.noticeId &&
      noticeVersion == other.noticeVersion &&
      purpose == other.purpose &&
      decision == other.decision &&
      respondedAt.toUtc() == other.respondedAt.toUtc() &&
      devicePseudoId == other.devicePseudoId;
}

class ConsentStoreException implements Exception {
  const ConsentStoreException(this.message);

  final String message;

  @override
  String toString() => 'ConsentStoreException: $message';
}

/// Owns the encrypted, device-local consent log and notice cache.
class ConsentLocalStore {
  ConsentLocalStore(this._storage);

  static const _storageKey = 'pisocamp_consent_state_v1';

  final SecureStorageService _storage;
  Future<void> _tail = Future<void>.value();

  Future<List<StoredConsentRecord>> readRecords() =>
      _exclusive(() async => List.unmodifiable((await _readState()).records));

  Future<List<StoredConsentRecord>> readPending() => _exclusive(() async {
    final state = await _readState();
    return List.unmodifiable(
      state.records.where(
        (record) => record.syncState == ConsentSyncState.pending,
      ),
    );
  });

  Future<void> append(StoredConsentRecord record) => _exclusive(() async {
    final state = await _readState();
    final existing = state.records.where(
      (candidate) => candidate.recordId == record.recordId,
    );
    if (existing.isNotEmpty) {
      if (existing.single.hasSameDecision(record)) return;
      throw StateError('Consent record ID already has another decision');
    }
    await _writeState(
      state.copyWith(records: <StoredConsentRecord>[...state.records, record]),
    );
  });

  Future<void> markSynced(String recordId) => _exclusive(() async {
    await _setSyncState(recordId, ConsentSyncState.synced);
  });

  Future<void> markStale(String recordId) => _exclusive(() async {
    await _setSyncState(recordId, ConsentSyncState.stale);
  });

  Future<void> _setSyncState(
    String recordId,
    ConsentSyncState syncState,
  ) async {
    final state = await _readState();
    var found = false;
    final records = state.records
        .map((record) {
          if (record.recordId != recordId) return record;
          found = true;
          return record.copyWith(syncState: syncState);
        })
        .toList(growable: false);
    if (!found) throw StateError('Consent record does not exist');
    await _writeState(state.copyWith(records: records));
  }

  Future<Map<String, Object?>?> readCachedNotice() => _exclusive(() async {
    final cached = (await _readState()).cachedNotice;
    return cached == null ? null : Map.unmodifiable(cached);
  });

  Future<void> writeCachedNotice(Map<String, Object?> notice) =>
      _exclusive(() async {
        final state = await _readState();
        await _writeState(
          state.copyWith(cachedNotice: Map<String, Object?>.from(notice)),
        );
      });

  Future<T> _exclusive<T>(Future<T> Function() operation) {
    final previous = _tail;
    final completed = Completer<void>();
    _tail = completed.future;
    return (() async {
      await previous;
      try {
        return await operation();
      } finally {
        completed.complete();
      }
    })();
  }

  Future<_ConsentStoreState> _readState() async {
    final encoded = await _storage.readValue(_storageKey);
    if (encoded == null) return const _ConsentStoreState(records: []);
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! Map<String, dynamic> ||
          decoded['schemaVersion'] != 1 ||
          decoded['records'] is! List) {
        throw const ConsentStoreException('Invalid consent store state');
      }
      final records = (decoded['records'] as List)
          .map((item) {
            if (item is! Map<String, dynamic>) {
              throw const ConsentStoreException('Invalid consent record');
            }
            return StoredConsentRecord.fromJson(item);
          })
          .toList(growable: false);
      final cachedNotice = decoded['cachedNotice'];
      if (cachedNotice != null && cachedNotice is! Map<String, dynamic>) {
        throw const ConsentStoreException('Invalid cached notice');
      }
      return _ConsentStoreState(
        records: records,
        cachedNotice: cachedNotice == null
            ? null
            : Map<String, Object?>.from(cachedNotice),
      );
    } on ConsentStoreException {
      rethrow;
    } on Object {
      throw const ConsentStoreException('Consent store is corrupted');
    }
  }

  Future<void> _writeState(_ConsentStoreState state) => _storage.writeValue(
    _storageKey,
    jsonEncode(<String, Object?>{
      'schemaVersion': 1,
      'records': state.records.map((record) => record.toJson()).toList(),
      if (state.cachedNotice != null) 'cachedNotice': state.cachedNotice,
    }),
  );
}

class _ConsentStoreState {
  const _ConsentStoreState({required this.records, this.cachedNotice});

  final List<StoredConsentRecord> records;
  final Map<String, Object?>? cachedNotice;

  _ConsentStoreState copyWith({
    List<StoredConsentRecord>? records,
    Map<String, Object?>? cachedNotice,
  }) => _ConsentStoreState(
    records: records ?? this.records,
    cachedNotice: cachedNotice ?? this.cachedNotice,
  );
}

final RegExp _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final RegExp _uuidV4Pattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final RegExp _devicePseudoIdPattern = RegExp(r'^[A-Za-z0-9_-]{22}$');
