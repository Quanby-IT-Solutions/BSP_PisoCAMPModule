# CM-3 Content Workflow Foundation Implementation Plan

> **For agentic workers:** Use the project full-stack agent and the contract, Drizzle, NestJS, Next.js, Tailwind/shadcn, TanStack Query, testing, logging, security, and monorepo skills. Execute every implementation task with strict RED/GREEN TDD.

**Goal:** Let authorized users submit immutable draft snapshots, approve or reject them with comments, and publish approved snapshots through one reusable, audited, idempotent transition service while ensuring no unapproved version can enter a content bundle.

**Architecture:** Preserve CM-1's immutable `content_version` and `related_link` guarantees. Every workflow transition appends a complete version snapshot and atomically advances the owning `content_item`. Publish also sets `current_published_version_id`, marks the item `bundle_pending`, and inserts a retryable transactional outbox request. A single exported Nest transition service owns the allowed-transition table and is the only lifecycle write path for this and later epics. Strict oRPC contracts expose exact transition routes and an approver review queue; Next.js pages use the typed client and existing permission spine.

**Tech Stack:** TypeScript 5.9, Zod 4, oRPC 1.13, NestJS 11, Drizzle ORM 1/PostgreSQL 16, Next.js 16/React 19, TanStack Query 5, Tailwind CSS 4/shadcn, Vitest/Jest/Testing Library/Playwright.

**Spec:** `docs/TICKETS.md` CM-3 and RF-1; `docs/DOMAIN-MODEL.md` sections 4a and 5; `docs/PRD.md` approved-content, security, reliability, observability, and Definition of Done constraints.

## Global constraints and decisions

- CM-1 commit `def204a` is the sole prerequisite and its immutable version/link triggers remain authoritative.
- Work only in the existing local `dev` checkout. Do not create a branch/worktree, push, or open a pull request.
- CM-3 is foundational. Make one local commit only after all acceptance criteria, database/live/browser validation, independent review, and the user's foundation review pass: `CM-3: add governed content workflow`.
- Use strict TDD: observe every intended behavior fail before implementation, record RED/GREEN evidence in the ignored SDD ledger, and keep the cumulative ticket diff unstaged until the final approval.
- State transitions are exactly `draft -> submitted_for_review` (`submit`), `submitted_for_review -> approved` (`approve`), `submitted_for_review -> draft` (`reject`), and `approved -> published` (`publish`). Any other source/action pair returns 409 without a partial write.
- Every transition appends a new immutable version and copies its version-scoped links. No version or link row is updated or deleted.
- `approve` and `reject` require trimmed plain-text comments; `submit` and `publish` may carry optional trimmed plain-text comments. All comments have an explicit bounded length and reject markup.
- Mutations carry a UUID `requestId`; the `Idempotency-Key` header is required, must match it, and is scoped to the active actor. Exact replay returns the stored response without a second version, audit, or outbox row.
- Permission enforcement is exact: submit = `content.items.submit`; approve/reject/review = `content.items.approve`; publish = `content.items.publish`. Missing permission returns 403 and the existing awaited `permission_denied` audit. Deactivated accounts return 401 before replay.
- Each successful transition writes an audit entry in the same transaction containing actor, action, item id, source/target version ids, from/to states, and comments.
- Publish atomically creates the immutable published snapshot, updates item status/pointers, sets `bundle_pending = true`, writes audit, and enqueues one pending rebuild request. The future CE-1 worker consumes and retries that request; CM-3 does not build a bundle.
- The bundle-candidate query seam returns only an item's `current_published_version_id` where both item and version are `published`; draft, submitted, approved, stale, or pointer-mismatched rows are excluded.
- Store timestamps in UTC and render administration timestamps in Asia/Manila.
- Migrations are additive and must apply from a fresh database and reapply safely through the migration runner.
- Do not create application barrel files or type-only files. Shared API types remain inferred from `@repo/contracts` schemas.

## Shared interfaces

