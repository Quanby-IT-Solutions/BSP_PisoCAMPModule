import 'package:flutter/material.dart';
import 'package:mobile/core/theme/app_styles.dart';

/// A grouped list rendered as one card with hairline seams between rows.
///
/// The pattern the visual direction leans on hardest: rows are not free-floating
/// tiles, they are bands inside a single plane. That reads as one object with
/// parts rather than a stack of separate objects, which is why the card owns
/// the corners and the rows own only their seams.
///
/// The seam falls *between* rows and never after the last — a trailing rule
/// reads as a list that got cut off.
class InsetListCard extends StatelessWidget {
  const InsetListCard({super.key, required this.children, this.margin});

  final List<Widget> children;
  final EdgeInsetsGeometry? margin;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    if (children.isEmpty) return const SizedBox.shrink();

    final List<Widget> rows = <Widget>[];
    for (int i = 0; i < children.length; i++) {
      final bool isLast = i == children.length - 1;
      rows.add(
        DecoratedBox(
          decoration: BoxDecoration(
            border: isLast ? null : Border(bottom: AppDividers.side(colors)),
          ),
          child: children[i],
        ),
      );
    }

    return Container(
      margin:
          margin ??
          const EdgeInsets.symmetric(horizontal: AppSpacing.cardGutter),
      decoration: BoxDecoration(
        color: AppSurfaces.raised(colors),
        borderRadius: AppRadii.cardRadius,
        boxShadow: AppShadows.card(colors),
      ),
      // Clip so a row's own ink splash follows the card's corners instead of
      // squaring them off on the first and last rows.
      child: ClipRRect(
        borderRadius: AppRadii.cardRadius,
        child: Column(mainAxisSize: MainAxisSize.min, children: rows),
      ),
    );
  }
}

/// One row inside an [InsetListCard]: leading badge, stacked title/subtitle,
/// optional trailing.
///
/// Deliberately not a `ListTile` — the direction wants a tighter leading badge
/// and a baseline-aligned trailing value, both of which fight ListTile's fixed
/// geometry.
class InsetListRow extends StatelessWidget {
  const InsetListRow({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.trailing,
    this.onTap,
  });

  final String title;
  final String? subtitle;
  final Widget? leading;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme colors = theme.colorScheme;

    // A tappable row must announce itself as a button. `InkWell` alone gives
    // a tap handler without the button flag, so a screen reader describes a
    // navigation control as plain text — which `ListTile` would have set for
    // free and is easy to lose when moving off it.
    return Semantics(
      button: onTap != null,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          // 48dp minimum height rather than the reference's tighter row: the
          // density here is carried by type and spacing, never by a touch
          // target below the accessible minimum.
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.s16,
            vertical: AppSpacing.s12,
          ),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Row(
              children: <Widget>[
                if (leading != null) ...<Widget>[
                  leading!,
                  const SizedBox(width: AppSpacing.s12),
                ],
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        title,
                        style: theme.textTheme.bodyLarge?.copyWith(
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      if (subtitle != null) ...<Widget>[
                        const SizedBox(height: AppSpacing.s2),
                        Text(
                          subtitle!,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                if (trailing != null) ...<Widget>[
                  const SizedBox(width: AppSpacing.s12),
                  trailing!,
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The small rounded square that leads a row.
///
/// Square-ish rather than circular, at the smallest radius on the ladder, so it
/// reads as a category chip rather than an avatar.
class RowBadge extends StatelessWidget {
  const RowBadge({super.key, required this.child, this.color});

  final Widget child;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    final Color background = color ?? colors.primaryContainer;

    return Container(
      width: 38,
      height: 38,
      decoration: BoxDecoration(
        color: background,
        borderRadius: AppRadii.badgeRadius,
      ),
      alignment: Alignment.center,
      child: IconTheme(
        data: IconThemeData(
          size: 18,
          color:
              ThemeData.estimateBrightnessForColor(background) ==
                  Brightness.dark
              ? Colors.white
              : colors.onSurface,
        ),
        child: child,
      ),
    );
  }
}
