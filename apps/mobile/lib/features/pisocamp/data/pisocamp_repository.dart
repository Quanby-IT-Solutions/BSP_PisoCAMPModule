import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/services/api/api_client.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:mobile/features/pisocamp/data/survey_triggers.dart';

part 'pisocamp_repository.g.dart';

class PisoCampHomeCard {
  const PisoCampHomeCard({required this.title, required this.description});

  final String title;
  final String description;

  factory PisoCampHomeCard.fromJson(Map<String, dynamic> json) {
    final title = json['title'];
    final description = json['description'];
    if (title is! String || description is! String) {
      throw const FormatException('Invalid Piso CAMP home card');
    }
    return PisoCampHomeCard(title: title, description: description);
  }
}

class PisoCampHome {
  const PisoCampHome({
    required this.title,
    required this.introduction,
    required this.cards,
  });

  final String title;
  final String introduction;
  final List<PisoCampHomeCard> cards;

  factory PisoCampHome.fromJson(Map<String, dynamic> json) {
    final title = json['title'];
    final introduction = json['introduction'];
    final cards = json['cards'];
    if (title is! String || introduction is! String || cards is! List) {
      throw const FormatException('Invalid Piso CAMP home content');
    }
    return PisoCampHome(
      title: title,
      introduction: introduction,
      cards: cards
          .map(
            (card) => PisoCampHomeCard.fromJson(card as Map<String, dynamic>),
          )
          .toList(growable: false),
    );
  }
}

class PisoCampHomeLoadResult {
  const PisoCampHomeLoadResult({
    required this.home,
    required this.isOffline,
    this.moduleEnabled = true,
    this.accountPromptEnabled = true,
    this.surveyTriggers = const [],
    this.exitAdvisoryIntervalHours = _defaultExitAdvisoryIntervalHours,
    this.leaderboardEnabled = false,
  });

  final PisoCampHome home;
  final bool isOffline;
  final bool moduleEnabled;
  final bool accountPromptEnabled;

  /// EV-3's rules. Empty while offline, which is the same as "do not ask".
  final List<SurveyTriggerRule> surveyTriggers;

  /// EV-4's interval. The default stands until configuration is read, so the
  /// advisory still appears on a device that has never reached the server.
  final int exitAdvisoryIntervalHours;

  /// GM-4. False until BSP turns the leaderboard on.
  final bool leaderboardEnabled;
}

/// The contract's default, repeated here for the offline first emission.
const int _defaultExitAdvisoryIntervalHours = 24;

/// Loads guest-safe packaged content before attempting public remote config.
class PisoCampRepository {
  PisoCampRepository(this._dio, {Future<String> Function()? loadAsset})
    : _loadAsset = loadAsset ?? (() => rootBundle.loadString(_assetPath));

  static const _assetPath = 'assets/pisocamp/home.json';

  final Dio _dio;
  final Future<String> Function() _loadAsset;

  Stream<PisoCampHomeLoadResult> loadHome() async* {
    final home = await _loadPackagedHome();
    yield PisoCampHomeLoadResult(home: home, isOffline: true);

    try {
      final response = await _dio
          .get<Object?>(ApiConstants.pisoCampConfig)
          .timeout(const Duration(seconds: 10));
      final config = _validatePublicConfig(response.data);
      yield PisoCampHomeLoadResult(
        home: home,
        isOffline: false,
        moduleEnabled: config.moduleEnabled,
        accountPromptEnabled: config.accountPromptEnabled,
        surveyTriggers: config.surveyTriggers,
        exitAdvisoryIntervalHours: config.exitAdvisoryIntervalHours,
        leaderboardEnabled: config.leaderboardEnabled,
      );
    } on Object {
      // The first emission is already the safe offline fallback.
    }
  }

  Future<PisoCampHome> _loadPackagedHome() async {
    final decoded = jsonDecode(await _loadAsset());
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Invalid Piso CAMP home content');
    }
    return PisoCampHome.fromJson(decoded);
  }

  /// The settings this build understands, from a configuration that may carry
  /// more than it knows about.
  ///
  /// A key this build has never heard of is ignored rather than allowed to fail
  /// the whole configuration — the same rule already applied to survey rules
  /// below. The allowlist that keeps anything private out of this response is
  /// enforced by the server's strict schema, which is where it can actually be
  /// enforced; refusing here only guaranteed that every installed app stopped
  /// working the day BSP added a setting.
  _PublicConfig _validatePublicConfig(Object? data) {
    if (data is! Map) throw const FormatException('Invalid Piso CAMP config');
    if (data['module_enabled'] is! bool ||
        data['account_prompt_enabled'] is! bool ||
        data['config_version'] is! String ||
        data['survey_triggers'] is! List ||
        data['exit_advisory_interval_hours'] is! int) {
      throw const FormatException('Invalid Piso CAMP config values');
    }
    return _PublicConfig(
      moduleEnabled: data['module_enabled'] as bool,
      accountPromptEnabled: data['account_prompt_enabled'] as bool,
      // A rule this build does not understand is dropped rather than allowed
      // to fail the whole configuration: the module still works without it.
      surveyTriggers: SurveyTriggerRule.listFromJson(data['survey_triggers']),
      exitAdvisoryIntervalHours: data['exit_advisory_interval_hours'] as int,
      // GM-4's flag, defaulted when a server predates it — a build that
      // demanded it would refuse a configuration it could otherwise use.
      leaderboardEnabled: data['leaderboard_enabled'] is bool
          ? data['leaderboard_enabled'] as bool
          : false,
    );
  }
}

class _PublicConfig {
  const _PublicConfig({
    required this.moduleEnabled,
    required this.accountPromptEnabled,
    this.surveyTriggers = const [],
    this.exitAdvisoryIntervalHours = _defaultExitAdvisoryIntervalHours,
    this.leaderboardEnabled = false,
  });
  final bool moduleEnabled;
  final bool accountPromptEnabled;

  /// EV-3's rules, as BSP arranged them.
  final List<SurveyTriggerRule> surveyTriggers;

  /// EV-4's interval, in hours.
  final int exitAdvisoryIntervalHours;

  /// GM-4's flag.
  final bool leaderboardEnabled;
}

@riverpod
PisoCampRepository pisoCampRepository(Ref ref) {
  return PisoCampRepository(ref.watch(dioProvider));
}
