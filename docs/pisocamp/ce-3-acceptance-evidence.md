# CE-3 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `9eda168` (CE-2)
Ticket: CE-3 — Zoom and pan for banknote and coin design elements

## Result

All four CE-3 acceptance criteria are **PASS**. Evidence comes from the
contract, `@repo/db`, backend (live PostgreSQL), web and Flutter suites.

The ticket's substance is BR-012, not the gesture: **second-level security
features must not reach the public.** So the rule is enforced where a bundle is
decided, not where one is displayed. A second-level feature is dropped from the
candidate list, the build says out loud that it dropped it, and a device that
somehow met one would refuse the document rather than quietly hide it. Three
independent layers, none of which trusts the next.

## What CE-3 adds

| Layer | Surface |
| --- | --- |
| Database | `feature_level`, `hotspot_x_permille`, `hotspot_y_permille` on `content_version`, with two CHECKs; migration `20260902050454_ce3_feature_level_and_hotspot` |
| Contract | `CONTENT_FEATURE_LEVELS`, `PisoCampFeatureHotspotSchema`, and both fields on the security-feature draft |
| Backend | `listPublishedBundleCandidates` returns `{ candidates, exclusions }`; `BundleBuilder` logs one warning per exclusion; the renderer carries `featureLevel` and `hotspot` to devices |
| Web | Disclosure-level select and optional hotspot inputs on the draft form; the level shown to reviewers beside what it governs |
| Mobile | `CurrencyFeatureHotspot`, strict parsing of both fields, and `ZoomableCurrencyImage` — pinch-zoom, pan, and tappable hotspots |

## AC1 — pinch-zoom and pan without pixelation at the approved limit

**PASS.** The viewer is an `InteractiveViewer` with `minScale: 1` and a maximum
that is **whichever bound comes first**:

- the approved ceiling, `kApprovedMaximumZoom = 4`; or
- the point at which the source runs out of pixels,
  `1 / (fittedScale × devicePixelRatio)`.

Past the second bound a viewer enlarges interpolation rather than revealing more
design, which is exactly what "without pixelation" forbids. The limit is a pure
function and is tested as one: a 2000 px source fitted to 400 logical px on a 3×
screen yields 1.67×; a 40,000 px source is still capped at 4×; a source already
being stretched to fit yields 1× rather than a value below the resting scale;
and a degenerate layout falls back to the approved ceiling instead of dividing
by zero.

In a widget test on a 400×800 surface at 3×, the packaged 1536 px illustration
gives `maxScale` exactly 1536/1200 = 1.28×, and `panEnabled`/`scaleEnabled` are
both on. On the wider default test surface the same image is already stretched,
and the viewer then offers **no** magnification at all — asserted, because
offering a blurry zoom would be the wrong answer.

Worth recording for later: 1.28× is not much headroom. It is the honest
consequence of a 1536 px placeholder illustration, and it is an argument for
approved artwork at a higher resolution rather than for a laxer limit.

## AC2 — tapping a hotspot shows its approved description; first level only

**PASS.**

- A hotspot is anchored in permille of the image, so it holds its place at any
  rendered size and at any zoom: the marker is an `Align` whose alignment is
  derived from the anchor, inside the transformed child. Asserted for the centre
  and for the top-left corner.
- Only features with an approved position are marked; one without a hotspot is
  left to the list below the image, and is asserted *absent* from the overlay.
- Tapping a marker reveals the feature's title, summary and approved body, and a
  Close control removes it again — asserted in both directions.
- Each marker is a 44 dp target, labelled `Security feature: <title>` for a
  screen reader and exposing its selected state.

"Only first-level features are shown" is not a filter in the viewer, because a
filter there would be the weakest possible place for it. Second-level features
are excluded from the bundle (AC3), and
`CurrencyContentDocument.parsePublished` **rejects** any published document whose
level is not `first`, any level on a non-feature, and any hotspot on either.
Eleven rejection cases are asserted, including a fractional coordinate, half a
hotspot, and one carrying an extra key.

## AC3 — a second-level item is excluded from the build, and the build says so

**PASS.** `content-feature-level.spec.ts` drives the real workflow against live
PostgreSQL:

