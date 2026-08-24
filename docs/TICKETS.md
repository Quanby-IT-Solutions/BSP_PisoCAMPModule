# TICKETS — Piso CAMP Module

Companion files: `PRD.md` (constraints, decisions) · `DOMAIN-MODEL.md` (entity names, permission keys, state machines). Risky flows RF-1…RF-6 are defined in §4 of this file and referenced from technical notes.

---

## 1. Epic map

| Epic key | Label | TOR / PRD source | Note |
|---|---|---|---|
| `foundation` | Module Shell, Identity, Consent & Permission Spine | Annex H §2, §3, §4.1, §4.3 UI-005–008, BR-006 | Cross-cutting; built just-in-time. Extends existing auth, nav, design system. |
| `content-management` | Content Workflow & Assets | Annex H §8 CM-001–007, CE-003, BR-002 | Shared workflow engine; first slice CM-1/CM-3, reused by trivia, surveys, AR, advisories. |
| `currency-education` | Currency Information & Special Features | Annex H §5.1 CE-001–007, BR-012 | Offline content bundle (first consumer), 3D, zoom/pan, haptic, tilt. |
| `gamification` | Trivia, Progress & Leaderboard | Annex H §5.2 GM-001–008, BR-003–005 | Reuses content workflow for questions. |
| `augmented-reality` | AR Experiences | Annex H §5.3 AR-001–005 | Coin + banknote AR, offline where packaged. |
| `denomination-recognition` | Camera-Based Denomination Recognition | Annex H §5.4 DR-001–009, BR-007/008/011 | On-device model; never authenticity. |
| `evaluation` | Surveys & Exit Advisory | Annex H §6 EV-001–005, §4.2-L | Consent-gated. |
| `analytics-reporting` | Analytics Events, KPIs, Reports & Export | Annex H §4.2 AN-001–032, §I–M, BR-009 | Exactly-once pipeline; own event store. |
| `admin-security` | Accounts, Roles, Config, Audit, Push, Hardening | Annex H §3.6, UM-004, §10, §11.7, AN-014 | Extends foundation spine. |

## 2. Build order

**Release 1 — walking skeleton (Milestone 1 prototype)**
1. **F1** — Piso CAMP section, optional account prompt, guest home, opens offline
2. **F2** — Permission spine + audit log + first admin screen (Module Configuration)
3. **F3** — Registered profile on existing account (name, gender, age, email, region, city)
4. **F4** — Privacy notice + consent record
5. **CM-1** — Create/edit a draft content item (currency series, denomination, description)
6. **CM-3** — Submit → approve/reject → publish workflow
7. **CE-1** — Published banknote/coin info delivered as an offline bundle and read in-app
8. **AN-1** — Analytics event pipeline: client SDK, encrypted offline queue, idempotent ingestion

**Release 2 — complete human loop**
9. **CM-2** — Upload and attach assets (image, audio, 3D, AR)
10. **CM-5** — Preview content before publication
11. **CM-4** — Version history and restore a prior approved version
12. **CM-6** — Unpublish, deactivate, archive, scheduled publication
13. **CM-7** — Content audit history view
14. **CE-2** — Interactive 3D coin viewer
15. **CE-3** — Zoom and pan (first-level features only)
16. **CE-4** — Haptic simulation of tactile features
17. **CE-5** — Tilt simulation of dynamic features
18. **F5** — External, internal and deep links with store fallback
19. **F6** — Accessibility baseline and orientation state preservation
20. **GM-1** — Manage trivia questions through the content workflow
21. **GM-2** — Random trivia prompt with skip, correct/incorrect behaviour
22. **GM-3** — Answer tracking and progress (local + synced)
23. **EV-1** — Manage surveys through the content workflow
24. **EV-2** — Consent-gated pop-up survey with offline queue
25. **EV-3** — Configurable survey triggers and frequency
26. **EV-4** — Exit advisory on proper currency handling
27. **AN-2** — Sessions + DAU/MAU/stickiness/session dashboard
28. **AN-3** — Feature usage, activation and time-to-first-key-action
29. **AN-4** — Retention, churn, lifetime, re-engagement, reactivation
30. **AN-8** — Parameter-driven historical report with filters
31. **AN-9** — Export to Excel, Word, PDF with generation metadata
32. **SA-1** — Activate/deactivate accounts
33. **SA-2** — Assign and revoke roles
34. **SA-3** — Manage module configuration
35. **SA-4** — Administrative audit log viewer
36. **SA-7** — Consent withdrawal and data-subject export/delete

**Release 3 — advanced experiences & depth (Milestone 2)**
37. **GM-4** — Leaderboard (config-flagged, aliases, periods, rank movement)
38. **GM-5** — Registered user progress view
39. **AR-1** — AR experience skeleton for one coin (capability check, permissions, exit, fallback)
40. **AR-2** — AR experience content admin
41. **AR-3** — Synchronized audio, full mandatory coverage, offline packaging
42. **DR-1** — Camera scan → on-device denomination + audio + disclaimer
43. **DR-2** — Uncertain/failed recognition handling
44. **DR-3** — Demonetized and foreign banknote handling
45. **DR-4** — Recognition model versioning, threshold config, accuracy harness
46. **AN-5** — Gamification and trivia metrics
47. **AN-6** — Evaluation, ratings and NPS metrics
48. **AN-7** — Technical metrics (crash, load time, API, network failures, size/battery)
49. **AN-10** — Demographic and cohort reports with small-group suppression
50. **AN-11** — Install volume and store ratings consolidation
51. **SA-5** — Push notifications (opt-in, send, metrics)
52. **SA-6** — Security hardening and observability pass

---

## 3. Full tickets

### Epic: `foundation`

---

**Title:** [F1] Piso CAMP section with optional account prompt and guest home, opens offline
**Epic:** `foundation`
**Problem / context:** Annex H UI-001/002, UM-001/002. The module must exist inside the existing Flutter app, be reachable from approved navigation, prompt for an optional account without coercion, and open in airplane mode. Whole-product walking skeleton.
**User story:** As a Guest User, I want to open Piso CAMP from the app navigation and continue without an account so that I can start learning immediately.
**Acceptance criteria:**
- *Given* the installed app, *when* I tap the Piso CAMP navigation entry, *then* a dedicated module section opens using the existing design system.
- *Given* first entry on this device, *when* the section opens, *then* a prompt explains that an account is optional and offers "Create Account" and "Continue as Guest" with no coercive language.
- *Given* I choose "Continue as Guest", *when* the home screen loads, *then* a `device_pseudo_id` is generated and stored in secure storage and the prompt is not shown again on this device.
- *Given* airplane mode, *when* I open the module, *then* the home screen renders from packaged content with an "offline" indicator and no crash.
- *Given* I tap a connectivity-dependent action (e.g. Create Account) offline, *then* a plain-language notice explains that internet is required.
**In scope:** Navigation entry; module route; account prompt; guest identity; connectivity indicator service; packaged placeholder home; `GET /pisocamp/config` read (public keys only).
**Out of scope:** Registration form (F3); consent (F4); real content (CE-1); admin screens (F2).
**Technical notes:** Flutter module package `pisocamp/` following existing app structure; `device_pseudo_id` via `flutter_secure_storage`; connectivity listener as a shared provider. Emits no analytics yet (AN-1 adds the SDK; event names `module_entry`, `account_prompt_shown`, `account_prompt_guest` reserved). RTM ids: UI-001, UI-002, UM-001, UM-002.
**Definition of done:** Code + tests merged · acceptance criteria pass · airplane-mode test evidence attached · PR reviewed · docs updated.
**Dependencies:** none.

---

**Title:** [F2] Permission spine, audit log and first admin screen (Module Configuration)
**Epic:** `foundation`
**Problem / context:** Annex H §3, §10 (RBAC, least privilege, admin audit logging). Every admin ticket needs a permission check and an audit write; prove both on one real screen.
**User story:** As a user with `admin.config.manage` permission, I want to view and edit the Piso CAMP module configuration so that access control and auditing are real from the first admin screen.
**Acceptance criteria:**
- *Given* the seeded roles/permissions, *when* an admin assigns "System Administrator" to a user, *then* that user's resolved permissions include `admin.config.manage`.
- *Given* a user with the permission, *when* they save a configuration value, *then* it persists and an `audit_entry` (actor, key, before, after, timestamp) is written.
- *Given* a user without the permission, *when* they call the endpoint, *then* it returns 403 and a `permission_denied` audit entry is written.
- *Given* a deactivated account, *when* it calls any admin endpoint, *then* it returns 401 before permission resolution.
**In scope:** `role`, `permission`, `role_permissions`, `user_roles`, `audit_entry`, `module_configuration`; permission middleware; audit helper; seed of the six Annex H roles; admin console screen "Module Configuration" with one editable key (`session_inactivity_minutes`, default 30).
**Out of scope:** Role assignment UI (SA-2); full config set (SA-3); audit viewer (SA-4); account activation (SA-1).
**Technical notes:** Reuses existing admin auth. Middleware resolves user → roles → permissions, cached per request. Endpoints `GET/PUT /admin/pisocamp/config`. Permission key enforced: `admin.config.manage`. Flow **RF-4**. RTM ids: §3.6, §10.
**Definition of done:** as standard.
**Dependencies:** none.

---

