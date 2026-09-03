import 'dart:convert';
import 'dart:typed_data';

import 'package:mobile/core/constants/redacted_fields.dart';
import 'package:mobile/core/utils/uuid_v4.dart';

const _schemaVersion = 1;
const _eventMaxBytes = 8 * 1024;
const _maxInspectionDepth = 8;
const _maxInspectedStringLength = 1024;

final _uuidV4Pattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final _pseudoIdPattern = RegExp(r'^[A-Za-z0-9_-]{22}$');
final _emailPattern = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');
final _isoDateTimePattern = RegExp(
  r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$',
);
final _numericOffsetPattern = RegExp(r'[+-](\d{2}):(\d{2})$');

final _forbiddenKeySegments = <String>{
  ...kRedactedFieldNames,
  'name',
  'image',
  'photo',
  'frame',
};

enum AnalyticsValidationReason {
  invalidShape,
  invalidCatalog,
  invalidField,
  forbiddenKey,
  forbiddenValue,
  byteArray,
  nestingTooDeep,
  stringTooLong,
  payloadTooLarge,
}

final class AnalyticsValidationException implements Exception {
  const AnalyticsValidationException(this.reason);

  final AnalyticsValidationReason reason;

  @override
  String toString() => 'AnalyticsValidationException(${reason.name})';
}

enum ModuleEntryPoint {
  navigation('navigation'),
  deepLink('deep_link'),
  other('other');

  const ModuleEntryPoint(this.wireValue);
  final String wireValue;
}

/// Features that report a `feature_use`. Each is bound to the one screen that
/// hosts it, so a mislabelled event is rejected rather than counted against the
/// wrong surface.
enum AnalyticsFeature {
  coin3d('3d_coin', 'coin_3d_viewer'),
  haptic('haptic', 'tactile_viewer'),
  tilt('tilt', 'tilt_viewer');

  const AnalyticsFeature(this.wireValue, this.screen);
  final String wireValue;
  final String screen;
}

/// AN-022. A cold start pays for the process as well as the module, so the two
/// are reported apart: one figure would hide which of them got slower.
enum ModuleLoadPhase {
  cold('cold'),
  warm('warm');

  const ModuleLoadPhase(this.wireValue);
  final String wireValue;
}

/// AN-024. The ways a request can fail on a device.
///
/// "No connectivity" and "timeout" are different problems with different
/// fixes, and one failure count would hide which one people are hitting.
enum AnalyticsNetworkFailureType {
  timeout('timeout'),
  noConnectivity('no_connectivity'),
  syncFailed('sync_failed'),
  downloadFailed('download_failed'),
  reportFailed('report_failed'),
  uploadFailed('upload_failed');

  const AnalyticsNetworkFailureType(this.wireValue);
  final String wireValue;
}

/// What was being attempted, never where: a URL is content.
enum AnalyticsNetworkOperation {
  config('config'),
  bundle('bundle'),
  asset('asset'),
  events('events'),
  survey('survey'),
  other('other');

  const AnalyticsNetworkOperation(this.wireValue);
  final String wireValue;
}

/// AR-1. How an AR session actually began.
///
/// Reported because a low start count means something different when devices
/// could not run the experience at all than when people chose not to.
enum ArStartOutcome {
  started('started'),
  unsupported('unsupported'),
  permissionDenied('permission_denied');

  const ArStartOutcome(this.wireValue);
  final String wireValue;
}

/// What a denomination scan concluded (DR-1).
///
/// `recognized` is the only value that carries a denomination claim;
/// `demonetized` and `foreign` are confident readings that deliberately are
/// not one.
/// `unavailable` and `permissionDenied` are the ones where no scan ran at all,
/// and they are reported with a failed status — a module nobody can use and a
/// module nobody wants are not the same problem.
enum RecognitionOutcome {
  recognized('recognized'),
  demonetized('demonetized'),
  foreign('foreign'),
  unrecognized('unrecognized'),
  unavailable('unavailable'),
  permissionDenied('permission_denied');

  const RecognitionOutcome(this.wireValue);
  final String wireValue;

  /// Whether no scan ran at all, which is what the failed status means.
  ///
  /// A scan that ran and could not read the note is a completed scan: it is the
  /// model's answer, not a broken install, and counting the two together would
  /// hide the model's real failure rate.
  bool get ranNothing =>
      this == RecognitionOutcome.unavailable ||
      this == RecognitionOutcome.permissionDenied;
}

