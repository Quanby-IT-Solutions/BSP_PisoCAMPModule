# PRD — Piso CAMP Module (BSP Mobile Application)

Source: *BSP Terms of Reference — Application Enhancements and Development Services for the Existing BSP Mobile Application, including the Piso CAMP Module* (TDIO Form 04-008, approved 7 May 2026), Part A–C and **Annex H** (mandatory minimums).
Scope of this package: **Piso CAMP Module only** (Annex H). Time-and-Material enhancement work (100 man-days, Part B §II.1) is ticketed per Change Authorization Form as each request arrives, using `ticket-template.md`, with epic key `tm-<CAF-number>`.
Stack: Flutter (existing BSP Mobile App, Part C §I) · existing BSP backend REST API behind the BSP API gateway with its relational database (Annex H §2, §12) · existing BSP admin web console extended for content/report/admin screens · on-device ML model (TFLite or equivalent) for denomination recognition · existing BSP push, monitoring/crash and auth services where they exist.

---

## Problem
BSP's mobile app has no structured currency-education or public-engagement capability. Currency content, trivia, surveys and the associated usage analytics either do not exist in-app or are unmanaged, so BSP cannot educate the public about banknote/coin features, cannot measure engagement, and cannot govern what content is published.

## Goal
Deliver, within six months of NTP, a production-ready Piso CAMP section inside the existing BSP Mobile Application that: works offline for packaged content; lets guests and registered users learn currency features through text, 3D, haptic, tilt, zoom/pan, AR and camera-based denomination recognition; engages users with trivia, leaderboard and surveys; is fed only by BSP-approved content through a draft → review → approve → publish workflow; and produces the KPI reports in Annex H §4.2 with Excel/Word/PDF export.

## Primary users
- **Guest User** — enters without registration; uses all educational, 3D/AR, recognition, trivia and optional-survey features.
- **Registered End User** — guest functions plus profile, synced progress, leaderboard, opt-in push.
- **Content Administrator** — drafts content, uploads assets, submits for review.
- **Content Approver** — approves/rejects, publishes, schedules, restores versions.
- **Reports & Analytics User** — dashboards, filters, historical reports, exports.
- **System Administrator** — accounts, roles, configuration, audit logs, integrations.

## Non-goals (v1)
- Banknote authenticity verification (BR-011, §17) — recognition identifies denomination only.
- Second-level security feature content (BR-012).
- Identifying foreign currency beyond "not Philippine currency" (DR-005).
- Currency series/denominations not listed in Annex H (BR-010) — added later via content update or CAF.
- A standalone Piso CAMP app or any non-Flutter mobile framework (Annex H §2, UI-001).
- Server-side or stored camera images (DR-007).
- Replacing existing BSP auth, navigation, design system or API gateway — the module integrates with them.

## Key constraints
- **Approved content only.** Nothing reaches end users unless in `published` state via the content workflow (CM-006, BR-002). Every content type flows through the same `content_item` state machine.
- **Offline-first.** Packaged/downloaded content, 3D, haptic, tilt, zoom/pan, local trivia and on-device recognition must work in airplane mode (UM-001). Connectivity-dependent functions show a plain-language notice, never fail silently.
- **Exactly-once analytics.** Events carry a client-generated id; server ingestion is idempotent (§4.2-M).
- **Consent before collection.** Personal data, survey responses and demographic analytics are collected only after the approved privacy notice is shown and consent recorded with notice version (UM-005, §4.2-L).
- **Least privilege.** Every admin action is gated by a permission key and audited (§10, CM-007).
- **Mandatory currency coverage.** NGC coins (7), BSP Coin Series (7), FPP banknotes (4), eNGC (5), NGC (6) per CE-002/004/005, AR-002/003, DR-001.
- **Never claim authenticity.** Disclaimer shown and spoken on every recognition result (DR-003).