**Title:** [F3] Registered profile on the existing account
**Epic:** `foundation`
**Problem / context:** Annex H UM-003, §3.2. Registration must capture name, gender, age, email, region and city with controlled lists, on top of the existing auth service.
**User story:** As a Guest User, I want to create an account with my profile details so that my progress can be kept and I can join registered-only features.
**Acceptance criteria:**
- *Given* I choose "Create Account", *when* the form opens, *then* it shows name, gender, age, email, region, city with required/optional clearly marked.
- *Given* region and city fields, *when* I open them, *then* they are dropdowns populated from BSP-approved lists, city filtered by region.
- *Given* a missing required field or invalid email, *when* I submit, *then* submission is blocked with an understandable message.
- *Given* a valid submission with consent recorded (F4), *when* I submit, *then* the account is created/linked via the existing auth service and a `profile` row is stored.
- *Given* an existing app account already logged in, *when* I enter Piso CAMP, *then* I am prompted only for the missing Piso CAMP profile fields.
**In scope:** `profile`, `region`, `city` tables and seed; `POST /pisocamp/profile`; registration screen; linkage of `device_pseudo_id` to the new account for later progress merge.
**Out of scope:** Consent notice (F4, dependency); account deactivation (SA-1); profile export/delete (SA-7).
**Technical notes:** Uses existing auth SDK for account creation/login. Age stored as integer; derived age-group used by analytics (AN-10). Flow **RF-3** gate before submit. RTM ids: UM-003, §3.2.
**Definition of done:** as standard.
**Dependencies:** F1, F4.

---

**Title:** [F4] Privacy notice and consent record
**Epic:** `foundation`
**Problem / context:** Annex H UM-005, §4.2-L, §10 (consent management). All consent-dependent collection must be preceded by the approved notice and a recorded response.
**User story:** As a Guest User, I want to see the privacy notice and accept or decline before any personal data is collected so that my choice is respected and recorded.
**Acceptance criteria:**
- *Given* a consent-dependent action (registration first), *when* it starts, *then* the current `privacy_notice` version is shown in full before any data is collected.
- *Given* I accept, *when* recorded, *then* a `consent_record` stores subject, notice version, timestamp, status `granted`.
- *Given* I decline, *when* recorded, *then* a `consent_record` with status `declined` is stored, no consent-dependent data is collected, and I can continue using non-dependent features.
- *Given* a new notice version is activated, *when* I next start a consent-dependent action, *then* I am asked again and prior consent is treated as `requires_reconsent`.
- *Given* I am offline, *when* I accept, *then* the record is queued and synced on reconnect (guest records keyed by `device_pseudo_id`).
**In scope:** `privacy_notice`, `consent_record`; consent service (client + `POST /pisocamp/consent`); notice screen; reusable `requireConsent(purpose)` guard.
**Out of scope:** Withdrawal UI and data-subject actions (SA-7); survey consent use (EV-2); demographic analytics use (AN-10).
**Technical notes:** Consent purposes enumerated: `registration`, `survey`, `demographic_analytics`. Flow **RF-3**. Notice version managed under `admin.config.manage` (SA-3). RTM ids: UM-005, §4.2-L.
**Definition of done:** as standard, plus consent-negative test evidence.
**Dependencies:** F1.

---

**Title:** [F5] External, internal and deep links with store fallback
**Epic:** `foundation`
**Problem / context:** Annex H UI-005/006/007. Content must link to BSP web, social and other app screens; BSP web/social must deep-link into the module with store fallback when not installed.
**User story:** As a Guest User, I want links inside Piso CAMP to open the right BSP page or app screen, and links from BSP websites to bring me into the module so that navigation is seamless.
**Acceptance criteria:**
- *Given* a published content item with an external link, *when* I tap it, *then* it opens per the existing app's approved browser behaviour.
- *Given* an internal link to another app screen, *when* I tap it, *then* the app navigates there and back navigation returns to the content.
- *Given* the app is installed, *when* I open an approved deep link (e.g. `bsp://pisocamp/denomination/ngc-20-piso`), *then* the app opens on that screen.
- *Given* the app is not installed, *when* I open the link, *then* it falls back to the App Store / Google Play listing or the approved BSP web page.
- *Given* a link is tapped, *then* an analytics event `link_open` with link type is emitted.
**In scope:** `related_link` type handling (external/internal/topic); universal links / app links configuration; route resolver; fallback page configuration.
**Out of scope:** Link content authoring (CM-1); link analytics reports (AN-3).
**Technical notes:** Reuse existing deep-link config if present; add route table for module screens. Emits via AN-1 SDK. RTM ids: UI-005, UI-006, UI-007.
**Definition of done:** as standard, plus deep-link test on both stores.
**Dependencies:** F1, CM-1, AN-1.

---

**Title:** [F6] Accessibility baseline and orientation state preservation
**Epic:** `foundation`
**Problem / context:** Annex H UI-008, §11.8, BR-006. Module screens must honour the existing app's accessibility practices and survive rotation without losing state.
**User story:** As a Guest User who relies on font scaling or a screen reader, I want every Piso CAMP screen to be readable and operable, and to keep my place when I rotate the device, so that the module is usable for me.
**Acceptance criteria:**
- *Given* system font scaling at the largest supported size, *when* I view any Release 1–2 screen, *then* no text is clipped and all actions remain reachable.
- *Given* a screen reader, *when* I navigate a screen, *then* every interactive element has a label and focus order is logical.
- *Given* a screen with state (scroll position, selected denomination, open trivia prompt), *when* I rotate the device, *then* state is preserved.
- *Given* reduced-motion is enabled, *when* animated content plays, *then* a reduced or static alternative is used where supported.
- *Given* an accessibility audit run per the approved test plan, *then* contrast, touch-target and non-colour-indicator checks pass.
**In scope:** Semantics labels; scaling-safe layouts; state restoration; reduced-motion hook; accessibility test checklist automated where possible.
**Out of scope:** Fixed-orientation exceptions for AR/recognition (AR-1, DR-1 declare their own).
**Technical notes:** Uses Flutter `Semantics`, `MediaQuery.textScaler`, `RestorationMixin`. Establishes the checklist every later UI ticket must pass. RTM ids: UI-008, §11.8, BR-006.
**Definition of done:** as standard, plus accessibility checklist evidence.
**Dependencies:** F1, CE-1.

---

### Epic: `content-management`

---

**Title:** [CM-1] Create and edit a draft content item
**Epic:** `content-management`
**Problem / context:** Annex H CM-001, CE-003, §3.3. Module walking skeleton for content: a Content Administrator can create a draft currency item in the admin console and see it listed. Establishes the generic `content_item` model all other content types reuse.
**User story:** As a user with `content.items.edit` permission, I want to create and edit a draft content item (series, denomination, descriptions, related links) so that BSP content can be prepared for review.
**Acceptance criteria:**
- *Given* the admin console, *when* I create an item with `content_type` (banknote, coin, security_feature, advisory, link), currency series, denomination and text fields, *then* it saves with status `draft` and appears in the content list.
- *Given* a `draft` item, *when* I edit fields, *then* changes persist and `last_editor` / `date_modified` update.
- *Given* a missing required field for the type, *when* I save, *then* it is blocked with a validation message.
- *Given* a user without `content.items.edit`, *when* they call create/edit, *then* 403 and a `permission_denied` audit entry.
- *Given* any create/edit, *then* an `audit_entry` is written.
**In scope:** `content_item`, `content_version` (draft version), `related_link`; `POST/PUT/GET /admin/pisocamp/content`; list + form screens; type-specific required-field rules.
**Out of scope:** Assets (CM-2); workflow transitions (CM-3); preview (CM-5); end-user visibility (CE-1).
**Technical notes:** Model per DOMAIN-MODEL §4a; status column owned here. Permission key enforced: `content.items.edit`. Reuses F2 spine. Design the version table so CM-3/CM-4 add transitions without schema rewrite. RTM ids: CM-001, CM-003 (creator fields), CE-003.
**Definition of done:** as standard.
**Dependencies:** F2.

---

**Title:** [CM-2] Upload and attach assets to a content version
**Epic:** `content-management`
**Problem / context:** Annex H CM-001, CE-002 (images/textures/3D), CE-003, §3.3. Content needs images, audio, 3D models and AR animations attached with integrity checks.
**User story:** As a user with `content.assets.upload` permission, I want to upload approved images, audio and 3D/AR files and attach them to a draft content item so that end-user experiences have their assets.
**Acceptance criteria:**
- *Given* a `draft` item, *when* I upload a file of an allowed type (png/jpg/webp, mp3/aac, glb/gltf, approved AR formats) within size limits, *then* an `asset` row stores checksum, mime type, size, version and it is attached to the draft version.
- *Given* a disallowed type or oversize file, *when* uploaded, *then* it is rejected with a message.
- *Given* an asset referenced by a published version, *when* deletion is attempted, *then* it is blocked.
- *Given* a user without the permission, *when* uploading, *then* 403 + audit.
- *Given* an upload, *then* it is audited.
**In scope:** `asset`, `version_asset`; object storage integration per existing backend; `POST /admin/pisocamp/assets`; attach/detach UI with role (obverse, reverse, edge, texture, audio, animation).
**Out of scope:** Bundle delivery of assets (CE-1/AR-3); 3D rendering (CE-2).
**Technical notes:** Server-side checksum (sha256) used later by bundle manifest (RF-6). Permission key: `content.assets.upload`. RTM ids: CM-001, CM-007 (asset references remain valid).
**Definition of done:** as standard.
**Dependencies:** CM-1.

---