enum AnalyticsAccountType {
  guest('guest'),
  registered('registered');

  const AnalyticsAccountType(this.wireValue);
  final String wireValue;
}

enum AnalyticsOsName {
  android('android'),
  ios('ios'),
  other('other');

  const AnalyticsOsName(this.wireValue);
  final String wireValue;
}

enum AnalyticsDeviceCategory {
  phone('phone'),
  tablet('tablet'),
  other('other');

  const AnalyticsDeviceCategory(this.wireValue);
  final String wireValue;
}

enum AnalyticsNetworkState {
  online('online'),
  offline('offline'),
  unknown('unknown');

  const AnalyticsNetworkState(this.wireValue);
  final String wireValue;
}

sealed class AnalyticsIntent {
  const AnalyticsIntent();

  String get eventName;
  String get screen;
  String get feature;
  String get status => 'completed';
  Map<String, Object?> get properties;
}

final class ModuleEntryIntent extends AnalyticsIntent {
  const ModuleEntryIntent(this.entryPoint);

  final ModuleEntryPoint entryPoint;

  @override
  String get eventName => 'module_entry';

  @override
  String get screen => 'pisocamp_home';

  @override
  String get feature => 'module';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'entryPoint': entryPoint.wireValue,
  };
}

final class AccountPromptShownIntent extends AnalyticsIntent {
  const AccountPromptShownIntent();

  @override
  String get eventName => 'account_prompt_shown';

  @override
  String get screen => 'pisocamp_home';

  @override
  String get feature => 'account_prompt';

  @override
  Map<String, Object?> get properties => const <String, Object?>{};
}

final class AccountPromptGuestIntent extends AnalyticsIntent {
  const AccountPromptGuestIntent();

  @override
  String get eventName => 'account_prompt_guest';

  @override
  String get screen => 'pisocamp_home';

  @override
  String get feature => 'account_prompt';

  @override
  Map<String, Object?> get properties => const <String, Object?>{};
}

final class ContentViewIntent extends AnalyticsIntent {
  const ContentViewIntent(this.logicalId);

  final String logicalId;

  @override
  String get eventName => 'content_view';

  @override
  String get screen => 'currency_detail';

  @override
  String get feature => 'currency_education';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'logicalId': logicalId,
  };
}

final class FeatureUseIntent extends AnalyticsIntent {
  const FeatureUseIntent({required this.usedFeature, required this.logicalId});

  final AnalyticsFeature usedFeature;
  final String logicalId;

  @override
  String get eventName => 'feature_use';

  @override
  String get screen => usedFeature.screen;

  @override
  String get feature => usedFeature.wireValue;

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'logicalId': logicalId,
  };
}

/// What kind of destination a tapped link led to. Never the destination
/// itself: a URL is content, and analytics carries none.
enum AnalyticsLinkType {
  external('external'),
  internal('internal'),
  topic('topic'),
  deepLink('deep_link');

  const AnalyticsLinkType(this.wireValue);
  final String wireValue;
}

final class LinkOpenIntent extends AnalyticsIntent {
  const LinkOpenIntent({required this.linkType, required this.logicalId});

  final AnalyticsLinkType linkType;
  final String logicalId;

  @override
  String get eventName => 'link_open';

  @override
  String get screen => 'currency_detail';

  @override
  String get feature => 'currency_education';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'linkType': linkType.wireValue,
    'logicalId': logicalId,
  };
}

/// EV-2 survey purposes, as the contract states them.
const Set<String> kSurveyPurposes = {
  'topic',
  'satisfaction',
  'feature',
  'application',
  'nps',
  'usefulness',
};

/// Where a refusal happened: at the prompt, or at the privacy notice.
enum SurveyDeclineStage { prompt, notice }

/// AN-3. Emitted once a registration has actually completed, so the account
/// creation rate counts accounts rather than attempts.
final class ProfileCreatedIntent extends AnalyticsIntent {
  const ProfileCreatedIntent();

  @override
  String get eventName => 'profile_created';

  @override
  String get screen => 'pisocamp_registration';

  @override
  String get feature => 'account';

  @override
  Map<String, Object?> get properties => const <String, Object?>{};
}

final class ArStartIntent extends AnalyticsIntent {
  const ArStartIntent({required this.logicalId, required this.outcome});

  final String logicalId;
  final ArStartOutcome outcome;

  @override
  String get eventName => 'ar_start';

