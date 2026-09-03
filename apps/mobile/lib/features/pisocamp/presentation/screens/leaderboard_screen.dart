import 'package:flutter/material.dart';
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
          padding: const EdgeInsets.all(16),
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
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              _problem!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        if (_loading) const LinearProgressIndicator(),
        if (_board?.you != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Card(
              child: ListTile(
                // Their own row first, even when they are not in the top: a
                // board that only shows the leaders tells everybody else
                // nothing about themselves.
                title: Text('You are ranked ${_board!.you!.rank}'),
                subtitle: Text(
                  '${_board!.you!.score} points'
                  '${_movement(_board!.you!.rankMovement)}',
                ),
              ),
            ),
          ),
        Expanded(
          child: ListView.builder(
            itemCount: _board?.top.length ?? 0,
            itemBuilder: (context, index) {
              final standing = _board!.top[index];
              return ListTile(
                leading: Text('${standing.rank}'),
                title: Text(standing.alias),
                trailing: Text(
                  '${standing.score}${_movement(standing.rankMovement)}',
                ),
              );
            },
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
