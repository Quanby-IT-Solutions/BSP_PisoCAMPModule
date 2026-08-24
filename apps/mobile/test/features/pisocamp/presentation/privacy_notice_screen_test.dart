import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_repository.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/presentation/screens/privacy_notice_screen.dart';

void main() {
  final notice = PrivacyNotice(
    id: '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
    version: '2024-12-26',
    title: 'BSP Mobile App Privacy Notice',
    body: List.filled(
      20,
      'Explicit fake notice paragraph used only by widget tests.',
    ).join('\n\n'),
    sourceUrl: Uri.parse('https://example.test/full-notice'),
    contentSha256:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    effectiveAt: DateTime.utc(2024, 12, 26),
  );

  Widget subject({
    Future<ConsentGateResult> Function(ConsentDecision)? onDecision,
    bool online = true,
    bool requiresReconsent = false,
  }) => MaterialApp(
    home: PrivacyNoticeScreen(
      notice: notice,
      online: online,
      requiresReconsent: requiresReconsent,
      onDecision: onDecision ?? (_) async => ConsentGateResult.grantedSynced,
    ),
  );

  testWidgets('renders the complete notice metadata and body before actions', (
    tester,
  ) async {
    await tester.pumpWidget(subject(requiresReconsent: true));

    expect(find.text(notice.title), findsOneWidget);
    expect(find.text('Version 2024-12-26'), findsOneWidget);
    expect(find.text('Effective December 26, 2024'), findsOneWidget);
    expect(find.text(notice.body), findsOneWidget);
    expect(
      find.text('Source: https://example.test/full-notice'),
      findsOneWidget,
    );
    expect(find.textContaining('updated privacy notice'), findsOneWidget);
    expect(find.bySemanticsLabel('Accept privacy notice'), findsOneWidget);
    expect(find.bySemanticsLabel('Decline privacy notice'), findsOneWidget);

    final bodyTop = tester.getTopLeft(find.text(notice.body)).dy;
    await tester.ensureVisible(find.text('Accept'));
    final acceptTop = tester.getTopLeft(find.text('Accept')).dy;
    expect(bodyTop, lessThan(acceptTop));
  });

  testWidgets('offline mode explains that the saved response will be queued', (
    tester,
  ) async {
    await tester.pumpWidget(subject(online: false));

    expect(
      find.text(
        'You can save your choice offline. Internet is required to continue registration.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('double tapping Accept records only one decision', (
    tester,
  ) async {
    final release = Completer<ConsentGateResult>();
    var submissions = 0;
    await tester.pumpWidget(
      subject(
        onDecision: (decision) {
          submissions++;
          expect(decision, ConsentDecision.granted);
          return release.future;
        },
      ),
    );
    await tester.ensureVisible(find.text('Accept'));

    await tester.tap(find.text('Accept'));
    await tester.tap(find.text('Accept'));
    await tester.pump();

    expect(submissions, 1);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    release.complete(ConsentGateResult.grantedSynced);
    await tester.pumpAndSettle();
  });

  testWidgets('an unavailable write stays on screen with a live error', (
    tester,
  ) async {
    await tester.pumpWidget(
      subject(onDecision: (_) async => ConsentGateResult.unavailable),
    );
    await tester.ensureVisible(find.text('Decline'));
    await tester.tap(find.text('Decline'));
    await tester.pumpAndSettle();

    await tester.ensureVisible(
      find.text(
        'Your choice could not be saved. No information was collected.',
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.bySemanticsLabel(
        'Your choice could not be saved. No information was collected.',
      ),
      findsOneWidget,
    );
    expect(find.text('Accept'), findsOneWidget);
    expect(find.text('Decline'), findsOneWidget);
  });

  testWidgets(
    'long notice fits a narrow landscape surface at 200 percent text',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(568, 320));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2)),
          child: subject(),
        ),
      );

      await tester.ensureVisible(find.text('Decline'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(
        tester.getSize(find.bySemanticsLabel('Accept privacy notice')).height,
        greaterThanOrEqualTo(48),
      );
      expect(
        tester.getSize(find.bySemanticsLabel('Decline privacy notice')).height,
        greaterThanOrEqualTo(48),
      );
    },
  );
}
