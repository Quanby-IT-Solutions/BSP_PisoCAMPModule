import 'package:dio/dio.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';

enum AnalyticsRepositoryFailureKind { permanent, transient, cancelled }

final class AnalyticsRepositoryException implements Exception {
  const AnalyticsRepositoryException(
    this.kind,
    this.code, {
    this.httpStatusClass,
  });

  final AnalyticsRepositoryFailureKind kind;
  final String code;
  final int? httpStatusClass;

  @override
  String toString() => 'AnalyticsRepositoryException($code)';
}

abstract interface class AnalyticsUploadPort {
  Future<List<String>> upload(List<AnalyticsEvent> events);
}

final class AnalyticsRepository implements AnalyticsUploadPort {
  AnalyticsRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<String>> upload(List<AnalyticsEvent> events) async {
    if (events.isEmpty) {
      throw const AnalyticsRepositoryException(
        AnalyticsRepositoryFailureKind.permanent,
        'emptyBatch',
      );
    }
    try {
      final response = await _dio.post<Object?>(
        ApiConstants.pisoCampEvents,
        data: <String, Object?>{
          'events': events
              .map((event) => event.toJson())
              .toList(growable: false),
        },
      );
      return _parseAcknowledgements(
        response.data,
        events.map((event) => event.eventId).toSet(),
      );
    } on AnalyticsRepositoryException {
      rethrow;
    } on DioException catch (error) {
      throw _fromDio(error);
    } on Object {
      throw const AnalyticsRepositoryException(
        AnalyticsRepositoryFailureKind.permanent,
        'invalidAcknowledgement',
      );
    }
  }

  List<String> _parseAcknowledgements(Object? value, Set<String> submitted) {
    if (value is! Map) return _invalidAcknowledgement();
    final map = Map<Object?, Object?>.from(value);
    if (map.length != 1 || !map.containsKey('ackedEventIds')) {
      return _invalidAcknowledgement();
    }
    final rawIds = map['ackedEventIds'];
    if (rawIds is! List) return _invalidAcknowledgement();
    final ids = <String>[];
    final seen = <String>{};
    for (final value in rawIds) {
      if (value is! String ||
          !_uuidV4Pattern.hasMatch(value) ||
          !submitted.contains(value) ||
          !seen.add(value)) {
        return _invalidAcknowledgement();
      }
      ids.add(value);
    }
    return List<String>.unmodifiable(ids);
  }

  Never _invalidAcknowledgement() => throw const AnalyticsRepositoryException(
    AnalyticsRepositoryFailureKind.permanent,
    'invalidAcknowledgement',
  );

  AnalyticsRepositoryException _fromDio(DioException error) {
    if (CancelToken.isCancel(error) || error.type == DioExceptionType.cancel) {
      return const AnalyticsRepositoryException(
        AnalyticsRepositoryFailureKind.cancelled,
        'cancelled',
      );
    }
    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.receiveTimeout) {
      return const AnalyticsRepositoryException(
        AnalyticsRepositoryFailureKind.transient,
        'timeout',
      );
    }
    final status = error.response?.statusCode;
    if (status != null && status >= 400 && status < 500) {
      return AnalyticsRepositoryException(
        AnalyticsRepositoryFailureKind.permanent,
        'http4xx',
        httpStatusClass: 4,
      );
    }
    if (status != null && status >= 500 && status < 600) {
      return AnalyticsRepositoryException(
        AnalyticsRepositoryFailureKind.transient,
        'http5xx',
        httpStatusClass: 5,
      );
    }
    return const AnalyticsRepositoryException(
      AnalyticsRepositoryFailureKind.transient,
      'network',
    );
  }
}

final _uuidV4Pattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
