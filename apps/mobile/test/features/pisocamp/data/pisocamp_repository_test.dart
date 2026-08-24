import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/pisocamp_repository.dart';
import 'dart:async';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  Dio dioRespondingWith(Object? data) {
    final dio = Dio();
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) => handler.resolve(
          Response<Object?>(
            requestOptions: options,
            statusCode: 200,
            data: data,
          ),
        ),
      ),
    );
    return dio;
  }

  Dio offlineDio() {
    final dio = Dio();
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) => handler.reject(
          DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          ),
        ),
      ),
    );
    return dio;
  }

  test(
    'returns packaged cards when the config request has a connection error',
    () async {
      final result = await PisoCampRepository(offlineDio()).loadHome().last;

      expect(result.isOffline, isTrue);
      expect(result.home.title, 'Piso CAMP');
      expect(
        result.home.cards.map((card) => card.title),
        containsAll(<String>['Banknotes', 'Coins']),
      );
    },
  );

  test(
    'emits packaged content before a pending config request completes',
    () async {
      final response = Completer<Object?>();
      final dio = Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) async => handler.resolve(
              Response<Object?>(
                requestOptions: options,
                statusCode: 200,
                data: await response.future,
              ),
            ),
          ),
        );
      final updates = PisoCampRepository(dio).loadHome();

      final first = await updates.first;

      expect(first.home.title, 'Piso CAMP');
      expect(first.isOffline, isTrue);
      response.complete(<String, Object>{
        'module_enabled': true,
        'account_prompt_enabled': true,
        'config_version': 'seed-1',
      });
    },
  );

  test('preserves validated module and account-prompt flags', () async {
    final updates = PisoCampRepository(
      dioRespondingWith(<String, Object>{
        'module_enabled': false,
        'account_prompt_enabled': false,
        'config_version': 'seed-1',
      }),
    ).loadHome().last;

    final result = await updates;

    expect(result.moduleEnabled, isFalse);
    expect(result.accountPromptEnabled, isFalse);
  });

  test('is online only after the complete public config validates', () async {
    final result = await PisoCampRepository(
      dioRespondingWith(<String, Object>{
        'module_enabled': true,
        'account_prompt_enabled': true,
        'config_version': 'seed-1',
      }),
    ).loadHome().last;

    expect(result.isOffline, isFalse);
  });

  test(
    'falls back offline when the config response contains an extra key',
    () async {
      final result = await PisoCampRepository(
        dioRespondingWith(<String, Object>{
          'module_enabled': true,
          'account_prompt_enabled': true,
          'config_version': 'seed-1',
          'secret': 'must-not-leak',
        }),
      ).loadHome().last;

      expect(result.isOffline, isTrue);
      expect(result.home.title, 'Piso CAMP');
    },
  );
}
