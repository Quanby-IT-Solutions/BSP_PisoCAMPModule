import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/progress_repository.dart';
import 'package:mobile/features/pisocamp/presentation/screens/progress_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeRepository extends ProgressRepository {
  _FakeRepository(this.result) : super(Dio());

  final ProgressLoadResult result;

  @override
  Future<ProgressLoadResult> load() async => result;
}

const _progress = PisoCampProgress(
  topicsViewed: 4,
  topicsAnswered: 3,
  questionsAnswered: 3,
  questionsCorrect: 2,
  questionsSkipped: 1,
  accuracyPercent: 66.67,
  points: 30,
  lastActivityAt: '2026-09-03T02:00:00.000Z',
);

const _empty = PisoCampProgress(
  topicsViewed: 0,
  topicsAnswered: 0,
  questionsAnswered: 0,
  questionsCorrect: 0,
  questionsSkipped: 0,
  accuracyPercent: 0,
  points: 0,
  lastActivityAt: null,
);

void main() {
  testWidgets('shows every figure the ticket asks for', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ProgressScreen(
          repository: _FakeRepository(
            const ProgressLoadResult(progress: _progress, isOffline: false),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Topics viewed'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
    expect(find.text('66.67%'), findsOneWidget);
    expect(find.text('30'), findsOneWidget);
    expect(find.text('2026-09-03T02:00:00.000Z'), findsOneWidget);
    expect(find.textContaining('Offline'), findsNothing);
  });

  testWidgets('shows zeros without an error when nothing has happened', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ProgressScreen(
          repository: _FakeRepository(
            const ProgressLoadResult(progress: _empty, isOffline: false),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Accuracy'), findsOneWidget);
    expect(find.text('0%'), findsOneWidget);
    // Nothing yet, said in words rather than left blank.
    expect(find.text('Nothing yet'), findsOneWidget);
  });

  testWidgets('says it is offline when showing the last synced summary', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ProgressScreen(
          repository: _FakeRepository(
            const ProgressLoadResult(progress: _progress, isOffline: true),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Figures somebody believes are current and are not are worse than none.
    expect(find.textContaining('showing what was last synced'), findsOneWidget);
    expect(find.text('30'), findsOneWidget);
  });

  testWidgets('says so when there is nothing cached to show yet', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ProgressScreen(
          repository: _FakeRepository(
            const ProgressLoadResult(progress: null, isOffline: true),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('once you have been online'), findsOneWidget);
  });

  group('the repository', () {
    setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

    test('falls back to the last synced summary when the request fails', () async {
      final preferences = await SharedPreferences.getInstance();
      // A summary written by an earlier, successful load.
      await preferences.setString(
        'pisocamp.progress.last',
        '{"topicsViewed":4,"topicsAnswered":3,"questionsAnswered":3,'
            '"questionsCorrect":2,"questionsSkipped":1,"accuracyPercent":66.67,'
            '"points":30,"lastActivityAt":null}',
      );
      final repository = ProgressRepository(
        Dio(BaseOptions(baseUrl: 'http://127.0.0.1:1')),
        preferences: preferences,
      );

      final result = await repository.load();

      expect(result.isOffline, isTrue);
      expect(result.progress?.points, 30);
    });

    test('shows nothing rather than a cache it cannot read', () async {
      final preferences = await SharedPreferences.getInstance();
      await preferences.setString('pisocamp.progress.last', 'not json');
      final repository = ProgressRepository(
        Dio(BaseOptions(baseUrl: 'http://127.0.0.1:1')),
        preferences: preferences,
      );

      final result = await repository.load();

      expect(result.progress, isNull);
      expect(result.isOffline, isTrue);
    });
  });
}
