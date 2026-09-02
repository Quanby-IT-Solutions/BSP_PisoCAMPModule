# CE-4 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `fe017c6` (CE-3)
Ticket: CE-4 — Haptic simulation of tactile banknote features

## Result

**PARTIAL.** All five acceptance criteria are **PASS**. The Definition of Done
additionally requires *device-matrix haptic test evidence*, and **no Android or
iOS device or emulator is available in this environment**, so that one item is
outstanding. Nothing else is.

What stands in for a device is not a screenshot. The default player is driven
through Flutter's real platform channel in a test, and the exact
`HapticFeedback.vibrate` calls it produces are captured and asserted — so "the
mapped pattern plays" is checked mechanically, on the same code path a handset
would run. What cannot be checked here is how the resulting vibration *feels* on
particular hardware, which is precisely what a device matrix is for.

## What CE-4 adds

| Layer | Surface |
| --- | --- |
| Contract | `TACTILE_PATTERN_IDS`, `PisoCampTactileRegionSchema`, `PisoCampTactileMapSchema`; `feature_use{feature:haptic}` on screen `tactile_viewer` |
| Seed bundle | `packages/db/src/pisocamp-tactile-catalog.ts`; `tactileRegions` on all 15 banknote catalog documents; re-signed as `ce4-seed-v3` |
| Mobile | `CurrencyTactileRegion` and strict map parsing; `tactile_patterns.dart` (approved catalog, limits, player); `TactileBanknoteView`; `TactileViewerScreen`; route `/pisocamp/currency/:kind/:logicalId/tactile`; entry point on the banknote detail |

## Two decisions worth reviewing

**The map lives in the frozen catalog, not on a content version.** The ticket's
in-scope line says "`tactile_map` JSON on banknote content version". It is in the
seed catalog instead, beside the image it is anchored to and beside CE-2's coin
model, for one reason: AC5 requires that *every mandatory banknote* has a map. A
column on `content_version` is populated only for notes an editor has published,
so on a fresh install — the state every device starts in — the coverage
criterion would be vacuous. Putting the map where the image already lives makes
AC5 a real check. If per-version override is wanted later, it overlays this
baseline the way CE-3's published fields overlay catalog presentation.

**The regions describe a fictional illustration.** They say what kinds of tactile
feature a note carries and roughly where; they are not the layout of any real
denomination, and all 15 notes share one map because they share one neutral
illustration. The viewer states that it is a simulation before anything can be
touched. Provenance is recorded in the seed's `SOURCE.md`.

## AC1 — touching a mapped region plays its pattern and highlights it

**PASS.**

- `tactile_viewer_screen_test.dart` touches the region whose approved pattern is
  `bars` and asserts the player received exactly that pattern's pulses, all at
  medium strength, and that the region is highlighted and named on screen.
- `tactile_patterns_test.dart` asserts the player emits every pulse in order,
  and — through Flutter's real platform channel — that `embossed` reaches the
  device as two `HapticFeedbackType.heavyImpact` calls. The default player really
  does drive the platform rather than being a fake all the way down.
- The three approved patterns are distinguishable by feel, not only by label:
  three different pulse counts and three different strengths, asserted.

## AC2 — the feature says it is a simulation

**PASS.** The notice is the first card on the screen, above the illustration and
before anything can be touched: *"This is a simulation. The vibration and the
illustration are educational only and do not reproduce any real banknote. Always
check a real note in your own hands."* Asserted on open.

## AC3 — no haptics, or vibration turned off, gives a visual-only alternative

**PASS.** Two routes to the same place, both asserted:

- **A device that cannot vibrate.** `tactileHapticsAvailable` is true only on
  Android and iOS — asserted for both, and false for Windows, macOS, Linux and
  Fuchsia. The screen then shows "This device cannot vibrate, so each feature is
  described on screen instead", offers no switch, and sends **nothing** to the
  player when a region is touched.
- **A user who turns it off.** Where haptics exist, a labelled switch turns them
  off; touching a region afterwards plays nothing and still names the region and
  describes what it would feel like.

