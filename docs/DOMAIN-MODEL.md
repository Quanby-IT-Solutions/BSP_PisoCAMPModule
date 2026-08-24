# DOMAIN-MODEL — Piso CAMP Module

Shared vocabulary for every ticket. Entity names here are the names used in code, tables, APIs and tickets.

---

## 1. Glossary (ubiquitous language)

- **Module** — the Piso CAMP section inside the BSP Mobile App (Flutter).
- **Account** — a user identity from the existing BSP auth service. Has `status ∈ active | deactivated`.
- **Profile** — Piso CAMP extension of an Account: name, gender, age, email, region, city (UM-003).
- **Guest** — a device-scoped pseudonymous identity (`device_pseudo_id`) with no Account.
- **Consent record** — an immutable row capturing a user's/guest's response to a specific version of the Privacy Notice (UM-005).
- **Privacy notice** — versioned BSP-approved text; bumping the version invalidates earlier consents for consent-dependent features.
- **Content item** — any manageable piece of module content (CM-001): currency series, denomination, banknote/coin description, security feature, design element, trivia question, survey, advisory, link, AR experience. Has a `content_type` and a lifecycle `status`.
- **Content version** — an immutable snapshot of a content item's fields + asset references, created on every submit/approve/publish/restore (CM-003/005). Exactly one version is `current_published`.
- **Asset** — an uploaded image, audio, 3D model, texture or AR animation file with checksum, mime type and version (CM-002).
- **Bundle** — a versioned, checksummed package (manifest + assets) of all `published` content delivered to devices for offline use (UM-001).
- **Currency series** — FPP (Polymer), eNGC, NGC banknote series; NGC coins, BSP Coin Series.
- **Denomination** — a series + face value (e.g. NGC 20 Piso coin, FPP 1000 Piso note) — the unit of mandatory coverage.
- **Trivia question** — content item with choices, correct choice, explanation, related-topic link, category, difficulty, active flag (GM-003).
- **Trivia response** — one presentation of a question to a user and the outcome (answered correct/incorrect/skipped) (GM-004).
- **Score / Leaderboard entry** — accumulated points per registered user per reporting period; rank and rank movement (GM-007).
- **Survey** — content item with questions (rating, NPS, free text), a purpose (EV-001) and trigger rules (EV-002).
- **Survey response** — consent-gated submission of answers (EV-005, §4.2-L).
- **Advisory** — proper-currency-handling content shown before exit (EV-004).
- **AR experience** — content item linking a denomination to 3D assets, animation, audio, description, device requirements (AR-004).
- **Recognition model** — versioned on-device ML model file with class list (denominations, demonetized classes, foreign class, non-banknote) and confidence thresholds (DR-008, §9).
- **Analytics event** — minimal, pseudonymous, idempotent usage record (§4.2-J).
- **Session** — a run of events from a user/guest with gaps < inactivity timeout (30 min default).
- **Report** — a parameter-driven query over events/responses/content, exportable to Excel/Word/PDF (§4.2-K).
- **Audit entry** — immutable record of an administrative or workflow action (CM-003, §10).
- **Module configuration** — admin-managed settings: leaderboard enabled, trivia repeat window, session timeout, survey trigger rules, notice version.

### Permission-key convention (RBAC)
`module.submodule.action`, lower-case, dot-separated. Roles are admin-configurable bundles of keys; the six Annex H roles are the seed bundles. Stories and middleware use the **same key**.

| Key | Seed role(s) | Used by |
|---|---|---|
| `content.items.edit` | Content Administrator | CM-1, GM-1, EV-1, AR-2 |
| `content.assets.upload` | Content Administrator | CM-2, AR-2 |
| `content.items.submit` | Content Administrator | CM-3 |
| `content.items.approve` | Content Approver | CM-3 |
| `content.items.publish` | Content Approver | CM-3, CM-6 |
| `content.items.restore` | Content Approver | CM-4 |
| `content.items.preview` | Content Administrator, Approver | CM-5 |
| `content.audit.view` | Content Approver | CM-7 |
| `surveys.triggers.configure` | Content Approver | EV-3 |
| `reports.dashboards.view` | Reports & Analytics User | AN-2..7, AN-10, AN-11 |
| `reports.reports.generate` | Reports & Analytics User | AN-8 |
| `reports.reports.export` | Reports & Analytics User | AN-9 |
| `reports.pii.view` | (explicit grant only) | AN-10 |
| `admin.accounts.manage` | System Administrator | SA-1 |
| `admin.roles.assign` | System Administrator | SA-2 |
| `admin.config.manage` | System Administrator | SA-3, GM-4 flag, DR-4 thresholds |
| `admin.audit.view` | System Administrator | SA-4 |
| `admin.notifications.send` | System Administrator | SA-5 |
| `admin.integrations.manage` | System Administrator | SA-5, DR-4 |

End-user features (Guest / Registered) are gated by **account state** (`guest`, `registered-active`, `deactivated`) and **consent state**, not by permission keys.

---

## 2. Entities and relationships

