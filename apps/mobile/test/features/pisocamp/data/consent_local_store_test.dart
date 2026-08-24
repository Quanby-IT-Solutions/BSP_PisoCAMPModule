import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  StoredConsentRecord record(int sequence) => StoredConsentRecord(
    recordId: '00000000-0000-4000-8000-${sequence.toString().padLeft(12, '0')}',
    noticeId: '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
    noticeVersion: '1',
    purpose: ConsentPurpose.registration,
    decision: ConsentDecision.granted,
    respondedAt: DateTime.utc(2026, 8, 24, 10, sequence),
    devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
    syncState: ConsentSyncState.pending,
  );

  test(
    'concurrent appends preserve every immutable record in FIFO order',
    () async {
      final store = ConsentLocalStore(SecureStorageService());

      await Future.wait(
        List.generate(8, (index) => store.append(record(index))),
      );

      final records = await store.readRecords();
      expect(records, hasLength(8));
      expect(
        records.map((item) => item.recordId),
        List.generate(
          8,
          (index) =>
              '00000000-0000-4000-8000-${index.toString().padLeft(12, '0')}',
        ),
      );
    },
  );

  test(
    'marking a record synced preserves the decision and removes it from pending',
    () async {
      final store = ConsentLocalStore(SecureStorageService());
      await store.append(record(1));

      await store.markSynced(record(1).recordId);

      final records = await store.readRecords();
      expect(records.single.decision, ConsentDecision.granted);
      expect(records.single.syncState, ConsentSyncState.synced);
      expect(await store.readPending(), isEmpty);
    },
  );

  test(
    'duplicate record IDs are idempotent but conflicting payloads fail closed',
    () async {
      final store = ConsentLocalStore(SecureStorageService());
      await store.append(record(1));
      await store.append(record(1));

      expect(await store.readRecords(), hasLength(1));

      final conflict = record(2).copyWith(recordId: record(1).recordId);
      await expectLater(store.append(conflict), throwsA(isA<StateError>()));
      expect(await store.readRecords(), hasLength(1));
    },
  );

  test('corrupt encrypted state fails closed without overwriting it', () async {
    FlutterSecureStorage.setMockInitialValues({
      'pisocamp_consent_state_v1': '{not valid json',
    });
    final storage = SecureStorageService();
    final store = ConsentLocalStore(storage);

    await expectLater(
      store.readRecords(),
      throwsA(isA<ConsentStoreException>()),
    );
    await expectLater(
      store.append(record(1)),
      throwsA(isA<ConsentStoreException>()),
    );
    expect(
      await storage.readValue('pisocamp_consent_state_v1'),
      '{not valid json',
    );
  });

  test(
    'well-formed JSON with an invalid guest identity also fails closed',
    () async {
      final encoded = jsonEncode(<String, Object?>{
        'schemaVersion': 1,
        'records': <Object?>[
          <String, Object?>{
            'recordId': '00000000-0000-4000-8000-000000000001',
            'noticeId': '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
            'noticeVersion': '1',
            'purpose': 'registration',
            'decision': 'granted',
            'respondedAt': '2026-08-24T01:02:03.000Z',
            'devicePseudoId': 'short',
            'syncState': 'pending',
          },
        ],
      });
      FlutterSecureStorage.setMockInitialValues({
        'pisocamp_consent_state_v1': encoded,
      });

      await expectLater(
        ConsentLocalStore(SecureStorageService()).readRecords(),
        throwsA(isA<ConsentStoreException>()),
      );
    },
  );

  test(
    'cached notice JSON survives store recreation in encrypted storage',
    () async {
      final storage = SecureStorageService();
      final store = ConsentLocalStore(storage);
      const notice = <String, Object?>{
        'id': 'notice-v1',
        'version': '1',
        'title': 'Privacy Notice',
        'body': 'Explicit fake notice text for tests.',
      };

      await store.writeCachedNotice(notice);

      final restored = ConsentLocalStore(SecureStorageService());
      expect(await restored.readCachedNotice(), notice);
    },
  );
}
