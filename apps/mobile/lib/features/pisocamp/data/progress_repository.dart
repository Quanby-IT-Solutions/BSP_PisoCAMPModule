import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// One person's own progress, as GM-5 reports it.
class PisoCampProgress {
  const PisoCampProgress({
    required this.topicsViewed,
    required this.topicsAnswered,
    required this.questionsAnswered,
    required this.questionsCorrect,
    required this.questionsSkipped,
    required this.accuracyPercent,
    required this.points,
    required this.lastActivityAt,
  });

  final int topicsViewed;
  final int topicsAnswered;
  final int questionsAnswered;
  final int questionsCorrect;
  final int questionsSkipped;
  final double accuracyPercent;
  final int points;

  /// Null before anything has happened — not a date standing in for nothing.
  final String? lastActivityAt;

  Map<String, Object?> toJson() => <String, Object?>{
    'topicsViewed': topicsViewed,
    'topicsAnswered': topicsAnswered,
    'questionsAnswered': questionsAnswered,
    'questionsCorrect': questionsCorrect,
    'questionsSkipped': questionsSkipped,
    'accuracyPercent': accuracyPercent,
    'points': points,
    'lastActivityAt': lastActivityAt,
  };

  static PisoCampProgress fromJson(Object? json) {
    if (json is! Map) throw const FormatException('Invalid progress');
    int number(String key) {
      final value = json[key];
      if (value is! int) throw const FormatException('Invalid progress');
      return value;
    }

    final accuracy = json['accuracyPercent'];
    final last = json['lastActivityAt'];
    if (accuracy is! num || (last != null && last is! String)) {
      throw const FormatException('Invalid progress');
    }
    return PisoCampProgress(
      topicsViewed: number('topicsViewed'),
      topicsAnswered: number('topicsAnswered'),
      questionsAnswered: number('questionsAnswered'),
      questionsCorrect: number('questionsCorrect'),
      questionsSkipped: number('questionsSkipped'),
      accuracyPercent: accuracy.toDouble(),
      points: number('points'),
      lastActivityAt: last as String?,
    );
  }
}

/// What the screen was given, and whether it came from the network.
class ProgressLoadResult {
  const ProgressLoadResult({required this.progress, required this.isOffline});

  final PisoCampProgress? progress;
  final bool isOffline;
}

/// GM-5's reader, with the last synced summary kept on the device.
///
/// The cache exists for one reason: somebody opening Progress on a train should
/// see what they had rather than an error. It is marked as offline so they know
/// the figures may have moved since.
class ProgressRepository {
  ProgressRepository(this._dio, {SharedPreferences? preferences})
    : _preferences = preferences;

  static const String _cacheKey = 'pisocamp.progress.last';

  final Dio _dio;
  final SharedPreferences? _preferences;

  Future<ProgressLoadResult> load() async {
    final preferences = _preferences ?? await SharedPreferences.getInstance();

    try {
      final response = await _dio
          .get<Object?>('${ApiConstants.baseUrl}/pisocamp/me/progress')
          .timeout(const Duration(seconds: 10));
      final progress = PisoCampProgress.fromJson(response.data);
      await preferences.setString(_cacheKey, jsonEncode(progress.toJson()));
      return ProgressLoadResult(progress: progress, isOffline: false);
    } on Object {
      final cached = preferences.getString(_cacheKey);
      if (cached == null) {
        return const ProgressLoadResult(progress: null, isOffline: true);
      }
      try {
        return ProgressLoadResult(
          progress: PisoCampProgress.fromJson(
            jsonDecode(cached) as Object?,
          ),
          isOffline: true,
        );
      } on Object {
        // A cache this build cannot read is not a summary to show.
        return const ProgressLoadResult(progress: null, isOffline: true);
      }
    }
  }
}
