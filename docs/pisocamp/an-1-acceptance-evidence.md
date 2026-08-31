# AN-1 acceptance evidence

- Date: 2026-08-31
- Repository: `D:\PROJECTS\BSP_PisoCAMPModule`
- Verification branch and starting HEAD: `dev` / `af77a632c46fb7e2dcbb0addbb7b37de3698e44a`

## Outcome

AN-1 passes all five ticket acceptance criteria and risky flow RF-2 against a dedicated PostgreSQL authority, a composed NestJS application, a real authenticated Chromium browser, and a Pixel 9a Android emulator. The acceptance run found a real offline catalog hang that unit/widget tests had masked. A RED regression reproduced the installed-valid-bundle/offline sequence; the pinned catalog now opens the same verified snapshot through the direct read seam while the activation stream remains unchanged. The fixed APK then passed the original offline list/detail procedure. Independent review subsequently found and closed complete-envelope privacy, transient queue-read retention, and exact staging-manifest gaps under RED/GREEN tests.

No account identity, event identifier, session identifier, pseudonym, local path, payload, or credential is copied into this document or its committed artifacts. Detailed local runtime evidence remains under the ignored `.superpowers/sdd/2026-08-30-an-1-analytics-event-pipeline/` directory.

## Acceptance matrix

| Criterion                                                                                                                                                   | Owning implementation and test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Reproducible proof                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Result and captured evidence                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC 1 — an emitted event is assigned a UUID and complete closed metadata, then written to an encrypted local queue                                           | [`analytics_event.dart`](../../apps/mobile/lib/features/pisocamp/data/analytics_event.dart), [`encrypted_analytics_queue.dart`](../../apps/mobile/lib/features/pisocamp/data/encrypted_analytics_queue.dart), [`analytics_provider.dart`](../../apps/mobile/lib/features/pisocamp/presentation/providers/analytics_provider.dart), [`analytics_event_test.dart`](../../apps/mobile/test/features/pisocamp/data/analytics_event_test.dart), and [`encrypted_analytics_queue_test.dart`](../../apps/mobile/test/features/pisocamp/data/encrypted_analytics_queue_test.dart) | From `apps/mobile`: run the exact shared-fixture parser test, then `flutter test test/features/pisocamp/data/encrypted_analytics_queue_test.dart test/features/pisocamp/data/analytics_sync_controller_test.dart test/features/pisocamp/presentation/pisocamp_home_screen_test.dart test/features/pisocamp/presentation/currency_screens_test.dart`. On the AVD, enter Piso CAMP offline and scan concatenated queue ciphertext for catalog/common-field/content sentinels. | **PASS.** Shared Dart fixture 1/1; pre-live queue/lifecycle/UI slice 86/86. Three encrypted files were created while offline and the ciphertext scan returned zero matches. Live-acceptance APK SHA-256: `64810B8FC4A79AC7B6336FA1F03432BE0D270A25CEC5E94113E41EC221E2A2DD`; final post-review Task 10 APK SHA-256: `1ED1535EB3D5F5F207F99CC4916FC2BFDB54BA115D028F05792E6DBA7BF38345`. |
| AC 2 — connectivity uploads bounded batches, PostgreSQL inserts on unique `event_id`, acknowledges submitted IDs, and the client deletes acknowledged files | [`analytics.service.ts`](../../apps/backend/src/modules/v1/pisocamp/analytics/analytics.service.ts), [`analytics_sync_controller.dart`](../../apps/mobile/lib/features/pisocamp/data/analytics_sync_controller.dart), [`analytics.idempotency.spec.ts`](../../apps/backend/src/modules/v1/pisocamp/analytics/analytics.idempotency.spec.ts), and [`analytics_sync_controller_test.dart`](../../apps/mobile/test/features/pisocamp/data/analytics_sync_controller_test.dart)                                                                                               | Run `pnpm --filter @repo/backend test -- analytics.idempotency.spec.ts --runInBand` with the Task 9 database variables. On the AVD, restore connectivity after the offline emission and compare queue/database counts without recording IDs.                                                                                                                                                                                                                                | **PASS.** PostgreSQL idempotency 3/3. The live queue changed 3 → 0 only after acknowledgement while the database changed 0 → 3. Partial-ack tests prove only acknowledged filenames are deleted. Final live state was queue 0 and database 14 total / 14 distinct.                                                                                                                      |
| AC 3 — timeout after server commit followed by resend creates no duplicate row                                                                              | [`analytics.service.ts`](../../apps/backend/src/modules/v1/pisocamp/analytics/analytics.service.ts), [`analytics.idempotency.spec.ts`](../../apps/backend/src/modules/v1/pisocamp/analytics/analytics.idempotency.spec.ts), [`analytics.e2e-spec.ts`](../../apps/backend/test/analytics.e2e-spec.ts), and [`analytics_sync_controller_test.dart`](../../apps/mobile/test/features/pisocamp/data/analytics_sync_controller_test.dart)                                                                                                                                      | Run the PostgreSQL idempotency suite and composed HTTP suite. On the AVD, delay the HTTP response, wait until PostgreSQL records one row while the encrypted file remains, force-stop, relaunch, remove delay, reconnect, and compare total/distinct counts.                                                                                                                                                                                                                | **PASS.** The retained event reached row count one before force-stop. Relaunch retained and resent it; acknowledgement drained queue 2 → 0 while the database remained 9 total / 9 distinct. The composed HTTP suite passed 9/9 and verifies identical acknowledgements plus one immutable row across transport-loss replay.                                                            |
| AC 4 — email, name, or raw-image payloads are rejected and only a safe development diagnostic is emitted                                                    | [`analytics.schema.ts`](../../packages/contracts/src/modules/v1/pisocamp/analytics.schema.ts), [`analytics.schema.test.ts`](../../packages/contracts/src/modules/v1/pisocamp/analytics.schema.test.ts), [`analytics_event.dart`](../../apps/mobile/lib/features/pisocamp/data/analytics_event.dart), and [`analytics.e2e-spec.ts`](../../apps/backend/test/analytics.e2e-spec.ts)                                                                                                                                                                                         | Run `pnpm --filter @repo/contracts test -- analytics.schema.test.ts` and the composed HTTP suite. Run the required privacy/log scans listed below and inspect every hit.                                                                                                                                                                                                                                                                                                    | **PASS.** TypeScript fixture/schema 11/11. Dart parser uses the same committed bytes. Email/name/`data:image`/byte-array cases fail closed. Rejected HTTP bodies and captured Pino output contain none of the seeded payload, credential, identifier, or path sentinels. The sole mobile diagnostic logs only allowlisted event name plus normalized failure code.                      |
| AC 5 — an authorized registered dashboard user sees today's Manila `module_entry` count                                                                     | [`analytics.service.ts`](../../apps/backend/src/modules/v1/pisocamp/analytics/analytics.service.ts), [`module-entry-today-tile.tsx`](../../apps/web/features/analytics/components/module-entry-today-tile.tsx), [`dashboard-overview.tsx`](../../apps/web/features/dashboard/components/dashboard-overview.tsx), and [`an1-dashboard.authenticated.spec.ts`](../../packages/e2e-web/tests/an1-dashboard.authenticated.spec.ts)                                                                                                                                            | Start backend/web on the Task 9 database with an origin-aligned public API URL, then run the exact Playwright command below.                                                                                                                                                                                                                                                                                                                                                | **PASS.** Three consecutive unchanged four-worker runs passed 18/18. The authorized path made exactly one successful protected analytics request and rendered only the Manila date/count aggregate. The denied fixture made zero analytics requests and mounted no tile.                                                                                                                |
| RF-2 — encrypted offline queue → unique-key ingestion → acknowledgement → deletion; timeout-after-commit resend remains exactly once                        | All AC 1–3 owners plus the database unique constraint in [`schema.ts`](../../packages/db/src/schema.ts) and migration [`migration.sql`](../../packages/db/src/migrations/20260830120000_an1_analytics_event_pipeline/migration.sql)                                                                                                                                                                                                                                                                                                                                       | Run the migration, PostgreSQL idempotency, composed HTTP, real-filesystem queue/sync, and AVD response-loss procedures in this document.                                                                                                                                                                                                                                                                                                                                    | **PASS.** Migration 5/5 with no skips; idempotency 3/3; HTTP 9/9; queue/lifecycle slice 86/86; live retained-file replay produced one row and deletion only after acknowledgement. Uniqueness—not a pre-read—is the race authority.                                                                                                                                                     |