The visual alternative is not a consolation prize: the highlight and the
plain-language description ("4 steady taps") play in *both* modes, so the
simulation teaches the same thing either way.

One limitation stated rather than papered over: Flutter cannot read the operating
system's own "vibration off" accessibility setting. The app does not pretend to.
A platform without haptics is treated as off, the app offers its own switch, and
a user who has silenced vibration at the system level simply feels nothing while
the on-screen description plays regardless.

## AC4 — vibration is pattern-limited

**PASS.** The limit is structural, not advisory.

- A pattern may contain at most 8 pulses and last at most 900 ms. A pattern
  outside either bound throws rather than playing; both are asserted.
- `TactilePlayer` plays one pattern at a time. A request arriving while a pattern
  is playing is **dropped**, and `play` returns whether it played so a caller can
  tell the difference. Asserted by re-entering the player from inside its own
  impact callback: the second request is refused and only the first pattern's two
  impacts are emitted. Holding a finger on a region, or dragging across regions,
  therefore cannot chain into continuous vibration.
- The lock is released even when an impact throws, so a failed channel call
  cannot wedge the player into a permanently "playing" state. Asserted.

## AC5 — every mandatory banknote has a tactile map

**PASS.** `tactile_coverage_test.dart` runs against the bundle a device reads:

- exactly 15 banknotes — 4 FPP, 5 eNGC, 6 NGC — with 15 distinct
  series/denomination pairs;
- every one has a non-empty map whose region ids are unique;
- every region names a pattern that **this build can actually play**, and that
  pattern is inside the pulse-count and duration limits — a bundle naming a
  pattern the app lacks fails here rather than doing nothing on a phone;
- every region lies inside the illustration it is anchored to, and no two
  regions of a note overlap, because an overlapped region would be unreachable
  by touch;
- coins and security features carry no map at all.

`pisocamp-seed-bundle.spec.ts` asserts the same coverage from the generator's
side, so the two ends of the pipeline agree.

## `feature_use{feature:haptic}`

Added to the shared catalog, so the TypeScript validator and the Dart producer
are checked against the same vocabulary. A feature is bound to the one screen
that hosts it: the contract test now asserts that `haptic` is rejected on
`coin_3d_viewer` and accepted on `tactile_viewer`. The screen records exactly one
event per opening, and only once the simulation can actually be used — an item
with no approved map records nothing. Both asserted.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 17 files, 246 tests passed |
| `@repo/db` vitest (live PostgreSQL, migration opt-in) | 16 files, 100 passed, 32 skipped |
| `@repo/backend` jest (live PostgreSQL, `--runInBand`) | 74 suites passed, 2 skipped; 627 passed, 48 skipped, 0 failed |
| `@repo/web` vitest | 40 files, 345 tests passed |
| `flutter test` | 423 passed, 1 skipped (CE-2's evidence renderer) |
| `flutter analyze` | 0 errors; 40 pre-existing infos/warnings |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

One sibling test updated: the packaged seed key id, `ce2-seed-v2` → `ce4-seed-v3`.

## Accessibility

Every region is its own labelled button (`Tactile feature: <label>`) exposing its
selected state, so the simulation is operable and legible without touch
precision or vibration. The description below the illustration is a live region,
so a screen reader announces what was touched and what it feels like. The image
keeps its alternative text. The vibration switch is a standard labelled
`SwitchListTile` with an explanation of what turning it off does.

## What is outstanding

Device-matrix haptic evidence: the ticket's Definition of Done asks for the
patterns to be exercised across real handsets, and no Android or iOS device or
emulator is attached here (`flutter devices` lists Windows, Chrome and Edge). The
Android **toolchain** works — CE-2 built and unpacked a debug APK — so the
remaining work is running the existing screen on real hardware and recording how
each of the three patterns reads on it. Nothing in the implementation is waiting
on that; the pattern catalog is one table, and tuning it is a data change.
