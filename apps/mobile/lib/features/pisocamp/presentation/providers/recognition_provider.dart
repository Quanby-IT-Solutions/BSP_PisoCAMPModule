import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/data/recognition_model.dart';
import 'package:mobile/features/pisocamp/data/recognition_scanner.dart';
import 'package:mobile/features/pisocamp/presentation/providers/bundle_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_provider.dart';

/// Reads the recognition model out of the active bundle, and only when a scan
/// actually starts.
///
/// Opening the snapshot eagerly would mean touching storage for a feature
/// nobody has asked for yet; a bundle that cannot be opened at all is the same
/// thing to this screen as one that carries no model.
final class ActiveBundleRecognitionModelSource implements RecognitionModelSource {
  const ActiveBundleRecognitionModelSource(this._openSnapshot);

  final Future<ActiveCurrencyCatalog> Function() _openSnapshot;

  @override
  Future<RecognitionModelDocument> load() async {
    final ActiveCurrencyCatalog catalog;
    try {
      catalog = await _openSnapshot();
    } on Object {
      throw const RecognitionModelException(RecognitionModelProblem.missing);
    }
    return BundleRecognitionModelSource(catalog).load();
  }
}

final recognitionModelSourceProvider = Provider<RecognitionModelSource>((ref) {
  return ActiveBundleRecognitionModelSource(() async {
    final repository = await ref.read(
      activeCurrencyCatalogRepositoryProvider.future,
    );
    return repository.openSnapshot();
  });
});

/// SA-3's configured threshold, or the contract's default until it is read.
final recognitionConfidenceThresholdProvider = Provider<double>((ref) {
  return ref
          .watch(pisoCampHomeProvider)
          .asData
          ?.value
          .recognitionConfidenceThreshold ??
      kDefaultRecognitionConfidenceThreshold;
});
