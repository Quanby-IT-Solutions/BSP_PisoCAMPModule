# CE-5 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `5652d19` (CE-4)
Ticket: CE-5 — Tilt simulation of dynamic security features

## Result

All five CE-5 acceptance criteria are **PASS**. As with CE-4, no Android or iOS
device is attached, so the accelerometer path is exercised through a scripted
sensor rather than by physically tilting a handset. CE-5's Definition of Done is
"as standard" — it does **not** ask for device-matrix evidence — so this ticket
is not blocked by that the way CE-4 is.

## What CE-5 adds

| Layer | Surface |
| --- | --- |
| Contract | `TILT_EFFECT_IDS`, `PisoCampTiltEffectSchema`; `feature_use{feature:tilt}` on screen `tilt_viewer` |
| Seed bundle | `tiltEffectFor` in the tactile catalog; `tiltEffect` on all 15 banknote catalog documents; re-signed as `ce5-seed-v4` |
| Mobile | `sensors_plus` dependency; `CurrencyTiltEffect` and strict parsing; `tilt_effects.dart` (approved effects, sensor and manual sources, throttling); `TiltBanknoteView` and `TiltEffectPainter`; `TiltViewerScreen`; route `/pisocamp/currency/:kind/:logicalId/tilt`; entry point on the banknote detail |

## The decision that shapes this ticket

**The sensor is one source of a number, not the feature.** Everything downstream
of the tilt value — the painter, the widget, the screen — takes a single double
in −1..1 and knows nothing about where it came from. A slider is therefore not a
degraded mode; it is the same simulation driven by a different `TiltSource`.
That is what makes AC3 a one-line change of source rather than a second code
path, and it is why reduced motion can be honoured without freezing the effect.

## AC1 — the effect responds to orientation within the approved range

**PASS.**

- `tiltFromAccelerationX` maps a level device to the middle of the range and a
  full sideways tilt to each end. Past the range it **holds** rather than
  continuing, so a device turned right over does not wrap the effect back around
  — asserted at ±40 m/s². An unreadable sample reads as level. The mapping is
  asserted monotonic across the whole range.
- In the screen, a scripted sensor emitting −0.75 and then 0.5 moves the
  rendered tilt to exactly those values, and no slider is shown while the sensor
  is driving.
- `TiltEffectPainter.bandPosition` places the band from hard left to hard right
  across the same range.

## AC2 — the feature is labelled an educational simulation

**PASS.** The notice is the first card on the screen, above the illustration:
*"This is an educational simulation. The effect and the illustration are neutral
teaching aids and do not reproduce any real banknote. Always check a real note in
your own hands."* Asserted on open. The effect region is additionally announced
to a screen reader as "…, an educational simulation that responds as the device
is tilted" — asserted.

## AC3 — no sensor, or reduced motion, gives an on-screen slider

**PASS.** Both routes are asserted:

- **No sensor.** `tiltSensorAvailable` is true only on Android and iOS —
  asserted for both, false for Windows, macOS, Linux and Fuchsia. The screen then
  says "Drag the slider…", shows a labelled slider, and dragging it moves the
  rendered tilt within the approved range.
- **Reduced motion.** With `disableAnimations` set, the slider appears even
  though a sensor exists, and a reading emitted by that sensor is **ignored** —
  asserted. Reduced motion changes where the value comes from; it does not freeze
  the effect, so the feature stays usable.

## AC4 — the simulation works offline

**PASS.** The illustration and the approved effect both come from the synced
bundle, and the effect catalog is compiled into the app. The screen makes no
network call, and the whole Flutter suite runs with no network. The renderer is a
`CustomPainter`, so nothing is fetched to draw the effect either.

## AC5 — every mandatory banknote has a tilt effect

**PASS.** `tilt_effects_test.dart` checks the bundle a device reads: all 15
banknotes carry an effect; every effect names an id **this build can render**, so
a bundle naming an unknown effect fails here rather than drawing nothing on a
phone; every region lies inside the illustration it is anchored to and carries a
label. Coins and security features carry none.

`pisocamp-seed-bundle.spec.ts` asserts the same from the generator's side.

## Battery (AN-025)

The sensor is read at the platform's UI interval and throttled again in
`SensorTiltSource` to at most one sample every 33 ms, because a simulation
redrawn faster than the screen refreshes costs battery and shows nothing extra.
Asserted with a scripted clock: of four samples arriving at 0, 30, 60 and 160 ms,
exactly two survive a 100 ms limit.

Two further costs are handled rather than assumed:

- Constructing a `SensorTiltSource` no longer wakes the sensor — the stream is
  resolved lazily, so only listening starts it.
- The screen cancels its subscription and disposes the source when it closes.
  Asserted by tearing the screen down and checking the source was disposed: a
  sensor left running is a battery cost the user cannot see.

## A defect found while building this

The effect overlay was a `Positioned` inside a `LayoutBuilder` inside the
`Stack`. Flutter requires a `Positioned` to be a **direct** child of its `Stack`,
so the screen threw *"Incorrect use of ParentDataWidget"* on every open. The
builder now wraps the stack instead. Caught by the first screen test that
rendered it.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 17 files, 246 tests passed |
| `@repo/db` vitest (live PostgreSQL, migration opt-in) | 16 files, 101 passed, 32 skipped |
| `@repo/backend` jest (live PostgreSQL, `--runInBand`) | 74 suites passed, 2 skipped; 627 passed, 48 skipped, 0 failed |
| `@repo/web` vitest | 40 files, 345 tests passed |
| `flutter test` | 443 passed, 1 skipped (CE-2's evidence renderer) |
| `flutter analyze` | 0 errors; 40 pre-existing infos/warnings |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

One sibling test updated: the packaged seed key id, `ce4-seed-v3` → `ce5-seed-v4`.

## Accessibility

The slider is a labelled slider control, so the fallback is operable by assistive
technology rather than by dragging alone. The effect region is announced as a
simulation. The illustration keeps its alternative text. The instruction line
changes with the source, so what to do is stated rather than implied.

## Environment note

`sensors_plus 7.1.0` was added as a dependency. Widget tests never touch the real
plugin: the screen takes a `TiltSource`, and the tests supply a scripted one, so
the sensor path is asserted deterministically rather than skipped.