| Producer                  | Consumer                  | Frozen interface                                                                                                  |
| ------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Task 1 contracts          | Tasks 3-6                 | Strict review queue/detail schemas plus submit/approve/reject/publish inputs and outputs                          |
| Task 2 database           | Tasks 3 and 7             | Immutable lifecycle metadata, `bundle_pending`, transactional rebuild outbox, published-only selection invariants |
| Task 3 transition service | Tasks 4-7 and later epics | One allowed-transition entry point with row locks, snapshot copying, audit, and outbox ordering                   |
| Task 4 controllers        | Tasks 5-7                 | Exact RBAC/idempotency-protected review and transition routes                                                     |
| Task 5 web boundary       | Tasks 6-7                 | Typed online-only queries/mutations and permission-gated App Router pages                                         |
| Task 6 UI                 | Task 7                    | Accessible submission, review, comment, approval/rejection, and publication interactions                          |

## Task 1: Define workflow contracts and route composition

**Files:**

- Modify `packages/contracts/src/modules/v1/pisocamp/content.schema.ts`
- Modify `packages/contracts/src/modules/v1/pisocamp/content.schema.test.ts`
- Modify `packages/contracts/src/modules/v1/pisocamp/content.contract.ts`
- Modify `packages/contracts/src/modules/v1/pisocamp/content.contract.test.ts`
- Modify `packages/contracts/src/modules/v1/pisocamp/pisocamp.contract.test.ts`
- Modify `packages/contracts/src/contracts.ts`

**RED:** Add failing tests for strict UUID/request/version correlation fields; required approve/reject comments; optional submit/publish comments; plain-text/length rules; workflow metadata; review queue pagination; and exact route methods/paths.

**GREEN:** Add inferred schemas/types and compose:

- `GET /admin/pisocamp/content/review-queue`
- `GET /admin/pisocamp/content/{itemId}/review`
- `POST /admin/pisocamp/content/{itemId}/submit`
- `POST /admin/pisocamp/content/{itemId}/approve`
- `POST /admin/pisocamp/content/{itemId}/reject`
- `POST /admin/pisocamp/content/{itemId}/publish`

Transition output is the updated content detail. Review output includes immutable current-version creator/time, transition action/comments, approval identity/time, and publication identity/time without duplicating DTOs in apps.

**Verify:** focused contract tests, full contracts test/lint/typecheck/format/build.

## Task 2: Add immutable workflow metadata and the RF-1 outbox seam

**Files:**

- Modify `packages/db/src/schema.ts`
- Modify `packages/db/src/schema.spec.ts`
- Add `packages/db/src/content-workflow-migration.spec.ts`
- Add one generated additive migration under `packages/db/src/migrations/`
- Modify migration journal/snapshot files generated by Drizzle as required

**RED:** Prove the schema/migration currently lacks transition metadata, comments constraints, `bundle_pending`, and a retryable rebuild request. Add PostgreSQL tests for invalid actions/comments/status metadata, immutable workflow rows, ownership FKs, unique publish request per version, indexes, and fresh apply/reapply.

**GREEN:** Add:

- nullable `transition_action` and `transition_comments` on `content_version` with lifecycle-aware checks;
- `bundle_pending boolean not null default false` on `content_item`;
- append-only `content_bundle_rebuild_request` outbox rows linked to the exact item/version, with pending/processing/completed/failed state, attempt metadata, UTC availability/created/processed times, bounded privacy-safe error text, uniqueness, and polling indexes;
- constraints ensuring a rebuild request references a version owned by the same item and only the publish transition can be enqueued;
- an immutability trigger for rebuild identity/payload while allowing the future CE-1 worker to advance delivery state safely.

Retain all CM-1 immutability and type/version constraints.

**Verify:** focused migration tests against a dedicated loopback PostgreSQL database with destructive-test opt-in, complete DB suite serially, Drizzle generation parity, lint/typecheck/format/build.

## Task 3: Build the single atomic transition service

**Files:**