**Title:** [CM-3] Submit → approve/reject → publish workflow
**Epic:** `content-management`
**Problem / context:** Annex H CM-002/003/006/007, §3.3–3.4, BR-002. The core governance rule: unapproved content is never visible. First slice of the shared workflow engine reused by trivia, surveys, AR, advisories.
**User story:** As a user with `content.items.approve` and `content.items.publish` permission, I want to review submitted content, approve or reject it with comments, and publish approved content so that only BSP-approved content reaches the public.
**Acceptance criteria:**
- *Given* a `draft` item, *when* a user with `content.items.submit` submits it, *then* status becomes `submitted_for_review`, a version snapshot is created and the item appears in the review queue.
- *Given* a submitted item, *when* an approver approves with comments, *then* status becomes `approved`, approver and approval date are recorded; when rejected, status returns to `draft` with rejection comments.
- *Given* an `approved` item, *when* an approver publishes, *then* status becomes `published`, the version is marked `current_published`, publication date recorded, and a bundle rebuild is triggered.
- *Given* a user holding only `content.items.edit`/`submit`, *when* they call approve or publish, *then* 403 + audit (a Content Administrator cannot publish).
- *Given* any transition, *then* an `audit_entry` with actor, from-state, to-state and comments is written.
- *Given* a `draft` or `submitted` item, *when* the bundle is built, *then* it is not included.
**In scope:** Transition service with allowed-transition table; `POST /admin/pisocamp/content/{id}/{submit|approve|reject|publish}`; review queue screen; comments.
**Out of scope:** Assets (CM-2); restore (CM-4); preview (CM-5); unpublish/schedule (CM-6); bundle build itself (CE-1 — this ticket only enqueues the trigger).
**Technical notes:** State machine DOMAIN-MODEL §4a. Permission keys enforced: `content.items.submit`, `content.items.approve`, `content.items.publish`. Flow **RF-1** (publish ordering). Transition service is the single entry point; other epics must call it. RTM ids: CM-002, CM-003, CM-006, CM-007, BR-002.
**Definition of done:** as standard, plus negative test that a submitted item never appears in a bundle.
**Dependencies:** CM-1.

---

**Title:** [CM-4] Version history and restore a prior approved version
**Epic:** `content-management`
**Problem / context:** Annex H CM-005, §3.4. Approvers must be able to see versions and roll back to a previously approved one.
**User story:** As a user with `content.items.restore` permission, I want to view an item's version history and restore a prior approved version so that a bad publication can be reverted quickly.
**Acceptance criteria:**
- *Given* an item with multiple versions, *when* I open history, *then* each version shows number, creator, date, approver, status and a field-level diff to the current version.
- *Given* a prior `approved`/`published` version, *when* I restore it, *then* a new version is created as a copy in state `approved` and can be published via CM-3 (published state is not bypassed).
- *Given* a user without the permission, *when* restoring, *then* 403 + audit.
- *Given* a restore, *then* it is audited with source version id.
**In scope:** History screen; diff; `POST /admin/pisocamp/content/{id}/versions/{v}/restore`.
**Out of scope:** Asset re-upload (assets are referenced by version, so restore reuses them).
**Technical notes:** Restore goes through CM-3 transition service. Permission key: `content.items.restore`. Flow **RF-1**. RTM ids: CM-005, CM-007 (rollback works).
**Definition of done:** as standard.
**Dependencies:** CM-3.

---

**Title:** [CM-5] Preview content before publication
**Epic:** `content-management`
**Problem / context:** Annex H CM-004. Authorised users must see how a draft/approved version renders before it goes live.
**User story:** As a user with `content.items.preview` permission, I want to preview a content version as end users will see it so that errors are caught before publication.
**Acceptance criteria:**
- *Given* a draft or approved version, *when* I open preview, *then* the admin console renders it with the module's layout, images and audio player.
- *Given* a preview, *when* generated, *then* no `published` flag changes and the version is not added to any bundle.
- *Given* a user without the permission, *when* previewing, *then* 403 + audit.
- *Given* the mobile app in a BSP-approved "preview build", *when* an admin scans a preview code, *then* the app renders that version once without caching it as published.
**In scope:** Web preview renderer; signed short-lived preview token; mobile preview mode (internal builds only).
**Out of scope:** Publishing (CM-3).
**Technical notes:** Preview endpoint `GET /admin/pisocamp/content/{id}/versions/{v}/preview`. Permission key: `content.items.preview`. RTM id: CM-004.
**Definition of done:** as standard.
**Dependencies:** CM-2, CM-3.

---

**Title:** [CM-6] Unpublish, deactivate, archive and scheduled publication
**Epic:** `content-management`
**Problem / context:** Annex H CM-002 (unpublished/deactivated/archived states), §3.3 (deactivate obsolete content), §3.4 (schedule publication).
**User story:** As a user with `content.items.publish` permission, I want to unpublish, deactivate, archive or schedule content so that obsolete content leaves the app and new content goes live at the approved time.
**Acceptance criteria:**
- *Given* a `published` item, *when* I unpublish it, *then* status becomes `unpublished`, it is removed at the next bundle build, and the change is audited.
- *Given* an `unpublished` or `published` item, *when* I deactivate it, *then* status becomes `deactivated` and it is never presented to end users (including trivia selection).
- *Given* a `deactivated` item, *when* archived, *then* it is read-only and hidden from default lists but retained per BR-001.
- *Given* an `approved` item with `publish_at`, *when* the time passes, *then* a scheduled job publishes it through the transition service.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** Transitions added to CM-3's table; scheduler job; `publish_at` field and UI.
**Out of scope:** Bundle build (CE-1 handles removal).
**Technical notes:** Permission key: `content.items.publish`. Scheduler idempotent (re-run safe). RTM ids: CM-002, CM-007 (deactivated not displayed).
**Definition of done:** as standard.
**Dependencies:** CM-3, CE-1.

---

**Title:** [CM-7] Content audit history view
**Epic:** `content-management`
**Problem / context:** Annex H CM-003, §3.4 (complete content audit history).
**User story:** As a user with `content.audit.view` permission, I want to see the full change and approval history of a content item so that governance is verifiable.
**Acceptance criteria:**
- *Given* an item, *when* I open its audit tab, *then* I see every workflow transition and edit with actor, timestamp, from/to state and comments.
- *Given* filters (actor, action, date range), *when* applied, *then* results narrow.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** Read view over `audit_entry` filtered by target; filters; pagination.
**Out of scope:** System-wide audit viewer (SA-4).
**Technical notes:** Permission key: `content.audit.view`. RTM id: CM-003, CM-007 (audit records complete).
**Definition of done:** as standard.
**Dependencies:** CM-3.

---

### Epic: `currency-education`

---

**Title:** [CE-1] Published banknote/coin information delivered offline via content bundle
**Epic:** `currency-education` · **Also touches:** `content-management`
**Problem / context:** Annex H CE-001/002 (descriptions), UM-001 (offline), §2 (offline content storage and secure sync). First consumer of the content bundle sync service; closes the Release 1 loop from admin publish to end-user reading offline.
**User story:** As a Guest User, I want to browse published banknote and coin information, including security-feature descriptions, even without internet so that I can learn anywhere.
**Acceptance criteria:**
- *Given* items are `published`, *when* the bundle job runs, *then* a new `bundle` with incremented version, manifest and checksums containing only published versions is produced.
- *Given* the app is online, *when* the module opens, *then* it checks the manifest, downloads changed entries to a staging directory, verifies checksums and atomically swaps to the new bundle.
- *Given* a download is interrupted, *when* connectivity returns, *then* download resumes and the previously live bundle remains usable meanwhile.
- *Given* airplane mode, *when* I open Banknotes or Coins, *then* the last synced content lists series and denominations and shows each item's approved descriptions and images.
- *Given* an item was unpublished, *when* the next bundle syncs, *then* it no longer appears.
- *Given* the module opens, *then* a `content_view` analytics event is emitted per item opened (via AN-1 when present).
**In scope:** Bundle builder job; `GET /pisocamp/bundle/manifest`, asset download; client bundle store; Currency Education list/detail screens for banknotes, coins, security features; first-run packaged seed bundle.
**Out of scope:** 3D (CE-2); zoom/pan (CE-3); haptic/tilt (CE-4/5); on-demand large assets (AR-3).
**Technical notes:** Flows **RF-1** (build only from published) and **RF-6** (interrupted download). Bundle version monotonic; manifest signed. Local store under app documents dir; large 3D/AR assets flagged `on_demand`. RTM ids: CE-001, CE-002 (descriptions), UM-001, UM-006 (airplane mode).
**Definition of done:** as standard, plus interrupted-download test evidence.
**Dependencies:** F1, CM-3.

---

**Title:** [CE-2] Interactive 3D coin viewer
**Epic:** `currency-education`
**Problem / context:** Annex H CE-002 — rotate, obverse/reverse/edge, inspect angles, zoom in/out, reset — for all 14 mandatory coins (NGC 7, BSP Coin Series 7).
**User story:** As a Guest User, I want to rotate and zoom a 3D model of each coin so that I can inspect its design from every angle.
**Acceptance criteria:**
- *Given* a coin item with an attached approved 3D model, *when* I open the 3D view, *then* the model renders and I can rotate it freely by drag.
- *Given* the viewer, *when* I tap Obverse, Reverse or Edge, *then* the camera animates to that face.
- *Given* the viewer, *when* I pinch or use +/−, *then* the model zooms within limits; Reset returns the default view.
- *Given* the model is packaged/downloaded, *when* offline, *then* the viewer works.
- *Given* a device that cannot render the model, *when* opened, *then* a clear notice and the static images are shown.
- *Given* every mandatory coin, *then* each has a working model (checked by an automated coverage test against the bundle).
**In scope:** 3D viewer widget (glb/gltf); face presets; zoom/reset; coverage test; `feature_use{feature:3d_coin}` event.
**Out of scope:** AR (AR-1); banknote 3D (not required).
**Technical notes:** Renderer per existing app approvals (e.g. `model_viewer_plus` / Flutter 3D plugin); reduced-motion respected (F6). RTM ids: CE-002, CE-007.
**Definition of done:** as standard, plus 14-coin coverage evidence.
**Dependencies:** CE-1, CM-2.

---

