import 'dart:convert';

import 'package:mobile/features/pisocamp/data/survey_document.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// When a survey may be offered, per Annex H EV-002.
enum SurveyTriggerType {
  pageDepth('page_depth'),
  activityCompletion('activity_completion'),
  topicCompletion('topic_completion'),
  moduleExit('module_exit'),
  appExit('app_exit');

  const SurveyTriggerType(this.wireValue);

  final String wireValue;

  static SurveyTriggerType? fromWire(Object? value) {
    for (final type in values) {
      if (type.wireValue == value) return type;
    }
    return null;
  }
}

/// One rule, as the device is told it by the public configuration.
final class SurveyTriggerRule {
  const SurveyTriggerRule({
    required this.contentItemId,
    required this.triggerType,
    required this.priority,
    this.pageDepth,
    this.frequencyCapDays,
  });

  final String contentItemId;
  final SurveyTriggerType triggerType;

  /// 1 is the highest. The console shows it the same way round.
  final int priority;

  /// Screens deep, for a page-depth trigger.
  final int? pageDepth;

  /// Days before the same survey may be offered again; null means no cap.
  final int? frequencyCapDays;

  /// Reads one rule, or null when it is not one this build understands.
  ///
  /// Null rather than an exception: a configuration carrying a trigger a
  /// released app has never heard of should cost that rule, not the module.
  static SurveyTriggerRule? tryFromJson(Object? value) {
    if (value is! Map) return null;
    final map = Map<Object?, Object?>.from(value);
    final contentItemId = map['contentItemId'];
    final triggerType = SurveyTriggerType.fromWire(map['triggerType']);
    final priority = map['priority'];
    final pageDepth = map['pageDepth'];
    final cap = map['frequencyCapDays'];
    if (contentItemId is! String ||
        contentItemId.isEmpty ||
        triggerType == null ||
        priority is! int ||
        priority < 1 ||
        priority > 100) {
      return null;
    }
    if (pageDepth != null && pageDepth is! int) return null;
    if (cap != null && cap is! int) return null;
    // A depth on a trigger that is not about depth, or a depth trigger with
    // none, is a rule that could never fire correctly.
    final isDepth = triggerType == SurveyTriggerType.pageDepth;
    if (isDepth != (pageDepth != null)) return null;
    return SurveyTriggerRule(
      contentItemId: contentItemId,
      triggerType: triggerType,
      priority: priority,
      pageDepth: pageDepth as int?,
      frequencyCapDays: cap as int?,
    );
  }

  static List<SurveyTriggerRule> listFromJson(Object? value) {
    if (value is! List) return const [];
    final rules = <SurveyTriggerRule>[];
    for (final entry in value) {
      final rule = tryFromJson(entry);
      if (rule != null) rules.add(rule);
    }
    return List.unmodifiable(rules);
  }
}

/// When each survey was last offered on this device.
abstract interface class SurveyFrequencyStore {
  Future<Map<String, DateTime>> readLastOffered();
  Future<void> recordOffered(String contentItemId, DateTime at);
}

/// Shared preferences, beside the trivia sighting history and for the same
/// reason: it is a list of content ids and times, and it identifies nobody.
class PreferencesSurveyFrequencyStore implements SurveyFrequencyStore {
  PreferencesSurveyFrequencyStore(this._preferences);

  final SharedPreferences _preferences;

  static const String storageKey = 'pisocamp.surveys.last-offered.v1';
  static const int maximumEntries = 200;

  @override
  Future<Map<String, DateTime>> readLastOffered() async {
    final raw = _preferences.getString(storageKey);
    if (raw == null || raw.isEmpty) return const {};
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return const {};
      final result = <String, DateTime>{};
      for (final entry in Map<Object?, Object?>.from(decoded).entries) {
        final key = entry.key;
        final at = entry.value;
        if (key is! String || at is! String) continue;
        final parsed = DateTime.tryParse(at);
        if (parsed != null) result[key] = parsed.toUtc();
      }
      return result;
    } on Object {
      // Unreadable history is history the device forgets. The worst outcome is
      // a survey offered sooner than the cap intended.
      return const {};
    }
  }

  @override
  Future<void> recordOffered(String contentItemId, DateTime at) async {
    final existing = Map<String, DateTime>.from(await readLastOffered());
    existing[contentItemId] = at.toUtc();
    final kept = existing.entries.toList()
      ..sort((left, right) => right.value.compareTo(left.value));
    await _preferences.setString(
      storageKey,
      jsonEncode({
        for (final entry in kept.take(maximumEntries))
          entry.key: entry.value.toIso8601String(),
      }),
    );
  }
}

/// Chooses which survey a fired trigger should offer.
///
/// Two rules and one tie-break, stated in one place: the cap is enforced on the
/// device because a guest has no account for the server to count against;
/// priority decides between eligible surveys; and equal priorities are settled
/// by content item id so the same device does not shuffle its own answer.
class SurveyTriggerEngine {
  const SurveyTriggerEngine({DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  final DateTime Function() _clock;

  SurveyDocument? select({
    required SurveyTriggerType trigger,
    required List<SurveyTriggerRule> rules,
    required List<SurveyDocument> surveys,
    required Map<String, DateTime> lastOffered,
    String? subjectContentItemId,
    int? pageDepth,
  }) {
    final now = _clock().toUtc();
    final byId = {for (final survey in surveys) survey.contentItemId: survey};
    final eligible = <SurveyTriggerRule>[];
    for (final rule in rules) {
      if (rule.triggerType != trigger) continue;
      final survey = byId[rule.contentItemId];
      // A rule for a survey this device does not hold is a rule for a survey
      // it cannot show; the bundle decides what exists.
      if (survey == null) continue;
      if (trigger == SurveyTriggerType.topicCompletion &&
          subjectContentItemId != null &&
          survey.subjectContentItemId != null &&
          survey.subjectContentItemId != subjectContentItemId) {
        continue;
      }
      if (trigger == SurveyTriggerType.pageDepth &&
          (pageDepth ?? 0) < (rule.pageDepth ?? 1)) {
        continue;
      }
      if (!_capExpired(rule, lastOffered[rule.contentItemId], now)) continue;
      eligible.add(rule);
    }
    if (eligible.isEmpty) return null;
    eligible.sort((left, right) {
      final byPriority = left.priority.compareTo(right.priority);
      return byPriority != 0
          ? byPriority
          : left.contentItemId.compareTo(right.contentItemId);
    });
    return byId[eligible.first.contentItemId];
  }

  bool _capExpired(SurveyTriggerRule rule, DateTime? offeredAt, DateTime now) {
    final cap = rule.frequencyCapDays;
    if (cap == null || offeredAt == null) return true;
    // The cap is "once per N days", so a survey offered exactly N days ago is
    // due again; anything more recent is not.
    return !now.isBefore(offeredAt.add(Duration(days: cap)));
  }
}