## Disposable PostgreSQL authority

The verification processes used only the following dedicated authority. The older AN-1 Task 2 container on port 55460 was preserved and was not substituted for this database.

| Field                  | Value                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Container              | `pisocamp-an1-postgres`                                                                          |
| Container ID           | `0509140139a223ebe919f537d61c93f9b08583fa20622246b0f195cdcf498ac6`                               |
| Labels                 | `pisocamp.ticket=AN-1`, `pisocamp.purpose=task9-acceptance`                                      |
| Image / image digest   | `postgres:17-alpine` / `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73` |
| PostgreSQL             | 17.11                                                                                            |
| Host mapping           | `127.0.0.1:55440 -> 5432/tcp`                                                                    |
| Database               | `pisocamp_an1_test`                                                                              |
| Migrations             | 13 rows in `drizzle.__drizzle_migrations`                                                        |
| Final acceptance state | running and recoverable for independent review                                                   |

Credentials used by the disposable process are intentionally omitted. Reproduction uses the plan's `docker run`, `pnpm --filter @repo/db migrate`, and `pnpm --filter @repo/db seed -- --force-password` commands with local test values.

Authority hashes:

- shared cross-language fixture: `7CB75F7A50B9BDF4C2D77FD4B1578976A5CF283C32A5E500B0A6F0DBEF85E192`;
- AN-1 migration: `5CD04717C3071155CF431FE16DD6B1C17532807E0439774C310FDAFCD3E77DFD`;
- signed bundle envelope/ETag: `93AF6423A58A76F31F13442A5892BDAE32F03B5098C0AB382BAA0617DD977249`;
- decoded bundle payload/database manifest: `2C5C6530498758AA941358E9807DA7CBEB14B4F1A1960D69CDAF62ED911E3BDF`.