  @override
  String get screen => 'ar_viewer';

  @override
  String get feature => 'ar';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'logicalId': logicalId,
    'outcome': outcome.wireValue,
  };
}

final class ArEndIntent extends AnalyticsIntent {
  const ArEndIntent({required this.logicalId, required this.durationMs});

  final String logicalId;

  /// Capped by the contract at an hour: longer is a session somebody left
  /// open, not one they watched.
  final int durationMs;

  @override
  String get eventName => 'ar_end';

  @override
  String get screen => 'ar_viewer';

  @override
  String get feature => 'ar';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'logicalId': logicalId,
    'durationMs': durationMs,
  };
}

final class RecognitionResultIntent extends AnalyticsIntent {
  const RecognitionResultIntent({
    required this.outcome,
    required this.elapsedMs,
  });

  final RecognitionOutcome outcome;

  /// How long the attempt took. Capped by the contract at two minutes.
  final int elapsedMs;

  @override
  String get eventName => 'recognition_result';

  @override
  String get screen => 'recognition_scanner';

  @override
  String get feature => 'recognition';

  /// Derived rather than passed in: the status and the outcome have to say the
  /// same thing, and the server refuses the event if they do not.
  @override
  String get status => outcome.ranNothing ? 'failed' : 'completed';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'outcome': outcome.wireValue,
    'elapsedMs': elapsedMs,
  };
}

final class FirstOpenIntent extends AnalyticsIntent {
  const FirstOpenIntent();

  @override
  String get eventName => 'first_open';

  @override
  String get screen => 'pisocamp_home';

  @override
  String get feature => 'module';

  /// Nothing at all: that this device opened the module for the first time is
  /// the whole of the event, and anything else would make an install traceable
  /// to a person.
  @override
  Map<String, Object?> get properties => const <String, Object?>{};
}

final class ModuleLoadIntent extends AnalyticsIntent {
  const ModuleLoadIntent({required this.phase, required this.durationMs});

  final ModuleLoadPhase phase;

  /// Capped at two minutes by the contract: anything longer is a device that
  /// gave up or a clock that moved, not a load time worth a percentile.
  final int durationMs;

  @override
  String get eventName => 'module_load';

  @override
  String get screen => 'pisocamp_home';

  @override
  String get feature => 'module';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'phase': phase.wireValue,
    'durationMs': durationMs,
  };
}

final class NetworkFailureIntent extends AnalyticsIntent {
  const NetworkFailureIntent({
    required this.failureType,
    required this.operation,
  });

  final AnalyticsNetworkFailureType failureType;
  final AnalyticsNetworkOperation operation;

  @override
  String get eventName => 'network_failure';

  @override
  String get screen => 'pisocamp_home';

  @override
  String get feature => 'module';

  /// The one event that exists because something did not work, so reporting it
  /// as a completion would be a lie.
  @override
  String get status => 'failed';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'failureType': failureType.wireValue,
    'operation': operation.wireValue,
  };
}

final class AdvisoryShownIntent extends AnalyticsIntent {
  const AdvisoryShownIntent({required this.logicalId});

  final String logicalId;

  @override
  String get eventName => 'advisory_shown';

  @override
  String get screen => 'exit_advisory';

  @override
  String get feature => 'advisory';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'logicalId': logicalId,
  };
}

final class SurveyPromptShownIntent extends AnalyticsIntent {
  const SurveyPromptShownIntent({
    required this.logicalId,
    required this.purpose,
  });

  final String logicalId;
  final String purpose;

  @override
  String get eventName => 'survey_prompt_shown';

  @override
  String get screen => 'survey_prompt';

  @override
  String get feature => 'survey';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'logicalId': logicalId,
    'purpose': purpose,
  };
}

final class SurveyDeclinedIntent extends AnalyticsIntent {
  const SurveyDeclinedIntent({
    required this.logicalId,
    required this.purpose,
    required this.stage,
  });

  final String logicalId;
  final String purpose;
  final SurveyDeclineStage stage;

  @override
  String get eventName => 'survey_declined';

  @override
  String get screen => 'survey_prompt';

  @override
  String get feature => 'survey';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'logicalId': logicalId,
    'purpose': purpose,
    'stage': stage.name,
  };
}

final class SurveySubmittedIntent extends AnalyticsIntent {
  const SurveySubmittedIntent({
    required this.logicalId,
    required this.purpose,
    required this.answeredCount,
  });

