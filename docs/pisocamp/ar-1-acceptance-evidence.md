# AR-1 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `ec0a743` (AR-2)
Ticket: AR-1 — AR experience skeleton for one coin

## Result

Four of the five AR-1 acceptance criteria are **PASS**. The fifth is **PARTIAL**
and the unproven half is named below rather than claimed.

## The seam, and why

AR-1 needs an AR runtime, and the ticket says the plugin is BSP's to approve
(`ar_flutter_plugin` or platform views). This build has none, so the runtime
sits behind two small ports — `ArCapabilityProbe` and `ArSessionFactory` — in
the same shape SA-5 uses for the push service and AN-7 for the monitoring tool.

That is not a stub standing in for the feature. A build with no runtime answers
`runtimeMissing`, which the screen treats exactly as it treats an unsupported
phone: it says so and hands the person to CE-2's 3D viewer. **That path is the
one this build actually runs, and it is fully exercised.** When the approved
plugin arrives, it is one implementation of two interfaces; nothing else moves.

## AC1 — the explanation comes before the OS prompt

**PASS.** The first thing the screen shows is why the camera and motion sensors
are needed and what happens to the view — nothing recorded, saved or sent — and
that saying no still leaves the coin viewable in 3D.

Asserted that **nothing has been started** at that point: the session factory's
log is empty, so the OS prompt cannot have happened. A system dialog with no
context is one people refuse, and on both platforms they cannot easily be asked
again.

## AC2 — loading, instructions, animation, clean exit

**PASS** for everything this environment can run. Continuing shows a loading
indicator, starts the session, waits for it to be ready, then shows the
on-screen instructions and an Exit control. Exit releases the session and pops
back to where the person came from.

**Unproven here:** that the approved 3D animation renders correctly in a live
camera view. That needs the plugin and a device.

## AC3 — unsupported device or denied permission falls back

**PASS**, and the three cases are distinguished rather than merged:

| Case | What the screen says |
| --- | --- |
| Device has no ARCore/ARKit | "This phone does not support augmented reality." |
| Permission refused | "Without camera access the coin cannot be placed…" |
| Build has no AR runtime | "This build cannot open augmented reality yet." |

Each offers **CE-2's 3D viewer**, and the test follows that button through to
the viewer: a dead end here would strand somebody who came to look at a coin.

The entry point on the currency detail screen is offered wherever a 3D model
exists rather than being hidden behind a capability check, because deciding
there would mean asking the camera stack a question before anybody has said they
want AR.

## AC4 — ten open and close cycles

**PARTIAL.** What a widget test can prove, it proves: ten full cycles start ten
sessions and dispose **exactly ten**, none outliving its screen, with ten
`ar_start` and ten `ar_end` events. Disposal runs from `dispose()`, so it
happens on Exit, on the system back gesture and on a route change alike.

**Unproven here:** memory growth against the approved limit. That is measured on
a device with a profiler, and no assertion in this repository can stand in for
it.

## AC5 — `ar_start` and `ar_end`

**PASS.** Both are in the shared catalog, the database CHECK, the mobile SDK and
`docs/analytics-events.md`, and the drift test inserts one of each.

`ar_start` carries an **outcome** — `started`, `unsupported` or
`permission_denied` — because a low start count means something different when
devices could not run the experience than when people chose not to. `ar_end`
carries the duration, clamped to the contract's hour: a session left open
overnight is not an hour of looking at a coin.

**The end is reported once.** Exiting and then disposing would otherwise count
one session twice and halve every average built on it — asserted directly.

### A defect found and fixed

Emitting `ar_end` from `dispose()` read a Riverpod provider after the element
was detached, so every ordinary exit printed
`analytics_emit_failed event=ar_end reason=unexpected`. The SDK reference is now
taken while the screen is still mounted. The full Flutter run contains **no**
`analytics_emit_failed` line.

## Test evidence

| Suite | Result |
| --- | --- |
| `flutter test` | 725 passed, 1 skipped (9 new AR-1 widget tests) |
| backend jest `--runInBand` | 113 suites passed, 1002 tests, 2 suites / 48 tests skipped |
| `packages/contracts` vitest | 23 files, 377 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` warnings |

Migration `20260903080000_ar1_ar_events`, applied to all four local databases.

## Not proven in this environment

- The animation rendering in a live camera session.
- Memory across ten cycles on real hardware.
- The device matrix the definition of done asks for.

All three need the approved AR plugin and physical devices. Everything that does
not depend on them is implemented and asserted.
