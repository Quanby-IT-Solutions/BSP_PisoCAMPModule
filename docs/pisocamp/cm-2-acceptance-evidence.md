# CM-2 acceptance evidence

Date: 2026-09-01 (Asia/Singapore)  
Baseline: `19f963e`  
Ticket: CM-2 — Upload and attach assets to a content version

## Result

All five CM-2 acceptance criteria are **PASS**. The evidence uses the repository Playwright runner because the Browser plugin was unavailable. The run used production-built backend and web applications, real Better Auth cookies, and a dedicated loopback PostgreSQL 16 database. No branch, worktree, stage, commit, push, PR, public delivery, preview renderer, mobile renderer, 3D renderer, or AR playback was added.

## Shared protocol and limit matrix

The canonical protocol is defined at `packages/contracts/src/modules/v1/pisocamp/asset.schema.ts:3` and the cross-field cap enforcement begins at line 42. The server detects bytes and validates structure in `apps/backend/src/modules/v1/pisocamp/assets/asset-file-policy.ts:73`, rather than trusting the submitted filename or MIME type. Role compatibility is enforced at line 497.

| Family | Canonical media types                   | Allowed roles                   |       Stored cap | Runtime evidence                                                                              |
| ------ | --------------------------------------- | ------------------------------- | ---------------: | --------------------------------------------------------------------------------------------- |
| Image  | `image/png`, `image/jpeg`, `image/webp` | obverse, reverse, edge, texture | 10,485,760 bytes | Valid PNG browser upload; generated PNG/JPEG/WebP structural and cap tests                    |
| Audio  | `audio/mpeg`, `audio/aac`               | audio                           | 26,214,400 bytes | Valid MP3 browser upload; generated MP3/AAC structural and cap tests                          |
| 3D     | `model/gltf-binary`, `model/gltf+json`  | animation                       | 52,428,800 bytes | Valid GLB browser upload; GLB/GLTF structural, padding, embedded-resource, and boundary tests |
| AR     | `model/vnd.usdz+zip`                    | animation                       | 52,428,800 bytes | Valid USDZ browser upload; central/local directory, CRC, alignment, and path-safety tests     |

The independent multipart transport ceiling is 52,428,800 bytes (`asset-upload.interceptor.ts:27`). Both shipped proxies keep the normal server limit at 1 MiB and grant 51 MiB only to the exact asset endpoint (`nginx/nginx.conf:71,116` and `nginx/nginx.dev.conf:53,104`). Fresh containerized `nginx -t` checks passed for both configurations.

## AC1 — allowed upload to a draft

**PASS.** The immutable PostgreSQL model is at `packages/db/src/schema.ts:676` (`asset_object`), line 704 (`asset`), and line 741 (`version_asset`). The object store recomputes the digest, validates stored metadata, and verifies readback in `asset-object-store.ts:38`. Upload, attachment cloning, and snapshot creation are transactional in `assets.service.ts:73`; shared attachment propagation is in `version-assets.ts:51`.

Automated evidence:

- Contracts: `pnpm --filter @repo/contracts test` — 13 files, 207 tests passed.
- Live database package regression: `pnpm --filter @repo/db test` with the Task 2 destructive-test guard and dedicated database — 15 files, 91 passed, 32 intentional non-CM-2 tests skipped.
- Guarded full backend: `pnpm --filter @repo/backend exec jest --runInBand` — 65 suites passed plus 2 intentional skipped suites; 558 passed, 48 skipped, zero failed.
- Web: `pnpm --filter @repo/web test` — 33 files, 271 tests passed.
- Production Chromium: `pnpm --filter @repo/e2e-web test:e2e -- cm2-assets.authenticated.spec.ts` — 3/3 passed in 39.2 seconds (two real-session setup projects and one complete scenario).

The browser scenario used keyboard-driven upload/attach/detach/delete interactions and valid generated PNG, MP3, GLB, and USDZ bytes. It observed each role in rendered attachment state and never rendered the media itself. Final database state was 5 immutable objects, 5 assets (1 logically deleted), 16 content versions, 40 historical/current attachment rows, and 15 idempotency rows. This is intentionally cumulative acceptance state; historical attachment rows remain immutable.

