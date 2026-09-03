# SA-4 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `5c1cf9a` (SA-3)
Ticket: SA-4 — Administrative audit log viewer

## Result

All four SA-4 acceptance criteria are **PASS**.

## What SA-4 adds

| Layer | Surface |
| --- | --- |
| Contract | Filters on `ListAuditLogRequestSchema`; `GET /admin/pisocamp/audit`; the `audit` report definition |
| Backend | `AuditService.list` gains the filters; `PisoCampAuditViewerController` behind `admin.audit.view` |
| Web | `/pisocamp/audit` |

## What was reused rather than rebuilt

**The query is `AuditService.list`** — the audit domain's own — extended with
the filters rather than copied. A second reader of `audit_log` that could
disagree with the first is not something an audit trail should have.

**The export is AN-9's.** The audit log is registered as a report definition, so
the file goes out through the same three renderers as every other report, and
the export is recorded by AN-9's own `report.export` entry. A second export
mechanism for the trail would have been a second thing to get right, and a
second thing to remember to audit.

The filter builder sits **outside** the service class: a guard test asserts the
audit service's prototype exposes nothing but `record` and `list`, because a log
the application can rewrite is not evidence. That test stays exactly as strict.

## AC1 — entries show actor, action, target, before/after and timestamp

**PASS.** Every field is carried and shown, with the actor resolved to an email
address where the account still exists and falling back to the id where it does
not — an entry outlives the account that produced it, by design.

The two kinds the ticket names by name are included and asserted: **permission
denials** and **report generations**. A refusal nobody can see is not evidence,
and the viewer marks a denial as denied rather than letting it read as a success.

Newest first, ordered by id: two rows written in one transaction share a
timestamp, and only the id totally orders them.

## AC2 — filters narrow, and results paginate

**PASS**, for each filter and in combination:

| Filter | Asserted |
| --- | --- |
| actor | only that actor's entries |
| action | only that action |
| target type | only that kind of target |
| date range | Asia/Manila days, **inclusive of both ends** |

The date range needed care: `created_at` stores UTC, so a Manila day runs from
16:00 the previous day, and "the 3rd to the 3rd" means that whole day. The upper
bound is the start of the following day — an upper bound at the start of `to`
would have meant nothing at all. Asserted with an entry at 16:30 UTC on the 2nd,
which is the 3rd in Manila.

Paging is by cursor, which is stable under concurrent appends in a way OFFSET is
not, and is asserted not to repeat or lose an entry. An empty result says so.

**Every filter is optional**, so the unfiltered page every existing caller asks
for — including `/rbac/audit-log` — is the same page it always was.

## AC3 — an export goes through AN-9 and is itself audited

**PASS**, end to end in the browser: the viewer prepares an `audit` report over
the filters on screen, the Excel link downloads a real `.xlsx`, and filtering
the trail by `report.export` immediately afterwards shows the entry that export
just created.

The report says whether it is complete: more matches than one report carries is
stated rather than silently truncated, because a truncated trail that claimed to
be whole would be read as "that is everything that happened".

## AC4 — 403 and an audit entry without `admin.audit.view`

**PASS.** Both branches, with the denial recorded **in the trail the viewer
shows**. The denied user deliberately holds `admin.accounts.manage`: being
trusted to lock somebody out is not being trusted to read the record of who else
did. A deactivated auditor is refused at 401 before the permission is reached.

The browser run adds the redirect and a direct 403 from the endpoint.

## Browser validation

`sa4-audit.authenticated.spec.ts` — **8 passed**: the columns and entries; a
filter narrowing to denials; an empty result stated plainly; the export
round-trip landing back in the trail; no horizontal overflow at 320 px with 44 px
controls; and the viewer refused to a user without the permission. Console, page
errors, failed requests and error responses asserted clean.

## A defect found in validation

`Date.now()` was being read during render to default the export's date range.
Besides being a rule violation the linter catches, it was wrong: the range
somebody means by "today" is the day they press the button, not the day the
page happened to render. It is read in the handler now.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 23 files, 377 tests passed |
| backend jest `--runInBand` | 96 suites, 841 passed, 48 skipped (+17) |
| `web` vitest | 48 files, 442 passed (+10) |
| `packages/e2e-web` Playwright | 8 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The server log carries no error-level line; the only 4xx are the deliberate
denials under test.

## Notes

- **The audit filters are SA-4's, not §4.2-K's.** `actor` and `targetType` were
  added to the report filter list for the audit definition alone — §3.6 is the
  authority for them — and only that definition declares them, so no KPI report
  can claim a filter it cannot apply.
- SIEM forwarding stays out of scope, as the ticket says.
