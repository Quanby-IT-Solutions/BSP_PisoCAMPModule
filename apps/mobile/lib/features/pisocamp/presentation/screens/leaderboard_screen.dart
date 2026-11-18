import 'package:flutter/material.dart';
import 'package:mobile/core/theme/app_styles.dart';
import 'package:mobile/shared/widgets/inset_list_card.dart';
import 'package:mobile/features/pisocamp/data/leaderboard_repository.dart';

/// GM-4's board.
///
/// Registered only, and a guest is told why rather than shown an empty list:
/// "no data" and "this is not for you yet" are different messages, and only one
/// of them tells somebody what to do next.
class LeaderboardScreen extends StatefulWidget {
  const LeaderboardScreen({
    super.key,
    required this.repository,
    required this.authenticated,
  });

  final LeaderboardRepository repository;
  final bool authenticated;

  @override
  State<LeaderboardScreen> createState() => _LeaderboardScreenState();
}

class _LeaderboardScreenState extends State<LeaderboardScreen> {
  LeaderboardPeriod _period = LeaderboardPeriod.weekly;
  Leaderboard? _board;
  bool _loading = false;
  bool _unavailable = false;
  String? _problem;

  @override
  void initState() {
    super.initState();
    if (widget.authenticated) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _problem = null;
    });
    try {
      final board = await widget.repository.fetch(_period);
      if (!mounted) return;
      setState(() {
        _board = board;
        _loading = false;
      });
    } on LeaderboardUnavailable {
      if (!mounted) return;
      setState(() {
        _unavailable = true;
        _loading = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _problem = 'The leaderboard could not be loaded. Please try again.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Leaderboard')),
      body: SafeArea(child: _body(context)),
    );
  }

  Widget _body(BuildContext context) {
    if (!widget.authenticated) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Text(
              'The leaderboard is for registered users',
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            const Text(
              'Create an account to see your rank and score. Everything else in '
              'Piso CAMP stays available without one.',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    if (_unavailable) {
      return const Padding(
        padding: EdgeInsets.all(24),
        child: Center(
          child: Text(
            'The leaderboard is not available at the moment.',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    return Column(
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.all(AppSpacing.cardGutter),
          child: SegmentedButton<LeaderboardPeriod>(
            segments: <ButtonSegment<LeaderboardPeriod>>[
              for (final period in LeaderboardPeriod.values)
                ButtonSegment<LeaderboardPeriod>(
                  value: period,
                  label: Text(period.label),
                ),
            ],
            selected: <LeaderboardPeriod>{_period},
            onSelectionChanged: (selection) {
              setState(() => _period = selection.first);
              _load();
            },
          ),
        ),
        if (_problem != null)
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.pageGutter,
            ),
            child: Text(
              _problem!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        if (_loading) const LinearProgressIndicator(),
        if (_board?.you != null)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.s16),
            child: InsetListCard(
              children: <Widget>[
                InsetListRow(
                  // Their own standing first, even when they are not in the
                  // top: a board that only shows the leaders tells everybody
                  // else nothing about themselves.
                  leading: RowBadge(
                    color: Theme.of(context).colorScheme.primary,
                    child: const Icon(Icons.person),
                  ),
                  title: 'You are ranked ${_board!.you!.rank}',
                  subtitle:
                      '${_board!.you!.score} points'
                      '${_movement(_board!.you!.rankMovement)}',
                ),
              ],
            ),
          ),
        // The standings are one board, so they are one plane with seams
        // between the places rather than a stack of loose rows on the page.
        Expanded(
          child: _BoardCard(
            child: ListView.separated(
              padding: EdgeInsets.zero,
              itemCount: _board?.top.length ?? 0,
              separatorBuilder: (context, index) => Divider(
                height: AppDividers.hairline,
                thickness: AppDividers.hairline,
                color: Theme.of(context).colorScheme.outlineVariant,
              ),
              itemBuilder: (context, index) {
                final standing = _board!.top[index];
                return InsetListRow(
                  leading: RowBadge(child: Text('${standing.rank}')),
                  title: standing.alias,
                  trailing: Text(
                    '${standing.score}${_movement(standing.rankMovement)}',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ],
    );
  }

  /// Movement in words, and nothing at all when there is none to report.
  String _movement(int? movement) {
    if (movement == null || movement == 0) return '';
    return movement > 0 ? ' · up $movement' : ' · down ${-movement}';
  }
}

/// The plane the standings sit on.
///
/// [InsetListCard] builds its rows into a `Column`, which cannot carry a list
/// of unknown length. This is the same surface, corners and shadow wrapped
/// around something that scrolls.
class _BoardCard extends StatelessWidget {
  const _BoardCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.fromLTRB(
        AppSpacing.cardGutter,
        0,
        AppSpacing.cardGutter,
        AppSpacing.cardGutter,
      ),
      decoration: BoxDecoration(
        color: AppSurfaces.raised(colors),
        borderRadius: AppRadii.cardRadius,
        boxShadow: AppShadows.card(colors),
      ),
      child: ClipRRect(borderRadius: AppRadii.cardRadius, child: child),
    );
  }
}
