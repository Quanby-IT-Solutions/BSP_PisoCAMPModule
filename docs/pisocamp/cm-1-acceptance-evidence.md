# CM-1 acceptance evidence

Date: 2026-08-26 (Asia/Singapore)

## Scope proved

CM-1 adds the generic draft content aggregate, an immutable first/versioned draft model, version-scoped related links, the controlled BSP currency catalog, protected list/detail/create/edit APIs, and permission-gated responsive admin screens for all five initial content types. Assets, workflow transitions, preview, publication, and public draft delivery remain outside CM-1.

## Static verification

The completion matrix ran serially against the complete working-tree change. PostgreSQL-backed backend tests were kept serial to avoid fixture contention.

| Gate            | Command                                                 | Result                                                           |
| --------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| Contracts tests | `pnpm.cmd --filter @repo/contracts test`                | 8 files, 124 tests passed                                        |
| Database tests  | `pnpm.cmd --filter @repo/db test`                       | 10 files, 68 tests passed                                        |
| Backend tests   | `pnpm.cmd --filter @repo/backend test --runInBand`      | 43 suites, 353 tests passed, 0 skipped                           |
| Web tests       | `pnpm.cmd --filter @repo/web test`                      | 24 files, 198 tests passed                                       |
| Lint            | package `lint` for contracts, db, backend, and web      | all passed with no diagnostics                                   |
| TypeScript      | package `typecheck` for contracts, db, backend, and web | all passed                                                       |
| Contracts build | `pnpm.cmd --filter @repo/contracts build`               | passed                                                           |
| Database build  | `pnpm.cmd --filter @repo/db build`                      | passed                                                           |
| Backend build   | `pnpm.cmd --filter @repo/backend build`                 | passed; 116 files compiled, 0 issues                             |
| Web build       | `pnpm.cmd --filter @repo/web build`                     | passed; 23 pages emitted and 73 service-worker entries precached |
| Workspace       | `pnpm.cmd lint:ws`                                      | no issues found                                                  |
| Patch integrity | `git diff --check`                                      | passed; Git emitted only line-ending advisories                  |

The web build emitted the expected notice that source-map upload was skipped without `SENTRY_AUTH_TOKEN`. The backend Jest process emitted its repository-level open-handle advisory after all 353 tests passed; there were no failed or skipped tests.

## Migration and controlled catalog provenance

Acceptance used a dedicated PostgreSQL 16 container labelled `codex.task=cm1-task7-acceptance`, bound only to `127.0.0.1:55440`, with database `cm1_task7_acceptance_test`. The CM-1 migration was applied with:

```powershell
pnpm.cmd --filter @repo/db migrate
```

The command exited 0 and applied the migration journal cleanly. `pnpm.cmd db:seed -- --force-password` then exited 0 and reported 3 users, 3 credential accounts, 9 roles, 27 permissions, and 30 role-permission mappings. The catalog seed is frozen as version `BSP-CURRENCY-2026-08-25`: five series and 29 series-scoped denominations. Its records retain the BSP source URL and catalog version, and the test suite compares the TypeScript projection with migrated/seeded database rows to detect drift.

## Live HTTP and PostgreSQL acceptance

The production-built backend ran at `http://127.0.0.1:3000` against the disposable database. An ignored TypeScript runner used real Better Auth sessions, assigned an isolated test identity only `content.items.edit`, and compared database counts before and after each request.

| Scenario                         | HTTP result | Database/application invariant                                                                                 |
| -------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| Permitted create                 | 200         | Returned `draft` version 1 and appeared in authorized list and detail responses.                               |
| Permitted edit                   | 200         | Returned version 2 with the changed editor/date and new related link; version 1 remained unchanged.            |
| Invalid type shape               | 400         | Returned a field-level validation error with zero writes.                                                      |
| Mismatched catalog pair          | 400         | A denomination that does not belong to the selected series caused zero writes.                                 |
| Missing/mismatched idempotency   | 400 / 400   | Both malformed request/header relationships were rejected.                                                     |
| Exact create/edit replay         | 200 / 200   | Stored responses were replayed with no change to item, version, link, audit, or idempotency-key counts.        |
| Stale edit                       | 409         | The winning version 2 remained current and unchanged.                                                          |
| Unprivileged create/edit         | 403 / 403   | Exactly two `permission_denied`/`denied` audits were written for the isolated actor.                           |
| Deactivated stored replay        | 401         | Active-account enforcement ran before response replay.                                                         |
| Forced audit/idempotency failure | 500 / 500   | Task-owned PostgreSQL triggers forced each failure; item, version, link, audit, and key counts were unchanged. |
| Public draft route               | 404         | `GET /api/v1/pisocamp/content/:itemId` does not exist.                                                         |

