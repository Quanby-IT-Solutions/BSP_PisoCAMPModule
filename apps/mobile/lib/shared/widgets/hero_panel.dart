import 'package:flutter/material.dart';
import 'package:mobile/core/theme/app_styles.dart';
import 'package:mobile/core/theme/flex_theme_config.dart';

/// The dark brand panel that anchors a screen.
///
/// One saturated plane against an otherwise near-white page. It carries an
/// off-canvas radial glow in the corner, which is what stops a large flat
/// rectangle from reading as a dead block — the light source implies depth
/// without a shadow.
///
/// The panel is BSP navy in both light and dark mode on purpose. It is the
/// brand surface, not a themed one, so it stays put while the page around it
/// inverts. Its own contents therefore always use white ink, which is safe at
/// 11.9:1 on this navy.
class HeroPanel extends StatelessWidget {
  const HeroPanel({
    super.key,
    required this.label,
    required this.headline,
    this.footnote,
    this.trailing,
    this.margin,
  });

  /// Small tracked, uppercased eyebrow.
  final String label;

  /// The panel's main line.
  final String headline;

  /// Optional line along the bottom edge.
  final String? footnote;

  /// Optional mark at the bottom-right, opposite [footnote].
  final Widget? trailing;

  final EdgeInsetsGeometry? margin;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Container(
      margin:
          margin ??
          const EdgeInsets.symmetric(horizontal: AppSpacing.pageGutter),
      decoration: BoxDecoration(
        color: FlexThemeConfig.bspNavy,
        borderRadius: AppRadii.heroRadius,
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: <Widget>[
          // Gold rather than the reference's violet: the glow is the one place
          // the seal's second colour can sit at full saturation without
          // becoming text, so it carries brand without a contrast cost.
          Positioned(
            right: -60,
            top: -60,
            child: Container(
              width: 220,
              height: 220,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: <Color>[
                    FlexThemeConfig.bspGold.withValues(alpha: 0.45),
                    FlexThemeConfig.bspGold.withValues(alpha: 0.0),
                  ],
                  stops: const <double>[0.0, 0.6],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.s20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  label.toUpperCase(),
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: Colors.white.withValues(alpha: 0.65),
                    letterSpacing: 1.8,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: AppSpacing.s12),
                Text(
                  headline,
                  style: theme.textTheme.titleLarge?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.2,
                  ),
                ),
                if (footnote != null || trailing != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.s16),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          footnote ?? '',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: Colors.white.withValues(alpha: 0.8),
                            letterSpacing: 0.4,
                          ),
                        ),
                      ),
                      if (trailing != null) trailing!,
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A row of primary destinations rendered as raised tiles with the label
/// outside the tile.
///
/// Keeping the label below the tile rather than inside it is what lets the tile
/// stay small and uniform while the label wraps freely — which is also what
/// keeps the row intact at large text scales instead of clipping.
class ActionTileRow extends StatelessWidget {
  const ActionTileRow({super.key, required this.actions});

  final List<ActionTileData> actions;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s20),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: actions
            .map((ActionTileData a) => Expanded(child: _ActionTile(data: a)))
            .toList(),
      ),
    );
  }
}

class ActionTileData {
  const ActionTileData({
    required this.icon,
    required this.label,
    this.onTap,
    this.enabled = true,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool enabled;
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.data});

  final ActionTileData data;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme colors = theme.colorScheme;
    final bool on = data.enabled && data.onTap != null;

    return Semantics(
      button: true,
      enabled: on,
      label: data.label,
      child: InkWell(
        onTap: on ? data.onTap : null,
        borderRadius: AppRadii.tileRadius,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            vertical: AppSpacing.s8,
            horizontal: AppSpacing.s4,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: AppSurfaces.raised(colors),
                  borderRadius: AppRadii.tileRadius,
                  boxShadow: AppShadows.tile(colors),
                ),
                alignment: Alignment.center,
                child: Icon(
                  data.icon,
                  size: 22,
                  color: on
                      ? colors.primary
                      : colors.onSurfaceVariant.withValues(alpha: 0.5),
                ),
              ),
              const SizedBox(height: AppSpacing.s6),
              Text(
                data.label,
                textAlign: TextAlign.center,
                style: theme.textTheme.labelMedium?.copyWith(
                  fontWeight: FontWeight.w500,
                  color: on ? colors.onSurface : colors.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
