import 'package:dio/dio.dart';
import 'package:mobile/core/constants/api_constants.dart';

/// The periods GM-4 offers. All three, because they answer different
/// questions: this week is "am I keeping up", this month is "am I improving",
/// all time is "how far have I come".
enum LeaderboardPeriod {
  weekly('weekly', 'This week'),
  monthly('monthly', 'This month'),
  allTime('all_time', 'All time');

  const LeaderboardPeriod(this.wireValue, this.label);

  final String wireValue;
  final String label;
}

class LeaderboardStanding {
  const LeaderboardStanding({
    required this.rank,
    required this.alias,
    required this.score,
    required this.rankMovement,
  });

  final int rank;
  final String alias;
  final int score;

  /// Places gained since the previous period, or null when there was none to
  /// compare with — which is not the same as having held station.
  final int? rankMovement;

  static LeaderboardStanding fromJson(Object? json) {
    if (json is! Map) throw const FormatException('Invalid leaderboard standing');
    final rank = json['rank'];
    final alias = json['alias'];
    final score = json['score'];
    final movement = json['rankMovement'];
    if (rank is! int || alias is! String || score is! int) {
      throw const FormatException('Invalid leaderboard standing');
    }
    if (movement != null && movement is! int) {
      throw const FormatException('Invalid leaderboard standing');
    }
    return LeaderboardStanding(
      rank: rank,
      alias: alias,
      score: score,
      rankMovement: movement as int?,
    );
  }
}

class Leaderboard {
  const Leaderboard({
    required this.period,
    required this.periodStart,
    required this.top,
    required this.you,
  });

  final LeaderboardPeriod period;
  final String periodStart;
  final List<LeaderboardStanding> top;

  /// Where the person asking stands, even outside the top. Null when they have
  /// scored nothing this period.
  final LeaderboardStanding? you;
}

/// Thrown when the module's leaderboard is switched off, which the server says
/// with a 404 rather than an empty board.
class LeaderboardUnavailable implements Exception {
  const LeaderboardUnavailable();
}

class LeaderboardRepository {
  LeaderboardRepository(this._dio);

  final Dio _dio;

  Future<Leaderboard> fetch(LeaderboardPeriod period) async {
    try {
      final response = await _dio.get<Object?>(
        '${ApiConstants.versionedUrl}/pisocamp/leaderboard',
        queryParameters: <String, Object?>{'period': period.wireValue},
      );
      return _parse(period, response.data);
    } on DioException catch (error) {
      if (error.response?.statusCode == 404) {
        throw const LeaderboardUnavailable();
      }
      rethrow;
    }
  }

  Leaderboard _parse(LeaderboardPeriod period, Object? data) {
    if (data is! Map) throw const FormatException('Invalid leaderboard');
    final periodStart = data['periodStart'];
    final top = data['top'];
    if (periodStart is! String || top is! List) {
      throw const FormatException('Invalid leaderboard');
    }
    final you = data['you'];
    return Leaderboard(
      period: period,
      periodStart: periodStart,
      top: top.map(LeaderboardStanding.fromJson).toList(growable: false),
      you: you == null ? null : LeaderboardStanding.fromJson(you),
    );
  }
}