## Non-functional requirements
- Timezone: Asia/Manila for all reporting periods, session windows and retention cohorts.
- Security: RBAC + least privilege; TLS in transit; encryption of sensitive local (secure storage/keystore) and server data at rest; no hard-coded credentials; dependency inventory; vulnerability scan with Critical/High fixed before production (Annex H §10).
- Performance targets (launch, screen load, API, report generation, AR init, recognition response, sync, app size, storage, battery) are set in the SRD/TCP before performance testing (§11.2); tickets record measured values.
- Reliability: no corruption on interrupted sync; state preserved on orientation change; graceful network failure; no duplicate queued submissions (§11.3).
- Compatibility: OS versions and device classes of the production app at NTP; supported-device matrix delivered in Milestone 1 (§11.1).
- Accessibility: font scaling, screen-reader labels, focus order, contrast, non-color indicators, touch targets, audio alternatives, reduced motion, orientation (UI-008).
- Observability: logs/monitoring for app, API, sync, publication, auth, report, recognition and AR failures; no PII in logs (§11.7).
- Retention: existing BSP Mobile App retention policy (BR-001).
- Integration: every interface documented per §12 (name, purpose, systems, data, auth, errors, retry, timeout, logging, owner); no production integration activated without BSP approval.
- Governance: every ticket maps to a requirement id in the Requirements Traceability Matrix (§13.1); no Critical/High defect at Go-Live (§13.4).

## Definition of Ready
A ticket may start when it has Given/When/Then acceptance criteria, its dependencies are identified, its Annex H requirement ids are named, and any risky flow it touches (RF-1 … RF-6 in TICKETS.md) is referenced.

## Definition of Done
Code + tests merged · acceptance criteria pass · permission/audit checks verified · consent gate verified where applicable · RTM row updated · PR reviewed · docs (SRD/SDD/manuals/release notes as applicable) updated.

## Decisions made

**Business-fact calls (defaults accepted by the user):**
1. *Backend stack* — existing BSP REST backend + relational DB behind the API gateway; admin screens extend the existing admin web console (or a small web admin app on the same backend if none exists). Rationale: Annex H §2 forbids introducing incompatible frameworks.
2. *Analytics store* — Piso CAMP owns its own analytics event tables in the BSP backend; crash/load/API metrics are read from the existing monitoring tool. Rationale: §4.2 KPI formulas are custom and must reconcile with source records; third-party dashboards cannot guarantee that.
3. *User accounts* — reuse the existing app auth/account service; Piso CAMP adds profile fields (gender, age, region, city), guest mode and consent records. Rationale: §12 lists the existing account service as the integration target.
4. *Leaderboard* — built behind an admin config flag, enabled at launch. *Push notifications* — via the existing push service, opt-in only, delivered as a late Release 3 slice. Rationale: AN-028–030 require leaderboard data; push is "where used".
5. *Package scope* — Piso CAMP only; T&M work ticketed per CAF.

**Best-practice calls (auto-resolved):**
- RBAC is in scope (Annex H §3, §10); admin stories name permission keys `module.submodule.action`; end-user stories use the Guest/Registered persona because they are gated by account state, not permission keys.
- No division/tenant segregation — BSP is a single organization; PII access is a permission (`reports.pii.view`), not a data partition.
- One generic `content_item` + `content_version` model for all content types (CM-001) rather than per-type workflows; the workflow engine is built once in CM-3 and reused by trivia, surveys, AR, advisories.
- Content delivery to devices is by versioned, checksummed bundles (manifest + assets) with atomic swap; large assets (3D/AR) downloaded on demand and cached.
- Recognition runs entirely on device (DR-007); model versioned and shipped via the bundle mechanism; accuracy harness built before UAT (DR-008).
- Sessions: 30-minute inactivity timeout as the SRD default (AN-010), configurable.
- Timestamps stored in UTC, reported in Asia/Manila.
- Migrations additive only; no destructive schema changes during the contract.
- Ticket size 1–2 days, vertical slices, walking-skeleton-first per epic, shared services (workflow, bundle sync, event pipeline, permission spine) grown through their first consumer.
