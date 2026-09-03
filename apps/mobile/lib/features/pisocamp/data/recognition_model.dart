import 'dart:convert';
import 'dart:typed_data';

import 'bundle_protocol.dart';
import 'bundle_store.dart';

/// What a recognition class is allowed to conclude.
///
/// A class this build does not understand is refused rather than quietly read
/// as a denomination, because a wrong reading of a class list is a wrong
/// denomination spoken aloud.
enum RecognitionClassOutcome {
  /// Circulating legal tender. The only outcome that names a denomination.
  denomination('denomination'),

  /// DR-004. A Philippine note from a series that no longer circulates.
  demonetized('demonetized'),

  /// DR-005. Not Philippine currency. Which currency is not this module's
  /// question (section 17), and the class list is not allowed to answer it.
  foreign('foreign');

  const RecognitionClassOutcome(this.wireValue);

  final String wireValue;

  static RecognitionClassOutcome? fromWire(String value) {
    for (final outcome in values) {
      if (outcome.wireValue == value) return outcome;
    }
    return null;
  }
}

/// One class the model can emit, and what it means.
///
/// The shape follows the outcome, and the parser enforces it:
///
/// | outcome | label | denominationCode |
/// | --- | --- | --- |
/// | `denomination` | required, e.g. "One thousand pesos" | required, e.g. `PHP1000` |
/// | `demonetized` | required, the series, e.g. "New Design Series" | **forbidden** |
/// | `foreign` | **forbidden** | **forbidden** |
///
/// BR-007/008 in the type rather than in a screen: a demonetized class cannot
/// carry a denomination for anything to read out by accident, and a foreign
/// class cannot carry the name of the currency this module is not allowed to
/// identify.
final class RecognitionClass {
  const RecognitionClass({
    required this.classId,
    required this.outcome,
    required this.label,
    required this.denominationCode,
  });

  /// The index the model returns.
  final int classId;
  final RecognitionClassOutcome outcome;

  /// What is shown and spoken. Null for a foreign note.
  final String? label;

  /// The catalogue code. Only a circulating denomination has one.
  final String? denominationCode;
}

/// Why the recognition model could not be used.
enum RecognitionModelProblem {
  /// No model in the synced bundle.
  missing,

  /// The bundle has one, but it does not read as a model.
  corrupt,
}

final class RecognitionModelException implements Exception {
  const RecognitionModelException(this.problem);

  final RecognitionModelProblem problem;

  @override
  String toString() => 'RecognitionModelException(${problem.name})';
}

/// The confidence a reading needs, and how long the module keeps trying.
///
/// Carried with the model rather than read from configuration: DR-4 approves a
/// threshold against one particular set of weights, and applying it to another
/// is how a recogniser starts naming notes it should have refused.
final class RecognitionModelThresholds {
  const RecognitionModelThresholds({
    required this.confidence,
    required this.dwellSeconds,
  });

  final double confidence;
  final int dwellSeconds;
}

/// An approved, versioned recognition model and the classes it emits.
///
/// The device reports [version] so DR-4 can tell which model produced a
/// figure. The weights themselves are [weights]; this object is what says how
/// to read the numbers that come out of them.
final class RecognitionModelDocument {
  const RecognitionModelDocument({
    required this.version,
    required this.thresholds,
    required this.classes,
    required this.weights,
  });

  final String version;

  /// Null for a descriptor published before DR-4 carried them, in which case
  /// the device falls back to configuration.
  final RecognitionModelThresholds? thresholds;

  final List<RecognitionClass> classes;
  final Uint8List weights;

  RecognitionClass? classFor(int classId) {
    for (final candidate in classes) {
      if (candidate.classId == classId) return candidate;
    }
    return null;
  }

