import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/analytics_repository.dart';

void main() {
  test(
    'uploads exactly one events payload to the versioned ingestion route',
    () async {
      final events = <AnalyticsEvent>[_event(1), _event(2)];
      final adapter = _RecordingAdapter((options) {
        expect(options.method, 'POST');
        expect(options.path, ApiConstants.pisoCampEvents);
        expect(options.headers.containsKey('Idempotency-Key'), isFalse);
        expect(options.data, <String, Object?>{
          'events': events
              .map((event) => event.toJson())
              .toList(growable: false),
        });
        return _jsonResponse(<String, Object?>{
          'ackedEventIds': <String>[events[1].eventId, events[0].eventId],
        });
      });

      final acknowledged = await AnalyticsRepository(
        _dio(adapter),
      ).upload(events);

      expect(acknowledged, <String>[events[1].eventId, events[0].eventId]);
      expect(adapter.calls, 1);
      expect(
        ApiConstants.pisoCampEvents,
        '${ApiConstants.versionedUrl}/pisocamp/events',
      );
    },
  );

  test('rejects an empty batch locally without transport', () async {
    final adapter = _RecordingAdapter(
      (_) => _jsonResponse(<String, Object?>{}),
    );

    await expectLater(
      AnalyticsRepository(_dio(adapter)).upload(const <AnalyticsEvent>[]),
      _failure(AnalyticsRepositoryFailureKind.permanent, 'emptyBatch'),
    );

    expect(adapter.calls, 0);
  });

  test(
    'rejects malformed, foreign, duplicate, and unknown acknowledgement payloads',
    () async {
      final event = _event(1);
      final cases = <Object?>[
        <String, Object?>{'ackedEventIds': 'not-a-list'},
        <String, Object?>{
          'ackedEventIds': <String>[_id(2)],
        },
        <String, Object?>{
          'ackedEventIds': <String>[event.eventId, event.eventId],
        },
        <String, Object?>{
          'ackedEventIds': <String>[event.eventId],
          'extra': true,
        },
      ];

      for (final response in cases) {
        await expectLater(
          AnalyticsRepository(
            _dio(_RecordingAdapter((_) => _jsonResponse(response))),
          ).upload(<AnalyticsEvent>[event]),
          _failure(
            AnalyticsRepositoryFailureKind.permanent,
            'invalidAcknowledgement',
          ),
        );
      }
    },
  );

  test(
    'classifies status, timeout, and cancellation failures without body exposure',
    () async {
      final event = _event(1);
      final cases = <_FailureCase>[
        _FailureCase(
          _jsonResponse(<String, Object?>{'sensitive': 'body'}, status: 400),
          AnalyticsRepositoryFailureKind.permanent,
          'http4xx',
        ),
        _FailureCase(
          _jsonResponse(<String, Object?>{'sensitive': 'body'}, status: 500),
          AnalyticsRepositoryFailureKind.transient,
          'http5xx',
        ),
        _FailureCase(
          null,
          AnalyticsRepositoryFailureKind.transient,
          'timeout',
          type: DioExceptionType.connectionTimeout,
        ),
        _FailureCase(
          null,
          AnalyticsRepositoryFailureKind.cancelled,
          'cancelled',
          type: DioExceptionType.cancel,
        ),
      ];

      for (final failure in cases) {
        final adapter = _RecordingAdapter((options) {
          final response = failure.response;
          if (response != null) return response;
          throw DioException(requestOptions: options, type: failure.type!);
        });
        await expectLater(
          AnalyticsRepository(_dio(adapter)).upload(<AnalyticsEvent>[event]),
          _failure(failure.kind, failure.code),
        );
      }
    },
  );

  test(
    'rejects null non-map and malformed UUID acknowledgement values',
    () async {
      for (final response in <Object?>[
        null,
        <Object?>[],
        <String, Object?>{
          'ackedEventIds': <String>['malformed'],
        },
      ]) {
        await expectLater(
          AnalyticsRepository(
            _dio(_RecordingAdapter((_) => _jsonResponse(response))),
          ).upload(<AnalyticsEvent>[_event(1)]),
          _failure(
            AnalyticsRepositoryFailureKind.permanent,
            'invalidAcknowledgement',
          ),
        );
      }
    },
  );

  test(
    'classifies a connection error as redacted transient network failure',
    () async {
      final repository = AnalyticsRepository(
        _dio(
          _RecordingAdapter(
            (options) => throw DioException(
              requestOptions: options,
              type: DioExceptionType.connectionError,
              error: StateError('secret response body'),
            ),
          ),
        ),
      );
      await expectLater(
        repository.upload(<AnalyticsEvent>[_event(1)]),
        _failure(AnalyticsRepositoryFailureKind.transient, 'network'),
      );
    },
  );
}

Matcher _failure(AnalyticsRepositoryFailureKind kind, String code) => throwsA(
  isA<AnalyticsRepositoryException>()
      .having((error) => error.kind, 'classification', kind)
      .having((error) => error.code, 'stable code', code)
      .having(
        (error) => error.toString(),
        'redacted text',
        'AnalyticsRepositoryException($code)',
      ),
);

Dio _dio(HttpClientAdapter adapter) => Dio()..httpClientAdapter = adapter;

ResponseBody _jsonResponse(Object? value, {int status = 200}) =>
    ResponseBody.fromString(
      jsonEncode(value),
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[Headers.jsonContentType],
      },
    );

AnalyticsEvent _event(int value) => AnalyticsEvent.build(
  intent: ContentViewIntent('currency.ngc.php-20'),
  context: const AnalyticsEventContext(
    subjectPseudoId: 'AbCdEfGhIjKlMnOpQrStUv',
    sessionId: 'f6635d24-b4d1-4f63-8a06-4026fa4e8fd6',
    accountType: AnalyticsAccountType.guest,
    appVersion: '1.0.0+1',
    osName: AnalyticsOsName.android,
    osVersion: 'Android 15',
    deviceCategory: AnalyticsDeviceCategory.phone,
    networkState: AnalyticsNetworkState.offline,
  ),
  createEventId: () => _id(value),
  clock: () => DateTime.utc(2026, 8, 30, 1, 2, 3, value),
);

String _id(int value) =>
    '00000000-0000-4000-8000-${value.toString().padLeft(12, '0')}';

final class _RecordingAdapter implements HttpClientAdapter {
  _RecordingAdapter(this._handler);

  final ResponseBody Function(RequestOptions options) _handler;
  var calls = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls++;
    return _handler(options);
  }

  @override
  void close({bool force = false}) {}
}

final class _FailureCase {
  const _FailureCase(this.response, this.kind, this.code, {this.type});

  final ResponseBody? response;
  final AnalyticsRepositoryFailureKind kind;
  final String code;
  final DioExceptionType? type;
}