- Add `apps/backend/src/modules/v1/pisocamp/content/content-workflow.service.ts`
- Add `apps/backend/src/modules/v1/pisocamp/content/content-workflow.service.spec.ts`
- Modify `apps/backend/src/modules/v1/pisocamp/content/content.module.ts`
- Refactor only the minimum shared snapshot/link mapping from `content.service.ts`, co-located with runtime code

**RED:** Add database-backed tests for all four happy paths and every invalid transition; row-lock concurrency; stale `expectedVersionNo`; snapshot/link copy parity; approver/publication metadata; comments; timestamps; atomic audit rollback; publish pointer/pending/outbox ordering; and bundle candidate exclusion for draft/submitted/approved/stale rows.

**GREEN:** Implement one `transition(action, input, actorId)` entry point driven by a readonly allowed-transition table. Under the existing transaction context it must:

1. lock the item;
2. load and validate its current working version and expected version;
3. validate the source/action pair;
4. append the target immutable snapshot and copied links;
5. update the item status/current working pointer and `updatedAt` while preserving editorial `lastEditedBy`;
6. on publish, set current published pointer, `bundle_pending`, and one pending rebuild request;
7. write the complete transition audit;
8. return the updated detail.

Expose a published-only bundle-candidate read seam for CE-1. Export the service from `ContentModule` so later content types call it instead of implementing state changes.

**Verify:** focused service tests with zero skips, full backend test/lint/typecheck/format/build.

## Task 4: Expose secure, idempotent controllers

**Files:**

- Modify `apps/backend/src/modules/v1/pisocamp/content/content.controller.ts`
- Modify `apps/backend/src/modules/v1/pisocamp/content/content.controller.spec.ts`
- Add `apps/backend/src/modules/v1/pisocamp/content/content-workflow.idempotency.spec.ts`
- Add or extend `apps/backend/test/content-routes.e2e-spec.ts`

**RED:** Assert exact permission metadata, strict throttling, required idempotency metadata, active actor propagation, error mapping, and real composed HTTP behavior. Cover edit/submit-only actors receiving 403 plus `permission_denied` audit for approve/publish; deactivated actors receiving 401; and replay preserving exact row counts.

**GREEN:** Wire review reads and transition mutations to `ContentWorkflowService`. Keep the existing RBAC guard, `@RequireIdempotency`, interceptor, transaction context, and safe oRPC error boundary. Do not introduce a second auth/audit/idempotency implementation.

**Verify:** focused controller/idempotency/E2E tests, then full backend matrix with `RUN_DB_IDEMPOTENCY_TESTS=1` and zero skipped tests.

## Task 5: Add typed web queries, mutations, navigation, and route guards

**Files:**

- Modify `apps/web/features/pisocamp-content-admin/api/content.hooks.ts`
- Modify `apps/web/features/pisocamp-content-admin/api/content.hooks.test.tsx`
- Modify `apps/web/services/orpc/client.ts` and its tests only if the new mutations require persistence metadata
- Modify `apps/web/features/dashboard/lib/nav-items.ts` and `access.test.ts`
- Modify `apps/web/app/(site)/pisocamp/content/[itemId]/edit/page.tsx` and its tests
- Add `apps/web/app/(site)/pisocamp/content/review/page.tsx` and tests
- Add `apps/web/app/(site)/pisocamp/content/review/[itemId]/page.tsx` and tests

**RED:** Cover typed query keys, dynamic idempotency headers, invalidation after transitions, online-only behavior, editor submit permission, approver navigation, exact server-side redirects, and route titles.

**GREEN:** Add typed review/detail hooks and four mutation hooks. Pass explicit permission capabilities from server pages to client views. Keep pages thin, gate review routes with `content.items.approve`, expose publish controls only for `content.items.publish`, and exclude mutations from offline persistence.

**Verify:** focused web boundary/route tests, full web test/lint/typecheck/format/build.

## Task 6: Build the accessible submission and review experience

**Files:**

