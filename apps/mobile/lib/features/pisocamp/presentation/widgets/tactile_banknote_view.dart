import 'package:flutter/material.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/data/tactile_patterns.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';

/// How long a region stays highlighted after it is touched, when the device is
/// not animating. Long enough to read, short enough not to look stuck.
const Duration kTactileHighlightDuration = Duration(milliseconds: 1200);

/// Plain-language description of what each approved pattern feels like, so a
/// device that cannot vibrate still teaches the same thing.
String describeTactilePattern(TactilePattern pattern) {
  final count = pattern.pulses.length;
  final strength = pattern.pulses.first.strength;
  final firmness = switch (strength) {
    TactileStrength.heavy => 'firm',
    TactileStrength.medium => 'steady',
    TactileStrength.light => 'light',
  };
  return count == 1 ? 'One $firmness tap' : '$count $firmness taps';
}

/// CE-4 tactile simulation surface.
///
/// Touching a mapped region highlights it and plays its approved pattern. The
/// highlight is not a decoration: it is the whole feature on a device that
/// cannot vibrate, so it plays whether or not the haptics do.
class TactileBanknoteView extends StatefulWidget {
  const TactileBanknoteView({
    super.key,
    required this.image,
    required this.alt,
    required this.regions,
    required this.hapticsEnabled,
    this.player,
    this.patterns = kApprovedTactilePatterns,
  });

  final VerifiedCurrencyImage image;
  final String alt;
  final List<CurrencyTactileRegion> regions;

  /// Whether this device will vibrate. False also covers "the user turned it
  /// off", and the visual alternative plays either way.
  final bool hapticsEnabled;

  final TactilePlayer? player;
  final Map<String, TactilePattern> patterns;

  @override
  State<TactileBanknoteView> createState() => _TactileBanknoteViewState();
}

class _TactileBanknoteViewState extends State<TactileBanknoteView> {
  late final TactilePlayer _player = widget.player ?? TactilePlayer();
  String? _activeRegionId;
  String? _announcement;

  Future<void> _touch(CurrencyTactileRegion region) async {
    final pattern = widget.patterns[region.pattern];
    setState(() {
      _activeRegionId = region.id;
      _announcement = pattern == null
          ? region.label
          : '${region.label}: ${describeTactilePattern(pattern)}';
    });

    if (pattern != null && widget.hapticsEnabled) {
      // A dropped request is the point of the limit, not a failure: holding a
      // finger down must not stack patterns into continuous vibration.
      await _player.play(pattern);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 600),
            child: AspectRatio(
              aspectRatio: widget.image.width / widget.image.height,
              child: Semantics(
                container: true,
                image: true,
                label: widget.alt,
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    return Stack(
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
                        for (final region in widget.regions)
                          _TactileRegionTarget(
                            region: region,
                            size: constraints.biggest,
                            active: region.id == _activeRegionId,
                            onTouch: () => _touch(region),
                          ),
                      ],
                    );
                  },
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Semantics(
          liveRegion: true,
          child: Text(
            _announcement ?? 'Touch a marked area to feel how it is described.',
            style: theme.textTheme.bodyMedium,
          ),
        ),
      ],
    );
  }
}

class _TactileRegionTarget extends StatelessWidget {
  const _TactileRegionTarget({
    required this.region,
    required this.size,
    required this.active,
    required this.onTouch,
  });

  final CurrencyTactileRegion region;
  final Size size;
  final bool active;
  final VoidCallback onTouch;

  @override
  Widget build(BuildContext context) {
    final colours = Theme.of(context).colorScheme;
    final bounds = region.fraction;
    return Positioned(
      left: bounds.left * size.width,
      top: bounds.top * size.height,
      width: bounds.width * size.width,
      height: bounds.height * size.height,
      child: Semantics(
        container: true,
        button: true,
        selected: active,
        label: 'Tactile feature: ${region.label}',
        child: ExcludeSemantics(
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: onTouch,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: active
                    ? colours.primary.withValues(alpha: 0.28)
                    : colours.primary.withValues(alpha: 0.08),
                border: Border.all(
                  color: active ? colours.primary : colours.outline,
                  width: active ? 3 : 1,
                ),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Align(
                alignment: Alignment.bottomLeft,
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Text(
                    region.label,
                    style: Theme.of(context).textTheme.labelSmall,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
