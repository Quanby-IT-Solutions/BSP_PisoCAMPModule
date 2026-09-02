import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/coin_model.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/coin_viewer.dart';

/// CE-2 interactive coin viewer.
///
/// Everything it needs is already on the device: the model is a core entry of
/// the synced bundle, verified against the manifest before it is parsed, so the
/// screen behaves the same offline as online. When a coin has no usable model
/// the screen says so plainly and falls back to the catalog's still image
/// rather than showing an empty stage.
class CoinViewerScreen extends ConsumerStatefulWidget {
  const CoinViewerScreen({
    super.key,
    required this.kind,
    required this.logicalId,
    this.initialCatalog,
  });

  final CurrencyRouteKind kind;
  final String logicalId;
  final CurrencyCatalogView? initialCatalog;

  @override
  ConsumerState<CoinViewerScreen> createState() => _CoinViewerScreenState();
}

class _CoinViewerScreenState extends ConsumerState<CoinViewerScreen>
    with SingleTickerProviderStateMixin {
  static const _presetDuration = Duration(milliseconds: 350);

  late Future<_ResolvedCoin> _resolved;
  late final AnimationController _presetController;
  CoinOrientation _orientation = CoinOrientation.initial;
  CoinOrientation _presetFrom = CoinOrientation.initial;
  CoinOrientation _presetTo = CoinOrientation.initial;
  bool _recordedUse = false;

  @override
  void initState() {
    super.initState();
    _presetController = AnimationController(
      vsync: this,
      duration: _presetDuration,
    )..addListener(_applyPresetFrame);
    _resolved = _resolve();
  }

  @override
  void dispose() {
    _presetController.dispose();
    super.dispose();
  }

  Future<_ResolvedCoin> _resolve() async {
    final CurrencyCatalogView catalog =
        widget.initialCatalog ??
        await ref.read(currencyCatalogViewProvider.future);
    final document = catalog.resolve(widget.kind, widget.logicalId);
    if (document == null) {
      return const _ResolvedCoin.failed(CoinModelFailure.unavailable);
    }
    try {
      final model = await catalog.readModel(document);
      _recordUse(document);
      return _ResolvedCoin.ready(
        document: document,
        model: model,
        catalog: catalog,
      );
    } on CoinModelException catch (error) {
      return _ResolvedCoin.failed(
        error.failure,
        document: document,
        catalog: catalog,
      );
    }
  }

  /// One `feature_use` per opened viewer, and only once the coin can actually
  /// be turned: a fallback notice is not a use of the 3D feature.
  void _recordUse(CurrencyContentDocument document) {
    if (_recordedUse) return;
    _recordedUse = true;
    emitAnalyticsFuture(
      FeatureUseIntent(
        usedFeature: AnalyticsFeature.coin3d,
        logicalId: document.logicalId,
      ),
      () => ref.read(coinViewerAnalyticsProvider).recordUse(document.logicalId),
    );
  }

  void _applyPresetFrame() {
    setState(() {
      _orientation = _presetFrom.lerpTo(
        _presetTo,
        Curves.easeInOutCubic.transform(_presetController.value),
      );
    });
  }

  void _moveTo(CoinOrientation target) {
    // F6's reduced-motion contract: an animated camera move is a courtesy, the
    // orientation change is the point, so it lands immediately instead.
    if (MediaQuery.disableAnimationsOf(context)) {
      _presetController.stop();
      setState(() => _orientation = target);
      return;
    }
    _presetFrom = _orientation;
    _presetTo = target;
    _presetController.forward(from: 0);
  }

  void _zoom(double factor) {
    _presetController.stop();
    setState(() => _orientation = _orientation.zoomedBy(factor));
  }

  void _setOrientation(CoinOrientation orientation) {
    _presetController.stop();
    setState(() => _orientation = orientation);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('3D View')),
      body: FutureBuilder<_ResolvedCoin>(
        future: _resolved,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: Text('Opening the 3D view…'));
          }
          final resolved = snapshot.data;
          if (resolved == null || resolved.model == null) {
            return _CoinUnavailable(
              failure: resolved?.failure ?? CoinModelFailure.unavailable,
              document: resolved?.document,
              catalog: resolved?.catalog,
            );
          }
          return _CoinStage(
            model: resolved.model!,
            document: resolved.document!,
            orientation: _orientation,
            onOrientationChanged: _setOrientation,
            onMoveTo: _moveTo,
            onZoom: _zoom,
          );
        },
      ),
    );
  }
}

final class _ResolvedCoin {
  const _ResolvedCoin.ready({
    required CurrencyContentDocument this.document,
    required CoinModel this.model,
    required CurrencyCatalogView this.catalog,
  }) : failure = null;

  const _ResolvedCoin.failed(
    CoinModelFailure this.failure, {
    this.document,
    this.catalog,
  }) : model = null;

  final CurrencyContentDocument? document;
  final CoinModel? model;
  final CurrencyCatalogView? catalog;
  final CoinModelFailure? failure;
}