  /// Reads a descriptor exactly, refusing anything it does not fully
  /// understand.
  ///
  /// Strict on purpose. A descriptor with an unexpected shape is a model this
  /// build was not written for, and guessing at it is how a device ends up
  /// announcing the wrong note.
  static RecognitionModelDocument parse(
    List<int> descriptorBytes,
    Uint8List weights,
  ) {
    Object? decoded;
    try {
      decoded = jsonDecode(utf8.decode(descriptorBytes));
    } on Object {
      throw const RecognitionModelException(RecognitionModelProblem.corrupt);
    }
    if (decoded is! Map<String, Object?>) {
      throw const RecognitionModelException(RecognitionModelProblem.corrupt);
    }
    if (decoded['schemaVersion'] != 1) {
      throw const RecognitionModelException(RecognitionModelProblem.corrupt);
    }
    final version = decoded['version'];
    if (version is! String || version.isEmpty || version.length > 64) {
      throw const RecognitionModelException(RecognitionModelProblem.corrupt);
    }
    final thresholds = _parseThresholds(decoded['thresholds']);
    final rawClasses = decoded['classes'];
    if (rawClasses is! List || rawClasses.isEmpty) {
      throw const RecognitionModelException(RecognitionModelProblem.corrupt);
    }
    if (weights.isEmpty) {
      throw const RecognitionModelException(RecognitionModelProblem.corrupt);
    }

    final classes = <RecognitionClass>[];
    final seen = <int>{};
    for (final raw in rawClasses) {
      if (raw is! Map<String, Object?>) {
        throw const RecognitionModelException(RecognitionModelProblem.corrupt);
      }
      final classId = raw['classId'];
      final outcome = raw['outcome'];
      final label = raw['label'];
      final denominationCode = raw['denominationCode'];
      if (classId is! int || classId < 0 || !seen.add(classId)) {
        throw const RecognitionModelException(RecognitionModelProblem.corrupt);
      }
      if (outcome is! String) {
        throw const RecognitionModelException(RecognitionModelProblem.corrupt);
      }
      final parsedOutcome = RecognitionClassOutcome.fromWire(outcome);
      if (parsedOutcome == null) {
        throw const RecognitionModelException(RecognitionModelProblem.corrupt);
      }
      // Each outcome carries exactly what it is entitled to carry, and a
      // descriptor that says otherwise is refused rather than trimmed: a
      // demonetized class with a denomination on it is a denomination waiting
      // to be spoken about a note that is no longer legal tender.
      final needsLabel = parsedOutcome != RecognitionClassOutcome.foreign;
      final needsDenomination =
          parsedOutcome == RecognitionClassOutcome.denomination;
      if (needsLabel) {
        if (label is! String || label.isEmpty || label.length > 64) {
          throw const RecognitionModelException(RecognitionModelProblem.corrupt);
        }
      } else if (label != null) {
        throw const RecognitionModelException(RecognitionModelProblem.corrupt);
      }
      if (needsDenomination) {
        if (denominationCode is! String ||
            denominationCode.isEmpty ||
            denominationCode.length > 32) {
          throw const RecognitionModelException(RecognitionModelProblem.corrupt);
        }
      } else if (denominationCode != null) {
        throw const RecognitionModelException(RecognitionModelProblem.corrupt);
      }
      classes.add(
        RecognitionClass(
          classId: classId,
          outcome: parsedOutcome,
          label: label as String?,
          denominationCode: denominationCode as String?,
        ),
      );
    }
    return RecognitionModelDocument(
      version: version,
      thresholds: thresholds,
      classes: classes,
      weights: weights,
    );
  }
}

/// Reads the thresholds a descriptor carries, refusing values outside the
/// approved range rather than obeying them.
///
/// A confidence of zero would make the scanner name notes on a coin flip, and a
/// descriptor is not a place to accept one from.
RecognitionModelThresholds? _parseThresholds(Object? raw) {
  if (raw == null) return null;
  if (raw is! Map<String, Object?>) {
    throw const RecognitionModelException(RecognitionModelProblem.corrupt);
  }
  final confidence = raw['confidence'];
  final dwellSeconds = raw['dwellSeconds'];
  if (confidence is! num ||
      confidence < 0.5 ||
      confidence > 1 ||
      dwellSeconds is! int ||
      dwellSeconds < 1 ||
      dwellSeconds > 60) {
    throw const RecognitionModelException(RecognitionModelProblem.corrupt);
  }
  return RecognitionModelThresholds(
    confidence: confidence.toDouble(),
    dwellSeconds: dwellSeconds,
  );
}

/// Where the recognition model comes from.
///
/// A port because DR-4 owns publishing it. DR-1 only has to load whatever the
/// synced bundle holds and refuse to guess when it holds nothing usable.
abstract interface class RecognitionModelSource {
  Future<RecognitionModelDocument> load();
}

/// The logical ids DR-4's bundle delivery writes.
const kRecognitionDescriptorLogicalId = 'recognition-model.active';
const kRecognitionWeightsLogicalId = 'recognition-model.weights';

/// Reads the model out of the active bundle snapshot (CE-1).
///
/// Both entries are read through [ActiveCurrencyCatalog], so each is checked
/// against the signed manifest's digest before it is used: a tampered or
/// half-written model reads as corrupt, not as a model.
final class BundleRecognitionModelSource implements RecognitionModelSource {
  const BundleRecognitionModelSource(this.catalog);

  final ActiveCurrencyCatalogReader catalog;

  @override
  Future<RecognitionModelDocument> load() async {
    final descriptor = _entry(kRecognitionDescriptorLogicalId);
    final weights = _entry(kRecognitionWeightsLogicalId);
    if (descriptor == null || weights == null) {
      throw const RecognitionModelException(RecognitionModelProblem.missing);
    }
    try {
      return RecognitionModelDocument.parse(
        await catalog.readBytes(descriptor),
        await catalog.readBytes(weights),
      );
    } on RecognitionModelException {
      rethrow;
    } on Object {
      // A digest mismatch, a truncated object, an unreadable file: from here
      // they are the same thing — a model that cannot be trusted to name a
      // banknote.
      throw const RecognitionModelException(RecognitionModelProblem.corrupt);
    }
  }

  BundleManifestEntry? _entry(String logicalId) {
    for (final entry in catalog.entries) {
      if (entry.logicalId == logicalId) return entry;
    }
    return null;
  }
}

/// The source a build with no synced model uses.
final class MissingRecognitionModelSource implements RecognitionModelSource {
  const MissingRecognitionModelSource();

  @override
  Future<RecognitionModelDocument> load() async =>
      throw const RecognitionModelException(RecognitionModelProblem.missing);
}
