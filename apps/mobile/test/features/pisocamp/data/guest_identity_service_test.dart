import 'dart:io';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/pisocamp/data/guest_identity_service.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  test(
    'returns the same non-empty URL-safe 128-bit id on repeat reads',
    () async {
      final service = GuestIdentityService(SecureStorageService());

      final first = await service.getOrCreateId();
      final second = await service.getOrCreateId();

      expect(first, second);
      expect(first, matches(RegExp(r'^[A-Za-z0-9_-]{22}$')));
    },
  );

  test(
    'continuing as guest persists the identity and continuation choice',
    () async {
      final service = GuestIdentityService(SecureStorageService());

      await service.continueAsGuest();

      final restored = GuestIdentityService(SecureStorageService());
      expect(
        await restored.getOrCreateId(),
        matches(RegExp(r'^[A-Za-z0-9_-]{22}$')),
      );
      expect(await restored.hasContinuedAsGuest(), isTrue);
    },
  );

  test('the first open is claimed once per install', () async {
    final service = GuestIdentityService(SecureStorageService());

    expect(await service.claimFirstOpen(), isTrue);
    expect(await service.claimFirstOpen(), isFalse);

    // A new instance reads the same storage: an install count that rose every
    // launch would not be an install count.
    final restarted = GuestIdentityService(SecureStorageService());
    expect(await restarted.claimFirstOpen(), isFalse);
  });

  test(
    'AuthRepository sign-out removes credentials but preserves the guest pseudo-ID',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'pisocamp-auth-test-',
      );
      addTearDown(() => directory.delete(recursive: true));
      final storage = SecureStorageService();
      final guest = GuestIdentityService(storage);
      final id = await guest.getOrCreateId();
      await storage.setSessionToken('session');
      await storage.setCookie('cookie');
      final dio = Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) => handler.resolve(
              Response<void>(requestOptions: options, statusCode: 200),
            ),
          ),
        );

      await AuthRepository(
        dio,
        storage,
        PersistCookieJar(storage: FileStorage(directory.path)),
      ).signOut();

      expect(await guest.getOrCreateId(), id);
      expect(await storage.getSessionToken(), isNull);
      expect(await storage.getCookie(), isNull);
    },
  );
}