  final String logicalId;
  final String purpose;

  /// How many questions were answered, never what any answer was.
  final int answeredCount;

  @override
  String get eventName => 'survey_submitted';

  @override
  String get screen => 'survey_prompt';

  @override
  String get feature => 'survey';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'logicalId': logicalId,
    'purpose': purpose,
    'answeredCount': answeredCount,
  };
}

final class TriviaPromptShownIntent extends AnalyticsIntent {
  const TriviaPromptShownIntent({
    required this.logicalId,
    required this.category,
    required this.difficulty,
  });

  final String logicalId;
  final String category;
  final String difficulty;

  @override
  String get eventName => 'trivia_prompt_shown';

  @override
  String get screen => 'trivia_prompt';

  @override
  String get feature => 'trivia';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'logicalId': logicalId,
    'category': category,
    'difficulty': difficulty,
  };
}

final class TriviaPromptAnsweredIntent extends AnalyticsIntent {
  const TriviaPromptAnsweredIntent({
    required this.logicalId,
    required this.category,
    required this.difficulty,
    required this.correct,
    required this.openedTopic,
  });

  final String logicalId;
  final String category;
  final String difficulty;

  /// Whether the answer was right, never which answer was chosen: the chosen
  /// label is content, and analytics carries none.
  final bool correct;
  final bool openedTopic;

  @override
  String get eventName => 'trivia_prompt_answered';

  @override
  String get screen => 'trivia_prompt';

  @override
  String get feature => 'trivia';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'logicalId': logicalId,
    'category': category,
    'difficulty': difficulty,
    'correct': correct,
    'openedTopic': openedTopic,
  };
}

final class TriviaPromptSkippedIntent extends AnalyticsIntent {
  const TriviaPromptSkippedIntent({
    required this.logicalId,
    required this.category,
    required this.difficulty,
  });

  final String logicalId;
  final String category;
  final String difficulty;

  @override
  String get eventName => 'trivia_prompt_skipped';

  @override
  String get screen => 'trivia_prompt';

  @override
  String get feature => 'trivia';

  @override
  Map<String, Object?> get properties => <String, Object?>{
    'logicalId': logicalId,
    'category': category,
    'difficulty': difficulty,
  };
}

final class AnalyticsEventContext {
  const AnalyticsEventContext({
    required this.subjectPseudoId,
    required this.sessionId,
    required this.accountType,
    required this.appVersion,
    required this.osName,
    required this.osVersion,
    required this.deviceCategory,
    required this.networkState,
  });

  final String subjectPseudoId;
  final String sessionId;
  final AnalyticsAccountType accountType;
  final String appVersion;
  final AnalyticsOsName osName;
  final String osVersion;
  final AnalyticsDeviceCategory deviceCategory;
  final AnalyticsNetworkState networkState;
}

/// The closed wire model shared by the mobile producer and parser.
final class AnalyticsEvent {
  const AnalyticsEvent._({
    required this.eventId,
    required this.intent,
    required this.occurredAt,
    required this.context,
  });

  final String eventId;
  final AnalyticsIntent intent;
  final DateTime occurredAt;
  final AnalyticsEventContext context;

  factory AnalyticsEvent.build({
    required AnalyticsIntent intent,
    required AnalyticsEventContext context,
    String Function()? createEventId,
    DateTime Function()? clock,
  }) {
    final event = AnalyticsEvent._(
      eventId: (createEventId ?? createUuidV4)(),
      intent: intent,
      occurredAt: _millisecondUtc((clock ?? DateTime.now)()),
      context: context,
    );
    event._validatedJson();
    return event;
  }

