import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/data/tactile_patterns.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/tactile_banknote_view.dart';

/// CE-4 haptic simulation of a banknote's tactile features.
///
/// Everything it needs is already on the device: the illustration and the
/// approved region map both come from the synced bundle, and the patterns are
/// compiled into the app, so the screen behaves the same offline as online.
class TactileViewerScreen extends ConsumerStatefulWidget {
  const TactileViewerScreen({
    super.key,
    required this.kind,
    required this.logicalId,
    this.initialCatalog,
    this.hapticsAvailable,
    this.player,
  });

  final CurrencyRouteKind kind;
  final String logicalId;
  final CurrencyCatalogView? initialCatalog;

  /// Overridden in tests; resolved from the platform otherwise.
  final bool? hapticsAvailable;
  final TactilePlayer? player;

  @override
  ConsumerState<TactileViewerScreen> createState() =>
      _TactileViewerScreenState();
}

class _TactileViewerScreenState extends ConsumerState<TactileViewerScreen> {
  late Future<_ResolvedTactile> _resolved;
  late final bool _available =
      widget.hapticsAvailable ?? tactileHapticsAvailable();
  bool _vibrationOn = true;
  bool _recordedUse = false;

  @override
  void initState() {
    super.initState();
    _resolved = _resolve();
  }

  Future<_ResolvedTactile> _resolve() async {
    final CurrencyCatalogView catalog =
        widget.initialCatalog ??
        await ref.read(currencyCatalogViewProvider.future);
    final document = catalog.resolve(widget.kind, widget.logicalId);
    if (document == null || !document.hasTactileMap) {
      return const _ResolvedTactile.unavailable();
    }
    final image = await catalog.readImage(document);
    if (image == null) return const _ResolvedTactile.unavailable();
    _recordUse(document);
    return _ResolvedTactile.ready(document: document, image: image);
  }

  /// One `feature_use` per opened simulation, and only once it can actually be
  /// used. A notice that the note has no map is not a use of the feature.
  void _recordUse(CurrencyContentDocument document) {
    if (_recordedUse) return;
    _recordedUse = true;
    emitAnalyticsFuture(
      FeatureUseIntent(
        usedFeature: AnalyticsFeature.haptic,
        logicalId: document.logicalId,
      ),
      () => ref.read(tactileAnalyticsProvider).recordUse(document.logicalId),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Tactile Features')),
      body: FutureBuilder<_ResolvedTactile>(
        future: _resolved,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: Text('Opening the tactile simulation…'));
          }
          final resolved = snapshot.data;
          if (resolved == null || resolved.document == null) {
            return const _TactileUnavailable();
          }
          return _TactileBody(
            document: resolved.document!,
            image: resolved.image!,
            available: _available,
            vibrationOn: _vibrationOn && _available,
            onVibrationChanged: (value) => setState(() => _vibrationOn = value),
            player: widget.player,
          );
        },
      ),
    );
  }
}

final class _ResolvedTactile {
  const _ResolvedTactile.ready({
    required CurrencyContentDocument this.document,
    required VerifiedCurrencyImage this.image,
  });

  const _ResolvedTactile.unavailable() : document = null, image = null;

  final CurrencyContentDocument? document;
  final VerifiedCurrencyImage? image;
}

class _TactileBody extends StatelessWidget {
  const _TactileBody({
    required this.document,
    required this.image,
    required this.available,
    required this.vibrationOn,
    required this.onVibrationChanged,
    required this.player,
  });

  final CurrencyContentDocument document;
  final VerifiedCurrencyImage image;
  final bool available;
  final bool vibrationOn;
  final ValueChanged<bool> onVibrationChanged;
  final TactilePlayer? player;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text(document.title, style: theme.textTheme.titleLarge),
            ),
            const SizedBox(height: 8),
            // AC2. Stated before anything can be touched, not tucked underneath.
            Card(
              color: theme.colorScheme.secondaryContainer,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  'This is a simulation. The vibration and the illustration are '
                  'educational only and do not reproduce any real banknote. '
                  'Always check a real note in your own hands.',
                  style: theme.textTheme.bodyMedium,
                ),
              ),
            ),
            const SizedBox(height: 16),
            TactileBanknoteView(
              image: image,
              alt: document.imageAlt ?? 'A neutral banknote illustration.',
              regions: document.tactileRegions,
              hapticsEnabled: vibrationOn,
              player: player,
            ),
            const SizedBox(height: 16),
            if (available)
              SwitchListTile(
                value: vibrationOn,
                onChanged: onVibrationChanged,
                title: const Text('Vibration'),
                subtitle: const Text(
                  'Turn this off to use the on-screen description only.',
                ),
              )
            else
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    'This device cannot vibrate, so each feature is described on '
                    'screen instead. Touch a marked area to read what it feels like.',
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TactileUnavailable extends StatelessWidget {
  const _TactileUnavailable();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text(
                'Tactile Simulation Unavailable',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'This item does not have an approved tactile map on this device.',
            ),
          ],
        ),
      ),
    );
  }
}