## AC2 — disallowed or oversized upload

**PASS.** The bounded parser creates private random temporary files, allows exactly one `file` field, enforces the transport ceiling, replaces the body with the canonical `File`, removes raw Multer metadata, and awaits abort cleanup in `asset-upload.interceptor.ts:77`. Structural validation covers ordered/CRC-valid PNG, JPEG/WebP dimensions, MP3/AAC frames, embedded-only GLTF, aligned and length-consistent GLB chunks/padding, and safe stored USDZ entries in `asset-file-policy.ts:73-495`.

The browser supplied a MIME/byte spoof and an oversized file. It observed fixed plain-language 400 and 413 responses, retained the selected file for retry where required, focused the safe error, and found no filename, submitted MIME, temporary path, bytes, stack, or secret in public output/logs. Expected negative-console classification was exactly one 400, one 413, one 409, and the deliberately induced lost-response `net::ERR_FAILED`; there were no extra console errors, page errors, failed requests, or unexpected responses.

Boundary/unit evidence includes every canonical media type at its cap and cap-plus-one, an independent exact 50 MiB multipart acceptance plus one-byte rejection, malformed/truncated/polyglot cases, PNG missing/non-contiguous IDAT, GLB JSON/BIN padding, and USDZ CRC/alignment/local-central agreement. The application limit test and both real Nginx syntax checks passed.

## AC3 — published-reference deletion block

**PASS.** Deletion acquires item/current then asset locks, checks every published reference before stale/draft/tombstone validation, and returns the fixed conflict before any mutation (`assets.service.ts:158-197`). Dedicated real-PostgreSQL tests cover unchanged rows and deterministic concurrent attach/edit/workflow versus delete ordering.

The acceptance scenario submitted, approved, and published through real roles, then attempted to delete the referenced asset. Chromium observed the expected fixed 409 conflict. The published attachment remained, the asset was not tombstoned by that request, and no extra mutation/audit row was added. The retained final content state is published with four current/published attachments.

## AC4 — missing upload permission

**PASS.** Page access still requires `content.items.edit`, while the independent `content.assets.upload` branch controls whether the asset editor exists (`apps/web/app/(site)/pisocamp/content/[itemId]/edit/page.tsx:26`). Every asset route declares the exact permission in `assets.controller.ts:34`, and the real Nest authorization suite proves guards run before multipart parsing (`assets.authorization.spec.ts:315`).

Before publication, the edit-only identity's DOM contained no asset upload/attach/detach/delete controls. A direct multipart request returned 403 before parsing and wrote the durable metadata-only denial audit; the final acceptance database contains 3 `rbac.permission_denied|denied` rows across the exercised negative branches and zero denied-side-effect asset/object/version rows. The screenshot `cm2-assets-editor-without-upload.png` was captured later, after publication, so it honestly shows “Published / Editing unavailable” and is not used alone as permission-hiding proof.

## AC5 — upload audited

**PASS.** Upload invokes the extracted `IdempotencyService` with a server-digest fingerprint in `assets.controller.ts:84`, and `AssetsService` writes the success audit in the same PostgreSQL transaction. Audits contain metadata only; original filename, submitted MIME, path, bytes, message, stack, cookies, and credentials are absent.

Final audit counts were: upload 5, attach 2, detach 2, logical delete 1, content edit 2, submit 1, approve 1, publish 1, and permission denied 3. Lost first response plus an exact retry returned byte/equality-identical data with one object/asset/snapshot/attachment/audit/idempotency effect. Reusing the same key with changed bytes/input returned conflict with zero added side effects. Dedicated live integration also proves response-persistence failure rolls the complete upload back.

## Accessibility and responsive evidence

The editor has a native labelled file input (`asset-attachments-editor.tsx:300`), exact role/policy guidance, polite live status (`:244,328`), focusable fixed errors and reload action (`:249-261`), confirmation dialogs (`:376-426`), and at least 44 px controls through `min-h-11`. Dirty, pending, and unresolved-conflict states lock mutation controls. A reload failure keeps the fixed 409 message and lock; only usable data plus awaited version synchronization unlocks the editor.

