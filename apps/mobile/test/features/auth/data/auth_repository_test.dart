import 'dart:io';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';

void main() {
  late Directory cookieDirectory;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    cookieDirectory = await Directory.systemTemp.createTemp(
      'pisocamp-signup-test-',
    );
  });

  tearDown(() async {
    await cookieDirectory.delete(recursive: true);
  });

  test(
    'a successful signup without a token requires verification and stores no token',
    () async {
      final storage = SecureStorageService();
      final dio = Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) => handler.resolve(
              Response<Map<String, dynamic>>(
                requestOptions: options,
                statusCode: 200,
                data: <String, dynamic>{
                  'token': null,
                  'user': <String, dynamic>{
                    'id': 'user-1',
                    'name': 'Test User',
                    'email': 'test@example.com',
                    'emailVerified': false,
                  },
                },
              ),
            ),
          ),
        );
      final repository = AuthRepository(
        dio,
        storage,
        PersistCookieJar(storage: FileStorage(cookieDirectory.path)),
      );

      final outcome = await repository.signUp(
        email: 'test@example.com',
        password: 'correct horse battery staple',
        name: 'Test User',
      );

      expect(outcome.state, AuthSignUpState.verificationRequired);
      expect(outcome.session, isNull);
      expect(outcome.user.id, 'user-1');
      expect(await storage.getSessionToken(), isNull);
    },
  );
}