  factory AnalyticsEvent.fromJson(Map<String, Object?> json) {
    _requireExactKeys(json, _commonKeys);

    final eventName = _requiredString(json, 'eventName');
    final eventId = _requiredUuid(json, 'eventId');
    final occurredAt = _requiredDateTime(json, 'occurredAt');
    final context = AnalyticsEventContext(
      subjectPseudoId: _requiredPseudoId(json, 'subjectPseudoId'),
      sessionId: _requiredUuid(json, 'sessionId'),
      accountType: _parseWire(
        AnalyticsAccountType.values,
        _requiredString(json, 'accountType'),
      ),
      appVersion: _requiredBoundedString(json, 'appVersion', 64),
      osName: _parseWire(
        AnalyticsOsName.values,
        _requiredString(json, 'osName'),
      ),
      osVersion: _requiredBoundedString(json, 'osVersion', 96),
      deviceCategory: _parseWire(
        AnalyticsDeviceCategory.values,
        _requiredString(json, 'deviceCategory'),
      ),
      networkState: _parseWire(
        AnalyticsNetworkState.values,
        _requiredString(json, 'networkState'),
      ),
    );
    _requireLiteral(json, 'schemaVersion', _schemaVersion);
    final properties = _requiredMap(json, 'properties');
    _inspectEnvelopeValues(json, properties);
    final intent = _parseIntent(
      eventName: eventName,
      screen: _requiredString(json, 'screen'),
      feature: _requiredString(json, 'feature'),
      properties: properties,
    );
    // Each event declares its own status. Only `network_failure` and a
    // recognition scan that never ran report anything but a completion.
    _requireLiteral(json, 'status', intent.status);

    final event = AnalyticsEvent._(
      eventId: eventId,
      intent: intent,
      occurredAt: occurredAt,
      context: context,
    );
    if (utf8.encode(jsonEncode(json)).length > _eventMaxBytes) {
      throw const AnalyticsValidationException(
        AnalyticsValidationReason.payloadTooLarge,
      );
    }
    return event;
  }

  Map<String, Object?> toJson() => _validatedJson();

  Map<String, Object?> _validatedJson() {
    final json = <String, Object?>{
      'schemaVersion': _schemaVersion,
      'eventId': eventId,
      'eventName': intent.eventName,
      'occurredAt': _millisecondUtc(occurredAt).toIso8601String(),
      'subjectPseudoId': context.subjectPseudoId,
      'sessionId': context.sessionId,
      'accountType': context.accountType.wireValue,
      'screen': intent.screen,
      'feature': intent.feature,
      'appVersion': context.appVersion,
      'osName': context.osName.wireValue,
      'osVersion': context.osVersion,
      'deviceCategory': context.deviceCategory.wireValue,
      'networkState': context.networkState.wireValue,
      'status': intent.status,
      'properties': Map<String, Object?>.from(intent.properties),
    };
    AnalyticsEvent.fromJson(json);
    if (utf8.encode(jsonEncode(json)).length > _eventMaxBytes) {
      throw const AnalyticsValidationException(
        AnalyticsValidationReason.payloadTooLarge,
      );
    }
    return json;
  }
}

void _inspectEnvelopeValues(
  Map<String, Object?> envelope,
  Map<String, Object?> properties,
) {
  for (final entry in envelope.entries) {
    if (entry.key != 'properties') _inspectValue(entry.value, 0);
  }
  _inspectValue(properties, 0);
}

const _commonKeys = <String>{
  'schemaVersion',
  'eventId',
  'eventName',
  'occurredAt',
  'subjectPseudoId',
  'sessionId',
  'accountType',
  'screen',
  'feature',
  'appVersion',
  'osName',
  'osVersion',
  'deviceCategory',
  'networkState',
  'status',
  'properties',
};