**Title:** [CE-3] Zoom and pan for banknote and coin design elements
**Epic:** `currency-education`
**Problem / context:** Annex H CE-006, BR-012 — detailed inspection of first-level security features only; second-level features excluded.
**User story:** As a Guest User, I want to zoom and pan high-resolution images of banknote and coin design elements so that I can see first-level security features clearly.
**Acceptance criteria:**
- *Given* a banknote or coin item, *when* I open an image, *then* I can pinch-zoom and pan without pixelation at the approved zoom limit.
- *Given* security-feature hotspots, *when* I tap one, *then* its approved description appears; only items tagged `feature_level = first` are shown.
- *Given* a content item tagged `feature_level = second`, *when* the bundle is built, *then* it is excluded and a build warning is logged.
- *Given* offline, *then* zoom/pan works on downloaded images.
**In scope:** Zoomable image widget; hotspot overlay; `feature_level` field on security features (CM-1 extension); build-time guard.
**Out of scope:** Tilt effects (CE-5).
**Technical notes:** `InteractiveViewer`; images delivered as tiled or high-res in bundle. RTM ids: CE-006, BR-012, CE-007 (no second-level disclosure).
**Definition of done:** as standard.
**Dependencies:** CE-1.

---

**Title:** [CE-4] Haptic simulation of tactile banknote features
**Epic:** `currency-education`
**Problem / context:** Annex H CE-004 — simulate embossed prints, tactile marks and tactile dots for FPP (4), eNGC (5), NGC (6) notes using device haptics, with a visual alternative and clear "simulation" labelling.
**User story:** As a Guest User, I want to feel a haptic simulation of a banknote's tactile features when I touch them on screen so that I learn what to feel for on a real note.
**Acceptance criteria:**
- *Given* a banknote with an approved tactile-feature map, *when* I touch a mapped region, *then* the device plays the mapped haptic pattern and the region highlights.
- *Given* the feature opens, *then* a notice states it is a simulation.
- *Given* a device without haptics or with vibration disabled in accessibility settings, *when* I touch a region, *then* a visual-only alternative plays.
- *Given* continuous touch, *then* vibration is pattern-limited (no continuous vibration beyond the approved pattern length).
- *Given* every mandatory banknote, *then* each has a tactile map (coverage test).
**In scope:** `tactile_map` JSON on banknote content version (regions → pattern id); haptic engine; accessibility fallback; coverage test; `feature_use{feature:haptic}` event.
**Out of scope:** Tilt (CE-5).
**Technical notes:** `HapticFeedback` / platform haptics; pattern catalog approved by BSP stored in config. RTM ids: CE-004, CE-007.
**Definition of done:** as standard, plus device-matrix haptic test evidence.
**Dependencies:** CE-3.

---

**Title:** [CE-5] Tilt simulation of dynamic security features
**Epic:** `currency-education`
**Problem / context:** Annex H CE-005 — motion-sensor-driven simulation of dynamic features for the same 15 banknotes, with an on-screen alternative and "educational simulation" labelling.
**User story:** As a Guest User, I want to tilt my phone and see a banknote's dynamic security feature change as it would in real life so that I can recognise it.
**Acceptance criteria:**
- *Given* a banknote with an approved tilt effect asset, *when* I tilt the device, *then* the effect responds to orientation direction within the approved range.
- *Given* the feature opens, *then* it is labelled an educational simulation.
- *Given* no gyroscope/accelerometer or reduced-motion enabled, *when* I open it, *then* an on-screen slider drives the same effect.
- *Given* offline, *then* the simulation works from bundle assets.
- *Given* every mandatory banknote, *then* each has a tilt effect (coverage test).
**In scope:** Sensor listener; effect renderer (shader/sprite sequence per approved asset); slider fallback; coverage test; `feature_use{feature:tilt}` event.
**Out of scope:** AR (AR-1).
**Technical notes:** `sensors_plus`; sample rate throttled for battery (AN-025). RTM ids: CE-005, CE-007.
**Definition of done:** as standard.
**Dependencies:** CE-3.

### Epic: `gamification`

---

**Title:** [GM-1] Manage trivia questions through the content workflow
**Epic:** `gamification` · **Also touches:** `content-management`
**Problem / context:** Annex H GM-003, CE-003, BR-002. Questions are content: created, submitted, approved and published through CM-3, with question-specific fields.
**User story:** As a user with `content.items.edit` permission, I want to create and edit trivia questions with choices, correct answer, explanation, related topic, category and difficulty so that an approved question pool exists.
**Acceptance criteria:**
- *Given* the admin console, *when* I create a question (`content_type = trivia_question`) with 2–6 choices, exactly one correct, explanation, optional related-topic link, category, difficulty, *then* it saves as `draft`.
- *Given* a question, *when* I toggle `active`, *then* inactive questions are excluded from selection even if published.
- *Given* a draft question, *when* submitted/approved/published, *then* it follows CM-3 exactly and only `published` + `active` questions enter the bundle.
- *Given* a user without `content.items.edit`, *then* 403 + audit.
**In scope:** `trivia_question_detail` child table keyed by `content_version_id`; question form; list with category/difficulty filters.
**Out of scope:** Presentation (GM-2); tracking (GM-3).
**Technical notes:** Uses CM-3 transition service — no separate workflow. Permission keys: `content.items.edit` (+ CM-3 keys for workflow). RTM ids: GM-003, GM-008 (only approved published; deactivated not presented).
**Definition of done:** as standard.
**Dependencies:** CM-3, CE-1.

---

**Title:** [GM-2] Random trivia prompt with skip, correct and incorrect behaviour
**Epic:** `gamification`
**Problem / context:** Annex H GM-001/002/005/006, BR-003/004/005. Random selection from the active approved pool, skippable, five-second auto-close on correct, explanation + topic link on incorrect.
**User story:** As a Guest User, I want to be offered random trivia questions I can answer or skip so that learning is engaging without being forced.
**Acceptance criteria:**
- *Given* an active published pool in the bundle, *when* a prompt trigger fires (module home visit, topic completion), *then* a question is chosen at random excluding any shown within the configured repeat window (default 7 days) when enough questions exist.
- *Given* a prompt, *when* I dismiss or skip, *then* it closes and the module remains fully usable.
- *Given* I answer correctly, *then* a congratulatory message shows, score/progress is recorded (GM-3), and the prompt auto-closes after 5 seconds unless the accessibility "keep result" setting is on.
- *Given* I answer incorrectly, *then* the app shows "incorrect", the correct answer/explanation, and a link to the related topic I may choose to open.
- *Given* offline, *then* prompts work from locally stored questions.
- *Given* any presentation, then `trivia_prompt_shown/answered/skipped` events are emitted.
**In scope:** Selection service with local seen-history; prompt widget; timers; accessibility setting; config keys `trivia_repeat_days`.
**Out of scope:** Question admin (GM-1); persistence/sync of responses (GM-3); leaderboard (GM-4).
**Technical notes:** Randomization documented in SDD. Config via F2 service. RTM ids: GM-001, GM-002, GM-005, GM-006, BR-003–005, GM-008.
**Definition of done:** as standard.
**Dependencies:** GM-1, AN-1.

---

**Title:** [GM-3] Answer tracking and progress (local for guests, synced for registered)
**Epic:** `gamification`
**Problem / context:** Annex H GM-004, §3.2 (synchronize eligible progress), UM-001 (queued offline data). Records each presentation and outcome subject to account/consent rules.
**User story:** As a Registered End User, I want my trivia answers and points kept and synced across devices so that my progress is not lost.
**Acceptance criteria:**
- *Given* any user answers or skips, *when* recorded, *then* a `trivia_response` (question, response, correct flag, timestamp, category, skipped flag, link-opened flag, points) is stored locally.
- *Given* a registered active user online, *when* responses exist, *then* they sync to the server idempotently (client `response_id`).
- *Given* a guest who later registers, *when* the account is created, *then* local responses are merged to the account once.
- *Given* a deactivated account, *when* sync is attempted, *then* it is rejected and local data retained.
- *Given* offline responses, *when* connectivity returns, *then* they upload without duplicates.
**In scope:** `trivia_response` table; local store; `POST /pisocamp/trivia/responses` batch; merge on registration.
**Out of scope:** Leaderboard ranking (GM-4); progress UI (GM-5).
**Technical notes:** Same idempotency pattern as **RF-2**. RTM ids: GM-004, GM-008 (correct answers recorded accurately).
**Definition of done:** as standard.
**Dependencies:** GM-2, F3.

---

**Title:** [GM-4] Leaderboard with config flag, aliases, periods and rank movement
**Epic:** `gamification`
**Problem / context:** Annex H GM-007, AN-028/029. Registered-only, BSP-approved scoring, enable/disable switch, privacy-preserving display.
**User story:** As a Registered End User, I want to see my rank and score on a leaderboard for the current period so that I am motivated to keep learning.
**Acceptance criteria:**
- *Given* `leaderboard_enabled = true`, *when* a registered user opens Leaderboard, *then* they see their rank, score and the top N by alias for the selected period (weekly, monthly, all-time).
- *Given* a guest, *when* they open Leaderboard, *then* a clear notice explains registration is required.
- *Given* `leaderboard_enabled = false`, *then* the entry point is hidden and the API returns 404.
- *Given* a period rollover, *when* the ranking job runs, *then* `leaderboard_entry` stores rank and rank movement vs the prior interval.
- *Given* display names, *then* only the user's chosen alias (or a generated one) is shown; no email or real name.
- *Given* an admin without `admin.config.manage`, *when* toggling the flag, *then* 403 + audit.
**In scope:** `leaderboard_entry`; scoring job; `GET /pisocamp/leaderboard`; alias field on profile; screen; config key.
**Out of scope:** Leaderboard KPIs (AN-5).
**Technical notes:** Scoring method documented in SRD; job idempotent per period. Permission key (admin side): `admin.config.manage`. RTM ids: GM-007, GM-008 (calculations reconcile).
**Definition of done:** as standard, plus reconciliation test between `trivia_response` and `leaderboard_entry`.
**Dependencies:** GM-3, F2.

---

