import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/features/pisocamp/data/trivia_repository.dart';

import 'trivia_response_store_test.dart' show record;

void main() {
  test('posts the batch to the versioned route and returns the ids', () async {
    final responses = [record(1), record(2)];
    final adapter = _RecordingAdapter((options) {
      expect(options.method, 'POST');
      expect(options.path, ApiConstants.pisoCampTriviaResponses);
      expect(options.data, {
        'responses': [
          for (final response in responses) response.toUploadJson(),
        ],
      });
      return _jsonResponse({
        'ackedResponseIds': [
          responses[1].responseId,
          responses[0].responseId,
        ],
      });
    });

    final acknowledged = await TriviaRepository(_dio(adapter)).upload(responses);

    expect(acknowledged, [responses[1].responseId, responses[0].responseId]);
    expect(adapter.calls, 1);
    expect(
      ApiConstants.pisoCampTriviaResponses,
      '${ApiConstants.versionedUrl}/pisocamp/trivia/responses',
    );
  });

  test('sends nothing the device did not record', () async {
    // The upload shape is the contract's, and `synced` is device bookkeeping.
    final sent = record(1, synced: true).toUploadJson();

    expect(sent.containsKey('synced'), isFalse);
    expect(sent['answeredAt'], '2026-09-02T04:01:00.000Z');
    expect(sent['difficulty'], 'easy');
  });

  test('refuses an empty batch without reaching the network', () async {
    final adapter = _RecordingAdapter((_) => _jsonResponse(const {}));

    await expectLater(
      TriviaRepository(_dio(adapter)).upload(const []),
      throwsA(
        isA<TriviaSyncException>().having(
          (error) => error.code,
          'code',
          'emptyBatch',
        ),
      ),
    );
    expect(adapter.calls, 0);
  });

  group('acknowledgements', () {
    Future<void> rejects(Object? body) async {
      await expectLater(
        TriviaRepository(
          _dio(_RecordingAdapter((_) => _jsonResponse(body))),
        ).upload([record(1)]),
        throwsA(
          isA<TriviaSyncException>()
              .having((error) => error.code, 'code', 'invalidAcknowledgement')
              .having(
                (error) => error.kind,
                'kind',
                TriviaSyncFailureKind.permanent,
              ),
        ),
      );
    }

    test('rejects a body that is not the acknowledgement', () async {
      await rejects(const []);
      await rejects(const {});
      await rejects(const {'ackedResponseIds': 'all of them'});
      await rejects({'ackedResponseIds': [], 'extra': true});
    });

    test('rejects an id nobody sent', () async {
      // Deleting on the strength of one would lose an answer.
      await rejects({
        'ackedResponseIds': ['8e2a4a6c-6d0b-4a1a-9d1e-000000000009'],
      });
    });

    test('rejects a repeated or malformed id', () async {
      await rejects({
        'ackedResponseIds': [record(1).responseId, record(1).responseId],
      });
      await rejects({
        'ackedResponseIds': ['not-a-uuid'],
      });
    });

    test('accepts an empty acknowledgement as nothing stored', () async {
      final acknowledged = await TriviaRepository(
        _dio(
          _RecordingAdapter(
            (_) => _jsonResponse(const {'ackedResponseIds': []}),
          ),
        ),
      ).upload([record(1)]);

      expect(acknowledged, isEmpty);
    });
  });

  group('failure classification', () {
    Future<TriviaSyncException> upload({
      int? status,
      DioExceptionType type = DioExceptionType.badResponse,
    }) async {
      final adapter = _ThrowingAdapter(status: status, type: type);
      try {
        await TriviaRepository(_dio(adapter)).upload([record(1)]);
      } on TriviaSyncException catch (error) {
        return error;
      }
      fail('expected a TriviaSyncException');
    }

    test('a deactivated account is rejected, not retried', () async {
      final error = await upload(status: 401);

      expect(error.kind, TriviaSyncFailureKind.rejected);
      expect(error.code, 'accountNotPermitted');
      expect(error.httpStatusClass, 4);
    });

    test('a forbidden account is rejected too', () async {
      expect((await upload(status: 403)).kind, TriviaSyncFailureKind.rejected);
    });

    test('another 4xx is permanent', () async {
      final error = await upload(status: 422);

      expect(error.kind, TriviaSyncFailureKind.permanent);
      expect(error.code, 'http4xx');
    });

    test('a 5xx and a timeout are worth retrying', () async {
      expect((await upload(status: 503)).kind, TriviaSyncFailureKind.transient);
      expect(
        (await upload(type: DioExceptionType.connectionTimeout)).kind,
        TriviaSyncFailureKind.transient,
      );
      expect(
        (await upload(type: DioExceptionType.connectionError)).kind,
        TriviaSyncFailureKind.transient,
      );
    });

    test('a cancelled request is neither a failure nor a retry', () async {
      final error = await upload(type: DioExceptionType.cancel);

      expect(error.kind, TriviaSyncFailureKind.cancelled);
    });
  });
}

Dio _dio(HttpClientAdapter adapter) => Dio()..httpClientAdapter = adapter;

ResponseBody _jsonResponse(Object? value, {int status = 200}) =>
    ResponseBody.fromString(
      jsonEncode(value),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

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

final class _ThrowingAdapter implements HttpClientAdapter {
  _ThrowingAdapter({this.status, required this.type});

  final int? status;
  final DioExceptionType type;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    throw DioException(
      requestOptions: options,
      type: type,
      response: status == null
          ? null
          : Response<Object?>(requestOptions: options, statusCode: status),
    );
  }

  @override
  void close({bool force = false}) {}
}
