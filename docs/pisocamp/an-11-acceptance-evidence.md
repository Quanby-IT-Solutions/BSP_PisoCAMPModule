# AN-11 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `c7246e6` (AN-10)
Ticket: AN-11 — Install volume and store ratings consolidation

## Result

All three AN-11 acceptance criteria are **PASS**.

## What AN-11 adds

| Layer | Surface |
| --- | --- |
| Schema | `store_metric_import`; the `first_open` catalog event |
| Contract | `AcquisitionSummarySchema`, `ImportStoreMetricsInputSchema` |
| Backend | `AcquisitionService`; `GET /analytics/acquisition`, `POST /monitoring/store-metrics` |
| Mobile | `first_open`, claimed once per install |
| Web | `/pisocamp/acquisition`, with the CSV import form |
| Docs | The store import in `an-7-monitoring-interface.md`; the event catalog |

Migration `20260903050000_an11_store_metrics`, applied to all four local
databases.

## AC1 — install volume, labelled and not double-counted

**PASS**, and the two figures are deliberately kept apart:

- **A store counts downloads.** Imported per store and period.
- **`first_open` counts devices that opened the module.** Emitted once per
  install and counted as **distinct devices**, so a device that reports twice is
  one install — asserted.

Adding them would count every install that was opened twice, so the report never
does. The headline names its source (`Store reports (Google Play)` or
`First opens reported by the module`), and the page says in plain words that the
two counts are not added together. Asserted at both levels, including that the
sum never appears.

**With no store report the module's own count is the headline**; with neither,
the report says there is no install data rather than showing a zero. Both
asserted.

**Re-importing a store's period replaces it** rather than adding to it, and the
response says how many periods were replaced — a retried upload cannot double an
install count. A period that only half overlaps the range is left out.

Every import is audited (`pisocamp` / `store_metrics.import`).

## AC2 — store ratings beside the in-app ones

**PASS.** In-app average and count, store average and count, and a combined
average all display.

**The combined average is weighted by how many ratings each side has.** An
average of two averages would let two in-app answers weigh as much as a hundred
store ratings; asserted with exactly that shape (4.4 over 100 store ratings
beside 4 over 2 in-app answers reads 4.39, not 4.2).

Two stores are weighted by their own counts, not averaged blindly — asserted.

A store period with installs but **no rating** stays out of the rating average
entirely: an empty rating column is a period the store reported no rating for,
not a rating of zero.

**Nobody rated reads as null, not zero**, on all three figures.

## AN-6's seam, now closed

AN-6 shipped `storeRatingsAvailable: false` with a note that it was AN-11's to
fill. It now reports the truth: false until a store rating covering the range
has been imported, true afterwards. Both directions asserted in the AN-11
backend suite, and the survey dashboard's "In-app answers only" notice follows
it.

## AC3 — permission, both ways

**PASS**, and, as with AN-7, reading and importing are different permissions:

- The figures are gated on `reports.dashboards.view`;
  `analytics.authorization.spec.ts` proves both branches for
  `AnalyticsController.acquisition` with a single handler-targeted
  `permission_denied` audit.
- The store import is gated on `admin.integrations.manage`;
  `monitoring.authorization.spec.ts` proves both branches for
  `MonitoringController.importStoreMetrics`, with the denied user holding
  `reports.dashboards.view` — being allowed to read a report is no reason to be
  allowed to write one.

## The upload form

The page accepts the store's CSV export — file or pasted — with the header
`source,periodStart,periodEnd,installs,uninstalls,ratingAverage,ratingCount`.
Parsing lives in an exported function so its rules are tested on their own: a
silent mis-parse would put a wrong install count in front of somebody as though
the store had said it. A wrong header, a short line, a non-numeric value and an
unknown store are each refused **before** anything is sent, and the message
names the line.

## Browser validation

`an11-acquisition.authenticated.spec.ts` — **7 passed**: the page names the
source of its install figure and says the counts are not added together; a
malformed paste is refused with the reason; a good report imports and appears in
the per-store table; no horizontal overflow at 320 px with 44 px date fields;
and a user without `reports.dashboards.view` is redirected.

`an2-engagement.authenticated.spec.ts` — **11 passed** afterwards.

## Test evidence

| Suite | Result |
| --- | --- |
| backend jest `--runInBand` | 108 suites, 956 passed, 48 skipped |
| `flutter test` | 710 passed, 1 skipped |
| `apps/web` vitest | 53 files, 485 passed |
| `packages/contracts` vitest | 23 files, 377 passed |
| `packages/e2e-web` Playwright | 7 + 11 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The API log carries no error-level line; every `/analytics/acquisition` and
`/monitoring/store-metrics` request answered 200.

One full backend run failed `pisocamp-consent.idempotency.spec.ts` on a
`beforeAll` hook timeout while the Flutter and web suites were running beside
it; that spec creates and drops its own database and passes on its own. Same
class of load flake as the one noted in AN-7, not an AN-11 regression.

## Shared code reused, not duplicated

- The range control, again, rather than a fourth copy.
- The same import shape as AN-7's monitoring interface: replace-on-re-import,
  audited, `admin.integrations.manage`, documented in the same §12 file.
- The in-app rating average is read from EV-2's stored answers with the same
  rule AN-6 uses — one definition of "an in-app rating".
- The mobile event goes through the existing SDK, queue and envelope
  validation; only the intent is new.

## Notes

- The AN-6 browser case no longer asserts the "In-app answers only" notice,
  because whether it appears now depends on whether a store rating has been
  imported for that range. Both states are asserted where they can be arranged:
  the component test and the AN-11 backend suite.
- **Double-counting is avoided "where feasible"**, as the ticket puts it: with
  no shared identifier between a store download and a device, the honest thing
  is to report both counts and name each, which is what this does.