**Title:** [GM-5] Registered user progress view
**Epic:** `gamification`
**Problem / context:** Annex H §3.2 (view learning/activity progress). Read view over synced responses and content views.
**User story:** As a Registered End User, I want to see my learning progress (topics viewed, questions answered, accuracy, points) so that I know what to explore next.
**Acceptance criteria:**
- *Given* synced data, *when* I open Progress, *then* I see topics completed, questions answered, correct %, points, and last activity.
- *Given* no activity, *then* zeros are shown without error.
- *Given* offline, *then* the last synced summary is shown with an offline indicator.
**In scope:** Progress summary endpoint and screen.
**Out of scope:** Cross-user analytics (AN-5).
**Technical notes:** Computed server-side from `trivia_response` and `analytics_event content_view`. RTM id: §3.2.
**Definition of done:** as standard.
**Dependencies:** GM-3, AN-1.

---

### Epic: `augmented-reality`

---

**Title:** [AR-1] AR experience skeleton for one coin
**Epic:** `augmented-reality`
**Problem / context:** Annex H AR-001 — permissions explained before OS prompt, loading, instructions, exit, unsupported-device fallback. Module walking skeleton using one seeded NGC 20 Piso asset.
**User story:** As a Guest User, I want to place an animated 3D coin in my surroundings through the camera so that I can explore its design in augmented reality.
**Acceptance criteria:**
- *Given* a supported device, *when* I open the AR experience, *then* a screen explains why camera/motion access is needed before the OS permission prompt.
- *Given* permission granted, *when* the session starts, *then* a loading indicator shows, on-screen instructions appear, the approved 3D animation plays, and an Exit control returns cleanly to the previous screen.
- *Given* an unsupported device or denied permission, *then* a clear fallback message and the 3D viewer (CE-2) are offered.
- *Given* 10 consecutive open/close cycles, *then* no crash and no memory growth beyond the approved limit.
- *Given* the experience starts/ends, then `ar_start`/`ar_end` events are emitted.
**In scope:** ARKit/ARCore capability check; permission flow; AR view; exit; fallback; one seeded experience.
**Out of scope:** Content admin (AR-2); audio and full coverage (AR-3).
**Technical notes:** Flutter AR plugin approved by BSP (e.g. `ar_flutter_plugin` / platform views); fixed portrait orientation approved for AR (BR-006 exception). RTM ids: AR-001, AR-005.
**Definition of done:** as standard, plus device-matrix test evidence.
**Dependencies:** CE-2, AN-1.

---

**Title:** [AR-2] AR experience content admin
**Epic:** `augmented-reality` · **Also touches:** `content-management`
**Problem / context:** Annex H AR-004 — every AR experience has series, denomination, 3D assets, animation, audio, description, device requirements, asset version, approval and publication status.
**User story:** As a user with `content.items.edit` permission, I want to define an AR experience per denomination with its assets and device requirements so that approvers can review and publish it.
**Acceptance criteria:**
- *Given* the admin console, *when* I create an item of type `ar_experience` linked to a denomination with 3D, animation and audio assets, description and minimum device capability, *then* it saves as `draft`.
- *Given* a missing mandatory asset, *when* submitting for review, *then* submission is blocked with a message.
- *Given* workflow transitions, *then* CM-3 rules apply unchanged.
- *Given* a user without `content.items.edit` or `content.assets.upload`, *then* 403 + audit.
**In scope:** `ar_experience_detail` child table; form; validation.
**Out of scope:** Rendering (AR-1/3).
**Technical notes:** Permission keys: `content.items.edit`, `content.assets.upload`. RTM id: AR-004.
**Definition of done:** as standard.
**Dependencies:** CM-2, CM-3.

---

**Title:** [AR-3] Synchronized audio, full mandatory coverage and offline packaging
**Epic:** `augmented-reality`
**Problem / context:** Annex H AR-001 (synchronized audio), AR-002/003 (14 coins + 10 banknotes), AR-005 (offline where downloaded).
**User story:** As a Guest User, I want every listed coin and banknote to have an AR experience with narration in sync, available offline once downloaded, so that the full currency set is covered.
**Acceptance criteria:**
- *Given* a published AR experience, *when* it plays, *then* audio starts and ends in sync with the animation timeline (±100 ms in test).
- *Given* audio controls, *when* I mute or replay, *then* they work and captions/text alternative is shown.
- *Given* AR assets flagged `on_demand`, *when* I open the AR section online, *then* I can download all or per-item with progress; downloaded items work in airplane mode.
- *Given* the bundle, *then* an automated coverage test confirms all 24 mandatory items have published experiences.
- *Given* download interruption, then resume works (RF-6).
**In scope:** Audio sync engine; download manager UI; coverage test; captions.
**Out of scope:** Additional currencies (BR-010 change control).
**Technical notes:** Flow **RF-6**. RTM ids: AR-001, AR-002, AR-003, AR-005.
**Definition of done:** as standard, plus coverage and sync evidence.
**Dependencies:** AR-1, AR-2.

---

### Epic: `denomination-recognition`

---

**Title:** [DR-1] Camera scan → on-device denomination with audio and authenticity disclaimer
**Epic:** `denomination-recognition`
**Problem / context:** Annex H DR-001/002/003/007, BR-011. Identify FPP/NGC/eNGC denominations on-device, speak and show the result, always with the disclaimer; no image storage or upload.
**User story:** As a Guest User, I want to point my camera at a banknote and hear and see its denomination so that I can identify notes, while understanding this is not an authenticity check.
**Acceptance criteria:**
- *Given* camera permission explained and granted, *when* I point at a supported note and confidence ≥ threshold, *then* the denomination is displayed as text and spoken.
- *Given* any result, *then* the disclaimer "does not verify authenticity; if in doubt submit to an authorized agent bank or BSP" is shown and spoken; no wording implies authentication.
- *Given* a scan, *then* frames are processed in memory only — no image written to disk or sent over network (verified by test and network log).
- *Given* audio is unavailable/muted, *then* the visual result suffices; audio controls are present.
- *Given* the model file is missing or corrupt, *then* the feature shows "unavailable" and never guesses.
- *Given* a scan completes, then `recognition_result{outcome}` event (no image data) is emitted.
**In scope:** Camera view; TFLite (or approved) inference; class→denomination mapping; TTS/pre-recorded audio; disclaimer; `recognition_model` loading from bundle.
**Out of scope:** Uncertain handling (DR-2); demonetized/foreign (DR-3); model versioning/thresholds/harness (DR-4).
**Technical notes:** Flow **RF-5**. Fixed orientation approved. Only camera permission requested. RTM ids: DR-001, DR-002, DR-003, DR-007, BR-011.
**Definition of done:** as standard, plus privacy test evidence (no storage/upload).
**Dependencies:** CE-1, AN-1.

---

**Title:** [DR-2] Uncertain or failed recognition handling
**Epic:** `denomination-recognition`
**Problem / context:** Annex H DR-006 — below-threshold results must never produce a denomination claim; guide the user to improve the scan.
**User story:** As a Guest User, I want clear guidance when a note cannot be recognised so that I can retry successfully or exit.
**Acceptance criteria:**
- *Given* confidence < threshold for the approved dwell time, *then* the app says the note could not be recognised and shows tips on lighting, distance, orientation and visibility.
- *Given* the unrecognised state, *when* I choose Retry, *then* scanning resumes; *when* I choose Exit, *then* I return to the previous screen.
- *Given* an unrecognised state, *then* no denomination text or audio is produced.
- *Given* unrecognised, then `recognition_result{outcome:unrecognized}` is emitted.
**In scope:** Threshold/dwell logic; guidance UI; retry/exit.
**Out of scope:** Threshold values (DR-4 config).
**Technical notes:** Flow **RF-5**. RTM ids: DR-006, DR-009 (no false claims).
**Definition of done:** as standard.
**Dependencies:** DR-1.

---

**Title:** [DR-3] Demonetized and foreign banknote handling
**Epic:** `denomination-recognition`
**Problem / context:** Annex H DR-004/005, BR-007/008. Distinguish circulating legal tender from demonetized Philippine notes and from foreign currency.
**User story:** As a Guest User, I want the app to tell me when a note is demonetized or not Philippine currency so that I am not misled about its status.
**Acceptance criteria:**
- *Given* a supported demonetized Philippine note is detected, *then* audio and text state it belongs to a demonetized/non-circulating series and that recognition is for circulating legal tender.
- *Given* a foreign note is detected, *then* audio and text state it is not Philippine currency, without naming the currency.
- *Given* either case, *then* the authenticity disclaimer still plays.
- *Given* the class list in `recognition_model`, *then* demonetized and foreign classes map to these outcomes, never to a denomination.
**In scope:** Outcome mapping; messages/audio; tests against approved dataset classes.
**Out of scope:** Foreign denomination identification (§17 exclusion).
**Technical notes:** Flow **RF-5**. RTM ids: DR-004, DR-005, BR-007, BR-008.
**Definition of done:** as standard.
**Dependencies:** DR-1.

---

**Title:** [DR-4] Recognition model versioning, threshold configuration and accuracy harness
**Epic:** `denomination-recognition` · **Also touches:** `admin-security`
**Problem / context:** Annex H DR-008/009, §9 (model versions), §11.2. UAT cannot start until thresholds are approved; the model must be versioned and measurable against the controlled dataset.
**User story:** As a user with `admin.config.manage` permission, I want to publish a versioned recognition model with approved confidence thresholds and run the accuracy harness so that UAT thresholds are demonstrably met.
**Acceptance criteria:**
- *Given* a new model file, *when* uploaded with version, class list and thresholds, *then* it is stored as `recognition_model` and delivered to devices via the bundle; devices report which version they run.
- *Given* the approved test dataset (every series/denomination, demonetized, foreign, negatives, lighting/distance/orientation/wear variants), *when* the harness runs on the device matrix, *then* it outputs recognition accuracy, classification accuracy, p50/p95 response time and failure rate per class.
- *Given* threshold edits, *then* they are audited and take effect on next bundle sync.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** Model upload endpoint; bundle delivery; harness CLI + report; threshold config keys.
**Out of scope:** Model training itself (ML specialist deliverable, tracked in RTM as DR-008 dataset approval).
**Technical notes:** Permission keys: `admin.config.manage`, `admin.integrations.manage`. Harness results attach to TCP. RTM ids: DR-008, DR-009, §9.
**Definition of done:** as standard, plus harness report attached to TCP.
**Dependencies:** DR-1, DR-3, F2.