Chromium verified keyboard order and actions, focus restoration after validation/conflict, destructive confirmation, non-color status/error copy, semantic controls, labels/descriptions, and target boxes. At 320×720 there was no horizontal overflow or clipping. The mobile and published screenshots are readable. Full-page capture can visually stitch the fixed header; that capture artifact is documented separately and was not treated as focus-obstruction evidence. DOM geometry/focus assertions independently proved the active control was not obscured.

## Runtime artifacts

All artifacts are under the ignored `.superpowers/sdd/2026-09-01-cm-2-content-assets/task-8-artifacts/` directory. The retained trace was sanitized and re-scanned: zero Cookie, Authorization, Set-Cookie, Idempotency-Key, password, database URL, auth secret, or bearer-value matches.

| Artifact                               | SHA-256                                                            | Purpose                                                |
| -------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| `cm2-assets-editor-without-upload.png` | `3CEBBF1D15E2CFD58F42A6BAE973E91DB77A9F9E4BAE2F14794903927547FD4D` | Late, post-publish edit-only view; timing caveat above |
| `cm2-assets-mobile-draft.png`          | `E5E138146D242A490436F93DCCCF95EA0F467BA209774617391EC181D099D9EA` | 320×720 draft/editor layout                            |
| `cm2-assets-published.png`             | `338D9F3556F20677C1D6F785B5BB25F78C032E2A8D57B71F4156250824070F69` | Published state and attached roles                     |
| `cm2-assets-trace.zip`                 | `554E16922CCEA275536231AA26896E16E744576772392B04B117378BA785ED7E` | Sanitized final successful trace                       |
| `SHA256SUMS.txt`                       | `1A393AF60872F541F13C604781358434458EAE4DEE7DA11CDB01A909B83B7443` | Hash manifest for the four runtime artifacts           |

## Dependencies, repository gates, and hygiene

CM-2 adds direct compatible `multer@2.0.2` and `@types/multer@2.0.0` declarations and uses the package entrypoint exception `@repo/contracts/pisocamp-assets` so the compiled Nest application can load the contract without importing the package's Nest ESM surface.

Fresh quality evidence: exact root typecheck 14/14; root lint exit 0 with only 6 unchanged auth warnings; focused backend lint clean; workspace lint clean; `git diff --check` exit 0. A clean direct production web build passed (24/24 routes, 78 Serwist entries), and the backend build compiled 161 files with zero issues. The exact root build is recorded in the Task 8 report because Windows Turbopack intermittently collides while creating its generated Sentry junction; no source/build configuration was changed to mask it.

Root `pnpm format` reports only out-of-scope auth/tooling baseline files. A disposable `git archive 19f963e` check with the current repository Prettier configuration reproduced 35 failures in the exact base auth/tooling blobs. All tooling and all auth paths except the separately modified, explicitly excluded `packages/auth/src/index.ts` are byte-identical to `19f963e`; all CM-2 touched paths pass Prettier.

Final cleanup: zero upload temp directories; zero trace-scan/format-export/certificate directories; zero task production listeners; zero test-only failure trigger/function catalog objects; generated `.next`, Playwright report/results, and container `/tmp/cm2-acceptance.sql` removed. The dedicated backend regression database was dropped. The dedicated acceptance database and retained PostgreSQL container remain available for independent review.

## Changed-file and scope confirmation

The proposed stage manifest is generated at `.superpowers/sdd/2026-09-01-cm-2-content-assets/task-8-proposed-stage-manifest.txt`. It contains only CM-2 contracts, database model/migration/tests, backend implementation/tests/config wiring, web hooks/editor/page/tests, E2E fixture/scenario, Nginx limits, lockfile/package metadata, approved design/plan, and this evidence document. It excludes `packages/auth/src/index.ts` and every ignored SDD report/artifact. Staged count remains zero.

Public asset delivery, bundle inclusion, preview, mobile rendering, 3D rendering, AR playback, unrelated auth work, infrastructure deployment, and production data mutation remain out of scope.
