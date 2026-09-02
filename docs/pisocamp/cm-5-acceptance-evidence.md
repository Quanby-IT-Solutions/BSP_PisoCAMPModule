# CM-5 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `d2c2d94` (CM-2)
Ticket: CM-5 — Preview content before publication

## Result

All four CM-5 acceptance criteria are **PASS**. Evidence comes from unit and
integration suites plus a Chromium run against production builds of the backend
and web applications, a dedicated loopback PostgreSQL 16 database
(`cm5_acceptance_test`), and real Better Auth sessions. No branch, push, PR or
production data was touched.

## What CM-5 adds

| Layer | Surface |
| --- | --- |
| Contract | `packages/contracts/src/modules/v1/pisocamp/preview.schema.ts`, `preview.contract.ts`, subpath export `@repo/contracts/pisocamp-preview` |
| Backend | `preview-token.ts` (HMAC grant), `preview.service.ts`, `preview.controller.ts`, `preview-resource.controller.ts`, `preview.module.ts` |
| Web | `api/preview.hooks.ts`, `components/content-preview-view.tsx`, route `app/(site)/pisocamp/content/[itemId]/versions/[versionNo]/preview` |
| Mobile | `data/preview_build.dart`, `data/preview_repository.dart`, `presentation/screens/pisocamp_preview_screen.dart`, gated route in `app_router.dart` |

Endpoints, exactly as the ticket specifies plus the media route the renderer needs:

- `GET /v1/admin/pisocamp/content/{itemId}/versions/{versionNo}/preview` — session + `content.items.preview`; returns the rendered version, a signed grant and its expiry.
- `GET /v1/pisocamp/preview?token=…` — grant-authenticated; what the mobile preview build redeems.
- `GET /v1/pisocamp/preview/resources/{assetId}?token=…` — grant-authenticated attachment bytes, `Cache-Control: no-store`.

Shared code is reused rather than duplicated: `AuditService`, `RbacGuard` /
`RequirePermissions`, `StrictThrottle`, `selectVersionAssets`,
`fromContentVersion`, `selectContentLinks` and `PostgresAssetObjectStore` are
all called as-is. No new workflow, version or asset mechanics were introduced.

## AC1 — a draft or approved version renders as end users will see it

**PASS.** `PreviewService.render` builds the payload from the exact
`content_version` row, its `related_link` rows and its `version_asset`
attachments (`preview.service.ts:171`). The console renders the module layout —
title, summary, body, currency series and denomination, images by role, an
audio player and related links (`content-preview-view.tsx`).

Chromium evidence (`cm5-preview.authenticated.spec.ts`, project
`cm5-preview-authenticated`): signed in as the Content Administrator, the
grant request returned 200 with `{ versionNo: 3, status: "approved" }`, the
heading, summary, body, series and denomination rendered, the obverse image
decoded in the browser (`naturalWidth > 0`) from
`/v1/pisocamp/preview/resources/{assetId}?token=…`, and the labelled audio
player carried the same grant-authorised source.

Screenshots: `cm-5-preview-desktop.png` (1280 px) and `cm-5-preview-mobile.png`
(320 px). The fixture image is an 8×8 transparent PNG, so the image frame is
deliberately blank in both captures; the decode assertion, not the pixels, is
the proof that bytes arrived.

Previewable states are `draft`, `submitted_for_review` and `approved`. The
ticket names draft and approved; the submitted state is included because it is
exactly what an approver is looking at in the review queue. Every other state
is refused.

## AC2 — a preview changes no publication flag and enters no bundle

**PASS.** `PreviewService` performs no write other than the audit row: it
touches `content_item`, `content_version`, `version_asset` and every bundle
table read-only. The bundle builder selects only
`content_item.current_published_version_id`, which a preview never sets.

- `preview.authorization.spec.ts` snapshots `content_item`, `content_version`,
  `version_asset`, `content_bundle`, `content_bundle_manifest_entry` and
  `content_bundle_rebuild_request` before and after a grant and asserts deep
  equality, then separately asserts `status: "draft"`,
  `currentPublishedVersionId: null`, `bundlePending: false` and zero rebuild
  requests.
- After the full browser run the acceptance database held: item `approved`,
  `current_published_version_id` null, `bundle_pending` false, 0 bundles,
  0 manifest entries, 0 rebuild requests, 3 versions.
- Every preview response carries `Cache-Control: no-store`, so no cache, service
  worker or mobile store can retain unpublished content.

A grant whose version has since left a previewable state fails closed:
`requireGrantedVersion` re-reads the live row and refuses rather than trusting
the signed claim.

## AC3 — a caller without `content.items.preview` is refused and audited

**PASS.** `PreviewController.createPreview` declares the exact permission, and
`RbacGuard` runs before the handler.

- `preview.authorization.spec.ts` proves 403 plus one `rbac.permission_denied`
  audit for the denied identity, with no `content.preview` audit written, and
  401 before permission resolution for a deactivated holder.
- In Chromium the editor identity (a role holding only `content.items.edit`)
  was redirected off the preview page, saw no preview entry point on the edit
  page, and — calling the endpoint directly — received 403 with no grant in the
  body. The acceptance database recorded
  `permission_denied / denied / seed-user-alex / PreviewController.createPreview`
  with `requiredPermissions: ["content.items.preview"]`.
