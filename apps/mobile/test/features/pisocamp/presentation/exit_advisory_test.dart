import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/advisory_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/advisory_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/exit_advisory.dart';

import '../data/advisory_document_test.dart' show advisoryBytes;

final class _MemoryStore implements AdvisoryDisplayStore {
  DateTime? lastShown;

  @override
  Future<DateTime?> readLastShown() async => lastShown;

  @override
  Future<void> recordShown(DateTime at) async => lastShown = at;
}

final class _RecordingAnalytics implements AdvisoryAnalytics {
  final List<String> events = [];

  @override
  Future<void> recordShown(AdvisoryDocument advisory) =>
      Future.sync(() => events.add('shown:${advisory.logicalId}'));
}

void main() {
  final advisory = AdvisoryDocument.parsePublished(
    advisoryBytes(
      links: [
        {
          'id': '33333333-3333-4333-8333-333333333333',
          'position': 0,
          'kind': 'external',
          'label': 'BSP guidance',
          'url': 'https://www.bsp.gov.ph/',
        },
      ],
    ),
  );

  group('the advisory itself', () {
    testWidgets('shows the approved words and its link', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExitAdvisory(advisory: advisory, onDismissed: () {}),
          ),
        ),
      );

      expect(find.text('Handle your money well'), findsOneWidget);
      expect(find.textContaining('flat and dry'), findsOneWidget);
      expect(find.text('BSP guidance'), findsOneWidget);
    });

    testWidgets('AC2 — dismissing is one tap and never confirmed', (
      tester,
    ) async {
      var dismissed = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExitAdvisory(
              advisory: advisory,
              onDismissed: () => dismissed += 1,
            ),
          ),
        ),
      );

      await tester.tap(find.widgetWithText(FilledButton, 'Got it'));
      await tester.pumpAndSettle();

      expect(dismissed, 1);
      expect(find.byType(AlertDialog), findsNothing);
    });

    testWidgets('opening a link is the reader choice', (tester) async {
      AdvisoryLink? opened;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ExitAdvisory(
              advisory: advisory,
              onDismissed: () {},
              onOpenLink: (link) => opened = link,
            ),
          ),
        ),
      );

      await tester.tap(find.text('BSP guidance'));
      await tester.pumpAndSettle();

      expect(opened?.destination, 'https://www.bsp.gov.ph/');
    });
  });

  group('ExitAdvisoryCoordinator', () {
    final now = DateTime.utc(2026, 9, 2, 12);

    ExitAdvisoryCoordinator coordinator(
      _MemoryStore store,
      _RecordingAnalytics analytics, {
      int intervalHours = 24,
    }) {
      return ExitAdvisoryCoordinator(
        store: store,
        analytics: analytics,
        intervalHours: intervalHours,
        clock: () => now,
      );
    }

    test('AC4 — shows it once and reports advisory_shown', () async {
      final store = _MemoryStore();
      final analytics = _RecordingAnalytics();

      final shown = await coordinator(store, analytics).onExit([advisory]);

      expect(shown?.logicalId, advisory.logicalId);
      expect(analytics.events, ['shown:${advisory.logicalId}']);
      // Recorded when shown, so the interval counts from being advised.
      expect(store.lastShown, now);
    });

    test('does not show it again inside the interval', () async {
      final store = _MemoryStore()
        ..lastShown = now.subtract(const Duration(hours: 12));
      final analytics = _RecordingAnalytics();

      expect(await coordinator(store, analytics).onExit([advisory]), isNull);
      expect(analytics.events, isEmpty);
    });

    test('shows it again once the interval has passed', () async {
      final store = _MemoryStore()
        ..lastShown = now.subtract(const Duration(hours: 24));

      expect(
        (await coordinator(store, _RecordingAnalytics()).onExit([advisory]))
            ?.logicalId,
        advisory.logicalId,
      );
    });

    test('honours a shorter configured interval', () async {
      final store = _MemoryStore()
        ..lastShown = now.subtract(const Duration(hours: 7));

      expect(
        await coordinator(
          store,
          _RecordingAnalytics(),
          intervalHours: 6,
        ).onExit([advisory]),
        isNotNull,
      );
    });

    test('records nothing when there is no advisory to show', () async {
      final store = _MemoryStore();
      final analytics = _RecordingAnalytics();

      expect(await coordinator(store, analytics).onExit(const []), isNull);
      expect(analytics.events, isEmpty);
      expect(store.lastShown, isNull);
    });
  });
}
