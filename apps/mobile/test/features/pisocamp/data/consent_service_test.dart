import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_repository.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/data/guest_identity_service.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';

void main() {
  final noticeV1 = PrivacyNotice(
    id: '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
    version: '1',
    title: 'Privacy Notice',
    body: 'Explicit fake notice version one for tests.',
    sourceUrl: Uri.parse('https://example.test/privacy'),
    contentSha256:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    effectiveAt: DateTime.utc(2026, 1, 1),
  );
  final noticeV2 = PrivacyNotice(
    id: '3cc8ca14-5a9c-4f3a-ae96-842c82bdaea5',
    version: '2',
    title: 'Updated Privacy Notice',
    body: 'Explicit fake notice version two for tests.',
    sourceUrl: Uri.parse('https://example.test/privacy-v2'),
    contentSha256:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    effectiveAt: DateTime.utc(2026, 8, 24),
  );

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  ConsentService subject(
    FakeConsentRepository repository,
    ConsentLocalStore store,
  ) => ConsentService(
    repository,
    store,
    GuestIdentityService(SecureStorageService()),
    idGenerator: () => 'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
    clock: () => DateTime.parse('2026-08-24T01:02:03.000Z'),
  );

  test('authoritative current grant bypasses the notice', () async {
    final repository = FakeConsentRepository(
      status: ConsentStatus(
        purpose: ConsentPurpose.registration,
        state: ConsentServerState.granted,
        notice: noticeV1,
      ),
    );

    final requirement = await subject(
      repository,
      ConsentLocalStore(SecureStorageService()),
    ).check(ConsentPurpose.registration, online: true);

    expect(requirement.state, ConsentRequirementState.grantedSynced);
    expect(requirement.notice, noticeV1);
  });

  test('fresh offline install without a cached notice fails closed', () async {
    final requirement = await subject(
      FakeConsentRepository(),
      ConsentLocalStore(SecureStorageService()),
    ).check(ConsentPurpose.registration, online: false);

    expect(requirement.state, ConsentRequirementState.unavailable);
    expect(requirement.notice, isNull);
  });

  test('offline cached notice with no response requires a decision', () async {
    final store = ConsentLocalStore(SecureStorageService());
    await store.writeCachedNotice(noticeV1.toJson());

    final requirement = await subject(
      FakeConsentRepository(),
      store,
    ).check(ConsentPurpose.registration, online: false);

    expect(requirement.state, ConsentRequirementState.needsDecision);
    expect(requirement.requiresReconsent, isFalse);
    expect(requirement.notice?.body, noticeV1.body);
  });

  test('offline grant from an old guest identity authorizes nothing', () async {
    final storage = SecureStorageService();
    final store = ConsentLocalStore(storage);
    await store.writeCachedNotice(noticeV1.toJson());
    await store.append(
      StoredConsentRecord(
        recordId: '11111111-1111-4111-8111-111111111111',
        noticeId: noticeV1.id,
        noticeVersion: noticeV1.version,
        purpose: ConsentPurpose.registration,
        decision: ConsentDecision.granted,
        respondedAt: DateTime.utc(2026, 1, 2),
        devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
        syncState: ConsentSyncState.synced,
      ),
    );
    await storage.writeValue('device_pseudo_id', 'QrStUvWxYzAbCdEfGhIj_-');
    final service = ConsentService(
      FakeConsentRepository(),
      store,
      GuestIdentityService(storage),
    );

    final requirement = await service.check(
      ConsentPurpose.registration,
      online: false,
    );

    expect(requirement.state, ConsentRequirementState.needsDecision);
    expect(requirement.requiresReconsent, isFalse);
  });

  test('a prior grant for another notice version requires reconsent', () async {
    final storage = SecureStorageService();
    final store = ConsentLocalStore(storage);
    await storage.writeValue('device_pseudo_id', 'AbCdEfGhIjKlMnOpQrSt_-');
    await store.writeCachedNotice(noticeV2.toJson());
    await store.append(
      StoredConsentRecord(
        recordId: '11111111-1111-4111-8111-111111111111',
        noticeId: noticeV1.id,
        noticeVersion: noticeV1.version,
        purpose: ConsentPurpose.registration,
        decision: ConsentDecision.granted,
        respondedAt: DateTime.utc(2026, 1, 2),
        devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
        syncState: ConsentSyncState.synced,
      ),
    );

    final requirement = await subject(
      FakeConsentRepository(),
      store,
    ).check(ConsentPurpose.registration, online: false);

    expect(requirement.state, ConsentRequirementState.needsDecision);
    expect(requirement.requiresReconsent, isTrue);
    expect(requirement.notice?.version, '2');
  });

  test('a locally stale grant never authorizes offline collection', () async {
    final storage = SecureStorageService();
    final store = ConsentLocalStore(storage);
    await storage.writeValue('device_pseudo_id', 'AbCdEfGhIjKlMnOpQrSt_-');
    await store.writeCachedNotice(noticeV1.toJson());
    await store.append(
      StoredConsentRecord(
        recordId: '22222222-2222-4222-8222-222222222222',
        noticeId: noticeV1.id,
        noticeVersion: noticeV1.version,
        purpose: ConsentPurpose.registration,
        decision: ConsentDecision.granted,
        respondedAt: DateTime.utc(2026, 1, 2),
        devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
        syncState: ConsentSyncState.stale,
      ),
    );

    final requirement = await subject(
      FakeConsentRepository(),
      store,
    ).check(ConsentPurpose.registration, online: false);

    expect(requirement.state, ConsentRequirementState.unavailable);
  });

  test(
    'decline is persisted and never authorizes the dependent action',
    () async {
      final store = ConsentLocalStore(SecureStorageService());
      final service = subject(FakeConsentRepository(), store);

      final result = await service.recordDecision(
        purpose: ConsentPurpose.registration,
        notice: noticeV1,
        decision: ConsentDecision.declined,
        online: false,
      );

      expect(result, ConsentGateResult.declined);
      final saved = (await store.readRecords()).single;
      expect(saved.decision, ConsentDecision.declined);
      expect(saved.devicePseudoId, hasLength(22));
      expect(saved.syncState, ConsentSyncState.pending);
    },
  );

  test(
    'withdrawal is durable offline and shuts the gate like a decline',
    () async {
      final store = ConsentLocalStore(SecureStorageService());
      final service = subject(FakeConsentRepository(), store);

      // SA-7. The moment somebody changes their mind is rarely the moment they
      // have a signal, so a withdrawal queues and retries like anything else.
      final result = await service.recordDecision(
        purpose: ConsentPurpose.survey,
        notice: noticeV1,
        decision: ConsentDecision.withdrawn,
        online: false,
      );

      expect(result, ConsentGateResult.declined);
      final saved = (await store.readRecords()).single;
      expect(saved.decision, ConsentDecision.withdrawn);
      expect(saved.syncState, ConsentSyncState.pending);
    },
  );

  test(
    'a withdrawal reaches the server as a withdrawal, not as a decline',
    () async {
      final store = ConsentLocalStore(SecureStorageService());
      final repository = FakeConsentRepository();
      final service = subject(repository, store);

      await service.recordDecision(
        purpose: ConsentPurpose.survey,
        notice: noticeV1,
        decision: ConsentDecision.withdrawn,
        online: true,
      );

      // Declining is never having agreed; withdrawing is having agreed and
      // changed your mind, and the server has to be told which happened.
      expect(repository.synced.single.decision, ConsentDecision.withdrawn);
    },
  );

  test(
    'online grant is durable before sync and becomes grantedSynced on ack',
    () async {
      final store = ConsentLocalStore(SecureStorageService());
      final repository = FakeConsentRepository();
      final service = subject(repository, store);

      final result = await service.recordDecision(
        purpose: ConsentPurpose.registration,
        notice: noticeV1,
        decision: ConsentDecision.granted,
        online: true,
      );

      expect(result, ConsentGateResult.grantedSynced);
      expect(
        repository.synced.single.recordId,
        'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
      );
      expect(
        (await store.readRecords()).single.syncState,
        ConsentSyncState.synced,
      );
    },
  );

  test(
    'failed online grant remains queued and cannot authorize registration',
    () async {
      final store = ConsentLocalStore(SecureStorageService());
      final repository = FakeConsentRepository(
        syncError: StateError('offline'),
      );

      final result = await subject(repository, store).recordDecision(
        purpose: ConsentPurpose.registration,
        notice: noticeV1,
        decision: ConsentDecision.granted,
        online: true,
      );

      expect(result, ConsentGateResult.grantedQueued);
      expect((await store.readPending()).single.recordId, isNotEmpty);
    },
  );

  test('new decisions use backend-compatible millisecond precision', () async {
    final store = ConsentLocalStore(SecureStorageService());
    final service = ConsentService(
      FakeConsentRepository(),
      store,
      GuestIdentityService(SecureStorageService()),
      idGenerator: () => 'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
      clock: () => DateTime.parse('2026-08-24T01:02:03.123456Z'),
    );

    await service.recordDecision(
      purpose: ConsentPurpose.registration,
      notice: noticeV1,
      decision: ConsentDecision.granted,
      online: false,
    );

    expect(
      (await store.readRecords()).single.respondedAt.toIso8601String(),
      '2026-08-24T01:02:03.123Z',
    );
  });

  test('syncPending is FIFO and shares one in-flight drain', () async {
    final store = ConsentLocalStore(SecureStorageService());
    for (var index = 0; index < 2; index++) {
      await store.append(
        StoredConsentRecord(
          recordId:
              '00000000-0000-4000-8000-${index.toString().padLeft(12, '0')}',
          noticeId: noticeV1.id,
          noticeVersion: noticeV1.version,
          purpose: ConsentPurpose.registration,
          decision: ConsentDecision.granted,
          respondedAt: DateTime.utc(2026, 8, 24, 1, index),
          devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
          syncState: ConsentSyncState.pending,
        ),
      );
    }
    final release = Completer<void>();
    final repository = FakeConsentRepository(syncBarrier: release.future);
    final service = subject(repository, store);

    final first = service.syncPending();
    final second = service.syncPending();
    await Future<void>.delayed(Duration.zero);
    expect(repository.maxConcurrentSyncs, 1);
    release.complete();
    await Future.wait([first, second]);

    expect(repository.synced.map((record) => record.recordId), <String>[
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000001',
    ]);
    expect(await store.readPending(), isEmpty);
  });

  test(
    'a transient sync failure remains pending and retries with the same ID',
    () async {
      final store = ConsentLocalStore(SecureStorageService());
      final pending = StoredConsentRecord(
        recordId: '00000000-0000-4000-8000-000000000007',
        noticeId: noticeV1.id,
        noticeVersion: noticeV1.version,
        purpose: ConsentPurpose.registration,
        decision: ConsentDecision.granted,
        respondedAt: DateTime.utc(2026, 8, 24, 1, 7),
        devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
        syncState: ConsentSyncState.pending,
      );
      await store.append(pending);
      final repository = FakeConsentRepository(
        syncError: StateError('timeout'),
      );
      final service = subject(repository, store);

      await service.syncPending();
      expect((await store.readPending()).single.recordId, pending.recordId);

      repository.syncError = null;
      await service.syncPending();
      expect(repository.synced.single.recordId, pending.recordId);
      expect(await store.readPending(), isEmpty);
    },
  );

  test(
    'a stale 409 is retired from the queue and refreshes reconsent state',
    () async {
      final store = ConsentLocalStore(SecureStorageService());
      final stale = StoredConsentRecord(
        recordId: '00000000-0000-4000-8000-000000000008',
        noticeId: noticeV1.id,
        noticeVersion: noticeV1.version,
        purpose: ConsentPurpose.registration,
        decision: ConsentDecision.granted,
        respondedAt: DateTime.utc(2026, 8, 24, 1, 8),
        devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
        syncState: ConsentSyncState.pending,
      );
      await store.append(stale);
      final requestOptions = RequestOptions(path: '/api/v1/pisocamp/consent');
      final repository = FakeConsentRepository(
        status: ConsentStatus(
          purpose: ConsentPurpose.registration,
          state: ConsentServerState.requiresReconsent,
          notice: noticeV2,
        ),
        syncError: DioException(
          requestOptions: requestOptions,
          response: Response<void>(
            requestOptions: requestOptions,
            statusCode: 409,
          ),
        ),
      );

      await subject(repository, store).syncPending();

      expect(await store.readPending(), isEmpty);
      expect(
        (await store.readRecords()).single.syncState,
        ConsentSyncState.stale,
      );
      expect(repository.fetchCount, 1);
    },
  );
}

