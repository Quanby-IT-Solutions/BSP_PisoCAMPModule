import 'package:dio/dio.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/features/pisocamp/data/trivia_response.dart';

enum TriviaSyncFailureKind {
  /// Worth retrying: a timeout, a dropped connection, a server fault.
  transient,

  /// Not worth retrying with the same batch.
  permanent,

  /// The account may not sync. The device keeps everything it has.
  rejected,

  cancelled,
}

final class TriviaSyncException implements Exception {
  const TriviaSyncException(this.kind, this.code, {this.httpStatusClass});

  final TriviaSyncFailureKind kind;
  final String code;
  final int? httpStatusClass;

  @override
  String toString() => 'TriviaSyncException($code)';
}

abstract interface class TriviaUploadPort {
  /// Uploads a batch and returns the ids the server now holds.
  Future<List<String>> upload(List<TriviaResponseRecord> responses);
}

/// Uploads batches of responses to `POST /pisocamp/trivia/responses`.
///
/// Failure classification is the whole job here: the controller deletes
/// nothing that was not acknowledged, so a wrong call costs answers.
final class TriviaRepository implements TriviaUploadPort {
  TriviaRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<String>> upload(List<TriviaResponseRecord> responses) async {
    if (responses.isEmpty) {
      throw const TriviaSyncException(
        TriviaSyncFailureKind.permanent,
        'emptyBatch',
      );
    }
    try {
      final response = await _dio.post<Object?>(
        ApiConstants.pisoCampTriviaResponses,
        data: <String, Object?>{
          'responses': [
            for (final record in responses) record.toUploadJson(),
          ],
        },
      );
      return _parseAcknowledgements(
        response.data,
        {for (final record in responses) record.responseId},
      );
    } on TriviaSyncException {
      rethrow;
    } on DioException catch (error) {
      throw _fromDio(error);
    } on Object {
      throw const TriviaSyncException(
        TriviaSyncFailureKind.permanent,
        'invalidAcknowledgement',
      );
    }
  }

  List<String> _parseAcknowledgements(Object? value, Set<String> submitted) {
    if (value is! Map) return _invalidAcknowledgement();
    final map = Map<Object?, Object?>.from(value);
    if (map.length != 1 || !map.containsKey('ackedResponseIds')) {
      return _invalidAcknowledgement();
    }
    final rawIds = map['ackedResponseIds'];
    if (rawIds is! List) return _invalidAcknowledgement();
    final ids = <String>[];
    final seen = <String>{};
    for (final entry in rawIds) {
      // An id nobody sent is not an acknowledgement of anything, and deleting
      // on the strength of one would lose an answer.
      if (entry is! String ||
          !_uuidV4Pattern.hasMatch(entry) ||
          !submitted.contains(entry) ||
          !seen.add(entry)) {
        return _invalidAcknowledgement();
      }
      ids.add(entry);
    }
    return List.unmodifiable(ids);
  }

  Never _invalidAcknowledgement() => throw const TriviaSyncException(
    TriviaSyncFailureKind.permanent,
    'invalidAcknowledgement',
  );

  TriviaSyncException _fromDio(DioException error) {
    if (CancelToken.isCancel(error) || error.type == DioExceptionType.cancel) {
      return const TriviaSyncException(
        TriviaSyncFailureKind.cancelled,
        'cancelled',
      );
    }
    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.receiveTimeout) {
      return const TriviaSyncException(
        TriviaSyncFailureKind.transient,
        'timeout',
      );
    }
    final status = error.response?.statusCode;
    // A deactivated account and an unauthenticated one are both told to stop
    // and keep their data, not to retry the batch into a wall.
    if (status == 401 || status == 403) {
      return TriviaSyncException(
        TriviaSyncFailureKind.rejected,
        status == 401 ? 'accountNotPermitted' : 'forbidden',
        httpStatusClass: 4,
      );
    }
    if (status != null && status >= 400 && status < 500) {
      return TriviaSyncException(
        TriviaSyncFailureKind.permanent,
        'http4xx',
        httpStatusClass: 4,
      );
    }
    if (status != null && status >= 500 && status < 600) {
      return TriviaSyncException(
        TriviaSyncFailureKind.transient,
        'http5xx',
        httpStatusClass: 5,
      );
    }
    return const TriviaSyncException(
      TriviaSyncFailureKind.transient,
      'network',
    );
  }
}

final _uuidV4Pattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