```
account ──1:0..1── profile
   │
   ├──< consent_record >── privacy_notice (version)
   ├──< trivia_response >── content_item (question)
   ├──< leaderboard_entry (per period)
   ├──< survey_response >── content_item (survey)
   ├──< analytics_event >── session
   ├──< push_subscription
   └──< user_roles >── role >── role_permissions >── permission

guest (device_pseudo_id) ── same child rows as account where consent allows,
                            with account_id NULL and device_pseudo_id set

content_item ──< content_version ──< version_asset >── asset
   │  (status, content_type, currency_series, denomination)
   ├──< related_link (internal / external / topic)
   ├──< audit_entry
   └── bundle_manifest_entry >── bundle (bundle_version, checksum)

recognition_model (version, class_list, thresholds) ── delivered via bundle
module_configuration (key, value, updated_by)
report_definition ──< report_run (params, generated_at, generated_by, format)
audit_entry (actor, action, target_type, target_id, before, after, at)
```

## 3. Core tables with lifecycle notes

| Table | Written first by | Extended by | Lifecycle / notes |
|---|---|---|---|
| `profile` | F3 | SA-7 (deletion flags) | 1:1 with existing account; region/city FK to controlled lists `region`, `city`. |
| `privacy_notice`, `consent_record` | F4 | EV-2, AN-10, SA-7 | Append-only. Latest record per (subject, notice) decides state. |
| `content_item`, `content_version` | CM-1 | CM-2..7, GM-1, EV-1, AR-2 | State machine §4a. Versions immutable. **Cross-epic ownership risk** — see §5. |
| `asset`, `version_asset` | CM-2 | AR-2 | Checksummed; never deleted while referenced by a published version. |
| `bundle`, `bundle_manifest_entry` | CE-1 | AR-3, DR-4, GM-2 | Built from `published` versions only; versions monotonic. |
| `trivia_response` | GM-3 | GM-4, AN-5 | Guest rows keyed by device pseudo id; registered rows synced. |
| `leaderboard_entry` | GM-4 | AN-5 | Recomputed per period; rank movement stored. |
| `survey_response` | EV-2 | AN-6 | Inserted only when a valid consent exists. |
| `analytics_event`, `session` | AN-1 / AN-2 | all AN, GM, EV, AR, DR (emit only) | `event_id` unique → idempotent ingestion. No PII columns. |
| `recognition_model` | DR-4 | — | Versioned; thresholds editable under `admin.config.manage`. |
| `module_configuration` | F2 | SA-3, GM-4, EV-3, DR-4 | Key/value; every change audited. |
| `role`, `permission`, `role_permissions`, `user_roles` | F2 | SA-2 | Seeded with six Annex H roles. |
| `audit_entry` | F2 | every admin ticket | Append-only; includes `permission_denied`. |
| `report_definition`, `report_run` | AN-8 | AN-9, AN-10 | Report runs recorded for §4.2-K audit. |
| `push_subscription`, `notification` | SA-5 | — | Opt-in only. |

## 4. State machines

### 4a. Content item (the heart of the module — every content type uses it)
```
draft ──submit──► submitted_for_review ──approve──► approved ──publish──► published
  ▲                       │                                     ▲              │
  └───────reject──────────┘                                     │              ├──unpublish──► unpublished
  (rejected returns to draft with comments)                     │              │
                                                                 restore ◄──────┘  (restore = new version from a prior approved version → approved)
published / unpublished ──deactivate──► deactivated ──archive──► archived
```
Rules: only `published` versions enter a bundle (CM-006). Publish and restore create a new immutable version. Every transition writes an `audit_entry` (actor, comments). Scheduled publish = `approved` + `publish_at`; a job promotes it.

### 4b. Account
`active ⇄ deactivated` (admin); deactivated cannot authenticate to registered-only functions; history retained (UM-004).

### 4c. Consent (per subject × notice version)
`none → granted | declined`; `granted → withdrawn`; new notice version → `requires_reconsent`.

### 4d. Recognition outcome (per scan, on device)
`scanning → (confidence < threshold) unrecognized | foreign | demonetized | recognized(denomination)` — every terminal state except `unrecognized` also shows/speaks the disclaimer; `recognized` shows/speaks denomination + disclaimer.

### 4e. Analytics event (client-side)
`queued (local, encrypted) → uploading → acked → deleted`; `uploading` failures return to `queued`.

## 5. Cross-epic ownership risks

- **`content_item` / `content_version`** — created by `content-management`, extended with type-specific fields by `gamification` (question fields), `evaluation` (survey fields), `augmented-reality` (device requirements). *Rule:* the base workflow, status column and version mechanics are owned by `content-management`; other epics may add **nullable, type-specific columns or a child table keyed by `content_version_id`** but never alter status semantics or bypass CM-3's transition service.
- **`analytics_event`** — schema owned by `analytics-reporting`; feature epics only emit through the AN-1 client SDK with registered event names. *Rule:* new event names are added to the event catalog in AN-1's docs before a feature ticket emits them.
- **`module_configuration`** — owned by `admin-security`; feature tickets read via the config service and register their keys with defaults.
