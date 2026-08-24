import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_repository.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/presentation/utils/require_consent.dart';

void main() {
  final notice = PrivacyNotice(
    id: '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
    version: '1',
    title: 'Privacy Notice',
    body: 'Explicit fake notice text used only by coordinator tests.',
    sourceUrl: Uri.parse('https://example.test/privacy'),
    contentSha256:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    effectiveAt: DateTime.utc(2026, 1, 1),
  );

  testWidgets('prompts, records decline, and returns without collection UI', (
    tester,
  ) async {
    ConsentGateResult? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Column(
              children: [
                FilledButton(
                  onPressed: () async {
                    result = await requireConsent(
                      context,
                      ConsentPurpose.registration,
                      online: true,
                      check: (_, {required online}) async => ConsentRequirement(
                        state: ConsentRequirementState.needsDecision,
                        notice: notice,
                      ),
                      recordDecision:
                          ({
                            required purpose,
                            required notice,
                            required decision,
                            required online,
                          }) async {
                            expect(decision, ConsentDecision.declined);
                            return ConsentGateResult.declined;
                          },
                    );
                  },
                  child: const Text('Start registration'),
                ),
                if (result != null) Text('Result: ${result!.name}'),
              ],
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Start registration'));
    await tester.pumpAndSettle();
    expect(find.text(notice.body), findsOneWidget);
    expect(find.byType(TextFormField), findsNothing);

    await tester.ensureVisible(find.text('Decline'));
    await tester.tap(find.text('Decline'));
    await tester.pumpAndSettle();

    expect(result, ConsentGateResult.declined);
    expect(find.text(notice.body), findsNothing);
  });

  testWidgets('returns unavailable without opening a collection surface', (
    tester,
  ) async {
    ConsentGateResult? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => FilledButton(
            onPressed: () async {
              result = await requireConsent(
                context,
                ConsentPurpose.registration,
                online: false,
                check: (_, {required online}) async => const ConsentRequirement(
                  state: ConsentRequirementState.unavailable,
                ),
                recordDecision:
                    ({
                      required purpose,
                      required notice,
                      required decision,
                      required online,
                    }) async => ConsentGateResult.unavailable,
              );
            },
            child: const Text('Start registration'),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Start registration'));
    await tester.pumpAndSettle();

    expect(result, ConsentGateResult.unavailable);
    expect(find.text('Privacy Notice'), findsNothing);
    expect(find.byType(TextFormField), findsNothing);
  });
}
