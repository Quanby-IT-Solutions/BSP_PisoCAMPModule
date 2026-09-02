import 'package:dio/dio.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/features/pisocamp/data/survey_response.dart';

enum SurveySyncFailureKind {
  transient,
  permanent,

  /// The subject may not submit: no current grant, or not their grant.
  refused,
  cancelled,
}

final class SurveySyncException implements Exception {
  const SurveySyncException(this.kind, this.code, {this.httpStatusClass});

  final SurveySyncFailureKind kind;
  final String code;
  final int? httpStatusClass;

  @override
  String toString() => 'SurveySyncException($code)';
}

abstract interface class SurveyUploadPort {
  Future<List<String>> upload(List<SurveyResponse> responses);
}

/// Uploads queued responses to `POST /pisocamp/surveys/responses`.
final class SurveyRepository implements SurveyUploadPort {
  SurveyRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<String>> upload(List<SurveyResponse> responses) async {
    if (responses.isEmpty) {
      throw const SurveySyncException(
        SurveySyncFailureKind.permanent,
        'emptyBatch',
      );
    }
    try {
      final response = await _dio.post<Object?>(
        ApiConstants.pisoCampSurveyResponses,
        data: <String, Object?>{
          'responses': [for (final entry in responses) entry.toJson()],
        },
      );
      return _parseAcknowledgements(response.data, {
        for (final entry in responses) entry.responseId,
      });
    } on SurveySyncException {
      rethrow;
    } on DioException catch (error) {
      throw _fromDio(error);
    } on Object {
      throw const SurveySyncException(
        SurveySyncFailureKind.permanent,
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
      // Deleting a response on the strength of an id nobody sent would lose
      // somebody's answers for good.
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

  Never _invalidAcknowledgement() => throw const SurveySyncException(
    SurveySyncFailureKind.permanent,
    'invalidAcknowledgement',
  );

  SurveySyncException _fromDio(DioException error) {
    if (CancelToken.isCancel(error) || error.type == DioExceptionType.cancel) {
      return const SurveySyncException(
        SurveySyncFailureKind.cancelled,
        'cancelled',
      );
    }
    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.receiveTimeout) {
      return const SurveySyncException(
        SurveySyncFailureKind.transient,
        'timeout',
      );
    }
    final status = error.response?.statusCode;
    // 412 is the consent guard: no current grant. 403 is a grant that is not
    // this subject's. Neither improves by retrying the same batch.
    if (status == 412 || status == 403 || status == 401) {
      return SurveySyncException(
        SurveySyncFailureKind.refused,
        status == 412 ? 'consentRequired' : 'notPermitted',
        httpStatusClass: 4,
      );
    }
    if (status != null && status >= 400 && status < 500) {
      return SurveySyncException(
        SurveySyncFailureKind.permanent,
        'http4xx',
        httpStatusClass: 4,
      );
    }
    if (status != null && status >= 500 && status < 600) {
      return SurveySyncException(
        SurveySyncFailureKind.transient,
        'http5xx',
        httpStatusClass: 5,
      );
    }
    return const SurveySyncException(
      SurveySyncFailureKind.transient,
      'network',
    );
  }
}

final _uuidV4Pattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