The clean runner exited 0. Final disposable aggregate counts were 5 items, 10 versions, 10 links, 13 audits, and 10 idempotency keys; acceptance used per-scenario before/after baselines because earlier harness-development runs intentionally left disposable rows.

## Rendered browser acceptance

Rendered Chromium acceptance used a disposable exact-permission editor and an unprivileged account against the production-built web/backend services.

- A keyboard-operated Banknote create selected First Philippine Polymer Banknote Series / PHP 50 and returned POST 200; PostgreSQL confirmed the item and version 1.
- Edit returned PUT 200/version 2, changed `last_editor` and `date_modified`, persisted after reload, and retained the earlier immutable version.
- All five fieldsets rendered. Banknote, Coin, and Security Feature each focused the series control with `Currency series is required.` and linked ARIA state. Link focused Primary URL for missing/invalid HTTP values with `Enter a valid HTTPS URL.` Advisory focused Body with `Body is required.` Common Title validation was also focus- and ARIA-linked.
- External, internal, and topic related links were added; the topic link was reordered; all three kinds were removed; the final two-link order persisted after reload.
- An external winning update returned 200; the rendered stale save returned 409, preserved unsaved input, showed the reload warning, and `Reload Latest` loaded the winner.
- The Content navigation item was absent for the unprivileged account, and direct content/edit navigation redirected to `/dashboard`.
- Desktop 1440px and the initial mobile 390px/200% pass had no page-level horizontal overflow or framework overlay. That metric did not detect the internal Select overlap later found by independent image review; the initial mobile reflow conclusion is superseded by the corrected 390px/320px rectangle evidence below. All six controls checked in the normal edit state had unique label associations, and the service worker was active.

The clean normal/service-worker run recorded zero console warnings/errors, zero `pageerror`, zero HTTP responses at or above 400, and zero unexpected request failures. Browser navigation/RSC prefetch produced expected `net::ERR_ABORTED` cancellations only. The intentional 409 pass produced Chromium's generic failed-resource console line for that exact response and no page error or transport failure; it was classified as expected, then the separate normal pass proved a zero-error steady state.

Initial screenshots were kept outside the repository under `%TEMP%`: desktop edited/reloaded list and form, conflict warning, unprivileged redirect, validation matrix, normal desktop, and 390px/200% mobile. Independent inspection of that initial mobile image found the Select overlap that the horizontal-overflow assertion missed; the corrected captures and explicit containment checks below replace it as reflow evidence.

### Independent-review reflow correction

The first whole-diff reviewer correctly rejected the initial 390px/200% image: the longest series label crossed its fixed-height Select boundary, and the list route could truncate its h1 while masking horizontal overflow. Five regression assertions were added first and failed against the old implementation. The fix added an explicit auto-height/wrapping Select mode, opted the long authoring/list controls into it, made the list title wrap without root overflow masking, made mobile item titles semantic h2 headings, and made Search a native submit form.

Fresh Chromium then passed at 390x844 and the stricter 320x720, both at 200% text:

- `First Philippine Polymer Banknote Series`, `External URL`, and `Internal route` value rectangles were fully contained inside their trigger rectangles; Denomination began below the series trigger.
- Edit and list document widths exactly equaled their 390px/320px client widths, with zero framework overlays.
- `Piso CAMP Content` rendered in full with normal whitespace, no ellipsis, and visible root overflow behavior rather than masking.
- Each mobile result title was an h2; Enter in Search updated the URL and reset page state.
- Both viewports recorded zero console warnings/errors, `pageerror`, unexpected failed requests, or HTTP error responses.

