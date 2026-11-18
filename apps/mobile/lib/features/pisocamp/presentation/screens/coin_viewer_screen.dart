import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/theme/app_styles.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/coin_model.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/utils/reduced_motion.dart';
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
    with TickerProviderStateMixin {
  static const _presetDuration = Duration(milliseconds: 350);

  /// One unhurried revolution. Long enough to read the second face on the way
  /// past, short enough that someone demonstrating the screen is not waiting
  /// on it before they can say anything.
  static const _revealDuration = Duration(milliseconds: 5200);

  /// How far the coin leans out of the turning plane at the quarter points.
  /// A revolution about the vertical axis alone passes exactly edge-on, and a
  /// coin that briefly disappears reads as a glitch rather than as proof the
  /// object has two sides.
  static const _revealLean = 0.20;

  late Future<_ResolvedCoin> _resolved;
  late final AnimationController _presetController;
  late final AnimationController _revealController;
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
    _revealController =
        AnimationController(vsync: this, duration: _revealDuration)
          ..addListener(_applyRevealFrame)
          ..addStatusListener(_onRevealStatus);
    _resolved = _resolve();
    // Only once the coin is actually on screen, and only if it is: a
    // revolution of the fallback notice would be an odd thing to watch.
    _resolved.then(_revealWhenReady);
  }

  @override
  void dispose() {
    _presetController.dispose();
    _revealController.dispose();
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

  void _revealWhenReady(_ResolvedCoin resolved) {
    if (!mounted || resolved.model == null) return;
    // F6 again: the reveal is a courtesy, and the coin is fully usable by
    // drag without it. Reduced motion gets the obverse, standing still.
    if (prefersReducedMotion(context)) return;
    _startReveal();
  }

  void _startReveal() {
    _presetController.stop();
    _revealController.forward(from: 0);
  }

  void _applyRevealFrame() {
    final progress = Curves.easeInOutSine.transform(_revealController.value);
    final yaw = progress * math.pi * 2;
    setState(() {
      _orientation = CoinOrientation(
        yaw: yaw,
        pitch: math.sin(yaw) * _revealLean,
        zoom: _orientation.zoom,
      );
    });
  }

  void _onRevealStatus(AnimationStatus status) {
    if (status != AnimationStatus.completed) return;
    // Land on the preset itself rather than on a yaw of 2π. The two face the
    // same way, but the view the screen opens on and the view Reset returns
    // to have to be the same value, not merely the same direction.
    setState(() => _orientation = CoinOrientation.initial);
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
    _revealController.stop();
    // F6's reduced-motion contract: an animated camera move is a courtesy, the
    // orientation change is the point, so it lands immediately instead.
    if (prefersReducedMotion(context)) {
      _presetController.stop();
      setState(() => _orientation = target);
      return;
    }
    _presetFrom = _orientation;
    _presetTo = target;
    _presetController.forward(from: 0);
  }

  void _zoom(double factor) {
    _revealController.stop();
    _presetController.stop();
    setState(() => _orientation = _orientation.zoomedBy(factor));
  }

  void _setOrientation(CoinOrientation orientation) {
    // A hand on the coin outranks the reveal: it stops where it was left.
    _revealController.stop();
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
            onSpin: _startReveal,
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
    required this.onSpin,
  });

  final CoinModel model;
  final CurrencyContentDocument document;
  final CoinOrientation orientation;
  final ValueChanged<CoinOrientation> onOrientationChanged;
  final ValueChanged<CoinOrientation> onMoveTo;
  final ValueChanged<double> onZoom;
  final VoidCallback onSpin;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      // Scrollable, and the stage takes a share of the viewport rather than
      // whatever is left: at 200% text a fixed column overflows, and an
      // overflowing control is an unreachable one.
      child: LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.pageGutter,
                  AppSpacing.s12,
                  AppSpacing.pageGutter,
                  0,
                ),
                child: Semantics(
                  header: true,
                  child: Text(
                    document.title,
                    style: theme.textTheme.titleLarge,
                  ),
                ),
              ),
              SizedBox(
                // The coin is what this screen is for, so it takes the
                // larger share of the viewport rather than sitting in a
                // band above a page of empty surface.
                height: math.max(280, constraints.maxHeight * 0.52),
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.cardGutter),
                  child: _CoinStageBackdrop(
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
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.pageGutter,
                  0,
                  AppSpacing.pageGutter,
                  AppSpacing.s8,
                ),
                child: Text(
                  'Drag to rotate. Pinch, or use the zoom buttons, to look closer.',
                  style: theme.textTheme.bodySmall,
                ),
              ),
              _ViewerControls(
                orientation: orientation,
                onMoveTo: onMoveTo,
                onZoom: onZoom,
                onSpin: onSpin,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ViewerControls extends StatelessWidget {
  const _ViewerControls({
    required this.orientation,
    required this.onMoveTo,
    required this.onZoom,
    required this.onSpin,
  });

  final CoinOrientation orientation;
  final ValueChanged<CoinOrientation> onMoveTo;
  final ValueChanged<double> onZoom;
  final VoidCallback onSpin;

  @override
  Widget build(BuildContext context) {
    final zoomPercent = (orientation.zoom * 100).round();
    // Movement is the whole of what this control does, so on a device asking
    // for less of it the honest answer is not to offer the control at all.
    final canSpin = !prefersReducedMotion(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.pageGutter,
        0,
        AppSpacing.pageGutter,
        AppSpacing.s16,
      ),
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
              if (canSpin)
                _ControlButton(label: 'Turn all round', onPressed: onSpin),
            ],
          ),
          const SizedBox(height: 8),
          // A Wrap, not a Row: at 320 px with the text scaled up, a fixed row
          // of three buttons and a readout overflows, and an overflowing
          // control is an unreachable one.
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _ControlButton(
                label: 'Zoom out',
                onPressed: orientation.canZoomOut
                    ? () => onZoom(1 / CoinOrientation.zoomStep)
                    : null,
              ),
              _ControlButton(
                label: 'Zoom in',
                onPressed: orientation.canZoomIn
                    ? () => onZoom(CoinOrientation.zoomStep)
                    : null,
              ),
              _ControlButton(
                label: 'Reset',
                onPressed: () => onMoveTo(CoinOrientation.initial),
              ),
              Semantics(liveRegion: true, child: Text('Zoom $zoomPercent%')),
            ],
          ),
        ],
      ),
    );
  }
}

/// The lit stage the coin stands on.
///
/// Gold on the seal's navy is the brand's own pairing and the highest-contrast
/// ground this palette offers, which is what showing a metal object needs: on
/// the app's grey surface the coin loses its rim highlight and its contact
/// shadow together, and a lit sphere on a light ground reads as a sticker. The
/// pool of light sits where the painter's key light is, so the backdrop and
/// the object agree about where the lamp is.
class _CoinStageBackdrop extends StatelessWidget {
  const _CoinStageBackdrop({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: AppRadii.heroRadius,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: <Color>[Color(0xFF27446F), Color(0xFF101E36)],
          ),
        ),
        child: DecoratedBox(
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(-0.32, -0.46),
              radius: 1.05,
              colors: <Color>[Color(0x2EFFFFFF), Color(0x00FFFFFF)],
            ),
          ),
          child: child,
        ),
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
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.pageGutter,
          AppSpacing.s12,
          AppSpacing.pageGutter,
          AppSpacing.s32,
        ),
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