class _CoinStage extends StatelessWidget {
  const _CoinStage({
    required this.model,
    required this.document,
    required this.orientation,
    required this.onOrientationChanged,
    required this.onMoveTo,
    required this.onZoom,
  });

  final CoinModel model;
  final CurrencyContentDocument document;
  final CoinOrientation orientation;
  final ValueChanged<CoinOrientation> onOrientationChanged;
  final ValueChanged<CoinOrientation> onMoveTo;
  final ValueChanged<double> onZoom;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Semantics(
              header: true,
              child: Text(document.title, style: theme.textTheme.titleLarge),
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: CoinModelView(
                  model: model,
                  orientation: orientation,
                  onOrientationChanged: onOrientationChanged,
                  semanticLabel:
                      document.modelAlt ??
                      'A neutral coin model, not a reproduction.',
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text(
              'Drag to rotate. Pinch, or use the zoom buttons, to look closer.',
              style: theme.textTheme.bodySmall,
            ),
          ),
          _ViewerControls(
            orientation: orientation,
            onMoveTo: onMoveTo,
            onZoom: onZoom,
          ),
        ],
      ),
    );
  }
}

class _ViewerControls extends StatelessWidget {
  const _ViewerControls({
    required this.orientation,
    required this.onMoveTo,
    required this.onZoom,
  });

  final CoinOrientation orientation;
  final ValueChanged<CoinOrientation> onMoveTo;
  final ValueChanged<double> onZoom;

  @override
  Widget build(BuildContext context) {
    final zoomPercent = (orientation.zoom * 100).round();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _ControlButton(
                label: 'Obverse',
                onPressed: () => onMoveTo(CoinOrientation.obverse),
              ),
              _ControlButton(
                label: 'Reverse',
                onPressed: () => onMoveTo(CoinOrientation.reverse),
              ),
              _ControlButton(
                label: 'Edge',
                onPressed: () => onMoveTo(CoinOrientation.edge),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _ControlButton(
                label: 'Zoom out',
                onPressed: orientation.canZoomOut
                    ? () => onZoom(1 / CoinOrientation.zoomStep)
                    : null,
              ),
              const SizedBox(width: 8),
              _ControlButton(
                label: 'Zoom in',
                onPressed: orientation.canZoomIn
                    ? () => onZoom(CoinOrientation.zoomStep)
                    : null,
              ),
              const SizedBox(width: 8),
              _ControlButton(
                label: 'Reset',
                onPressed: () => onMoveTo(CoinOrientation.initial),
              ),
              const Spacer(),
              Semantics(liveRegion: true, child: Text('Zoom $zoomPercent%')),
            ],
          ),
        ],
      ),
    );
  }
}

class _ControlButton extends StatelessWidget {
  const _ControlButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 48),
      child: OutlinedButton(onPressed: onPressed, child: Text(label)),
    );
  }
}

/// AC5's fallback: a plain notice naming what went wrong, plus the catalog's
/// still image so the screen still teaches something.
class _CoinUnavailable extends StatelessWidget {
  const _CoinUnavailable({
    required this.failure,
    required this.document,
    required this.catalog,
  });

  final CoinModelFailure failure;
  final CurrencyContentDocument? document;
  final CurrencyCatalogView? catalog;

  String get _explanation => switch (failure) {
    CoinModelFailure.unavailable =>
      'This item does not have a 3D model. The saved illustration is shown instead.',
    CoinModelFailure.missingResource =>
      'The 3D model has not been downloaded to this device yet. The saved illustration is shown instead.',
    CoinModelFailure.unreadable =>
      'This device could not open the 3D model. The saved illustration is shown instead.',
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final entry = document;
    final view = catalog;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text(
                '3D View Unavailable',
                style: theme.textTheme.titleLarge,
              ),
            ),
            const SizedBox(height: 8),
            Text(_explanation),
            if (entry != null && view != null) ...[
              const SizedBox(height: 16),
              _FallbackImage(document: entry, catalog: view),
            ],
          ],
        ),
      ),
    );
  }
}

class _FallbackImage extends StatelessWidget {
  const _FallbackImage({required this.document, required this.catalog});

  final CurrencyContentDocument document;
  final CurrencyCatalogView catalog;

  @override
  Widget build(BuildContext context) {
    final alt = document.imageAlt;
    if (document.imageSha256 == null || alt == null) {
      return const SizedBox.shrink();
    }
    return FutureBuilder<VerifiedCurrencyImage?>(
      future: catalog.readImage(document),
      builder: (context, snapshot) {
        final image = snapshot.data;
        if (image == null) return const SizedBox.shrink();
        return Semantics(
          container: true,
          image: true,
          label: alt,
          child: ExcludeSemantics(
            child: Image.memory(
              image.bytes,
              fit: BoxFit.contain,
              gaplessPlayback: true,
              cacheWidth: image.cacheWidth,
              cacheHeight: image.cacheHeight,
              errorBuilder: (context, error, stackTrace) =>
                  const SizedBox.shrink(),
            ),
          ),
        );
      },
    );
  }
}