- Modify `apps/web/features/pisocamp-content-admin/components/content-form-view.tsx` and tests
- Add `apps/web/features/pisocamp-content-admin/components/content-review-queue-view.tsx` and tests
- Add `apps/web/features/pisocamp-content-admin/components/content-review-view.tsx` and tests
- Reuse existing shadcn primitives by direct imports; add a component only if the repository lacks the needed primitive

**RED:** Cover submit confirmation/double-submit prevention; queue loading/empty/error/retry/pagination states; complete content rendering; required approve/reject comments; publish confirmation; success/error focus and announcements; permission-specific controls; stale-version conflicts; keyboard operation; semantic headings/forms/tables/cards; 320px and 200% text reflow.

**GREEN:** Add a submit action for permitted draft editors and a review queue/detail workflow for approvers. Make status and actor/time changes visible without color-only meaning. Preserve dirty-edit protection, do not allow submitted content to be edited, give every field an accessible label/error relationship, use at least 44px touch targets where practical, and return focus predictably after dialogs/errors.

**Verify:** focused component tests, full web suite, rendered desktop/mobile/200% checks, keyboard/focus/screen-reader semantics, no horizontal overflow.

## Task 7: Complete CM-3 acceptance, evidence, and independent review

**Files:**

- Add `docs/pisocamp/cm-3-acceptance-evidence.md`
- Update the repository RTM artifact if one exists; otherwise record CM-002/003/006/007 and BR-002 traceability in the evidence document without inventing a parallel RTM
- Maintain ignored reports under `.superpowers/sdd/2026-08-26-cm-3-content-workflow-foundation/`

Run a fresh disposable PostgreSQL-backed production-like matrix and verify:

- draft submit appends a snapshot and enters the review queue;
- approve records actor/date/comments; reject returns to editable draft with comments retained in history;
- approved publish appends the published snapshot, sets both pointers correctly, marks pending, and creates exactly one rebuild request;
- invalid/stale/concurrent transitions roll back cleanly;
- edit/submit-only actors cannot approve/publish and denials are audited;
- every successful transition audit has actor, from/to state, comments, and version ids;
- exact idempotent replays do not duplicate version/link/audit/outbox rows;
- bundle candidates contain only exact current published snapshots and exclude draft/submitted/approved versions;
- real browser flows pass for Content Administrator and Content Approver at desktop, mobile, keyboard-only, and 200% text;
- API/browser/server logs contain no unexpected errors, warnings, unhandled rejections, failed requests, secrets, or PII.

Run contracts, DB, backend, and web tests; lint; typecheck; package builds; workspace dependency lint; targeted format checks; `git diff --check`; and rendered browser acceptance. Remove only exact labelled disposable containers/processes and confirm owned ports are closed.

Dispatch the project `code-reviewer` across the complete CM-3 diff against `def204a`. Fix every Critical/Important/Major finding via RED/GREEN and request scoped re-review until clean.

## Foundation review checkpoint and commit

Present the complete implementation, evidence, residual risks, and exact validation counts to the user. Pause before staging or committing. After explicit approval, rerun the fresh completion matrix, audit staged scope and credential sentinels, then create exactly one local commit:

```powershell
git add -A
git commit -m "CM-3: add governed content workflow"
```

Verify the commit, a clean working tree/index, no push/PR/branch activity, and log CM-3 PASS before starting CE-1.

## Plan self-review

- All six CM-3 acceptance criteria map to Tasks 1-7.
- The transition service is the only lifecycle writer and is exported for CM-4/CM-6/GM-1/EV-1/AR-2 reuse.
- RF-1 publish ordering is atomic and retryable without implementing CE-1's builder early.
- CM-1 immutability remains intact; approval/rejection/publication create snapshots rather than updating versions.
- RBAC, active-account checks, audit, idempotency, transactions, logging, and typed client infrastructure are reused.
- Assets, restore, preview, unpublish/scheduling, and actual bundle construction remain out of scope.
