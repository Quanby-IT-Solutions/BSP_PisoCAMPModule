import 'package:flutter/material.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/data/tilt_effects.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';

/// CE-5 dynamic-feature simulation.
///
/// The effect is drawn over one approved region of the illustration and driven
/// by a single value in −1..1, whether that value came from the device's
/// accelerometer or from the on-screen slider. Nothing downstream of the value
/// knows which, so the fallback is the same simulation rather than a lesser one.
class TiltBanknoteView extends StatelessWidget {
  const TiltBanknoteView({
    super.key,
    required this.image,
    required this.alt,
    required this.effect,
    required this.tilt,
    this.effects = kApprovedTiltEffects,
  });

  final VerifiedCurrencyImage image;
  final String alt;
  final CurrencyTiltEffect effect;

  /// The current tilt, −1 (left) to 1 (right).
  final double tilt;

  final Map<String, TiltEffect> effects;

  @override
  Widget build(BuildContext context) {
    final approved = effects[effect.effect];
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 600),
        child: AspectRatio(
          aspectRatio: image.width / image.height,
          child: Semantics(
            container: true,
            image: true,
            label: alt,
            // The builder wraps the stack rather than sitting inside it: a
            // Positioned must be a direct child of its Stack.
            child: LayoutBuilder(
              builder: (context, constraints) => Stack(
                fit: StackFit.expand,
                children: [
                  ExcludeSemantics(
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
                  if (approved != null)
                    Positioned(
                      left: effect.fraction.left * constraints.maxWidth,
                      top: effect.fraction.top * constraints.maxHeight,
                      width: effect.fraction.width * constraints.maxWidth,
                      height: effect.fraction.height * constraints.maxHeight,
                      child: Semantics(
                        container: true,
                        label:
                            '${effect.label}, an educational simulation that '
                            'responds as the device is tilted',
                        child: ExcludeSemantics(
                          child: CustomPaint(
                            painter: TiltEffectPainter(
                              kind: approved.kind,
                              tilt: tilt,
                              accent: Theme.of(context).colorScheme.primary,
                            ),
                            child: const SizedBox.expand(),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Draws an approved effect at a given tilt.
@visibleForTesting
class TiltEffectPainter extends CustomPainter {
  const TiltEffectPainter({
    required this.kind,
    required this.tilt,
    required this.accent,
  });

  final TiltEffectKind kind;
  final double tilt;
  final Color accent;

  /// Where the band sits, 0 (hard left) to 1 (hard right).
  static double bandPosition(double tilt) => (tilt + 1) / 2;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final rect = Offset.zero & size;
    switch (kind) {
      case TiltEffectKind.movingBand:
        final centre = bandPosition(tilt) * size.width;
        final bandWidth = size.width * 0.32;
        canvas.drawRect(rect, Paint()..color = accent.withValues(alpha: 0.16));
        canvas.drawRect(
          Rect.fromLTWH(centre - bandWidth / 2, 0, bandWidth, size.height),
          Paint()
            ..shader =
                LinearGradient(
                  colors: [
                    accent.withValues(alpha: 0),
                    accent.withValues(alpha: 0.85),
                    accent.withValues(alpha: 0),
                  ],
                ).createShader(
                  Rect.fromLTWH(
                    centre - bandWidth / 2,
                    0,
                    bandWidth,
                    size.height,
                  ),
                ),
        );
      case TiltEffectKind.colourShift:
        // A hue that travels with the tilt rather than a band that moves.
        final shifted = HSLColor.fromColor(accent)
            .withHue((HSLColor.fromColor(accent).hue + tilt * 60 + 360) % 360)
            .toColor();
        canvas.drawRect(rect, Paint()..color = shifted.withValues(alpha: 0.55));
    }
  }

  @override
  bool shouldRepaint(TiltEffectPainter oldDelegate) =>
      oldDelegate.kind != kind ||
      oldDelegate.tilt != tilt ||
      oldDelegate.accent != accent;
}
