import 'package:flutter/material.dart';

/// The Bangko Sentral ng Pilipinas seal.
///
/// The asset ships at three resolutions (`assets/images/bsp-logo.png` plus
/// `2.0x` and `3.0x` variants) and Flutter picks one from the device pixel
/// ratio. Those variants are sized for the largest placement — the 180px
/// onboarding mark — so a 32px app-bar usage would otherwise decode a 540px
/// bitmap to draw 96 physical pixels. [cacheWidth]/[cacheHeight] pin the
/// decode to the size actually drawn.
class BspLogo extends StatelessWidget {
  const BspLogo({super.key, required this.size, this.semanticLabel});

  /// Logical edge length. The seal is square.
  final double size;

  /// Screen-reader label. Leave null where nearby text already names the
  /// thing — the seal beside a "Piso CAMP" heading is decoration, and
  /// announcing it twice is noise rather than access.
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final devicePixels = (size * MediaQuery.of(context).devicePixelRatio).round();
    final image = Image.asset(
      'assets/images/bsp-logo.png',
      width: size,
      height: size,
      cacheWidth: devicePixels,
      cacheHeight: devicePixels,
      filterQuality: FilterQuality.medium,
      semanticLabel: semanticLabel,
    );

    if (semanticLabel != null) return image;
    return ExcludeSemantics(child: image);
  }
}
