import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/push_repository.dart';

class _FixedTokenProvider implements PushTokenProvider {
  const _FixedTokenProvider(this.value);

  final String? value;

  @override
  Future<String?> token() async => value;
}

Dio _dio({
  required Object? Function(RequestOptions options) respond,
  List<RequestOptions>? seen,
}) {
  final dio = Dio();
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) {
        seen?.add(options);
        final body = respond(options);
        if (body == null) {
          handler.reject(
            DioException(requestOptions: options, message: 'refused'),
          );
          return;
        }
        handler.resolve(
          Response<Object?>(requestOptions: options, statusCode: 200, data: body),
        );
      },
    ),
  );
  return dio;
}

void main() {
  const subscribed = <String, Object?>{
    'subscribed': true,
    'platform': 'android',
    'subscribedAt': '2026-09-03T10:00:00.000Z',
  };
  const notSubscribed = <String, Object?>{
    'subscribed': false,
    'platform': null,
    'subscribedAt': null,
  };

  test('opting in sends the device token and the platform', () async {
    final seen = <RequestOptions>[];
    final repository = PushRepository(
      _dio(respond: (_) => subscribed, seen: seen),
      tokens: const _FixedTokenProvider('device-token-0123456789'),
    );

    final status = await repository.subscribe(platform: 'android');

    expect(status.subscribed, isTrue);
    expect(seen.single.method, 'POST');
    expect(seen.single.data, <String, Object?>{
      'deviceToken': 'device-token-0123456789',
      'platform': 'android',
    });
  });

  test('a build with no push service says so instead of sending', () async {
    final seen = <RequestOptions>[];
    final repository = PushRepository(
      _dio(respond: (_) => subscribed, seen: seen),
      tokens: const _FixedTokenProvider(null),
    );

    // Storing a token nothing could deliver to would be a subscription in
    // name only.
    await expectLater(
      repository.subscribe(platform: 'android'),
      throwsA(
        isA<PushSubscriptionException>().having(
          (error) => error.code,
          'code',
          'tokenUnavailable',
        ),
      ),
    );
    expect(seen, isEmpty);
  });

  test('opting out asks the server to remove the subscription', () async {
    final seen = <RequestOptions>[];
    final repository = PushRepository(
      _dio(respond: (_) => notSubscribed, seen: seen),
    );

    final status = await repository.unsubscribe();

    expect(status.subscribed, isFalse);
    expect(seen.single.method, 'DELETE');
  });

  test('a refused request is reported rather than swallowed', () async {
    final repository = PushRepository(_dio(respond: (_) => null));

    await expectLater(
      repository.status(),
      throwsA(
        isA<PushSubscriptionException>().having(
          (error) => error.code,
          'code',
          'requestFailed',
        ),
      ),
    );
  });

  test('a receipt names the notification and what happened to it', () async {
    final seen = <RequestOptions>[];
    final repository = PushRepository(
      _dio(
        respond: (_) => <String, Object?>{
          'notificationId': '1f1d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61',
          'status': 'delivered',
          'opened': true,
          'clicked': false,
        },
        seen: seen,
      ),
    );

    await repository.reportReceipt(
      notificationId: '1f1d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61',
      event: 'opened',
    );

    expect(seen.single.data, <String, Object?>{
      'notificationId': '1f1d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61',
      'event': 'opened',
    });
  });

  test('a malformed status is refused rather than half-read', () async {
    final repository = PushRepository(
      _dio(respond: (_) => <String, Object?>{'subscribed': 'yes'}),
    );

    await expectLater(
      repository.status(),
      throwsA(isA<PushSubscriptionException>()),
    );
  });
}