The four corrected edit/list screenshots (`cm1-task7-reflow-{edit,list}-{390,320}-text200.png`) are outside the repository under `%TEMP%` and were directly inspected. The corrected controls grow vertically, complete text remains visible, all following labels/actions remain separate and reachable, and the list h1 is no longer truncated.

## Security, privacy, and public-surface checks

Backend stdout/stderr and built web assets were scanned for the unique live titles, summaries, bodies, external URL, internal route, task password, `better-auth.session_token`, cookies, session material, unhandled-rejection markers, stack traces, and fatal markers. None appeared. The three request-time level-40 records were the expected structured RBAC denial events (two from the clean run and one earlier harness-development denial); they contained permission/request metadata but no content or session secrets. Startup retained the known process-local Redis and legacy wildcard-conversion advisories.

`apps/web/.next` and `apps/web/public` contained none of the live draft strings or related-link values and no `/api/v1/pisocamp/content` public data route. The built admin route is present as intended, but no draft record is bundled or anonymously retrievable.

## Teardown

The exact production web process tree was stopped and port 3001 had zero listeners. Backend PID `117096` was verified as the `node dist/main.js` listener on port 3000, stopped, and port 3000 then had zero listeners. Before removal, Docker inspection verified container ID `c7b367b4a516...`, exact name `cm1-task7-acceptance-postgres`, label `codex.task=cm1-task7-acceptance`, image `postgres:16-alpine`, and only the loopback `127.0.0.1:55440` binding. The exact container was removed with `docker rm -f cm1-task7-acceptance-postgres`. Final checks found no listeners on ports 3000/3001 and no exact container, so its disposable `cm1_task7_acceptance_test` database is absent.

The reflow correction used a second isolated PostgreSQL 16 container, `cm1-task7-reflow-postgres`, labelled `codex.task=cm1-task7-reflow-acceptance`, bound only to `127.0.0.1:55441`, with database `cm1_task7_reflow_test`. After the clean scoped re-review, the exact backend/web process tree was verified and stopped, ports 3000/3001 were closed, and the exact reflow container was removed. Final checks again found zero listeners and no exact container, so the correction database is also absent.

## Independent review and residual limitations

The first independent whole-working-tree review found no backend, contract, database, security, atomicity, idempotency, privacy, or public-surface defect. It requested changes for one rendered 200%-text reflow Major and two list UX Minors. The focused RED/GREEN correction and fresh 390px/320px browser evidence are recorded above; scoped independent re-review closed all three source findings. The user subsequently approved proceeding from the foundation checkpoint.

## Post-approval commit verification

After the user approved proceeding, the full completion matrix was rerun against a third exact disposable PostgreSQL 16 database (`cm1_final_verification_test`, loopback port 55442):

- contracts: 8 files / 124 tests passed;
- database: 10 files / 68 tests passed;
- backend: 43 suites / 353 tests passed with `RUN_DB_IDEMPOTENCY_TESTS=1`, so no tests were skipped;
- web: 24 files / 198 tests passed;
- all four package lints and typechecks passed;
- contracts, database, and backend builds passed; the isolated web rebuild passed cleanly with 23 pages and 73 service-worker precache entries;
- workspace dependency lint and all CM-1 package/document formatting checks passed;
- `git diff --check` passed with line-ending advisories only.

The first ordinary backend rerun finished successfully but crossed Jest's one-second shutdown heuristic. A diagnostic rerun with `--detectOpenHandles` again passed all 353 tests, reported no open handle, and emitted no shutdown advisory. The first web build ran concurrently with the backend build and emitted transient Windows `EBUSY` standalone-copy warnings; the required isolated web rebuild completed without them. Workspace-wide Prettier still identifies unrelated pre-existing auth/tooling formatting debt, so formatting was checked and corrected only across CM-1-owned packages/files to avoid absorbing unrelated changes.

Docker inspection verified the final container ID `10b35c036126...`, exact name `cm1-final-verification-postgres`, label `codex.task=cm1-final-verification`, image `postgres:16-alpine`, and only loopback port 55442 before removal. The exact container was removed; final checks found no listeners on ports 3000/3001 and no final-verification container.
