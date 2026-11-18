import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/features/pisocamp/data/leaderboard_repository.dart';
import 'package:mobile/features/pisocamp/data/progress_repository.dart';
import 'package:mobile/features/pisocamp/data/push_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Every module request goes to the versioned API.
///
/// The backend serves its routes only under `/api/v1`; the unversioned path
/// 404s. Three repositories were built against `ApiConstants.baseUrl`, which
/// stops at `/api`, so GM-4's leaderboard, GM-5's progress and SA-5's push
/// subscription could never reach the server.
///
/// The failure was invisible from inside the app. Each of those repositories
/// treats any thrown error as "offline" and falls back to cache — correct
/// behaviour for a train tunnel, and indistinguishable from a permanent 404.
/// Progress reported "you have not been online yet" to somebody who had never
/// been anything else.
///
/// The existing repository tests all mocked the transport without asserting
/// the URL, so nothing caught it. These assert the address itself.
class _RecordingTokenProvider implements PushTokenProvider {
  const _RecordingTokenProvider();

  @override
  Future<String?> token() async => 'token-for-test';
}

void main() {
  /// A Dio that records every request and answers with [body].
  Dio recordingDio(List<RequestOptions> seen, Object? body) {
    final Dio dio = Dio();
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (RequestOptions options, RequestInterceptorHandler handler) {
          seen.add(options);
          handler.resolve(
            Response<Object?>(
              requestOptions: options,
              statusCode: 200,
              data: body,
            ),
          );
        },
      ),
    );
    return dio;
  }

  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

  test('the versioned URL carries the version segment', () {
    expect(ApiConstants.versionedUrl, endsWith('/${ApiConstants.apiVersion}'));
    expect(ApiConstants.versionedUrl.startsWith(ApiConstants.baseUrl), isTrue);
    // The distinction this whole file exists to defend.
    expect(ApiConstants.versionedUrl, isNot(ApiConstants.baseUrl));
  });

  test('progress is read from the versioned API', () async {
    final List<RequestOptions> seen = <RequestOptions>[];
    await ProgressRepository(
      recordingDio(seen, <String, Object?>{
        'topicsViewed': 0,
        'topicsAnswered': 0,
        'questionsAnswered': 0,
        'questionsCorrect': 0,
        'questionsSkipped': 0,
        'accuracyPercent': 0,
        'points': 0,
        'lastActivityAt': null,
      }),
    ).load();

    expect(seen, hasLength(1));
    expect(seen.single.uri.toString(), startsWith(ApiConstants.versionedUrl));
    expect(seen.single.uri.path, contains('/pisocamp/me/progress'));
  });

  test('the leaderboard is read from the versioned API', () async {
    final List<RequestOptions> seen = <RequestOptions>[];
    await LeaderboardRepository(
      recordingDio(seen, <String, Object?>{
        'periodStart': '2026-01-01',
        'top': <Object?>[],
        'you': null,
      }),
    ).fetch(LeaderboardPeriod.allTime);

    expect(seen, hasLength(1));
    expect(seen.single.uri.toString(), startsWith(ApiConstants.versionedUrl));
    expect(seen.single.uri.path, contains('/pisocamp/leaderboard'));
  });

  test('push subscription is read from the versioned API', () async {
    final List<RequestOptions> seen = <RequestOptions>[];
    await PushRepository(
      recordingDio(seen, <String, Object?>{
        'subscribed': false,
        'platform': null,
        'subscribedAt': null,
      }),
      tokens: const _RecordingTokenProvider(),
    ).status();

    expect(seen, hasLength(1));
    expect(seen.single.uri.toString(), startsWith(ApiConstants.versionedUrl));
    expect(seen.single.uri.path, contains('/pisocamp/me/push'));
  });
}