AnalyticsIntent _parseIntent({
  required String eventName,
  required String screen,
  required String feature,
  required Map<String, Object?> properties,
}) {
  switch (eventName) {
    case 'module_entry':
      _requireExactKeys(properties, const <String>{'entryPoint'});
      if (screen != 'pisocamp_home' || feature != 'module') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return ModuleEntryIntent(
        _parseWire(
          ModuleEntryPoint.values,
          _requiredString(properties, 'entryPoint'),
        ),
      );
    case 'account_prompt_shown':
      _requireExactKeys(properties, const <String>{});
      if (screen != 'pisocamp_home' || feature != 'account_prompt') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return const AccountPromptShownIntent();
    case 'account_prompt_guest':
      _requireExactKeys(properties, const <String>{});
      if (screen != 'pisocamp_home' || feature != 'account_prompt') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return const AccountPromptGuestIntent();
    case 'content_view':
      _requireExactKeys(properties, const <String>{'logicalId'});
      if (screen != 'currency_detail' || feature != 'currency_education') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return ContentViewIntent(
        _requiredBoundedString(properties, 'logicalId', 128),
      );
    case 'link_open':
      _requireExactKeys(properties, const <String>{'linkType', 'logicalId'});
      if (screen != 'currency_detail' || feature != 'currency_education') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return LinkOpenIntent(
        linkType: _parseWire(
          AnalyticsLinkType.values,
          _requiredString(properties, 'linkType'),
        ),
        logicalId: _requiredBoundedString(properties, 'logicalId', 128),
      );
    case 'trivia_prompt_shown':
    case 'trivia_prompt_skipped':
      _requireExactKeys(properties, const <String>{
        'logicalId',
        'category',
        'difficulty',
      });
      if (screen != 'trivia_prompt' || feature != 'trivia') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      final promptLogicalId = _requiredBoundedString(
        properties,
        'logicalId',
        128,
      );
      final promptCategory = _requiredBoundedString(properties, 'category', 64);
      final promptDifficulty = _requiredTriviaDifficulty(properties);
      return eventName == 'trivia_prompt_shown'
          ? TriviaPromptShownIntent(
              logicalId: promptLogicalId,
              category: promptCategory,
              difficulty: promptDifficulty,
            )
          : TriviaPromptSkippedIntent(
              logicalId: promptLogicalId,
              category: promptCategory,
              difficulty: promptDifficulty,
            );
    case 'trivia_prompt_answered':
      _requireExactKeys(properties, const <String>{
        'logicalId',
        'category',
        'difficulty',
        'correct',
        'openedTopic',
      });
      if (screen != 'trivia_prompt' || feature != 'trivia') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return TriviaPromptAnsweredIntent(
        logicalId: _requiredBoundedString(properties, 'logicalId', 128),
        category: _requiredBoundedString(properties, 'category', 64),
        difficulty: _requiredTriviaDifficulty(properties),
        correct: _requiredBool(properties, 'correct'),
        openedTopic: _requiredBool(properties, 'openedTopic'),
      );
    case 'profile_created':
      _requireExactKeys(properties, const <String>{});
      if (screen != 'pisocamp_registration' || feature != 'account') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return const ProfileCreatedIntent();
    case 'ar_start':
      _requireExactKeys(properties, const <String>{'logicalId', 'outcome'});
      if (screen != 'ar_viewer' || feature != 'ar') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return ArStartIntent(
        logicalId: _requiredBoundedString(properties, 'logicalId', 128),
        outcome: _parseWire(
          ArStartOutcome.values,
          _requiredString(properties, 'outcome'),
        ),
      );
    case 'ar_end':
      _requireExactKeys(properties, const <String>{'logicalId', 'durationMs'});
      if (screen != 'ar_viewer' || feature != 'ar') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return ArEndIntent(
        logicalId: _requiredBoundedString(properties, 'logicalId', 128),
        durationMs: _requiredBoundedInt(properties, 'durationMs', 3600000),
      );
    case 'recognition_result':
      _requireExactKeys(properties, const <String>{'outcome', 'elapsedMs'});
      if (screen != 'recognition_scanner' || feature != 'recognition') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return RecognitionResultIntent(
        outcome: _parseWire(
          RecognitionOutcome.values,
          _requiredString(properties, 'outcome'),
        ),
        elapsedMs: _requiredBoundedInt(properties, 'elapsedMs', 120000),
      );
    case 'first_open':
      _requireExactKeys(properties, const <String>{});
      if (screen != 'pisocamp_home' || feature != 'module') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return const FirstOpenIntent();
    case 'module_load':
      _requireExactKeys(properties, const <String>{'phase', 'durationMs'});
      if (screen != 'pisocamp_home' || feature != 'module') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return ModuleLoadIntent(
        phase: _parseWire(
          ModuleLoadPhase.values,
          _requiredString(properties, 'phase'),
        ),
        durationMs: _requiredBoundedInt(properties, 'durationMs', 120000),
      );
    case 'network_failure':
      _requireExactKeys(properties, const <String>{'failureType', 'operation'});
      if (screen != 'pisocamp_home' || feature != 'module') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return NetworkFailureIntent(
        failureType: _parseWire(
          AnalyticsNetworkFailureType.values,
          _requiredString(properties, 'failureType'),
        ),
        operation: _parseWire(
          AnalyticsNetworkOperation.values,
          _requiredString(properties, 'operation'),
        ),
      );
    case 'advisory_shown':
      _requireExactKeys(properties, const <String>{'logicalId'});
      if (screen != 'exit_advisory' || feature != 'advisory') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return AdvisoryShownIntent(
        logicalId: _requiredBoundedString(properties, 'logicalId', 128),
      );
    case 'survey_prompt_shown':
      _requireExactKeys(properties, const <String>{'logicalId', 'purpose'});
      _requireSurveyCatalog(screen, feature);
      return SurveyPromptShownIntent(
        logicalId: _requiredBoundedString(properties, 'logicalId', 128),
        purpose: _requiredSurveyPurpose(properties),
      );
    case 'survey_declined':
      _requireExactKeys(properties, const <String>{
        'logicalId',
        'purpose',
        'stage',
      });
      _requireSurveyCatalog(screen, feature);
      final stage = _requiredString(properties, 'stage');
      if (stage != 'prompt' && stage != 'notice') {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidField,
        );
      }
      return SurveyDeclinedIntent(
        logicalId: _requiredBoundedString(properties, 'logicalId', 128),
        purpose: _requiredSurveyPurpose(properties),
        stage: stage == 'prompt'
            ? SurveyDeclineStage.prompt
            : SurveyDeclineStage.notice,
      );
    case 'survey_submitted':
      _requireExactKeys(properties, const <String>{
        'logicalId',
        'purpose',
        'answeredCount',
      });
      _requireSurveyCatalog(screen, feature);
      final answered = properties['answeredCount'];
      if (answered is! int || answered < 0 || answered > 20) {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidShape,
        );
      }
      return SurveySubmittedIntent(
        logicalId: _requiredBoundedString(properties, 'logicalId', 128),
        purpose: _requiredSurveyPurpose(properties),
        answeredCount: answered,
      );
    case 'feature_use':
      _requireExactKeys(properties, const <String>{'logicalId'});
      // An unknown or mislabelled feature is a catalog problem, not a
      // malformed field, so it is reported as one.
      final usedFeature = _featureForWireValue(feature);
      if (usedFeature == null || screen != usedFeature.screen) {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidCatalog,
        );
      }
      return FeatureUseIntent(
        usedFeature: usedFeature,
        logicalId: _requiredBoundedString(properties, 'logicalId', 128),
      );
    default:
      throw const AnalyticsValidationException(
        AnalyticsValidationReason.invalidCatalog,
      );
  }
}

