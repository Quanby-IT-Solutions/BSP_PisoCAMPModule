import 'package:dio/dio.dart';
import 'package:mobile/core/constants/api_constants.dart';

/// Whether this account is opted in, as SA-5 reports it.
class PushSubscriptionStatus {
  const PushSubscriptionStatus({
    required this.subscribed,
    required this.platform,
    required this.subscribedAt,
  });

  final bool subscribed;
  final String? platform;
  final String? subscribedAt;

  static PushSubscriptionStatus fromJson(Object? json) {
    if (json is! Map) throw const FormatException('Invalid push status');
    final subscribed = json['subscribed'];
    final platform = json['platform'];
    final subscribedAt = json['subscribedAt'];
    if (subscribed is! bool ||
        (platform != null && platform is! String) ||
        (subscribedAt != null && subscribedAt is! String)) {
      throw const FormatException('Invalid push status');
    }
    return PushSubscriptionStatus(
      subscribed: subscribed,
      platform: platform as String?,
      subscribedAt: subscribedAt as String?,
    );
  }
}

/// Where a device push token comes from.
///
/// A port rather than a plugin call, because the token is issued by whichever
/// push service the build ships with. A build without one returns null and the
/// settings screen says so, rather than sending an invented token that would
/// be recorded as a subscription nothing could ever reach.
abstract interface class PushTokenProvider {
  Future<String?> token();
}

/// The provider used when a build ships no push service.
final class UnavailablePushTokenProvider implements PushTokenProvider {
  const UnavailablePushTokenProvider();

  @override
  Future<String?> token() async => null;
}

class PushSubscriptionException implements Exception {
  const PushSubscriptionException(this.code);

  /// `tokenUnavailable` when the build has no push service; `requestFailed`
  /// when the server refused or could not be reached.
  final String code;

  @override
  String toString() => 'PushSubscriptionException($code)';
}

/// SA-5's device half: opting in and out of push from settings.
class PushRepository {
  PushRepository(this._dio, {PushTokenProvider? tokens})
    : _tokens = tokens ?? const UnavailablePushTokenProvider();

  final Dio _dio;
  final PushTokenProvider _tokens;

  Future<PushSubscriptionStatus> status() async {
    try {
      final response = await _dio
          .get<Object?>('${ApiConstants.versionedUrl}/pisocamp/me/push')
          .timeout(const Duration(seconds: 10));
      return PushSubscriptionStatus.fromJson(response.data);
    } on Object {
      throw const PushSubscriptionException('requestFailed');
    }
  }

  Future<PushSubscriptionStatus> subscribe({required String platform}) async {
    final token = await _tokens.token();
    if (token == null || token.trim().length < 16) {
      // Nothing to subscribe with. Saying so beats storing a token that no
      // notification could ever be delivered to.
      throw const PushSubscriptionException('tokenUnavailable');
    }

    try {
      final response = await _dio
          .post<Object?>(
            '${ApiConstants.versionedUrl}/pisocamp/me/push',
            data: <String, Object?>{
              'deviceToken': token.trim(),
              'platform': platform,
            },
          )
          .timeout(const Duration(seconds: 10));
      return PushSubscriptionStatus.fromJson(response.data);
    } on PushSubscriptionException {
      rethrow;
    } on Object {
      throw const PushSubscriptionException('requestFailed');
    }
  }

  Future<PushSubscriptionStatus> unsubscribe() async {
    try {
      final response = await _dio
          .delete<Object?>('${ApiConstants.versionedUrl}/pisocamp/me/push')
          .timeout(const Duration(seconds: 10));
      return PushSubscriptionStatus.fromJson(response.data);
    } on Object {
      throw const PushSubscriptionException('requestFailed');
    }
  }

  /// Report that a notification arrived, was opened, or was tapped.
  Future<void> reportReceipt({
    required String notificationId,
    required String event,
  }) async {
    try {
      await _dio
          .post<Object?>(
            '${ApiConstants.versionedUrl}/pisocamp/me/push/receipt',
            data: <String, Object?>{
              'notificationId': notificationId,
              'event': event,
            },
          )
          .timeout(const Duration(seconds: 10));
    } on Object {
      throw const PushSubscriptionException('requestFailed');
    }
  }
}
