import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';

const _fixturePath =
    '../../packages/contracts/src/modules/v1/pisocamp/fixtures/an1-event-vectors.json';

void main() {
  final vectors = (jsonDecode(File(_fixturePath).readAsStringSync()) as List)
      .cast<Map<String, Object?>>()
      .map((vector) => Map<String, Object?>.from(vector))
      .toList(growable: false);

  test('parses and round-trips every shared TypeScript fixture exactly', () {
    final result = vectors
        .map((vector) => AnalyticsEvent.fromJson(vector).toJson())
        .toList(growable: false);

    expect(result, vectors);
  });

  test('build assigns one injected UUID and a UTC millisecond timestamp', () {
    var identifiersCreated = 0;
    final event = AnalyticsEvent.build(
      intent: const ModuleEntryIntent(ModuleEntryPoint.navigation),
      context: _context(),
      createEventId: () {
        identifiersCreated++;
        return '0190f49b-57a8-4b85-9d0e-5e274f0e4aa1';
      },
      clock: () => DateTime.parse('2026-08-30T09:02:03.123456+08:00'),
    );

    expect(identifiersCreated, 1);
    expect(event.toJson(), <String, Object?>{
      'schemaVersion': 1,
      'eventId': '0190f49b-57a8-4b85-9d0e-5e274f0e4aa1',
      'eventName': 'module_entry',
      'occurredAt': '2026-08-30T01:02:03.123Z',
      'subjectPseudoId': 'AbCdEfGhIjKlMnOpQrStUv',
      'sessionId': 'f6635d24-b4d1-4f63-8a06-4026fa4e8fd6',
      'accountType': 'guest',
      'screen': 'pisocamp_home',
      'feature': 'module',
      'appVersion': '1.0.0+1',
      'osName': 'android',
      'osVersion': 'Android 15',
      'deviceCategory': 'phone',
      'networkState': 'offline',
      'status': 'completed',
      'properties': <String, Object?>{'entryPoint': 'navigation'},
    });
  });

  group('feature_use binds a feature to the screen that hosts it', () {
    Map<String, Object?> featureUse(Map<String, Object?> changes) {
      final vector = Map<String, Object?>.from(
        vectorsForTest.firstWhere(
          (candidate) => candidate['eventName'] == 'feature_use',
        ),
      );
      return vector..addAll(changes);
    }

    test('builds the coin viewer event from its intent', () {
      final event = AnalyticsEvent.build(
        intent: const FeatureUseIntent(
          usedFeature: AnalyticsFeature.coin3d,
          logicalId: 'catalog.ngc-coins.php-1',
        ),
        context: _context(),
        createEventId: () => '0190f49b-57a8-4b85-9d0e-5e274f0e4aa1',
        clock: () => DateTime.parse('2026-08-30T09:02:03.123456+08:00'),
      );
      final json = event.toJson();

      expect(json['eventName'], 'feature_use');
      expect(json['feature'], '3d_coin');
      expect(json['screen'], 'coin_3d_viewer');
      expect(json['properties'], <String, Object?>{
        'logicalId': 'catalog.ngc-coins.php-1',
      });
    });

    test('refuses a feature reported against the wrong screen', () {
      expect(
        () => AnalyticsEvent.fromJson(
          featureUse(<String, Object?>{'screen': 'currency_detail'}),
        ),
        throwsA(
          isA<AnalyticsValidationException>().having(
            (error) => error.reason,
            'reason',
            AnalyticsValidationReason.invalidCatalog,
          ),
        ),
      );
    });

    test('refuses a feature the catalog does not name', () {
      expect(
        () => AnalyticsEvent.fromJson(
          featureUse(<String, Object?>{'feature': 'coin_polisher'}),
        ),
        throwsA(
          isA<AnalyticsValidationException>().having(
            (error) => error.reason,
            'reason',
            AnalyticsValidationReason.invalidCatalog,
          ),
        ),
      );
    });
  });

  group('rejects forbidden values in every free-text envelope field', () {
    const forbiddenValues = <String>[
      'private@example.test',
      'data:image/png;base64,abc',
    ];
    for (final value in forbiddenValues) {
      test('build rejects appVersion value shaped as ${_shape(value)}', () {
        expect(
          () => AnalyticsEvent.build(
            intent: const ModuleEntryIntent(ModuleEntryPoint.navigation),
            context: _context(appVersion: value),
          ),
          _throwsForbiddenValue,
        );
      });

      test('build rejects osVersion value shaped as ${_shape(value)}', () {
        expect(
          () => AnalyticsEvent.build(
            intent: const ModuleEntryIntent(ModuleEntryPoint.navigation),
            context: _context(osVersion: value),
          ),
          _throwsForbiddenValue,
        );
      });

      test('build rejects logicalId value shaped as ${_shape(value)}', () {
        expect(
          () => AnalyticsEvent.build(
            intent: ContentViewIntent(value),
            context: _context(),
          ),
          _throwsForbiddenValue,
        );
      });

      test('parser rejects appVersion value shaped as ${_shape(value)}', () {
        expect(
          () => AnalyticsEvent.fromJson(_with('appVersion', value)),
          _throwsForbiddenValue,
        );
      });

      test('parser rejects osVersion value shaped as ${_shape(value)}', () {
        expect(
          () => AnalyticsEvent.fromJson(_with('osVersion', value)),
          _throwsForbiddenValue,
        );
      });

      test('parser rejects logicalId value shaped as ${_shape(value)}', () {
        final payload = Map<String, Object?>.from(
          vectorsForTest.firstWhere(
            (vector) => vector['eventName'] == 'content_view',
          ),
        )..['properties'] = <String, Object?>{'logicalId': value};

        expect(() => AnalyticsEvent.fromJson(payload), _throwsForbiddenValue);
      });
    }
  });

  group('rejects untrusted event payloads without echoing values', () {
    for (final invalid in <String, Map<String, Object?>>{
      'unknown common key': _with('extra', true),
      'unknown property': _withProperties(<String, Object?>{
        'entryPoint': 'navigation',
        'extra': true,
      }),
      'email key': _withProperties(<String, Object?>{'email': 'safe'}),
      'normalized email key': _withProperties(<String, Object?>{
        'ｅｍａｉｌ': 'safe',
      }),
      'name key': _withProperties(<String, Object?>{'display_name': 'safe'}),
      'nested photo key': _withProperties(<String, Object?>{
        'entryPoint': 'navigation',
        'nested': <String, Object?>{'photo': 'safe'},
      }),
      'data image': _withProperties(<String, Object?>{
        'entryPoint': 'navigation',
        'nested': 'data:image/png;base64,abc',
      }),
      'image base64': _withProperties(<String, Object?>{
        'entryPoint': 'navigation',
        'nested': 'iVBORw0KGgoAAAA',
      }),
      'byte array': _withProperties(<String, Object?>{
        'entryPoint': 'navigation',
        'nested': Uint8List.fromList(<int>[1, 2]),
      }),
      'email-shaped value': _withProperties(<String, Object?>{
        'entryPoint': 'navigation',
        'nested': 'private@example.test',
      }),
      'excessive nesting': _withProperties(<String, Object?>{
        'entryPoint': 'navigation',
        'nested': _nested(9),
      }),
      'overlong string': _withProperties(<String, Object?>{
        'entryPoint': 'x' * 129,
      }),
      'invalid pseudo ID': _with('subjectPseudoId', 'not-a-pseudonym'),
      'invalid UUID': _with('eventId', 'not-a-uuid'),
      'invalid time': _with('occurredAt', 'yesterday'),
      'invalid UTC offset minute': _with(
        'occurredAt',
        '2026-08-30T01:02:03.000+00:60',
      ),
      'invalid UTC offset hour and minute': _with(
        'occurredAt',
        '2026-08-30T01:02:03.000+99:99',
      ),
      'invalid enum': _with('networkState', 'mobile_data'),
      'canonical payload over 8 KiB': _with('appVersion', 'a' * 8192),
    }.entries) {
      test(invalid.key, () {
        expect(
          () => AnalyticsEvent.fromJson(invalid.value),
          throwsA(
            isA<AnalyticsValidationException>().having(
              (error) => error.reason.name,
              'stable reason code',
              isNotEmpty,
            ),
          ),
        );
        try {
          AnalyticsEvent.fromJson(invalid.value);
        } on AnalyticsValidationException catch (error) {
          expect(error.toString(), isNot(contains('private@example.test')));
          expect(error.toString(), isNot(contains('data:image')));
        }
      });
    }
  });
}