void _requireSurveyCatalog(String screen, String feature) {
  if (screen != 'survey_prompt' || feature != 'survey') {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidCatalog,
    );
  }
}

String _requiredSurveyPurpose(Map<String, Object?> properties) {
  final purpose = _requiredString(properties, 'purpose');
  if (!kSurveyPurposes.contains(purpose)) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidField,
    );
  }
  return purpose;
}

void _requireExactKeys(Map<String, Object?> value, Set<String> expected) {
  if (value.length != expected.length ||
      !value.keys.toSet().containsAll(expected)) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidShape,
    );
  }
}

Map<String, Object?> _requiredMap(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! Map) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidField,
    );
  }
  final result = <String, Object?>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      throw const AnalyticsValidationException(
        AnalyticsValidationReason.invalidField,
      );
    }
    result[entry.key as String] = entry.value;
  }
  return result;
}

String _requiredString(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! String) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidField,
    );
  }
  return value;
}

String _requiredBoundedString(Map<String, Object?> json, String key, int max) {
  final value = _requiredString(json, key);
  if (value.trim().isEmpty || value.length > max || value != value.trim()) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidField,
    );
  }
  return value;
}

String _requiredUuid(Map<String, Object?> json, String key) {
  final value = _requiredString(json, key);
  if (!_uuidV4Pattern.hasMatch(value)) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidField,
    );
  }
  return value;
}

String _requiredPseudoId(Map<String, Object?> json, String key) {
  final value = _requiredString(json, key);
  if (!_pseudoIdPattern.hasMatch(value)) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidField,
    );
  }
  return value;
}

DateTime _requiredDateTime(Map<String, Object?> json, String key) {
  final value = _requiredString(json, key);
  final match = _isoDateTimePattern.firstMatch(value);
  if (match == null || !_hasValidCalendarDate(value)) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidField,
    );
  }
  try {
    return DateTime.parse(value).toUtc();
  } on FormatException {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidField,
    );
  }
}

bool _hasValidCalendarDate(String value) {
  final year = int.parse(value.substring(0, 4));
  final month = int.parse(value.substring(5, 7));
  final day = int.parse(value.substring(8, 10));
  final hour = int.parse(value.substring(11, 13));
  final minute = int.parse(value.substring(14, 16));
  final second = int.parse(value.substring(17, 19));
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  final daysInMonth = <int>[
    31,
    _isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (day < 1 || day > daysInMonth[month - 1]) return false;
  if (value.endsWith('Z')) return true;

  final offset = _numericOffsetPattern.firstMatch(value);
  if (offset == null) return false;
  final offsetHour = int.parse(offset.group(1)!);
  final offsetMinute = int.parse(offset.group(2)!);
  return offsetHour <= 23 && offsetMinute <= 59;
}

bool _isLeapYear(int year) =>
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);

