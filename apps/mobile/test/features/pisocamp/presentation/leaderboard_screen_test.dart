import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/leaderboard_repository.dart';
import 'package:mobile/features/pisocamp/presentation/screens/leaderboard_screen.dart';

class _FakeRepository extends LeaderboardRepository {
  _FakeRepository({this.board, this.throws}) : super(Dio());

  final Leaderboard? board;
  final Object? throws;
  final List<LeaderboardPeriod> asked = <LeaderboardPeriod>[];

  @override
  Future<Leaderboard> fetch(LeaderboardPeriod period) async {
    asked.add(period);
    if (throws != null) throw throws!;
    return board!;
  }
}

Leaderboard _board({LeaderboardStanding? you}) => Leaderboard(
  period: LeaderboardPeriod.weekly,
  periodStart: '2026-08-31',
  top: const <LeaderboardStanding>[
    LeaderboardStanding(
      rank: 1,
      alias: 'Piso Champion',
      score: 30,
      rankMovement: 2,
    ),
    LeaderboardStanding(
      rank: 2,
      alias: 'Learner-ABC123',
      score: 25,
      rankMovement: null,
    ),
  ],
  you: you,
);

void main() {
  testWidgets('a guest is told registration is required, not shown an empty list', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: LeaderboardScreen(
          repository: _FakeRepository(board: _board()),
          authenticated: false,
        ),
      ),
    );
    await tester.pumpAndSettle();

    // "No data" and "this is not for you yet" are different messages, and only
    // one of them tells somebody what to do next.
    expect(find.textContaining('registered users'), findsOneWidget);
    expect(find.text('Piso Champion'), findsNothing);
  });

  testWidgets('shows the top by alias, and never anything else', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: LeaderboardScreen(
          repository: _FakeRepository(board: _board()),
          authenticated: true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Piso Champion'), findsOneWidget);
    expect(find.text('Learner-ABC123'), findsOneWidget);
    // Movement is shown where there is some, and nothing is invented where
    // there is none to report.
    expect(find.textContaining('up 2'), findsOneWidget);
  });

  testWidgets('shows where you stand even outside the top', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: LeaderboardScreen(
          repository: _FakeRepository(
            board: _board(
              you: const LeaderboardStanding(
                rank: 42,
                alias: 'Learner-ZZZ999',
                score: 5,
                rankMovement: -3,
              ),
            ),
          ),
          authenticated: true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('You are ranked 42'), findsOneWidget);
    expect(find.textContaining('down 3'), findsOneWidget);
  });

  testWidgets('says the leaderboard is off rather than showing an empty one', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: LeaderboardScreen(
          repository: _FakeRepository(throws: const LeaderboardUnavailable()),
          authenticated: true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('not available'), findsOneWidget);
  });

  testWidgets('asks the server again when the period changes', (tester) async {
    final repository = _FakeRepository(board: _board());
    await tester.pumpWidget(
      MaterialApp(
        home: LeaderboardScreen(repository: repository, authenticated: true),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('All time'));
    await tester.pumpAndSettle();

    expect(repository.asked, <LeaderboardPeriod>[
      LeaderboardPeriod.weekly,
      LeaderboardPeriod.allTime,
    ]);
  });

  testWidgets('says a load failed rather than showing an empty board', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: LeaderboardScreen(
          repository: _FakeRepository(throws: Exception('offline')),
          authenticated: true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('could not be loaded'), findsOneWidget);
  });
}