---

### Epic: `evaluation`

---

**Title:** [EV-1] Manage surveys through the content workflow
**Epic:** `evaluation` · **Also touches:** `content-management`
**Problem / context:** Annex H EV-001, §3.3 (manage surveys), BR-002. Surveys are content items with purpose and questions.
**User story:** As a user with `content.items.edit` permission, I want to create surveys (topic, satisfaction, feature, application, NPS, usefulness) with rating, NPS and text questions so that approved evaluations can be presented.
**Acceptance criteria:**
- *Given* the admin console, *when* I create an item of type `survey` with purpose, questions (rating 1–5, NPS 0–10, text) and optional topic/feature link, *then* it saves as `draft`.
- *Given* an NPS question, *then* wording and grouping (promoter 9–10, passive 7–8, detractor 0–6) are stored per SRD.
- *Given* workflow, *then* CM-3 applies; only published surveys enter the bundle.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** `survey_detail`, `survey_question` child tables; form.
**Out of scope:** Triggers (EV-3); presentation (EV-2).
**Technical notes:** Permission key: `content.items.edit`. RTM ids: EV-001, AN-019 (wording documented).
**Definition of done:** as standard.
**Dependencies:** CM-3.

---

**Title:** [EV-2] Consent-gated pop-up survey with offline queue
**Epic:** `evaluation`
**Problem / context:** Annex H EV-001/003/005, §4.2-L, UM-005. Responses only after notice + consent; declining never blocks; offline queue.
**User story:** As a Guest User, I want to optionally answer a short survey after giving consent so that I can share feedback without being forced.
**Acceptance criteria:**
- *Given* a survey trigger fires (EV-3; a simple "after topic completion" trigger seeded here), *when* the pop-up appears, *then* I can Decline and continue normally.
- *Given* I choose to answer and have no valid `survey` consent, *then* the privacy notice is shown first; on decline nothing is collected.
- *Given* valid consent, *when* I submit, *then* a `survey_response` is stored with consent reference, survey version and timestamp.
- *Given* offline, *when* I submit, *then* the response is queued encrypted and uploaded once, idempotently.
- *Given* submission, then `survey_shown/declined/submitted` events are emitted.
**In scope:** Pop-up widget; consent guard reuse (F4); local queue; `POST /pisocamp/surveys/responses`.
**Out of scope:** Trigger config (EV-3); survey reports (AN-6).
**Technical notes:** Flows **RF-2** (queue) and **RF-3** (consent). RTM ids: EV-001, EV-003, EV-005, §4.2-L.
**Definition of done:** as standard, plus consent-negative test.
**Dependencies:** EV-1, F4, AN-1.

---

**Title:** [EV-3] Configurable survey triggers and frequency
**Epic:** `evaluation`
**Problem / context:** Annex H EV-002 — triggers on page depth, activity completion, topic completion, module exit, app exit; rules and frequency configurable by BSP.
**User story:** As a user with `surveys.triggers.configure` permission, I want to set when and how often each survey appears so that users are not over-surveyed.
**Acceptance criteria:**
- *Given* a published survey, *when* I set trigger type, parameters (e.g. page depth = 5), frequency cap (e.g. once per 30 days) and priority, *then* the rules save and sync to devices via config.
- *Given* multiple eligible surveys, *when* a trigger fires, *then* only the highest-priority one shows and the frequency cap is enforced locally.
- *Given* a user without the permission, *then* 403 + audit.
- *Given* rule changes, then they are audited.
**In scope:** `survey_trigger_rule` table; admin UI; client trigger engine.
**Out of scope:** Exit advisory (EV-4).
**Technical notes:** Permission key: `surveys.triggers.configure`. RTM ids: EV-002, EV-005 (triggers work as configured).
**Definition of done:** as standard.
**Dependencies:** EV-2, F2.

---

**Title:** [EV-4] Exit advisory on proper currency handling
**Epic:** `evaluation`
**Problem / context:** Annex H EV-004, §1 (proper currency handling advisories). Approved advisory shown before module/app exit.
**User story:** As a Guest User, I want a brief approved advisory on handling currency properly when I leave Piso CAMP so that I take good practice with me.
**Acceptance criteria:**
- *Given* a published `advisory` item, *when* I exit the module (back from home or app background at the approved point), *then* the advisory (text/images/audio/links) is displayed once per configured interval.
- *Given* the advisory, *when* I dismiss it, *then* exit proceeds.
- *Given* offline, *then* the advisory renders from the bundle.
- *Given* display, then an `advisory_shown` event is emitted.
**In scope:** Exit hook; advisory widget; interval config key.
**Out of scope:** Advisory authoring (CM-1 type `advisory`).
**Technical notes:** RTM ids: EV-004, EV-005.
**Definition of done:** as standard.
**Dependencies:** CE-1, EV-3.

---

### Epic: `analytics-reporting`

---

**Title:** [AN-1] Analytics event pipeline: client SDK, encrypted offline queue, idempotent ingestion
**Epic:** `analytics-reporting`
**Problem / context:** Annex H §4.2-J (minimal event schema), §4.2-M (once and only once; offline sync without duplication), §11.3. Module walking skeleton for analytics using `module_entry` and `content_view`.
**User story:** As a user with `reports.dashboards.view` permission, I want every module action recorded exactly once, even when users are offline, so that KPIs are trustworthy.
**Acceptance criteria:**
- *Given* the client SDK, *when* a feature emits an event, *then* it is written to an encrypted local queue with a UUID `event_id`, timestamp, pseudonymous subject id, session id, account type, screen/feature, app/OS version, device category, network state, status.
- *Given* connectivity, *when* the queue uploads in batches, *then* the server inserts on unique `event_id` and returns acked ids; the client deletes acked rows.
- *Given* an upload that timed out after server commit, *when* the client resends, *then* no duplicate rows exist (verified by test).
- *Given* an event payload containing an email, name or raw image, *when* emitted, *then* the SDK rejects it (schema validation) and logs a dev error.
- *Given* a registered dashboard user, *when* they open the first dashboard tile, *then* it shows count of `module_entry` today.
**In scope:** `analytics_event` table; `POST /pisocamp/events`; client SDK with event catalog; first dashboard tile; permission gate.
**Out of scope:** Sessions/KPIs (AN-2+); PII-scoped reports (AN-10).
**Technical notes:** Flow **RF-2**. Event catalog in `docs/analytics-events.md`; feature tickets register names there. Permission key: `reports.dashboards.view`. RTM ids: §4.2-J, §4.2-M, §11.3.
**Definition of done:** as standard, plus duplicate-resend test evidence.
**Dependencies:** F1, F2.

---

**Title:** [AN-2] Sessions and DAU/MAU/stickiness/session dashboard
**Epic:** `analytics-reporting`
**Problem / context:** Annex H AN-005–012. Session definition and inactivity timeout documented; engagement KPIs computed from events.
**User story:** As a user with `reports.dashboards.view` permission, I want DAU, MAU, DAU/MAU ratio, concurrent users, peak hours, sessions per user, average session duration and screen views per session so that engagement is measurable.
**Acceptance criteria:**
- *Given* events, *when* the sessioniser runs, *then* a `session` groups events with gaps < `session_inactivity_minutes` (Asia/Manila days).
- *Given* a date range, *when* the dashboard loads, *then* DAU, MAU (rolling 30 days), DAU/MAU %, sessions per user, average duration, screen views per session, peak hours and concurrent sessions per 5-minute interval display.
- *Given* a sample of raw events, *when* recomputed by hand in the test suite, *then* KPI values reconcile exactly.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** `session` table + job; KPI queries; dashboard page.
**Out of scope:** Feature usage (AN-3); retention (AN-4); exports (AN-9).
**Technical notes:** Formulas per SRD (AN-005–012). Permission key: `reports.dashboards.view`. RTM ids: AN-005–AN-012.
**Definition of done:** as standard, plus reconciliation test.
**Dependencies:** AN-1.

---

**Title:** [AN-3] Feature usage, activation and time-to-first-key-action
**Epic:** `analytics-reporting`
**Problem / context:** Annex H AN-002/003/004/013. Account creation rate, key-action timing, first-day activation, per-feature usage.
**User story:** As a user with `reports.dashboards.view` permission, I want feature usage counts and onboarding KPIs so that I can see what users adopt.
**Acceptance criteria:**
- *Given* `account_prompt_shown` and `profile_created` events, *then* Account Creation Rate = unique registered ÷ unique prompted × 100.
- *Given* the approved key-action list (config), *then* Time to First Key Action (median, p95) and First-Day Activation Rate (within 24 h of first entry) display.
- *Given* `feature_use` events, *then* usage is shown separately for each feature in AN-013 (currency education, banknotes, coins, 3D, haptic, tilt, zoom/pan, trivia, leaderboard, AR, recognition, surveys, advisory, external/internal links).
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** KPI queries; dashboard widgets; key-action config key.
**Out of scope:** Cohorts (AN-10).
**Technical notes:** Permission key: `reports.dashboards.view`. RTM ids: AN-002, AN-003, AN-004, AN-013.
**Definition of done:** as standard, plus reconciliation test.
**Dependencies:** AN-2, F3.

---