void _requireLiteral(Map<String, Object?> json, String key, Object value) {
  if (json[key] != value) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidField,
    );
  }
}

String _requiredTriviaDifficulty(Map<String, Object?> properties) {
  final value = properties['difficulty'];
  if (value != 'easy' && value != 'medium' && value != 'hard') {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidField,
    );
  }
  return value! as String;
}

int _requiredBoundedInt(
  Map<String, Object?> properties,
  String key,
  int maximum,
) {
  final value = properties[key];
  if (value is! int || value < 0 || value > maximum) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidField,
    );
  }
  return value;
}

bool _requiredBool(Map<String, Object?> properties, String key) {
  final value = properties[key];
  if (value is! bool) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.invalidField,
    );
  }
  return value;
}

AnalyticsFeature? _featureForWireValue(String wireValue) {
  for (final value in AnalyticsFeature.values) {
    if (value.wireValue == wireValue) return value;
  }
  return null;
}

T _parseWire<T extends Enum>(List<T> values, String wireValue) {
  for (final value in values) {
    final actual = switch (value) {
      ModuleEntryPoint value => value.wireValue,
      AnalyticsLinkType value => value.wireValue,
      AnalyticsAccountType value => value.wireValue,
      AnalyticsOsName value => value.wireValue,
      AnalyticsDeviceCategory value => value.wireValue,
      AnalyticsNetworkState value => value.wireValue,
      ModuleLoadPhase value => value.wireValue,
      AnalyticsNetworkFailureType value => value.wireValue,
      AnalyticsNetworkOperation value => value.wireValue,
      ArStartOutcome value => value.wireValue,
      RecognitionOutcome value => value.wireValue,
      _ => null,
    };
    if (actual == wireValue) return value;
  }
  throw const AnalyticsValidationException(
    AnalyticsValidationReason.invalidField,
  );
}

void _inspectValue(Object? value, int depth, [String? key]) {
  if (depth > _maxInspectionDepth) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.nestingTooDeep,
    );
  }
  if (key != null && _hasForbiddenKeySegment(key)) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.forbiddenKey,
    );
  }
  if (value is ByteBuffer || value is TypedData) {
    throw const AnalyticsValidationException(
      AnalyticsValidationReason.byteArray,
    );
  }
  if (value is String) {
    if (value.length > _maxInspectedStringLength) {
      throw const AnalyticsValidationException(
        AnalyticsValidationReason.stringTooLong,
      );
    }
    if (_emailPattern.hasMatch(value) || _isImagePayload(value)) {
      throw const AnalyticsValidationException(
        AnalyticsValidationReason.forbiddenValue,
      );
    }
    return;
  }
  if (value is List) {
    for (final entry in value) {
      _inspectValue(entry, depth + 1);
    }
    return;
  }
  if (value is Map) {
    for (final entry in value.entries) {
      if (entry.key is! String) {
        throw const AnalyticsValidationException(
          AnalyticsValidationReason.invalidShape,
        );
      }
      _inspectValue(entry.value, depth + 1, entry.key as String);
    }
  }
}

bool _hasForbiddenKeySegment(String key) {
  final normalized = String.fromCharCodes(
    key.runes.map((rune) {
      if (rune >= 0xff01 && rune <= 0xff5e) return rune - 0xfee0;
      if (rune == 0x3000) return 0x20;
      return rune;
    }),
  ).replaceAll(RegExp(r'[^A-Za-z0-9]'), '').toLowerCase();
  return _forbiddenKeySegments.any(
    (segment) => normalized.contains(segment.toLowerCase()),
  );
}

bool _isImagePayload(String value) {
  final compact = value.trim().replaceAll(RegExp(r'\s'), '');
  return compact.toLowerCase().startsWith('data:image/') ||
      RegExp(r'^(?:iVBORw0KGgo|/9j/|R0lGOD|UklGR)').hasMatch(compact);
}

DateTime _millisecondUtc(DateTime value) => DateTime.fromMillisecondsSinceEpoch(
  value.toUtc().millisecondsSinceEpoch,
  isUtc: true,
);
