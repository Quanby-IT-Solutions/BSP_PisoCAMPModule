# AN-8 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `8a95050` (AN-4)
Ticket: AN-8 — Parameter-driven historical report with filters

## Result

All five AN-8 acceptance criteria are **PASS**.

## What AN-8 adds

| Layer | Surface |
| --- | --- |
| Contract | `REPORT_DEFINITIONS` (the registry), `REPORT_FILTER_KEYS` (§4.2-K's approved list), `ReportFiltersSchema`, `ReportResultSchema`, `ReportRunSchema`; `GET /admin/pisocamp/reports/definitions`, `POST .../runs`, `GET .../runs` |
| Database | `report_definition`, `report_run` |
| Backend | `ReportService`, `ActivityService`, the event filter engine — all behind `reports.reports.generate` |
| Web | `/pisocamp/reports` |

## AC1 — parameters and filters from the approved list

**PASS.** A run carries its generation date, the parameters, the period and the
data source, and the screen prints all four above the figures. Asserted in the
backend spec and in the browser.

The filter engine narrows `analytics_event` by app version, feature, user type,
device, OS and activity type. Two people on different operating systems, one
`os` filter: one event, not two. Asserted.

**A filter a report cannot apply is refused by name.** Asking `engagement` to
filter by app version returns "Engagement cannot filter by appVersion" rather
than running unfiltered — a report that quietly dropped a filter would answer a
different question from the one asked, under the name of the one asked. The
screen only offers the filters the chosen definition declares, so the refusal is
a backstop rather than the normal path.

## AC2 — a historical report keeps saying what it said

**PASS.** The result is **stored on the run**, not recomputed on read. A late
upload landing for a day a report already covered does not change that report:
asserted by inserting an event after generation and re-reading the run.

Generation is idempotent on the client-minted run id, as RF-2 is everywhere
else: a replay after a lost response returns the first run, and the table still
holds one row. Asserted.

Every underlying query is bounded by the report end (AN-2, AN-3 and AN-4 each
already were), so a past range is reproducible.

## AC3 — a new KPI registers as a definition

**PASS.** The registry is a list in `@repo/contracts`. Nothing in the running,
recording, auditing or listing of a report names a definition — the only place
that does is the runner map, one line per KPI beside its registry entry.

The claim is demonstrated rather than described: **`activity` is a new KPI added
with the framework** — event volume by name and by day — and it needed a registry
row, a result shape and a query. The spec runs every registered definition
through the same path and checks each returns figures tagged with its own key.

A contract test checks each definition only claims filters from the approved
list, and never claims a demographic one.

## AC4 — a run and an audit entry are written

**PASS.** One `report_run` row and one `report.generate` audit entry, in one
transaction, naming the definition, period, filters and whether the report was
withheld. Asserted, including that a refused generation writes **neither**.

## AC5 — 403 and an audit entry without `reports.reports.generate`

**PASS.** Both branches on all three handlers. The denied user deliberately
holds `reports.dashboards.view`: being allowed to read a dashboard is not being
allowed to generate a report, and denying somebody with no permissions at all
would not have shown that. Each denial writes exactly one `permission_denied`
row naming the handler. A deactivated holder is refused at 401 before the
permission is reached (RF-4), and the browser run adds the page redirect.

## Demographic filters

The ticket puts demographic cuts out of scope and notes they need AN-10's
consent scoping. AN-8 therefore **accepts them in the contract and withholds the
report**: the run is recorded and audited with `suppressed: true`, a reason
naming AN-10 and no figures, and a database CHECK makes "withheld with a reason
and no figures" and "computed with figures and no reason" the only two shapes a
row can take. The screen offers no demographic filter at all.

A demographic cut of people who never consented to demographic analytics is
precisely the report F4 exists to prevent, so returning one unscoped was not an
option, and silently ignoring the filter would have mislabelled an unfiltered
report.

## Browser validation

`an8-reports.authenticated.spec.ts` — **8 passed**: every registered report is
offered with its data source; generating one shows what produced it and the run
appears in the history; no demographic filter is offered; a backwards range is
refused with a visible message; the page has no horizontal overflow at 320 px
and its controls are keyboard-focusable at 44 px; and a user without the
permission is redirected. Console, page errors, failed requests and error
responses asserted clean in every case.

The backend log shows no error-level line and no failure from the reports
endpoints; the only 403s are the deliberate denials under test.

## Defects found and fixed during validation

- **The run history 400'd on every page load.** `limit` was declared as
  `z.number()`, but the history is fetched over GET and a query string carries
  text. Fixed to `z.coerce.number()`, matching the paging schemas already in the
  repo, with a contract test that parses `"20"`.
- **The registry sync made the whole API's boot depend on the database.** It
  was an `onModuleInit` upsert; when PostgreSQL was briefly unavailable the
  entire service failed to start rather than starting and serving everything
  that does not need that table. The definition row is now written when a report
  is run, inside the same transaction as the run, so the foreign key is still
  satisfied and start-up has nothing to do.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 23 files, 364 tests passed (+18) |
| backend jest `--runInBand` | 89 suites, 775 passed, 48 skipped (+18) |
| `web` vitest | 45 files, 406 passed (+9) |
| `packages/e2e-web` Playwright | 8 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

## Notes

- **The key-action list and the report registry both live in the contract.**
  SA-3 asks for a configuration screen covering every key including the
  key-action list; AN-8's registry is the natural neighbour of that work.
- Exports are AN-9, which reads `report_run.result` rather than re-running the
  query — the reason the result is stored.
- The turbopack production build still fails on this machine
  (`failed to create junction point`), identically at `ed43844` with the work
  stashed; the browser validation used `next build --webpack`.
