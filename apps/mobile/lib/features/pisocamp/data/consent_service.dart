import 'package:dio/dio.dart';
import 'package:mobile/core/utils/uuid_v4.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_repository.dart';
import 'package:mobile/features/pisocamp/data/guest_identity_service.dart';

enum ConsentGateResult {
  grantedSynced,
  grantedQueued,
  declined,
  cancelled,
  unavailable,
}

enum ConsentRequirementState {
  grantedSynced,
  grantedQueued,
  needsDecision,
  unavailable,
}

class ConsentRequirement {
  const ConsentRequirement({
    required this.state,
    this.notice,
    this.requiresReconsent = false,
  });

  final ConsentRequirementState state;
  final PrivacyNotice? notice;
  final bool requiresReconsent;
}

/// Applies consent policy independently from navigation and widgets.
class ConsentService {
  ConsentService(
    this._repository,
    this._store,
    this._guestIdentity, {
    String Function()? idGenerator,
    DateTime Function()? clock,
  }) : _idGenerator = idGenerator ?? createUuidV4,
       _clock = clock ?? DateTime.now;

  final ConsentRepository _repository;
  final ConsentLocalStore _store;
  final GuestIdentityService _guestIdentity;
  final String Function() _idGenerator;
  final DateTime Function() _clock;
  Future<void>? _activeDrain;

  Future<ConsentRequirement> check(
    ConsentPurpose purpose, {
    required bool online,
  }) async {
    try {
      if (online) {
        final devicePseudoId = await _guestIdentity.getOrCreateId();
        final status = await _repository.fetchStatus(
          purpose,
          devicePseudoId: devicePseudoId,
        );
        if (status.state == ConsentServerState.granted) {
          return ConsentRequirement(
            state: ConsentRequirementState.grantedSynced,
            notice: status.notice,
          );
        }
        return ConsentRequirement(
          state: ConsentRequirementState.needsDecision,
          notice: status.notice,
          requiresReconsent:
              status.state == ConsentServerState.requiresReconsent ||
              status.state == ConsentServerState.withdrawn,
        );
      }

      final devicePseudoId = await _guestIdentity.getOrCreateId();
      final cachedJson = await _store.readCachedNotice();
      if (cachedJson == null) {
        return const ConsentRequirement(
          state: ConsentRequirementState.unavailable,
        );
      }
      final notice = PrivacyNotice.fromJson(cachedJson);
      final records = (await _store.readRecords())
          .where(
            (record) =>
                record.purpose == purpose &&
                record.devicePseudoId == devicePseudoId,
          )
          .toList(growable: false);
      final current = records.reversed.where(
        (record) =>
            record.noticeId == notice.id &&
            record.noticeVersion == notice.version,
      );
      if (current.isNotEmpty &&
          current.first.syncState == ConsentSyncState.stale) {
        return ConsentRequirement(
          state: ConsentRequirementState.unavailable,
          notice: notice,
          requiresReconsent: true,
        );
      }
      if (current.isNotEmpty &&
          current.first.decision == ConsentDecision.granted) {
        return ConsentRequirement(
          state: current.first.syncState == ConsentSyncState.synced
              ? ConsentRequirementState.grantedSynced
              : ConsentRequirementState.grantedQueued,
          notice: notice,
        );
      }
      final hasOlderGrant = records.any(
        (record) =>
            record.decision == ConsentDecision.granted &&
            (record.noticeId != notice.id ||
                record.noticeVersion != notice.version),
      );
      return ConsentRequirement(
        state: ConsentRequirementState.needsDecision,
        notice: notice,
        requiresReconsent: hasOlderGrant,
      );
    } on Object {
      return const ConsentRequirement(
        state: ConsentRequirementState.unavailable,
      );
    }
  }

  Future<ConsentGateResult> recordDecision({
    required ConsentPurpose purpose,
    required PrivacyNotice notice,
    required ConsentDecision decision,
    required bool online,
  }) async {
    try {
      final record = StoredConsentRecord(
        recordId: _idGenerator(),
        noticeId: notice.id,
        noticeVersion: notice.version,
        purpose: purpose,
        decision: decision,
        respondedAt: _millisecondPrecision(_clock()),
        devicePseudoId: await _guestIdentity.getOrCreateId(),
        syncState: ConsentSyncState.pending,
      );
      await _store.append(record);

      if (online) {
        try {
          await _repository.sync(record);
          await _store.markSynced(record.recordId);
          return decision == ConsentDecision.granted
              ? ConsentGateResult.grantedSynced
              : ConsentGateResult.declined;
        } on DioException catch (error) {
          if (_isStaleConflict(error)) {
            await _retireStale(record);
            return ConsentGateResult.unavailable;
          }
          // The durable pending record is retried with the same UUID.
        } on Object {
          // The durable pending record is retried with the same UUID.
        }
      }
      return decision == ConsentDecision.granted
          ? ConsentGateResult.grantedQueued
          : ConsentGateResult.declined;
    } on Object {
      return ConsentGateResult.unavailable;
    }
  }

  Future<void> syncPending() {
    final running = _activeDrain;
    if (running != null) return running;
    final drain = _drainPending();
    _activeDrain = drain;
    return drain.whenComplete(() {
      if (identical(_activeDrain, drain)) _activeDrain = null;
    });
  }

  Future<void> _drainPending() async {
    final pending = await _store.readPending();
    for (final record in pending) {
      try {
        await _repository.sync(record);
        await _store.markSynced(record.recordId);
      } on DioException catch (error) {
        if (_isStaleConflict(error)) {
          await _retireStale(record);
          continue;
        }
        // FIFO is intentional: do not overtake an earlier legal record.
        break;
      } on Object {
        // FIFO is intentional: do not overtake an earlier legal record.
        break;
      }
    }
  }

  bool _isStaleConflict(DioException error) =>
      error.response?.statusCode == 409;

  Future<void> _retireStale(StoredConsentRecord record) async {
    await _store.markStale(record.recordId);
    try {
      await _repository.fetchStatus(
        record.purpose,
        devicePseudoId: record.devicePseudoId,
      );
    } on Object {
      // The stale record remains retired; the next gate refreshes fail closed.
    }
  }
}

DateTime _millisecondPrecision(DateTime value) =>
    DateTime.fromMillisecondsSinceEpoch(
      value.toUtc().millisecondsSinceEpoch,
      isUtc: true,
    );
