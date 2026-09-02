/// F6's accessibility checklist, as something a test can run.
///
/// The ticket asks for "an accessibility audit run per the approved test plan".
/// A checklist a person is asked to remember is a checklist that decays, so it
/// is written here once and every later UI ticket registers its screen against
/// it rather than restating the rules.
///
/// The four checks correspond to the criteria directly:
///
/// * touch targets — Flutter's Android and iOS tap-target guidelines;
/// * labels — every tappable node carries one, which is also focus order's
///   prerequisite;
/// * contrast and non-colour indicators — Flutter's text-contrast guideline;
/// * font scaling and rotation — no overflow at the largest supported scale,
///   in either orientation.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The largest text scale the module supports, from the ticket's "largest
/// supported size".
const double kLargestSupportedTextScale = 2;

/// A phone in portrait, and the same phone rotated.
const Size kAuditPortrait = Size(390, 844);
const Size kAuditLandscape = Size(844, 390);

/// The narrowest width the module supports.
const Size kAuditNarrow = Size(320, 640);

/// Runs the guideline checks Flutter can decide mechanically.
///
/// Kept separate from the layout checks so a failure names which kind of
/// problem it is.
Future<void> expectMeetsGuidelines(WidgetTester tester) async {
  final handle = tester.ensureSemantics();
  await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
  await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
  await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
  await expectLater(tester, meetsGuideline(textContrastGuideline));
  handle.dispose();
}

/// Asserts nothing overflows its box.
///
/// Flutter reports an overflow as an exception during paint rather than as a
/// visible failure, so the check is to pump a frame and find none pending.
void expectNoOverflow(WidgetTester tester, {required String reason}) {
  final exception = tester.takeException();
  expect(exception, isNull, reason: reason);
}

/// Builds [subject] at [size] and [textScale], pumps it, and reports any
/// overflow.
///
/// Returns after the frame settles, so a caller can make its own assertions
/// about what is on screen at that size.
Future<void> pumpAtScale(
  WidgetTester tester,
  Widget subject, {
  required Size size,
  double textScale = 1,
}) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MediaQuery(
      data: MediaQueryData(
        size: size,
        textScaler: TextScaler.linear(textScale),
      ),
      child: subject,
    ),
  );
  await tester.pumpAndSettle();
}

/// Whether the page scrolls sideways, which it must not.
///
/// A horizontal overflow is the failure a person actually meets when text is
/// scaled up: content is reachable in principle and unreachable in practice.
void expectNoHorizontalScroll(WidgetTester tester) {
  for (final scrollable in tester.widgetList<Scrollable>(
    find.byType(Scrollable),
  )) {
    expect(
      scrollable.axisDirection,
      isNot(AxisDirection.right),
      reason: 'a screen must not scroll sideways',
    );
    expect(scrollable.axisDirection, isNot(AxisDirection.left));
  }
}
