import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_repository.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';

void main() {
  const noticeResponse = <String, Object?>{
    'purpose': 'registration',
    'state': 'requires_reconsent',
    'notice': <String, Object?>{
      'id': '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
      'version': '2024-12-26',
      'title': 'BSP Mobile App Privacy Notice',
      'body': 'Explicit fake notice text for tests.',
      'sourceUrl':
          'https://www.bsp.gov.ph/Pages/AboutTheBank/MobileAppPrivacyNotice.aspx',
      'contentSha256':
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'effectiveAt': '2024-12-26T00:00:00.000Z',
    },
  };

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  test(
    'GET parses and caches the strict active full notice response',
    () async {
      late RequestOptions request;
      final dio = Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              request = options;
              handler.resolve(
                Response<Object?>(
                  requestOptions: options,
                  statusCode: 200,
                  data: noticeResponse,
                ),
              );
            },
          ),
        );
      final store = ConsentLocalStore(SecureStorageService());
      final repository = ConsentRepository(dio, store);

      final status = await repository.fetchStatus(
        ConsentPurpose.registration,
        devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
      );

      expect(request.method, 'GET');
      expect(request.uri.path, '/api/v1/pisocamp/consent/registration');
      expect(request.headers['X-Device-Pseudo-Id'], 'AbCdEfGhIjKlMnOpQrSt_-');
      expect(status.state, ConsentServerState.requiresReconsent);
      expect(status.notice.body, 'Explicit fake notice text for tests.');
      expect(status.notice.sourceUrl.host, 'www.bsp.gov.ph');
      expect((await repository.readCachedNotice())?.version, '2024-12-26');
    },
  );

  test(
    'GET rejects unknown response fields and does not poison the cache',
    () async {
      final malformed = <String, Object?>{
        ...noticeResponse,
        'accountId': 'must-not-leak',
      };
      final dio = Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) => handler.resolve(
              Response<Object?>(
                requestOptions: options,
                statusCode: 200,
                data: malformed,
              ),
            ),
          ),
        );
      final repository = ConsentRepository(
        dio,
        ConsentLocalStore(SecureStorageService()),
      );

      await expectLater(
        repository.fetchStatus(
          ConsentPurpose.registration,
          devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
        ),
        throwsA(isA<FormatException>()),
      );
      expect(await repository.readCachedNotice(), isNull);
    },
  );

  test('GET rejects an unknown state without mutating the cache', () async {
    final store = ConsentLocalStore(SecureStorageService());
    await store.writeCachedNotice(<String, Object?>{
      ...(noticeResponse['notice']! as Map<String, Object?>),
      'version': 'cached-before-invalid-response',
    });
    final malformed = <String, Object?>{
      ...noticeResponse,
      'state': 'future_unknown_state',
    };
    final dio = Dio()
      ..interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) => handler.resolve(
            Response<Object?>(
              requestOptions: options,
              statusCode: 200,
              data: malformed,
            ),
          ),
        ),
      );
    final repository = ConsentRepository(dio, store);

    await expectLater(
      repository.fetchStatus(
        ConsentPurpose.registration,
        devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
      ),
      throwsA(isA<FormatException>()),
    );

    expect(
      (await repository.readCachedNotice())?.version,
      'cached-before-invalid-response',
    );
  });

  test('GET rejects a notice whose identifier is not a UUID', () async {
    final malformedNotice = <String, Object?>{
      ...noticeResponse,
      'notice': <String, Object?>{
        ...(noticeResponse['notice']! as Map<String, Object?>),
        'id': 'not-a-uuid',
      },
    };
    final dio = Dio()
      ..interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) => handler.resolve(
            Response<Object?>(
              requestOptions: options,
              statusCode: 200,
              data: malformedNotice,
            ),
          ),
        ),
      );
    final repository = ConsentRepository(
      dio,
      ConsentLocalStore(SecureStorageService()),
    );

    await expectLater(
      repository.fetchStatus(
        ConsentPurpose.registration,
        devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
      ),
      throwsA(isA<FormatException>()),
    );
  });

  test(
    'POST sends the stable idempotent guest request without account identity',
    () async {
      late RequestOptions request;
      final dio = Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              request = options;
              handler.resolve(
                Response<Object?>(
                  requestOptions: options,
                  statusCode: 200,
                  data: const <String, Object?>{
                    'id': 'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
                    'purpose': 'registration',
                    'noticeId': '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
                    'noticeVersion': '2024-12-26',
                    'decision': 'granted',
                    'respondedAt': '2026-08-24T01:02:03.000Z',
                    'recordedAt': '2026-08-24T01:02:04.000Z',
                    'state': 'granted',
                  },
                ),
              );
            },
          ),
        );
      final repository = ConsentRepository(
        dio,
        ConsentLocalStore(SecureStorageService()),
      );
      final record = StoredConsentRecord(
        recordId: 'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
        noticeId: '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
        noticeVersion: '2024-12-26',
        purpose: ConsentPurpose.registration,
        decision: ConsentDecision.granted,
        respondedAt: DateTime.parse('2026-08-24T01:02:03.000Z'),
        devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
        syncState: ConsentSyncState.pending,
      );

      final acknowledgement = await repository.sync(record);

      expect(request.method, 'POST');
      expect(request.uri.path, '/api/v1/pisocamp/consent');
      expect(request.headers['X-Device-Pseudo-Id'], 'AbCdEfGhIjKlMnOpQrSt_-');
      expect(
        request.headers['Idempotency-Key'],
        'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
      );
      expect(request.data, <String, Object?>{
        'id': 'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
        'purpose': 'registration',
        'noticeId': '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
        'noticeVersion': '2024-12-26',
        'decision': 'granted',
        'respondedAt': '2026-08-24T01:02:03.000Z',
      });
      expect(
        (request.data as Map<String, Object?>).containsKey('accountId'),
        isFalse,
      );
      expect(acknowledgement.state, ConsentServerState.granted);
    },
  );

  test(
    'POST accepts backend millisecond normalization of respondedAt',
    () async {
      final dio = Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) => handler.resolve(
              Response<Object?>(
                requestOptions: options,
                statusCode: 200,
                data: const <String, Object?>{
                  'id': 'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
                  'purpose': 'registration',
                  'noticeId': '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
                  'noticeVersion': '2024-12-26',
                  'decision': 'granted',
                  'respondedAt': '2026-08-24T01:02:03.000Z',
                  'recordedAt': '2026-08-24T01:02:04.000Z',
                  'state': 'granted',
                },
              ),
            ),
          ),
        );
      final repository = ConsentRepository(
        dio,
        ConsentLocalStore(SecureStorageService()),
      );
      final record = StoredConsentRecord(
        recordId: 'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
        noticeId: '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
        noticeVersion: '2024-12-26',
        purpose: ConsentPurpose.registration,
        decision: ConsentDecision.granted,
        respondedAt: DateTime.parse('2026-08-24T01:02:03.000908Z'),
        devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
        syncState: ConsentSyncState.pending,
      );

      final acknowledgement = await repository.sync(record);

      expect(acknowledgement.state, ConsentServerState.granted);
    },
  );

  test('POST rejects an acknowledgement for another client record', () async {
    final dio = Dio()
      ..interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) => handler.resolve(
            Response<Object?>(
              requestOptions: options,
              statusCode: 200,
              data: const <String, Object?>{
                'id': '11111111-1111-4111-8111-111111111111',
                'purpose': 'registration',
                'noticeId': '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
                'noticeVersion': '2024-12-26',
                'decision': 'declined',
                'respondedAt': '2026-08-24T01:02:03.000Z',
                'recordedAt': '2026-08-24T01:02:04.000Z',
                'state': 'declined',
              },
            ),
          ),
        ),
      );
    final repository = ConsentRepository(
      dio,
      ConsentLocalStore(SecureStorageService()),
    );
    final record = StoredConsentRecord(
      recordId: 'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
      noticeId: '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
      noticeVersion: '2024-12-26',
      purpose: ConsentPurpose.registration,
      decision: ConsentDecision.declined,
      respondedAt: DateTime.parse('2026-08-24T01:02:03.000Z'),
      devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
      syncState: ConsentSyncState.pending,
    );

    await expectLater(repository.sync(record), throwsA(isA<FormatException>()));
  });

  test(
    'POST rejects a resulting state that contradicts the recorded decision',
    () async {
      final dio = Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) => handler.resolve(
              Response<Object?>(
                requestOptions: options,
                statusCode: 200,
                data: const <String, Object?>{
                  'id': 'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
                  'purpose': 'registration',
                  'noticeId': '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
                  'noticeVersion': '2024-12-26',
                  'decision': 'granted',
                  'respondedAt': '2026-08-24T01:02:03.000Z',
                  'recordedAt': '2026-08-24T01:02:04.000Z',
                  'state': 'declined',
                },
              ),
            ),
          ),
        );
      final repository = ConsentRepository(
        dio,
        ConsentLocalStore(SecureStorageService()),
      );
      final record = StoredConsentRecord(
        recordId: 'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
        noticeId: '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
        noticeVersion: '2024-12-26',
        purpose: ConsentPurpose.registration,
        decision: ConsentDecision.granted,
        respondedAt: DateTime.parse('2026-08-24T01:02:03.000Z'),
        devicePseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
        syncState: ConsentSyncState.pending,
      );

      await expectLater(
        repository.sync(record),
        throwsA(isA<FormatException>()),
      );
    },
  );
}