AnalyticsEventContext _context({
  String appVersion = '1.0.0+1',
  String osVersion = 'Android 15',
}) => AnalyticsEventContext(
  subjectPseudoId: 'AbCdEfGhIjKlMnOpQrStUv',
  sessionId: 'f6635d24-b4d1-4f63-8a06-4026fa4e8fd6',
  accountType: AnalyticsAccountType.guest,
  appVersion: appVersion,
  osName: AnalyticsOsName.android,
  osVersion: osVersion,
  deviceCategory: AnalyticsDeviceCategory.phone,
  networkState: AnalyticsNetworkState.offline,
);

Matcher get _throwsForbiddenValue => throwsA(
  isA<AnalyticsValidationException>().having(
    (error) => error.reason,
    'stable reason',
    AnalyticsValidationReason.forbiddenValue,
  ),
);

String _shape(String value) => value.startsWith('data:') ? 'image' : 'email';

Map<String, Object?> _with(String key, Object? value) {
  final result = Map<String, Object?>.from(vectorsForTest.first);
  result[key] = value;
  return result;
}

Map<String, Object?> _withProperties(Map<String, Object?> properties) {
  final result = Map<String, Object?>.from(vectorsForTest.first);
  result['properties'] = properties;
  return result;
}

Map<String, Object?> _nested(int depth) => depth == 0
    ? <String, Object?>{'value': 'safe'}
    : <String, Object?>{'level': _nested(depth - 1)};

final vectorsForTest =
    (jsonDecode(File(_fixturePath).readAsStringSync()) as List)
        .cast<Map<String, Object?>>()
        .map((vector) => Map<String, Object?>.from(vector))
        .toList(growable: false);
