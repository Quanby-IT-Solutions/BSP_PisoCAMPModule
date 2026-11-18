import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:mobile/core/theme/app_styles.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';

/// The furthest the viewer will ever magnify, however large the source image.
/// A closer look than this is inspection of pixels, not of a design element.
const double kApprovedMaximumZoom = 4;

/// Diameter of a hotspot marker at rest. Also its tap target, which is why it
/// is not smaller.
const double _markerDiameter = 44;

/// CE-3 zoom-and-pan viewer for a banknote or coin image.
///
/// The magnification limit is whichever comes first: the approved maximum, or
/// the point at which the source runs out of pixels. Beyond that second bound a
/// viewer would be enlarging interpolation rather than showing more of the
/// design, which is precisely what "without pixelation" rules out.
///
/// Only first-level security features are marked. Second-level features never
/// reach the device — the bundle excludes them — so there is nothing here that
/// filters them; if one arrived, the document reader would have refused it.
class ZoomableCurrencyImage extends StatefulWidget {
  const ZoomableCurrencyImage({
    super.key,
    required this.image,
    required this.alt,
    this.features = const [],
  });

  final VerifiedCurrencyImage image;
  final String alt;

  /// Security features for this denomination. Those with an approved hotspot
  /// are marked on the image; the rest are left to the list below it.
  final List<CurrencyContentDocument> features;

  /// The magnification at which one source pixel covers one device pixel.
  ///
  /// [fittedScale] is how much the image is already scaled to fit the view, and
  /// [devicePixelRatio] how many device pixels a logical one covers.
  static double pixelLimit({
    required double fittedScale,
    required double devicePixelRatio,
  }) {
    final denominator = fittedScale * devicePixelRatio;
    if (denominator <= 0 || !denominator.isFinite) return kApprovedMaximumZoom;
    return 1 / denominator;
  }

  /// The largest magnification this view will allow, never below 1.
  static double maximumScaleFor({
    required double fittedScale,
    required double devicePixelRatio,
  }) {
    final limit = math.min(
      kApprovedMaximumZoom,
      pixelLimit(fittedScale: fittedScale, devicePixelRatio: devicePixelRatio),
    );
    return limit < 1 ? 1 : limit;
  }

  @override
  State<ZoomableCurrencyImage> createState() => _ZoomableCurrencyImageState();
}

class _ZoomableCurrencyImageState extends State<ZoomableCurrencyImage> {
  final TransformationController _transformation = TransformationController();
  String? _selectedLogicalId;

  @override
  void dispose() {
    _transformation.dispose();
    super.dispose();
  }

  List<CurrencyContentDocument> get _marked => widget.features
      .where((feature) => feature.hotspot != null)
      .toList(growable: false);

  CurrencyContentDocument? get _selected {
    final id = _selectedLogicalId;
    if (id == null) return null;
    for (final feature in _marked) {
      if (feature.logicalId == id) return feature;
    }
    return null;
  }

  void _select(CurrencyContentDocument feature) {
    setState(() {
      _selectedLogicalId = _selectedLogicalId == feature.logicalId
          ? null
          : feature.logicalId;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final devicePixelRatio = MediaQuery.devicePixelRatioOf(context);
    final aspectRatio = widget.image.width / widget.image.height;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 600),
            child: AspectRatio(
              aspectRatio: aspectRatio,
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final fittedScale = constraints.maxWidth / widget.image.width;
                  final maximumScale = ZoomableCurrencyImage.maximumScaleFor(
                    fittedScale: fittedScale,
                    devicePixelRatio: devicePixelRatio,
                  );
                  return Semantics(
                    container: true,
                    // Still announced as an image: CE-1's contract with a screen
                    // reader does not change because the region can now be
                    // magnified. The markers inside are separate button nodes.
                    image: true,
                    label: widget.alt,
                    child: InteractiveViewer(
                      transformationController: _transformation,
                      minScale: 1,
                      maxScale: maximumScale,
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          ExcludeSemantics(
                            child: Image.memory(
                              widget.image.bytes,
                              fit: BoxFit.contain,
                              gaplessPlayback: true,
                              cacheWidth: widget.image.cacheWidth,
                              cacheHeight: widget.image.cacheHeight,
                              errorBuilder: (context, error, stackTrace) =>
                                  const SizedBox.shrink(),
                            ),
                          ),
                          for (final feature in _marked)
                            _HotspotMarker(
                              feature: feature,
                              selected: feature.logicalId == _selectedLogicalId,
                              onPressed: () => _select(feature),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ),
        if (_marked.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(
            'Pinch to zoom and drag to move. Tap a marked feature to read it.',
            style: theme.textTheme.bodySmall,
          ),
        ],
        if (_selected case final selected?) ...[
          const SizedBox(height: 8),
          _HotspotCaption(
            feature: selected,
            onDismiss: () => setState(() => _selectedLogicalId = null),
          ),
        ],
      ],
    );
  }
}

class _HotspotMarker extends StatelessWidget {
  const _HotspotMarker({
    required this.feature,
    required this.selected,
    required this.onPressed,
  });

  final CurrencyContentDocument feature;
  final bool selected;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final hotspot = feature.hotspot!;
    final colours = Theme.of(context).colorScheme;
    return Align(
      // Alignment runs -1..1 across the box, so a permille anchor maps onto it
      // directly and stays put at any rendered size or zoom.
      alignment: Alignment(
        hotspot.fractionX * 2 - 1,
        hotspot.fractionY * 2 - 1,
      ),
      child: Semantics(
        container: true,
        button: true,
        selected: selected,
        label: 'Security feature: ${feature.title}',
        child: ExcludeSemantics(
          child: Tooltip(
            message: feature.title,
            child: InkResponse(
              onTap: onPressed,
              radius: _markerDiameter / 2,
              child: Container(
                width: _markerDiameter,
                height: _markerDiameter,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: selected
                      ? colours.primary
                      : colours.surface.withValues(alpha: 0.85),
                  border: Border.all(color: colours.primary, width: 2),
                ),
                child: Icon(
                  Icons.search,
                  size: 20,
                  color: selected ? colours.onPrimary : colours.primary,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _HotspotCaption extends StatelessWidget {
  const _HotspotCaption({required this.feature, required this.onDismiss});

  final CurrencyContentDocument feature;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              liveRegion: true,
              child: Text(feature.title, style: theme.textTheme.titleMedium),
            ),
            const SizedBox(height: 8),
            Text(feature.summary),
            const SizedBox(height: 8),
            Text(feature.body),
            const SizedBox(height: 8),
            ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 48),
              child: TextButton(
                onPressed: onDismiss,
                child: const Text('Close'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