## Commands and results

All database commands used `DATABASE_URL` pointing to `127.0.0.1:55440/pisocamp_an1_test`; secret values are redacted here.

```powershell
pnpm --filter @repo/contracts test -- analytics.schema.test.ts
# PASS: 1 file, 11/11

$env:RUN_AN1_TASK2_DB_MIGRATION_TESTS='true'
$env:ALLOW_DESTRUCTIVE_DATABASE_TESTS='true'
$env:AN1_TASK2_DATABASE_URL=$env:DATABASE_URL
pnpm --filter @repo/db test -- analytics-migration.spec.ts
# PASS: 5/5, no skips

$env:AN1_EXPECTED_DATABASE_NAME='pisocamp_an1_test'
pnpm --filter @repo/backend test -- analytics.idempotency.spec.ts --runInBand
# PASS: 3/3
pnpm --filter @repo/backend test -- analytics.authorization.spec.ts --runInBand
# PASS: 4/4
pnpm --filter @repo/backend test:e2e -- analytics.e2e-spec.ts --runInBand
# PASS: 9/9
pnpm --filter @repo/backend typecheck
# PASS
```

The exact browser command from the implementation plan ran unchanged after fixture and service-origin alignment:

```powershell
$env:BASE_URL='http://127.0.0.1:3001'
$env:E2E_AUTH_API_URL='http://127.0.0.1:3000/api/v1/auth/'
$env:E2E_NO_WEBSERVER='1'
pnpm --filter @repo/e2e-web test:e2e -- an1-dashboard.authenticated.spec.ts --project=chromium-authenticated
```

It passed 6/6 with four workers in 16.8 s, 15.7 s, and 15.3 s: 18/18 total. A separate one-worker trace run passed 6/6 in 23.8 s.

Flutter acceptance commands ran from `apps/mobile` through the exact Flutter tool snapshot:

