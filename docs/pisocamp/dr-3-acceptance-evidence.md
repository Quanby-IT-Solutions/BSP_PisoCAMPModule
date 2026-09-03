# DR-3 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `2190dd0` (DR-2)
Ticket: DR-3 — demonetized and foreign banknote handling

## Result

All four acceptance criteria are **PASS**.

## AC4 first, because it is the one the others rest on

**PASS**, and enforced by the shape of the class list rather than by a screen
remembering to check:

| outcome | label | denominationCode |
| --- | --- | --- |
| `denomination` | required — "Twenty pesos" | required — `PHP20` |
| `demonetized` | required — the series, "New Design Series" | **refused** |
| `foreign` | **refused** | **refused** |

A demonetized class carrying a denomination is refused as a corrupt descriptor.
So is a foreign class carrying a label. There is therefore **nothing for
anything downstream to read out by accident**: BR-007 and BR-008 hold because
the wrong claim has nowhere to live, not because every reader remembers not to
make it.

The scanner switches on the class's own outcome, and Dart's exhaustiveness
checking on the sealed state type is what forced the screen to handle both new
findings rather than falling through to the denomination branch — it refused to
compile until it did.

Asserted directly: the same class, read confidently, reaches
`RecognitionDemonetized` and **not** `RecognitionRecognized`; a circulating
class still reads as its denomination.

## AC1 — a demonetized note

**PASS.** Headline "This note is no longer in circulation", then both halves the
criterion asks for: it belongs to the *New Design Series*, a demonetized series
that is no longer circulating legal tender, and **this reader identifies
circulating legal tender only**.

The second half matters because somebody holding an old note is asking a
question this module does not answer — whether a bank will still take it — and
saying what the reader is for is the honest way to decline it.

Spoken as the same sentence, and asserted to contain no denomination.

## AC2 — a foreign note

**PASS.** "This is not Philippine currency", and it stops there. The test sweeps
the rendered screen and the spoken sentence for *dollar*, *euro*, *yen*,
*ringgit* and *USD* and requires all of them absent. Section 17 puts foreign
denomination identification outside this module, and the class list is not
allowed to carry the answer even if a model claimed to know it.

## AC3 — the disclaimer still plays

**PASS**, on both findings, shown and spoken, asserted in a loop over the two.
Somebody holding an unfamiliar or obsolete note is *more* likely to be asking
whether it is real, not less, so the qualification travels with every answer.

Both findings also keep the ordinary controls — replay, scan another note, exit
— because these are answers, not errors. Somebody who gets one still has a next
note to look at.

## Test evidence

| Suite | Result |
| --- | --- |
| `flutter test` | 769 passed, 1 skipped (9 new: 1 model shape, 5 model refusals, 3 scanner, 5 screen) |
| backend jest `--runInBand` | 113 suites passed, 1004 tests, 2 suites / 48 tests skipped |
| `packages/contracts` vitest | 23 files, 380 passed |
| `pnpm typecheck` | 18/18 |
| `pnpm lint` | 18/18; only the 6 pre-existing `@repo/auth` warnings |
| `flutter analyze` | no new issues |

No migration: the analytics CHECK constrains an event's name, screen, feature
and status, and both new outcomes are property values on a completed scan.

## Not proven in this environment

Whether the approved model actually distinguishes a demonetized note from a
circulating one, or a foreign note from either. That is a measurement against
the approved dataset — DR-4's harness — and this ticket's job is to make sure
that whatever the model concludes, the module never turns those two classes
into a denomination. That part is proven.
