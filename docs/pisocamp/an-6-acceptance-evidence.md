# AN-6 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `0aeb8b5` (AN-5)
Ticket: AN-6 — Evaluation, ratings and NPS metrics

## Result

All four AN-6 acceptance criteria are **PASS**.

## What AN-6 adds

| Layer | Surface |
| --- | --- |
| Contract | `SurveyMetricsSummarySchema`; `GET /admin/pisocamp/analytics/surveys` |
| Backend | `SurveyMetricsService` |
| Web | A Surveys section on `/pisocamp/engagement` |

No new table and no new column. Everything is read from EV-2's
`survey_response` and `survey_answer`, F4's `consent_record` and AN-1's
`analytics_event`.

## AC1 — per survey and period, with NPS from the answers

**PASS.** For each survey answered in the range the report gives prompts shown,
declines, responses, completion rate, average rating, per-question answered and
skipped counts, the average of each scaled question, its full distribution, and
NPS where the question is an NPS question.

**NPS is percent promoters minus percent detractors**, using the promoter and
passive thresholds stored on the question itself rather than numbers written
again here. Asserted twice: a one-each spread reads 0, and a 2/1/1 spread reads
50 − 25 = **25**.

**A distribution carries every point on the question's scale**, including the
ones nobody chose — asserted on a 1–5 rating where two values have no answers
and still appear. A missing bar reads as a value that could not be picked,
which is a different claim from one nobody picked.

**Skips are not answers.** A skipped question is counted as skipped and left out
of the average — asserted directly.

Responses submitted outside the range are left out, and the range is bounded on
Asia/Manila days like every other analytics surface.

**A question is reported against the version people actually answered.** A
survey that has been through draft, submitted and approved has a set of
questions per version; reporting all of them would show empty duplicates of
every question. Only the versions named by the responses in range are reported.

## AC2 — the counts match the stored responses exactly

**PASS**, and asserted by counting the tables in the test itself rather than
against numbers typed twice: `summary.totalResponses` is compared with
`select count(*) from survey_response`, and the answered figures with
`select count(*) from survey_answer where skipped is false`.

That is EV-005's requirement in the only form that means anything — the report
and the store agree because the report is built from the store.

**Consent status is reported, not assumed.** Every response names the grant it
rests on. A grant that has since been withdrawn does not delete the response, so
the report says how many of the responses it counted rest on a withdrawn
consent, at the summary and per survey. Asserted with one of each.

Prompts shown and declines come from the events, because a prompt nobody
answered leaves no response behind. An event names its survey by the logical id
the bundle gave it; the report resolves that with **the renderer's own rule**,
exported from `bundle-renderer.ts` so the mapping exists once. A prompt whose
logical id names something else is ignored — asserted.

## AC3 — store ratings are AN-11's

**PASS.** AN-11 is out of scope for this ticket and is not yet built, so
`storeRatingsAvailable` is false and the dashboard says "In-app answers only"
rather than presenting the in-app half as a consolidated figure. Calling it
consolidated would be a claim about data this build has never seen. When AN-11
lands, the flag is the seam it fills.

## AC4 — permission, both ways

**PASS**, on the same `reports.dashboards.view` through the shared `RbacGuard`.
`analytics.authorization.spec.ts` proves both branches: a holder reaches
`AnalyticsController.surveys`; a registered user without it is refused **403**
and exactly one `permission_denied` audit is written, targeted at
`handler` / `AnalyticsController.surveys`.

## Reading a zero honestly

An NPS of 0 means the promoters and the detractors cancelled out. Silence means
nobody answered. They are different, so the score and the averages are **null**
when there is nothing to average, and both the API and the screen say "No
answers yet" instead of printing a 0.

## Browser validation

`an2-engagement.authenticated.spec.ts` — the AN-6 case signs in as a holder,
finds the Surveys section with its headline figures and the in-app-only notice.
Console, page errors, failed requests and 4xx/5xx responses all asserted empty.

## Test evidence

| Suite | Result |
| --- | --- |
| backend jest `--runInBand` | 104 suites, 909 passed, 48 skipped, 2 suites skipped |
| `apps/web` vitest | 50 files, 459 passed |
| `packages/contracts` vitest | 23 files, 377 passed |
| `packages/e2e-web` Playwright | 11 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The API log carries no error-level line; every
`/admin/pisocamp/analytics/surveys` request answered 200. The only non-2xx are
the deliberate 403s from the permission case and better-auth's own sign-in rate
limit, which the sign-in fixture retries.

## Notes

- The backend suite is run against `an1_task3_backend_test`, which two AN-1
  specs assert by name.
- Shared code reused rather than copied: the Manila-day range handling from the
  sibling analytics services, `RbacGuard` and `AuditService` for the permission,
  EV-2's content and workflow services to build the fixture survey, and the
  bundle renderer's logical-id rule for mapping an event back to its survey.
