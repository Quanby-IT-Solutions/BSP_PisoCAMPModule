import 'dart:convert';

import 'package:mobile/features/pisocamp/data/trivia_response.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Where answers live on the device.
///
/// Every answer is recorded here first, whoever gives it: a guest has nowhere
/// else to put one, and a registered user who is offline is in the same
/// position until connectivity returns.
abstract interface class TriviaResponseStore {
  Future<List<TriviaResponseRecord>> readAll();

  /// Records one response. Recording the same [TriviaResponseRecord.responseId]
  /// twice keeps the first, which is what makes a retried write safe.
  Future<void> record(TriviaResponseRecord response);

  /// The responses the server has not acknowledged, oldest first.
  Future<List<TriviaResponseRecord>> readPending({int limit});

  Future<void> markSynced(Iterable<String> responseIds);

  /// The account the device's backlog has already been merged into, if any.
  Future<String?> readMergedAccountId();

  Future<void> recordMerged(String accountId);
}

/// Shared-preferences implementation.
///
/// The same place [PreferencesTriviaHistoryStore] keeps sightings, and for the
/// same reason: a response names a question, an outcome and a moment. It
/// identifies nobody until it is uploaded, and what identifies it then is the
/// account it is uploaded under. The analytics queue is encrypted because it
/// carries a subject pseudo-id and a session id; this carries neither.
class PreferencesTriviaResponseStore implements TriviaResponseStore {
  PreferencesTriviaResponseStore(this._preferences);

  final SharedPreferences _preferences;

  static const String storageKey = 'pisocamp.trivia.responses.v1';
  static const String mergedAccountKey = 'pisocamp.trivia.merged-account.v1';

  /// How many synced responses are kept for the device's own history. Pending
  /// responses are never dropped: they are the answers nobody else holds.
  static const int maximumSyncedEntries = 500;

  /// The server's batch limit, so a read never proposes more than one upload.
  static const int defaultPendingLimit = 100;

  @override
  Future<List<TriviaResponseRecord>> readAll() async {
    final raw = _preferences.getString(storageKey);
    if (raw == null || raw.isEmpty) return const [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      final records = <TriviaResponseRecord>[];
      for (final entry in decoded) {
        final record = TriviaResponseRecord.tryFromStorageJson(entry);
        if (record != null) records.add(record);
      }
      records.sort((left, right) => left.answeredAt.compareTo(right.answeredAt));
      return List.unmodifiable(records);
    } on Object {
      return const [];
    }
  }

  @override
  Future<void> record(TriviaResponseRecord response) async {
    final existing = await readAll();
    if (existing.any((entry) => entry.responseId == response.responseId)) return;
    await _write([...existing, response]);
  }

  @override
  Future<List<TriviaResponseRecord>> readPending({
    int limit = defaultPendingLimit,
  }) async {
    final pending = [
      for (final record in await readAll())
        if (!record.synced) record,
    ];
    return List.unmodifiable(pending.take(limit));
  }

  @override
  Future<void> markSynced(Iterable<String> responseIds) async {
    final acknowledged = responseIds.toSet();
    if (acknowledged.isEmpty) return;
    final existing = await readAll();
    await _write([
      for (final record in existing)
        acknowledged.contains(record.responseId) ? record.asSynced() : record,
    ]);
  }

  @override
  Future<String?> readMergedAccountId() async =>
      _preferences.getString(mergedAccountKey);

  @override
  Future<void> recordMerged(String accountId) =>
      _preferences.setString(mergedAccountKey, accountId);

  Future<void> _write(List<TriviaResponseRecord> records) async {
    final pending = [
      for (final record in records)
        if (!record.synced) record,
    ];
    final synced = [
      for (final record in records)
        if (record.synced) record,
    ]..sort((left, right) => right.answeredAt.compareTo(left.answeredAt));
    final kept = [...pending, ...synced.take(maximumSyncedEntries)]
      ..sort((left, right) => left.answeredAt.compareTo(right.answeredAt));
    await _preferences.setString(
      storageKey,
      jsonEncode([for (final record in kept) record.toStorageJson()]),
    );
  }
}
