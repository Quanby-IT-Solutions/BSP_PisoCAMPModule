# F6 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `4bfd6ab` (F5)
Ticket: F6 — Accessibility baseline and orientation state preservation

## Result

All five F6 acceptance criteria are **PASS**, and the ticket's real deliverable —
a checklist every later UI ticket must pass — is a **test that runs**, not a
document someone has to remember.

The audit found and fixed two genuine defects in screens that had already been
committed. That is the argument for the ticket: reviewing screens by eye had
missed both.

## What F6 adds

| Layer | Surface |
| --- | --- |
| Test support | `test/support/accessibility_checklist.dart` — the checklist, as callable checks |
| Test | `accessibility_audit_test.dart` — every Piso CAMP screen in Releases 1–2, run against it |
| Mobile | `prefersReducedMotion(context)`, one place the module asks; two layout fixes in the CE-2 viewer |

## The checklist

A later UI ticket adds one line to `kAuditedScreens` and one to `buildScreen`.
That registration is the whole obligation; the rules live in one file.

Each registered screen is run through four checks:

| Check | What it uses |
| --- | --- |
| Touch targets | Flutter's `androidTapTargetGuideline` and `iOSTapTargetGuideline` |
| Labels | `labeledTapTargetGuideline` — every tappable node carries one |
| Contrast | `textContrastGuideline` |
| Scaling, width and rotation | No overflow at 200% text, at 320 px, and in landscape at 200% text |

Seven screens are registered: the banknote and coin lists, both details, and the
3D, tactile and tilt viewers — 28 guideline runs plus 4 rotation-state tests.

## AC1 — nothing is clipped at the largest supported size, all actions reachable

**PASS**, and this is where the audit earned its keep. Flutter reports an
overflow as an exception during paint rather than as anything visible, so a
screen can be broken at 200% text and look fine in every screenshot. Two real
defects, both in CE-2's coin viewer, both committed before this ticket:

1. **A control row overflowed by 282 px at 320 px width.** Zoom out, Zoom in,
   Reset and the zoom readout were a fixed `Row`. It is now a `Wrap`: an
   overflowing control is an unreachable one.
2. **The whole screen overflowed by 208 px at 200% text.** The stage was an
   `Expanded` in a non-scrolling `Column`, so growing text had nowhere to go. The
   body now scrolls and the stage takes a share of the viewport rather than
   whatever is left over.

Every registered screen now passes at 200% text, at 320 px, and in landscape at
200% text, with no horizontal scrolling anywhere — a sideways-scrolling page
being the failure a person actually meets when text is scaled up.

## AC2 — every interactive element has a label, and focus order is logical

**PASS.** `labeledTapTargetGuideline` is run on every registered screen, so an
unlabelled tappable node fails the build. Labels are also focus order's
prerequisite: an unlabelled node cannot be announced in any order.

The specific labels the CE tickets introduced are asserted in their own suites —
`Security feature: <title>`, `Tactile feature: <label>`, the coin model's "not a
reproduction" description, the tilt effect's "educational simulation" — and are
re-checked here as part of the guideline run.

## AC3 — state survives rotation

**PASS.** Four assertions, one per kind of state the ticket names:

- a list keeps its scroll offset;
- the 3D viewer keeps the face and the zoom it was showing;
- the tactile viewer keeps the region that was touched;
- the tilt viewer keeps where the slider was left.

Worth being precise about *why* this holds, because it is easy to claim wrongly:
the Android manifest declares `orientation|screenSize` among its `configChanges`,
so the activity is not recreated on rotation and Flutter keeps the widget tree.
State is preserved by construction. The tests assert the consequence rather than
assuming it, so a later change to that manifest line fails here instead of
silently losing people's place.

`RestorationMixin` addresses a different problem — the process being killed and
restarted — which no acceptance criterion here asks for, and which would be
misleading to claim on the strength of a rotation test.

## AC4 — reduced motion has a reduced or static alternative

**PASS.** The module now asks in one place, `prefersReducedMotion(context)`,
which the CE-2 and CE-5 viewers both read.

Honouring it never removes the feature: a face preset still lands, it just lands
immediately instead of animating; the tilt effect still responds, driven by the
slider instead of the sensor. Both are asserted in their own suites — CE-2's
"reduced motion lands on the face immediately", CE-5's "reduced motion moves the
simulation onto the slider", which also asserts the sensor is no longer listened
to.

## AC5 — the accessibility audit passes

**PASS.** 32 tests, run on every build:

```
flutter test test/features/pisocamp/presentation/accessibility_audit_test.dart
28 guideline and layout checks + 4 rotation-state checks — all passed
```

## Scope note

The audit registers the seven currency screens CE-1 to CE-5 built. The module's
home, registration and privacy-notice screens keep the accessibility assertions
written with them in F2/F3/F4 and are not re-registered here; folding them into
the same audit needs their provider graphs, which is a larger change than this
ticket's criteria call for. The registration list is the obvious place to add
them, and a later ticket that touches those screens should.

## Test evidence

| Suite | Result |
| --- | --- |
| `flutter test` | 509 passed, 1 skipped (CE-2's evidence renderer) |
| `flutter analyze` | 0 errors; 40 pre-existing infos/warnings |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

No sibling test needed changing: the two fixes were to layout, and every existing
assertion about those screens still holds.