class FakeConsentRepository implements ConsentRepository {
  FakeConsentRepository({this.status, this.syncError, this.syncBarrier});

  final ConsentStatus? status;
  Object? syncError;
  final Future<void>? syncBarrier;
  final List<StoredConsentRecord> synced = [];
  int _activeSyncs = 0;
  int maxConcurrentSyncs = 0;
  int fetchCount = 0;

  @override
  Future<ConsentStatus> fetchStatus(
    ConsentPurpose purpose, {
    required String devicePseudoId,
  }) async {
    fetchCount++;
    final value = status;
    if (value == null) throw StateError('No status response');
    return value;
  }

  @override
  Future<PrivacyNotice?> readCachedNotice() async => null;

  @override
  Future<RecordedConsentAcknowledgement> sync(
    StoredConsentRecord record,
  ) async {
    _activeSyncs++;
    if (_activeSyncs > maxConcurrentSyncs) maxConcurrentSyncs = _activeSyncs;
    try {
      if (syncError != null) throw syncError!;
      if (syncBarrier != null) await syncBarrier;
      synced.add(record);
      return RecordedConsentAcknowledgement(
        id: record.recordId,
        state: record.decision == ConsentDecision.granted
            ? ConsentServerState.granted
            : ConsentServerState.declined,
        recordedAt: DateTime.utc(2026, 8, 24, 1, 3),
      );
    } finally {
      _activeSyncs--;
    }
  }
}