**Title:** [AN-4] Retention, churn, lifetime, re-engagement and reactivation
**Epic:** `analytics-reporting`
**Problem / context:** Annex H AN-015/016/017/026/027.
**User story:** As a user with `reports.dashboards.view` permission, I want Day 1/7/30 retention, churn, user lifetime, re-engagement and reactivation rates so that I understand whether users come back.
**Acceptance criteria:**
- *Given* cohorts by first-activity date, *then* D1/D7/D30 retention percentages display per cohort.
- *Given* the configured inactivity period (default 30 days), *then* churn rate, re-engagement rate and reactivation rate compute per SRD definitions.
- *Given* a user, *then* lifetime duration = last qualifying activity − first, up to churn or report end.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** Cohort tables/materialised views; dashboard widgets; config keys.
**Out of scope:** Demographic cuts (AN-10).
**Technical notes:** Permission key: `reports.dashboards.view`. RTM ids: AN-015, AN-016, AN-017, AN-026, AN-027.
**Definition of done:** as standard, plus reconciliation test.
**Dependencies:** AN-2.

---

**Title:** [AN-5] Gamification and trivia metrics
**Epic:** `analytics-reporting`
**Problem / context:** Annex H AN-028–032.
**User story:** As a user with `reports.dashboards.view` permission, I want leaderboard participation, rank movement, top-performer retention, trivia participation and learning re-engagement so that gamification effectiveness is visible.
**Acceptance criteria:**
- *Given* `leaderboard_entry`, *then* participation rate = participating registered ÷ eligible registered, and rank movement between intervals displays.
- *Given* the configured top group (e.g. top 10%), *then* retention of that group displays.
- *Given* trivia events/responses, *then* viewed, answered, skipped, correct, incorrect, completion rate and repeat participation display.
- *Given* `content_view` after a trivia event, related-link open or engagement prompt, *then* re-engagement in learning modules displays.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** KPI queries; widgets.
**Out of scope:** —
**Technical notes:** Permission key: `reports.dashboards.view`. RTM ids: AN-028–AN-032, GM-008 (required analytics events generated).
**Definition of done:** as standard, plus reconciliation with `trivia_response`.
**Dependencies:** AN-2, GM-4.

---

**Title:** [AN-6] Evaluation, ratings and NPS metrics
**Epic:** `analytics-reporting`
**Problem / context:** Annex H AN-018/019/020, EV-005 (reports reconcile with responses).
**User story:** As a user with `reports.dashboards.view` permission, I want survey results (response count, completion rate, average and distribution, topic and satisfaction ratings, NPS, consent status, period) so that user satisfaction is measured.
**Acceptance criteria:**
- *Given* `survey_response` rows, *then* per survey and period the listed metrics display; NPS = %promoters − %detractors.
- *Given* only consented responses exist, *then* counts match stored responses exactly.
- *Given* in-app feedback ratings, *then* they are consolidated with store ratings when AN-11 is present.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** KPI queries; widgets.
**Out of scope:** Store ratings import (AN-11).
**Technical notes:** Permission key: `reports.dashboards.view`. RTM ids: AN-018, AN-019, AN-020, EV-005.
**Definition of done:** as standard.
**Dependencies:** AN-2, EV-2.

---

**Title:** [AN-7] Technical metrics: crash, load time, API, network failures, size/battery
**Epic:** `analytics-reporting`
**Problem / context:** Annex H AN-021–025, §11.7. Crash and API data from the existing monitoring tool; load time and network failures from module events; size/battery from performance test results.
**User story:** As a user with `reports.dashboards.view` permission, I want crash rate, load-time percentiles, API latency/error/timeout/auth-failure counts and network failure counts so that technical health is visible.
**Acceptance criteria:**
- *Given* the monitoring integration, *then* crash count, affected users/sessions, crashes per session and crash-free session rate display for the period.
- *Given* `module_load` timing events, *then* p50, p95 and max display.
- *Given* API gateway logs/metrics for module endpoints, *then* request count, latency, error rate, timeouts and auth failures display per endpoint.
- *Given* `network_failure{type}` events (timeout, no connectivity, failed sync/download/report/upload), *then* counts by type display.
- *Given* the performance test run, *then* app size, module size increase, downloaded asset size, local storage and battery impact are recorded as a report entry.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** Monitoring-tool connector; timing and failure events in SDK; widgets; manual entry form for AN-025 test results.
**Out of scope:** Alerting (existing ops tooling).
**Technical notes:** Interface documented per §12. Permission key: `reports.dashboards.view`. RTM ids: AN-021–AN-025, §11.7.
**Definition of done:** as standard.
**Dependencies:** AN-2.

---

**Title:** [AN-8] Parameter-driven historical report with filters
**Epic:** `analytics-reporting`
**Problem / context:** Annex H §4.2-K — historical, parameter-driven reports filterable by date range, app version, feature, user type, age group, gender, region, city, device, OS, activity type, survey type, content topic, currency series, denomination; generation audited.
**User story:** As a user with `reports.reports.generate` permission, I want to run any KPI report for a past period with filters so that I can answer specific questions over time.
**Acceptance criteria:**
- *Given* a report definition, *when* I set parameters and filters from the approved list, *then* the report generates showing generation date, parameters, data period and data source.
- *Given* a historical period, *then* results reflect data as retained under BR-001, unchanged by later events.
- *Given* the report framework, *when* a new KPI is added, *then* it registers as a new `report_definition` without changing the framework.
- *Given* generation, *then* a `report_run` and an `audit_entry` are written.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** `report_definition`, `report_run`; parameter UI; filter engine; report registry.
**Out of scope:** Exports (AN-9); demographic filters require AN-10's consent scoping to return non-suppressed values.
**Technical notes:** Permission key: `reports.reports.generate`. RTM ids: §4.2-K, BR-001.
**Definition of done:** as standard.
**Dependencies:** AN-2, AN-3.

---

**Title:** [AN-9] Export reports to Excel, Word and PDF with generation metadata
**Epic:** `analytics-reporting`
**Problem / context:** Annex H §4.2-K (export), BR-009, §10 (prevention of unauthorized export).
**User story:** As a user with `reports.reports.export` permission, I want to export a generated report to Excel, Word or PDF so that it can be shared per BSP templates.
**Acceptance criteria:**
- *Given* a generated report, *when* I export in each format, *then* the file opens in Excel/Word/a PDF reader with data, generation date, parameters, period and source.
- *Given* an export, *then* it is audited with format and user.
- *Given* a user with `reports.reports.generate` but not `export`, *then* 403 + audit.
- *Given* BSP report templates, *then* exports use the approved template layout.
**In scope:** Export service (xlsx/docx/pdf libs per backend stack); template mapping; download endpoint.
**Out of scope:** Scheduled email delivery.
**Technical notes:** Permission key: `reports.reports.export`. RTM ids: §4.2-K, BR-009, §4.2-M (exports open).
**Definition of done:** as standard, plus opened-file evidence for all three formats.
**Dependencies:** AN-8.

---

**Title:** [AN-10] Demographic and cohort reports with small-group suppression
**Epic:** `analytics-reporting`
**Problem / context:** Annex H §4.2-I (age, gender, region, city distributions and cuts), §4.2-J (no PII), §3.5 (PII only where explicitly authorised), UM-005.
**User story:** As a user with `reports.dashboards.view` permission, I want aggregate demographic breakdowns of usage and retention with privacy suppression so that I can analyse cohorts lawfully.
**Acceptance criteria:**
- *Given* profiles with `demographic_analytics` consent, *then* age-group, gender, region and city distributions, DAU by gender, session duration by gender, retention by age/gender/region/city and churn by region/city display.
- *Given* any group below the configured minimum (default 10), *then* its value is suppressed and marked.
- *Given* users without consent, *then* their data is excluded from demographic cuts (but not from non-demographic KPIs).
- *Given* a user holding `reports.pii.view`, *when* they open the PII drill-down, *then* it is shown and audited; without it, no row-level data is reachable.
- *Given* a user without `reports.dashboards.view`, *then* 403 + audit.
**In scope:** Consent-scoped joins; suppression rule; widgets; PII drill-down gate.
**Out of scope:** —
**Technical notes:** Flow **RF-3** (consent scoping). Permission keys: `reports.dashboards.view`, `reports.pii.view`. Age-group buckets in config. RTM ids: §4.2-I, §4.2-J, §4.2-M (PII not exposed).
**Definition of done:** as standard, plus suppression test.
**Dependencies:** AN-4, F3, F4.

---

**Title:** [AN-11] Install volume and store ratings consolidation
**Epic:** `analytics-reporting`
**Problem / context:** Annex H AN-001, AN-018 (store reports).
**User story:** As a user with `reports.dashboards.view` permission, I want download/install/first-open counts and store ratings consolidated with in-app feedback so that acquisition and satisfaction are complete.
**Acceptance criteria:**
- *Given* `first_open` events and store report imports (CSV/API per BSP access), *then* install volume displays with data source labelled and double-counting avoided where feasible.
- *Given* store ratings, *then* average and count display alongside in-app ratings.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** Import job/upload form; widgets.
**Out of scope:** —
**Technical notes:** Interface documented per §12. Permission key: `reports.dashboards.view`. RTM ids: AN-001, AN-018.
**Definition of done:** as standard.
**Dependencies:** AN-6.

---

### Epic: `admin-security`

---

**Title:** [SA-1] Activate and deactivate accounts
**Epic:** `admin-security`
**Problem / context:** Annex H UM-004, §3.6. Deactivated accounts cannot authenticate to registered-only functions; history retained.
**User story:** As a user with `admin.accounts.manage` permission, I want to activate or deactivate a user account so that access can be controlled without deleting history.
**Acceptance criteria:**
- *Given* an active account, *when* I deactivate it with a reason, *then* status becomes `deactivated`, sessions are invalidated, and the change is audited.
- *Given* a deactivated account, *when* it attempts login or a registered-only API call, *then* it is refused with a clear message; guest features remain usable.
- *Given* a deactivated account, *then* its historical data is retained.
- *Given* reactivation, *then* access resumes and is audited.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** Account list/search; status toggle; existing auth service integration for session invalidation.
**Out of scope:** Data deletion (SA-7).
**Technical notes:** Permission key: `admin.accounts.manage`. Flow **RF-4** (deactivated short-circuit). RTM ids: UM-004, UM-006.
**Definition of done:** as standard.
**Dependencies:** F2, F3.