```powershell
flutter test test/features/pisocamp/data/analytics_event_test.dart --plain-name "parses the shared contract vectors"
# PASS: 1/1

flutter test test/features/pisocamp/data/encrypted_analytics_queue_test.dart test/features/pisocamp/data/analytics_sync_controller_test.dart test/features/pisocamp/presentation/pisocamp_home_screen_test.dart test/features/pisocamp/presentation/currency_screens_test.dart
# PASS: 86/86 before live work

flutter test
# PASS: 322/322 after the offline-catalog and review fixes

flutter analyze
# Exit 1: 48 existing repository-baseline findings; zero findings in the one-line fix or new regression
```

## Authorization and account-state branches

- Reports & Analytics permission: HTTP 200 and aggregate-only response.
- Registered user without `reports.dashboards.view`: HTTP 403 and exactly one `permission_denied` audit targeting `AnalyticsController.moduleEntryToday`.
- Unauthenticated and deactivated identities: HTTP 401 before permission auditing.
- Browser denied path: no query-owning child, no tile, and exactly zero protected analytics requests.
- The denied fixture retained eight unrelated baseline admin permissions and exactly zero reports permission, preventing unrelated dashboard calls from confounding the denial proof.

## Browser accessibility, responsive layout, and runtime privacy

The real Chromium suite proves:

- a named region and heading, semantic `<time>`, polite live status/count, labelled retry, and visible keyboard focus;
- keyboard-only retry from generic error to success;
- 320 CSS-pixel viewport at 200% root text with no document overflow and no clipped role badges;
- numeric-zero, pending/loading, generic error, recovery, and success states;
- no raw server-body sentinel in DOM or captured runtime;
- no console error/warning, page error, or failed request in clean asserted windows.

The first concurrent diagnostic run captured one React hydration-ID warning before the service host and fixtures were made identical to the planned authority. That failure was preserved rather than discarded. After correcting only disposable fixtures and the web public API origin, the unchanged four-worker command passed three consecutive times with no hydration warning; no serialization workaround was added.

Ignored browser evidence hashes include:

- authorized live screenshot after the 320-pixel/200%-text assertions: `BB19FB1E1EA17B15FD3DB94FEE33576B761166F003D926DFA7312D62FEFFFA96`;
- denied screenshot: `92375060F27829AAA3ABCB64F76785FCC48134928C34BB6CB56E2B8CB205D8BF`;
- preserved hydration diagnostic screenshot/context: `A544562B0D4EA49D5D949EBE541690004E688F38356134AF55EF4DF67B032376` / `A80F824CB94530AEEB81F493191FA28CCE22D1271B42824318E2808CF4C08EF7`.

The complete screenshot, trace, database, and final gate inventory is recorded in the ignored full-stack report whose final SHA-256 is `47EBEED66B6D93DD6C20DB51C18CC7EDCA684CD70A0F16ED184C001095DD6C39`.

## Android lifecycle and offline UI evidence

Device: Pixel 9a AVD, Android 16 / API 36, x86_64, emulator-5554.

The original trusted build installed a valid bundle but remained at `Opening saved content…` for more than 20 minutes while offline. The preserved screenshot/XML/log proved the failure and contained no Flutter exception. The RED regression then isolated `activeCurrencyCatalogProvider.future` as the only unresolved stage when no independent stream listener existed. The one-shot projection now opens the verified snapshot through `activeCurrencyCatalogReadProvider`; affected suites passed 64/64 and the full suite passed 308/308 at the live-device checkpoint.

With the fixed APK, a fresh install reprovisioned 36 store files, two ready manifests, and one active pointer. After Wi-Fi disable, force-stop, and explicit relaunch:

- Piso CAMP remained usable and displayed Offline;
- Banknotes displayed `Offline — showing saved content`, five series, and all 15 saved banknotes;
- the first denomination detail displayed title, summary, verified neutral image, body, and safe BSP HTTPS source;
- app-only logs contained zero fatal/unhandled patterns and zero analytics payload/catalog sentinels.

Observation window: 2026-08-31 00:56:29–00:56:59 UTC / 08:56:29–08:56:59 Asia/Manila.

