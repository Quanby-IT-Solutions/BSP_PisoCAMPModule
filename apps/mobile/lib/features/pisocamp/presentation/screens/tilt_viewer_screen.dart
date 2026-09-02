import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/data/tilt_effects.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/tilt_banknote_view.dart';

/// CE-5 tilt simulation of a banknote's dynamic security feature.
///
/// The illustration and the approved effect both come from the synced bundle,
/// so the simulation works offline. The sensor is only ever one source of the
/// tilt value: when there is no sensor, or the device is set to reduce motion,
/// a slider drives exactly the same effect.
class TiltViewerScreen extends ConsumerStatefulWidget {
  const TiltViewerScreen({
    super.key,
    required this.kind,
    required this.logicalId,
    this.initialCatalog,
    this.sensorAvailable,
    this.sensorSource,
  });

  final CurrencyRouteKind kind;
  final String logicalId;
  final CurrencyCatalogView? initialCatalog;

  /// Overridden in tests; resolved from the platform otherwise.
  final bool? sensorAvailable;
  final TiltSource? sensorSource;

  @override
  ConsumerState<TiltViewerScreen> createState() => _TiltViewerScreenState();
}

class _TiltViewerScreenState extends ConsumerState<TiltViewerScreen> {
  late Future<_ResolvedTilt> _resolved;
  final ManualTiltSource _manual = ManualTiltSource();
  TiltSource? _sensor;
  StreamSubscription<double>? _subscription;
  double _tilt = 0;
  bool _recordedUse = false;
  bool _sensorDriving = false;

  @override
  void initState() {
    super.initState();
    _resolved = _resolve();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _updateSource();
  }

  /// Reduced motion is honoured as a *source* decision, not by freezing the
  /// effect: the slider still drives it, so the feature stays usable.
  void _updateSource() {
    final available =
        (widget.sensorAvailable ?? tiltSensorAvailable()) &&
        !MediaQuery.disableAnimationsOf(context);
    if (available == _sensorDriving) return;
    _sensorDriving = available;
    unawaited(_subscription?.cancel());
    _subscription = null;
    if (!available) {
      setState(() => _tilt = _manual.value);
      return;
    }
    final source = widget.sensorSource ?? SensorTiltSource();
    _sensor = source;
    _subscription = source.tilts.listen((tilt) {
      if (mounted) setState(() => _tilt = tilt);
    });
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    unawaited(_sensor?.dispose());
    unawaited(_manual.dispose());
    super.dispose();
  }

  Future<_ResolvedTilt> _resolve() async {
    final CurrencyCatalogView catalog =
        widget.initialCatalog ??
        await ref.read(currencyCatalogViewProvider.future);
    final document = catalog.resolve(widget.kind, widget.logicalId);
    if (document == null || !document.hasTiltEffect) {
      return const _ResolvedTilt.unavailable();
    }
    final image = await catalog.readImage(document);
    if (image == null) return const _ResolvedTilt.unavailable();
    _recordUse(document);
    return _ResolvedTilt.ready(document: document, image: image);
  }

  void _recordUse(CurrencyContentDocument document) {
    if (_recordedUse) return;
    _recordedUse = true;
    emitAnalyticsFuture(
      FeatureUseIntent(
        usedFeature: AnalyticsFeature.tilt,
        logicalId: document.logicalId,
      ),
      () => ref.read(tiltAnalyticsProvider).recordUse(document.logicalId),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Tilt Simulation')),
      body: FutureBuilder<_ResolvedTilt>(
        future: _resolved,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: Text('Opening the tilt simulation…'));
          }
          final resolved = snapshot.data;
          if (resolved == null || resolved.document == null) {
            return const _TiltUnavailable();
          }
          return _TiltBody(
            document: resolved.document!,
            image: resolved.image!,
            tilt: _tilt,
            sensorDriving: _sensorDriving,
            onSliderChanged: (value) {
              _manual.set(value);
              setState(() => _tilt = _manual.value);
            },
          );
        },
      ),
    );
  }
}

final class _ResolvedTilt {
  const _ResolvedTilt.ready({
    required CurrencyContentDocument this.document,
    required VerifiedCurrencyImage this.image,
  });

  const _ResolvedTilt.unavailable() : document = null, image = null;

  final CurrencyContentDocument? document;
  final VerifiedCurrencyImage? image;
}

class _TiltBody extends StatelessWidget {
  const _TiltBody({
    required this.document,
    required this.image,
    required this.tilt,
    required this.sensorDriving,
    required this.onSliderChanged,
  });

  final CurrencyContentDocument document;
  final VerifiedCurrencyImage image;
  final double tilt;
  final bool sensorDriving;
  final ValueChanged<double> onSliderChanged;

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
            Card(
              color: theme.colorScheme.secondaryContainer,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  'This is an educational simulation. The effect and the '
                  'illustration are neutral teaching aids and do not reproduce '
                  'any real banknote. Always check a real note in your own hands.',
                  style: theme.textTheme.bodyMedium,
                ),
              ),
            ),
            const SizedBox(height: 16),
            TiltBanknoteView(
              image: image,
              alt: document.imageAlt ?? 'A neutral banknote illustration.',
              effect: document.tiltEffect!,
              tilt: tilt,
            ),
            const SizedBox(height: 16),
            Text(
              sensorDriving
                  ? 'Tilt your device from side to side to see the effect move.'
                  : 'Drag the slider from side to side to see the effect move.',
              style: theme.textTheme.bodyMedium,
            ),
            if (!sensorDriving) ...[
              const SizedBox(height: 8),
              Semantics(
                slider: true,
                label: 'Tilt',
                child: Slider(
                  value: tilt,
                  min: -kApprovedTiltRange,
                  max: kApprovedTiltRange,
                  onChanged: onSliderChanged,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _TiltUnavailable extends StatelessWidget {
  const _TiltUnavailable();

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
                'Tilt Simulation Unavailable',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'This item does not have an approved tilt effect on this device.',
            ),
          ],
        ),
      ),
    );
  }
}