- a first-level feature is published, appears as a candidate with its hotspot
  intact, and is rendered into the bundle document carrying both fields;
- a second-level feature is published and does **not** appear, is reported as
  `{ itemId, versionId, reason: "second_level_security_feature" }`, and — checked
  explicitly — remains `published`: it is withheld from devices, not withdrawn;
- with both present, the rendered bytes are asserted not to contain the withheld
  feature's title at all.

`bundle-builder.spec.ts` asserts one warning per exclusion, with the exact text,
and that each call passes exactly one argument — the line carries the reason and
two identifiers and cannot carry editor-supplied text alongside them.

The database enforces the same rules independently, and the tests name **which**
constraint refused each write rather than merely that something did: a security
feature with no level, a level on an advisory, a hotspot past either edge, half a
hotspot, and a hotspot on a withheld feature.

## AC4 — zoom and pan work offline

**PASS.** The viewer receives bytes that are already on the device: a
`VerifiedCurrencyImage` read from the active bundle and checked against its
manifest digest before it is decoded. The widget performs no I/O of any kind —
its only inputs are those bytes and the documents beside them — so its behaviour
cannot depend on connectivity. The whole Flutter suite runs with no network.

## A defect found while building this

Transitions copied a version's editorial fields to the next version **by hand**,
listing each column. The new columns were not in that list, so the first
`submit` of any security feature would have failed its CHECK — caught by the
first integration test written for this ticket.

The fix is not to add three lines to two lists: it is
`carriedContentFields(source)`, one place that names what a new version inherits,
spread by both the transition and the restore path. The next column added to the
content model cannot be silently dropped the same way.

## Design decisions worth recording

- **Permille, not pixels or fractions.** An integer 0–1000 is exact in JSON, in
  PostgreSQL and in Dart, survives any rendered size, and maps onto Flutter's
  −1..1 `Alignment` with one multiplication.
- **The migration backfills existing features to `first`.** They are already
  published and already shown; preserving what devices see today is a migration's
  job, and reclassifying one is an editorial act. Recorded in the migration.
- **A blank coordinate is omitted, not sent as zero.** `Number("")` is `0`, so
  the naive form would have anchored half-filled hotspots to the top-left corner.
  The form now leaves the missing half out and the schema reports it — a defect
  caught by its own test before it could ship.
- **Reviewers see the level.** An approver decides whether a feature reaches the
  public at all, so the disclosure level is shown on the review screen beside the
  series and denomination it governs.
- **The image keeps its `image: true` semantics.** CE-1's contract with a screen
  reader does not change because the region can now be magnified; the markers
  inside are separate button nodes.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 17 files, 246 tests passed |
| `@repo/db` vitest (live PostgreSQL, migration opt-in) | 16 files, 99 passed, 32 skipped |
| `@repo/backend` jest (live PostgreSQL, `--runInBand`) | 74 suites passed, 2 skipped; 627 passed, 48 skipped, 0 failed |
| `@repo/web` vitest | 40 files, 345 tests passed |
| `flutter test` | 400 passed, 1 skipped (CE-2's evidence renderer) |
| `flutter analyze` | 0 errors; 40 pre-existing infos/warnings |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

Sibling tests updated because CE-3 legitimately changed what they assert: the
published bundle document gained two keys (its frozen key-order test and its
exact-bytes test), `listPublishedBundleCandidates` now returns a pair, the
`content_version` column list grew by three, and the CM-1 migration test now
supplies a disclosure level so that the rule it is testing — a missing body — is
the only one the row breaks.

## Accessibility

Labelled select and numeric inputs with help text on the draft form; the hotspot
inputs appear only for a level that can carry one, and are cleared if the feature
is reclassified as withheld. On the device: 44 dp markers, each a labelled button
exposing its selected state; the caption is a live region; the Close control is a
48 dp target; the image region keeps its alternative text. The existing
security-feature list below the image is unchanged, so every feature — marked or
not — is still readable without touching the image at all.

## Environment note

Unchanged from CE-2: no Android or iOS device or emulator is attached, so the
gestures are exercised through `flutter test`'s gesture layer rather than by
hand.