---

**Title:** [SA-2] Assign and revoke roles
**Epic:** `admin-security`
**Problem / context:** Annex H §3.6 (assign approved roles, revoke access), §10 least privilege.
**User story:** As a user with `admin.roles.assign` permission, I want to assign and revoke roles on users and view each role's permission keys so that least privilege is maintained.
**Acceptance criteria:**
- *Given* a user, *when* I assign a role, *then* their permissions update immediately and the change is audited.
- *Given* a role, *when* I revoke it, *then* affected permissions are removed on the next request.
- *Given* the role list, *then* each role shows its permission keys read-only (bundle editing is a later CAF).
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** Role assignment UI; `PUT /admin/pisocamp/users/{id}/roles`.
**Out of scope:** Custom role editing.
**Technical notes:** Permission key: `admin.roles.assign`. RTM ids: §3.6, §10.
**Definition of done:** as standard.
**Dependencies:** F2.

---

**Title:** [SA-3] Manage module configuration
**Epic:** `admin-security`
**Problem / context:** Annex H §3.6 (manage module configurations), GM-001 (repeat window), AN-010 (session timeout), UM-005 (notice version), GM-007 (leaderboard flag).
**User story:** As a user with `admin.config.manage` permission, I want to edit all Piso CAMP configuration keys with validation so that behaviour is tunable without a release.
**Acceptance criteria:**
- *Given* the config screen, *when* I edit a key (session timeout, trivia repeat days, leaderboard flag, advisory interval, key-action list, age buckets, suppression minimum, active notice version, recognition thresholds), *then* it validates by type/range, saves and is audited with before/after.
- *Given* a saved change, *when* devices next sync, *then* the public subset is delivered via `GET /pisocamp/config`.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** Key registry with defaults and validators; UI.
**Out of scope:** Integration credentials (SA-5/DR-4 under `admin.integrations.manage`).
**Technical notes:** Extends F2. Permission key: `admin.config.manage`. RTM id: §3.6.
**Definition of done:** as standard.
**Dependencies:** F2.

---

**Title:** [SA-4] Administrative audit log viewer
**Epic:** `admin-security`
**Problem / context:** Annex H §3.6 (view administrative audit logs), §10 (audit logging for administrative activity), §4.2-K (report generation audit).
**User story:** As a user with `admin.audit.view` permission, I want to browse and filter all administrative audit entries so that I can review who did what and when.
**Acceptance criteria:**
- *Given* the viewer, *then* entries show actor, action, target, before/after, timestamp, including `permission_denied` and report generation entries.
- *Given* filters (actor, action, target type, date range), *then* results narrow; results are paginated.
- *Given* an export request, *then* it goes through AN-9 and is itself audited.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** Viewer; filters; pagination.
**Out of scope:** SIEM forwarding.
**Technical notes:** Permission key: `admin.audit.view`. RTM ids: §3.6, §10.
**Definition of done:** as standard.
**Dependencies:** F2.

---

**Title:** [SA-5] Push notifications: opt-in, send approved notification, metrics
**Epic:** `admin-security` · **Also touches:** `analytics-reporting`
**Problem / context:** Annex H §3.2 (opt-in push), AN-014, §12 (existing push service).
**User story:** As a user with `admin.notifications.send` permission, I want to send a BSP-approved notification to opted-in registered users and see delivery metrics so that re-engagement can be measured.
**Acceptance criteria:**
- *Given* a registered user, *when* they opt in from settings, *then* a `push_subscription` is stored; opt-out removes it.
- *Given* an approved notification text and deep link, *when* I send, *then* it is dispatched via the existing push service and audited.
- *Given* sends, *then* opt-in rate, delivery rate, open rate, click rate, failed delivery rate and re-engagement attributable (opens leading to a qualifying activity within 24 h) display on the dashboard.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** Subscription; send UI; delivery/open/click events; widgets.
**Out of scope:** Scheduling/segmentation beyond "all opted-in".
**Technical notes:** Permission keys: `admin.notifications.send`, `admin.integrations.manage` (service config). Interface documented per §12. RTM ids: §3.2, AN-014.
**Definition of done:** as standard.
**Dependencies:** F3, AN-2, F5.

---

**Title:** [SA-6] Security hardening and observability pass
**Epic:** `admin-security`
**Problem / context:** Annex H §10, §11.6, §11.7, §13.2 (security testing, vulnerability scanning), Milestone 2 (Critical/High remediated before production).
**User story:** As a user with `admin.audit.view` permission, I want evidence that the module meets the minimum security and observability controls so that production Go-Live conditions are satisfied.
**Acceptance criteria:**
- *Given* the mobile module, *then* tokens and queues use secure storage/encryption at rest, no hard-coded credentials exist (scan passes), input validation and output encoding are applied on all endpoints.
- *Given* dependency and third-party inventory, *then* it is generated from lockfiles and attached to release docs.
- *Given* vulnerability scans (mobile, API, admin), *then* no Critical/High remains open.
- *Given* logs, *then* app, API, sync, publication, auth, report, recognition and AR failures are logged with correlation ids and contain no PII, credentials or images.
- *Given* an audit of the checklist, *then* results are attached to the security documentation.
**In scope:** Hardening fixes; log review; inventory scripts; scan evidence.
**Out of scope:** Penetration testing scheduling (BSP-led).
**Technical notes:** Cross-cutting; runs before UAT. RTM ids: §10, §11.6, §11.7.
**Definition of done:** as standard, plus scan reports attached.
**Dependencies:** all Release 1–2 tickets.

---

**Title:** [SA-7] Consent withdrawal and data-subject export/delete
**Epic:** `admin-security`
**Problem / context:** Annex H UM-005 (withdrawal/modification of consent), Part A §XIX–XX (data subject requests, secure deletion), §10 (secure deletion).
**User story:** As a Registered End User, I want to withdraw consent and request a copy or deletion of my Piso CAMP data so that my privacy rights are honoured.
**Acceptance criteria:**
- *Given* settings, *when* I withdraw a consent purpose, *then* a `withdrawn` `consent_record` is written and consent-dependent collection stops immediately.
- *Given* an export request, *then* a readable, documented file of my profile, consents, responses and progress is produced per BSP process.
- *Given* a deletion request approved by BSP process, *when* executed by a user with `admin.accounts.manage`, *then* personal data is securely deleted or pseudonymised per retention policy, analytics aggregates are preserved, and the action is audited.
- *Given* a user without the permission, *then* 403 + audit.
**In scope:** Settings screen; export job; deletion job; admin trigger.
**Out of scope:** Automated request intake (BSP process).
**Technical notes:** Flow **RF-3**. Permission key: `admin.accounts.manage`. RTM ids: UM-005, §XIX, §XX.
**Definition of done:** as standard.
**Dependencies:** F4, SA-1.

---

## 4. Risky-path flows (referenced above)

**RF-1 Content publish → bundle → client visibility.** Approver publishes → server checks `content.items.publish` and state `approved` → status `published`, new immutable version `current_published` → audit → bundle job builds from `published` only, increments `bundle_version`, writes checksums → client compares manifest, downloads diff to staging, verifies, atomic swap. *Failure:* bundle build fails → item flagged `bundle_pending`, next build retries; client never sees a partial bundle. *Risk:* CM-006 and rollback correctness depend on ordering and immutability.

**RF-2 Offline queue → exactly-once ingestion.** Client generates UUID `event_id` → encrypted local queue → batch upload → server upsert on unique key → acked ids → client deletes. *Failure:* timeout after commit → resend → duplicates rejected and acked. *Risk:* §4.2-M; naive retry double-counts.

**RF-3 Consent gate.** Consent-dependent action → check latest `consent_record` for the active notice version → none/withdrawn/outdated → show notice → accept (record) or decline (record, skip collection, feature usable) → collect only after `granted`. *Failure:* notice version bumped → `requires_reconsent`; collection stops. *Risk:* UM-005, §4.2-L are legal obligations.

**RF-4 Admin permission enforcement.** Request → existing auth → account `deactivated` → 401 → roles → permissions → key present → proceed + audit; absent → 403 + `permission_denied` audit. *Risk:* security-critical prerequisite for every admin ticket.

**RF-5 Recognition decision.** Frame → on-device inference → confidence < threshold → `unrecognized` (guidance, retry/exit) → class foreign → "not Philippine currency" → class demonetized → demonetized notice → else denomination (visual + audio); disclaimer on every result; frames discarded, never stored/uploaded. *Failure:* model missing/corrupt → "unavailable", never guess. *Risk:* BR-011, DR-006, DR-007.

**RF-6 Bundle download with interruption.** Manifest → version compare → staged download with resume → per-asset checksum → atomic rename → record version. *Failure:* connectivity lost → staging kept, resume later, live content untouched. *Risk:* §11.3/11.4 corruption on interrupted sync.

Standard create-and-view screens (question list, survey list, report list, account list, config forms) need no flow; their acceptance criteria suffice.

---

## How a developer uses this package
1. Open your assigned ticket in this file → create a branch `<KEY>-short-name` from the issue.
2. Build from the acceptance criteria; run the referenced risky-flow (RF-n) checks and the Definition of Done before opening the PR.
3. When unsure, consult `DOMAIN-MODEL.md` for entity names, state machines and permission keys, and `PRD.md` for constraints, non-goals and decisions.
