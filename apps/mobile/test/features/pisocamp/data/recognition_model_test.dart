import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/data/recognition_model.dart';

Uint8List _weights() => Uint8List.fromList(<int>[1, 2, 3, 4]);

Map<String, Object?> _descriptorMap() => <String, Object?>{
  'schemaVersion': 1,
  'version': '2026.09.1',
  'classes': <Object?>[
    {
      'classId': 0,
      'outcome': 'denomination',
      'label': 'Twenty pesos',
      'denominationCode': 'PHP20',
    },
  ],
};

List<int> _bytes(Map<String, Object?> descriptor) =>
    utf8.encode(jsonEncode(descriptor));

void main() {
  group('DR-1 reading the approved model descriptor', () {
    test('reads a version and its classes', () {
      final model = RecognitionModelDocument.parse(
        _bytes(_descriptorMap()),
        _weights(),
      );

      // The version is what DR-4 needs to say which model produced a figure.
      expect(model.version, '2026.09.1');
      expect(model.classFor(0)?.denominationCode, 'PHP20');
      expect(model.classFor(9), isNull);
    });

    test('refuses anything it does not fully understand', () {
      final rejected = <String, Map<String, Object?>>{
        'a schema this build was not written for': {
          ..._descriptorMap(),
          'schemaVersion': 2,
        },
        'no version to report': {..._descriptorMap(), 'version': ''},
        'no classes at all': {..._descriptorMap(), 'classes': <Object?>[]},
        'a class with no denomination': {
          ..._descriptorMap(),
          'classes': <Object?>[
            {'classId': 0, 'outcome': 'denomination', 'label': 'Twenty pesos'},
          ],
        },
        'two classes claiming the same id': {
          ..._descriptorMap(),
          'classes': <Object?>[
            {
              'classId': 0,
              'outcome': 'denomination',
              'label': 'Twenty pesos',
              'denominationCode': 'PHP20',
            },
            {
              'classId': 0,
              'outcome': 'denomination',
              'label': 'Fifty pesos',
              'denominationCode': 'PHP50',
            },
          ],
        },
        'an outcome this build cannot honour': {
          ..._descriptorMap(),
          'classes': <Object?>[
            {
              'classId': 0,
              'outcome': 'counterfeit',
              'label': 'Fake',
              'denominationCode': 'PHP20',
            },
          ],
        },
        // BR-007. A denomination on a demonetized class is a denomination
        // waiting to be spoken about a note that is no longer legal tender.
        'a demonetized class carrying a denomination': {
          ..._descriptorMap(),
          'classes': <Object?>[
            {
              'classId': 0,
              'outcome': 'demonetized',
              'label': 'New Design Series',
              'denominationCode': 'PHP20',
            },
          ],
        },
        'a demonetized class with no series to name': {
          ..._descriptorMap(),
          'classes': <Object?>[
            {'classId': 0, 'outcome': 'demonetized'},
          ],
        },
        // BR-008 and section 17: naming the currency is outside this module,
        // so the class list is not allowed to carry the answer.
        'a foreign class naming the currency': {
          ..._descriptorMap(),
          'classes': <Object?>[
            {'classId': 0, 'outcome': 'foreign', 'label': 'US dollar'},
          ],
        },
        'a foreign class carrying a denomination': {
          ..._descriptorMap(),
          'classes': <Object?>[
            {'classId': 0, 'outcome': 'foreign', 'denominationCode': 'USD20'},
          ],
        },
      };

      for (final entry in rejected.entries) {
        expect(
          () => RecognitionModelDocument.parse(_bytes(entry.value), _weights()),
          throwsA(
            isA<RecognitionModelException>().having(
              (error) => error.problem,
              'problem',
              RecognitionModelProblem.corrupt,
            ),
          ),
          reason: entry.key,
        );
      }
    });

    test('reads the classes DR-3 owns, and only what each may carry', () {
      final model = RecognitionModelDocument.parse(
        _bytes({
          ..._descriptorMap(),
          'classes': <Object?>[
            {
              'classId': 0,
              'outcome': 'denomination',
              'label': 'Twenty pesos',
              'denominationCode': 'PHP20',
            },
            {
              'classId': 1,
              'outcome': 'demonetized',
              'label': 'New Design Series',
            },
            {'classId': 2, 'outcome': 'foreign'},
          ],
        }),
        _weights(),
      );

      expect(model.classFor(1)?.outcome, RecognitionClassOutcome.demonetized);
      expect(model.classFor(1)?.label, 'New Design Series');
      // Nothing to read out as a denomination, and nothing that names a
      // foreign currency: the shapes make the wrong claim impossible rather
      // than merely unlikely.
      expect(model.classFor(1)?.denominationCode, isNull);
      expect(model.classFor(2)?.outcome, RecognitionClassOutcome.foreign);
      expect(model.classFor(2)?.label, isNull);
      expect(model.classFor(2)?.denominationCode, isNull);
    });

    test('refuses a descriptor with no weights behind it', () {
      // A descriptor without a model is a class list that can never be
      // produced: reading it as usable would leave the scanner waiting forever.
      expect(
        () => RecognitionModelDocument.parse(
          _bytes(_descriptorMap()),
          Uint8List(0),
        ),
        throwsA(isA<RecognitionModelException>()),
      );
    });

    test('refuses bytes that are not a descriptor at all', () {
      expect(
        () => RecognitionModelDocument.parse(
          utf8.encode('not json'),
          _weights(),
        ),
        throwsA(
          isA<RecognitionModelException>().having(
            (error) => error.problem,
            'problem',
            RecognitionModelProblem.corrupt,
          ),
        ),
      );
    });
  });

  group('DR-1 loading the model out of the bundle', () {
    test('reports a bundle that carries no model as missing', () async {
      final catalog = _FakeCatalog(<String, Uint8List>{});

      await expectLater(
        BundleRecognitionModelSource(catalog).load(),
        throwsA(
          isA<RecognitionModelException>().having(
            (error) => error.problem,
            'problem',
            RecognitionModelProblem.missing,
          ),
        ),
      );
    });

    test('reads the descriptor and the weights the manifest names', () async {
      final catalog = _FakeCatalog(<String, Uint8List>{
        kRecognitionDescriptorLogicalId: Uint8List.fromList(
          _bytes(_descriptorMap()),
        ),
        kRecognitionWeightsLogicalId: _weights(),
      });

      final model = await BundleRecognitionModelSource(catalog).load();
      expect(model.version, '2026.09.1');
      expect(model.weights, _weights());
    });

    test('reports a model it cannot read back as corrupt, not missing', () async {
      final catalog = _FakeCatalog(<String, Uint8List>{
        kRecognitionDescriptorLogicalId: Uint8List.fromList(
          _bytes(_descriptorMap()),
        ),
        kRecognitionWeightsLogicalId: _weights(),
      }, unreadable: {kRecognitionWeightsLogicalId});

      // A digest mismatch or a truncated object is a model that cannot be
      // trusted to name a banknote, and saying "not downloaded" would send
      // somebody to sync a bundle they already have.
      await expectLater(
        BundleRecognitionModelSource(catalog).load(),
        throwsA(
          isA<RecognitionModelException>().having(
            (error) => error.problem,
            'problem',
            RecognitionModelProblem.corrupt,
          ),
        ),
      );
    });
  });
}

class _FakeCatalog implements ActiveCurrencyCatalogReader {
  _FakeCatalog(this._objects, {this.unreadable = const <String>{}});

  final Map<String, Uint8List> _objects;
  final Set<String> unreadable;

  @override
  List<BundleManifestEntry> get entries => _objects.entries
      .map(
        (entry) => BundleManifestEntry.forTest(
          logicalId: entry.key,
          kind: BundleEntryKind.recognitionModel,
          mediaType: entry.key == kRecognitionDescriptorLogicalId
              ? 'application/json'
              : 'application/octet-stream',
          bytes: entry.value,
        ),
      )
      .toList();

  @override
  Future<Uint8List> readBytes(BundleManifestEntry entry) async {
    if (unreadable.contains(entry.logicalId)) {
      throw const FormatException('digest mismatch');
    }
    return _objects[entry.logicalId]!;
  }
}