- The positive branch is the same run's Content Administrator: 19
  `content.preview` success audits, `target_type: content_version`, metadata
  only — the grant itself never appears in an audit row.

## AC4 — a preview build renders a scanned version once, uncached

**PASS, with one scope note.** The console renders a real QR code whose payload
is the redemption URL, plus the same URL as copyable text and the expiry time
(`content-preview-view.tsx`, verified in Chromium and visible in both
screenshots).

The Flutter side is compiled out of ordinary builds:
`kPisoCampPreviewBuild` is `const bool.fromEnvironment('PISOCAMP_PREVIEW_BUILD')`,
so the route, the screen body and every network call are absent unless a build
opts in. `flutter test` proves both configurations:

- default build — the route redirects to login, the screen renders only
  "Content preview is available only in a BSP-approved preview build", and
  **zero** requests are issued (this caught a real defect: `initState` fetched
  before the gate, now closed in both `initState` and `_render`);
- `--dart-define=PISOCAMP_PREVIEW_BUILD=true` — a scanned code or redemption
  URL renders the version, labelled "Preview only — not published", with the
  image fetched and its SHA-256 verified, exactly one preview request per code
  (a rebuild does not refetch), an unusable code rejected before any request,
  and the screen readable at 320 px with 200 % text.

Nothing is persisted: `PisoCampPreviewRepository` holds no store, cache or file
handle, and the document and bytes live in widget state only, so a preview can
never enter the offline bundle the published experience reads.

**Scope note.** The code is scannable by the device camera today, and the
preview build accepts the scanned payload (raw grant or redemption URL) by deep
link or paste. An in-app camera scanner is deliberately not added here: it
would put a camera plugin and a camera permission into every build ahead of
DR-1, which owns the camera capability. This is the only part of AC4 not
delivered as an in-app affordance.

## Deliberate change outside the preview files

`apps/web/next.config.ts` — the page CSP previously allowed images only from
`'self' data: blob:` and had no `media-src`, so the browser silently blocked
preview media from the API origin (found in the browser run, not in unit
tests). `img-src` and a new `media-src` now include the same API origin
`connect-src` already allows. The unauthenticated Playwright project (25 tests)
passes unchanged after the edit.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 14 files, 214 tests passed |
| `@repo/db` vitest (live PostgreSQL, migration opt-in) | 15 files, 91 passed, 32 skipped |
| `@repo/backend` jest (live PostgreSQL) | 67 suites passed, 2 skipped; 576 passed, 48 skipped, 0 failed |
| `@repo/web` vitest | 35 files, 294 tests passed (8 consecutive green runs) |
| `flutter test` | 330 passed |
| `flutter test --dart-define=PISOCAMP_PREVIEW_BUILD=true` | 333 passed |
| Playwright `cm5-preview-authenticated` | 5 passed, repeated 5× green |
| Playwright `chromium` (unauthenticated regression) | 25 passed, 4 skipped |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |
| `pnpm build` | backend 168 files, web 25 routes |

Two pre-existing flaky web tests were found while stabilising the suite and
fixed at the root rather than retried: `asset-attachments-editor.test.tsx` read
a portalled listbox synchronously, and `assets.hooks.test.tsx` read React Query
error state on the line after the rejection settled.

## Console, network and server-log cleanliness

The browser run asserts zero page errors, zero console errors or warnings, zero
failed requests and zero error responses, with two documented exceptions:

- aborted requests (`net::ERR_ABORTED`) from Next.js cancelling RSC prefetches
  and the connectivity poll on navigation — the framework working, not a
  failure;
- in the denial test only, the dashboard shell prefetching `/user-management`,
  which that identity may not read. That 403 is the RBAC spine working; it is
  allowed explicitly and by URL, and the paired anonymous console line is
  dropped with it.

Backend log for the whole acceptance run: no ERROR lines. Warnings are
`REDIS_URL` unset (single-instance configuration), a `path-to-regexp` legacy
route notice from the framework, and the RBAC denials above. Status codes seen:
231×200, 1×403 (the prefetch), 8×404 (the deliberate unknown-version check plus
one mis-pointed sign-in during setup), 7×429 (the strict throttle on the grant
endpoint during repeated runs).

One pre-existing defect was observed and left alone as out of scope: the API
docs setup logs `Failed to merge Better Auth OpenAPI schema TypeError:
api.generateOpenAPISchema is not a function` at boot. It affects only the
Scalar documentation page and predates CM-5.

## Accessibility and responsiveness

Verified in Chromium and in component tests: heading structure with a single
`h1`, a polite status region for the preview notice, an `alert` error that
takes focus and offers retry, alt text naming the role and the item for every
image, a labelled audio player with controls, an accessible name on the QR
image, a visible text alternative to the code, no horizontal overflow at 320 px,
and a ≥44 px touch target on the back control. The Flutter screen keeps its
semantics headers, a live region for failures and a ≥48 px action, and was
exercised at 320×720 with 200 % text.

## Environment note

Workspace dependencies were reinstalled with pnpm's hoisted node linker because
this session's sandbox denies Windows reparse-point (symlink and junction)
creation, which the default isolated linker requires. That is a local
`node_modules` layout only — no repository file encodes it, and a normal
`pnpm install` on a machine that can create junctions restores the usual
layout.