Ignored Android artifact hashes:

- fixed detail screenshot: `253F0DBBB8446DFABB9EB0B2EE2C569C79804F46DF59CA1A7B9C4B8AC8AF3901`;
- fixed list XML: `1BEA81B7D46ADA1696E53B822DA4C18DE9E50C17CC52B96D80E513A6C5A0B797`;
- fixed detail XML: `08D7D77A416F32A9FAF3BC405B7BEFDCBBB17054436C8A5633B132CE82E0DE03`;
- fixed app-only log: `902CC31E75B26467FC0508B2C0F154F8EA3025563D6AF2569BC6BA923F736F98`;
- original blocked screenshot/XML: `5CC6215896DED73FEC1273FC45398BB54A367C7A66EF603086FEC10D7822EC10` / `CFA6DFC42C41A53D998B8A555D9F6C84EA82DFEA85B453C51F0DF177C04EB149`.

The ignored Flutter report SHA-256 is `5079E69ACA04041BB32BEF11253FB9AA1EEFF80429231FA02E032F8423D61BBC`.

## Independent review closure

Review round 1 reported zero Critical, three Important, and zero Minor findings. All three Important findings were resolved before Task 9 completion:

1. Complete-envelope privacy: TypeScript and Dart previously inspected only `properties`. RED tests proved email/data-image values were accepted in `appVersion` and `osVersion`. Both implementations now inspect forbidden values across the complete envelope while restricting forbidden-key scanning to dynamic properties, so fixed schema keys remain valid. Final contracts passed 182/182; the mobile event/queue/repository/sync/provider slice passed 90/90.
2. Transient queue reads: a RED filesystem-injection test proved catch-all quarantine could remove a valid unacknowledged event after a transient `FileSystemException`. The queue now surfaces the stable redacted `readFailed` code, retains the active file, and successfully rereads it later. Confirmed envelope/authentication/UTF-8/JSON/ID/validation corruption still quarantines. The full Flutter suite passed 322/322, and focused analysis found no issue in the changed files.
3. Exact staging scope: Task 10's command was audited against the working tree and replaced with an exact 61-path manifest. Programmatic comparison reported manifest 61, actual AN-1 content paths 61, missing 0, extra 0, including backend app/body-limit wiring, the shared auth configuration, and the CE-1 migration compatibility assertion updated for the later AN-1 migration.

The live-device APK hash above predates the review-only privacy and injected-I/O fixes. Its observations remain the authority for the offline catalog, signed-bundle, encryption, reconnect, and response-loss behaviors. The post-review fixes are covered by RED/GREEN focused tests, the 322-test full Flutter suite, and the mandatory fresh Task 10 APK build whose hash is recorded in AC 1. The final APK was built after every review fix; it was not reinstalled for a duplicate live procedure.

## Privacy, secret, logging, and scope scans

```powershell
rg -n -i 'email|full.?name|raw.?image|data:image|authorization|cookie|token|ip.?address|user.?agent' packages/db/src/schema.ts apps/backend/src/modules/v1/pisocamp/analytics apps/mobile/lib/features/pisocamp/data apps/mobile/lib/features/pisocamp/presentation/providers/analytics_provider.dart
rg -n 'console\.|print\(|debugPrint\(' apps/backend/src/modules/v1/pisocamp/analytics apps/web/features/analytics apps/mobile/lib/features/pisocamp
git diff --check
git status --short
```

Every broad scan hit was classified. Auth/session/profile columns are outside `analytics_event`; cancellation-token hits are transport types; email/image strings in analytics code are rejection defenses; backend email hits are test fixtures. The analytics table has no email, name, image, IP, user-agent, cookie, or token column. No production path logs bodies, identifiers, credentials, raw exceptions, or local paths. Focused secret scans of Task 9 reports/logs found no private key, database credential, auth secret, fixture password, or account identifier.

`git diff --check` passed with Windows line-ending notices only. The index remained empty throughout Task 9. Browser/backend processes were stopped after live acceptance; the exact disposable PostgreSQL container remains running and recoverable for independent review.
