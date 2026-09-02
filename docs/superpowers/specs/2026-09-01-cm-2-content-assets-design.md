# CM-2 Governed Content Assets Design

## Status and scope

This specification implements ticket **CM-2 — Upload and attach assets to a content version**. CM-1, CM-3, CE-1, and AN-1 are already implemented, so CM-2's declared dependency is satisfied. The design follows the repository's existing PostgreSQL-coordinated content and object-store patterns and the shared F2 permission/audit spine.

CM-2 owns the first definitions of `asset` and `version_asset`. It provides governed upload, attachment, detachment, logical deletion, and the draft-editor UI. It does not add public asset delivery, bundle entries, mobile rendering, preview rendering, 3D rendering, or AR playback. CE-1/AR-3 remain responsible for delivery; CM-5 owns preview; CE-2 and AR tickets own rendering.

## Decisions

### Storage

Asset bytes use a new `PostgresAssetObjectStore` with immutable, content-addressed objects. This matches CE-1's durable PostgreSQL `BundleObjectStore`: every backend replica sees the same bytes, metadata and bytes commit atomically, and local development requires no untracked storage service or credentials.

The object-store interface is deliberately provider-neutral so a future approved BSP deployment may replace the implementation with S3-compatible storage. CM-2 does not add AWS credentials, buckets, presigned uploads, or filesystem-backed durable storage. The local filesystem is used only for bounded, private temporary multipart files that are removed after each request.

### Upload transport

The upload route is `POST /api/v1/admin/pisocamp/assets` (`/admin/pisocamp/assets` beneath the repository's global `/api/v1` prefix). Its shared contract contains a `File`, `itemId`, `expectedVersionNo`, `role`, and `requestId`, so the generated browser client sends multipart form data.

The route remains an `@Implement` oRPC procedure, but a bounded NestJS multipart preparation interceptor runs before the oRPC adapter reads the body. The installed oRPC Node adapter otherwise materializes multipart form data without an early byte ceiling. Nest guards run first; the interceptor then uses Multer/Busboy limits, validates the temporary file, materializes one bounded canonical `File` in `request.body`, and removes the temporary file. The oRPC adapter consequently validates the already bounded body instead of reading the raw request stream. JSON asset commands remain ordinary oRPC handlers.

The current `IdempotencyInterceptor` correctly wraps oRPC procedures but its plain-Nest fallback observes a response only after controller work has occurred. CM-2 therefore does not route upload through that fallback. Its transaction/lock/cache logic is extracted into a reusable `IdempotencyService`; existing JSON interceptors delegate to it, while the upload procedure calls it inside the oRPC handler with an explicit fingerprint containing the server-computed digest. This is a refactor with regression tests, not a second idempotency implementation.

The proxy receives an exact upload location with `client_max_body_size 51m`. Existing routes retain the current 1 MiB proxy limit and 100 KiB/512 KiB application JSON limits. Direct backend requests remain bounded by multipart parser limits, so the proxy is defense in depth rather than the only size control.

### Immutable content versions

An attachment set is part of a content-version snapshot. Upload, attach, detach, and delete never edit a `version_asset` row belonging to an existing version. Each successful mutation:

1. locks the item and verifies that both the item and current version are `draft`;
2. compares `expectedVersionNo` to the current version;
3. creates a new draft `content_version` with the next version number and the current content fields;
4. copies related links and all unchanged asset roles;
5. applies the one requested attachment change;
6. advances `currentWorkingVersionId`, `lastEditedBy`, and `updatedAt`; and
7. writes the audit entry in the same transaction.

CM-1 content edits and all CM-3 workflow transitions copy `version_asset` rows just as they already copy content fields and related links. Submitted, approved, and published snapshots therefore retain the exact asset identities they were reviewed with. A role may have at most one asset in a version.

### Deletion

Deletion is logical, not physical. An asset has `deletedAt` and `deletedBy`; a deleted asset cannot be newly attached and is omitted from the current draft asset library. Its metadata and object bytes remain available to immutable historical versions.

Deleting an asset first locks it and checks every referencing content version. If any reference has status `published`, the request returns `409 Conflict` with `Published content references this asset`; no content version, asset, object, or audit-success row changes. This check covers historical published versions, not only the item's current published pointer.

When no published reference exists, deletion creates a new draft snapshot without the asset if it occupies a role in the current draft, then tombstones the asset. References from older non-published snapshots remain intact. Physical object garbage collection and retention-policy purging are out of scope.

## Data model

### `asset_object`

An implementation-detail table behind `PostgresAssetObjectStore`:

- `sha256 text primary key`, lowercase 64-character hex;
- `byte_length integer not null`, 1 through 52,428,800;
- `media_type text not null`, restricted to the canonical allowlist;
- `body bytea not null`, with `octet_length(body) = byte_length`;
- `created_at timestamptz not null default now()`; and
- unique `(sha256, byte_length, media_type)` metadata for a composite integrity reference.

Identical bytes are stored once. `putVerified` recomputes SHA-256 and verifies the persisted bytes and metadata before returning.

### `asset`

- `id uuid primary key`;
- `content_item_id uuid not null` with restrictive FK to `content_item`;
- `sha256`, `byte_length`, and `media_type` with a composite restrictive FK to `asset_object`;
- `version integer not null default 1`, constrained positive;
- `uploaded_by text not null` with restrictive FK to `users`;
- `created_at timestamptz not null default now()`;
- `deleted_at timestamptz null` and `deleted_by text null`, both null or both present; and
- unique `(content_item_id, id)` for same-item attachment integrity.

CM-2 creates immutable version `1` assets. A future replacement feature may create a new asset row and increment the logical version; it must never overwrite bytes or metadata in an existing row. Original filenames are not persisted because they are untrusted and may contain personal data.

### `version_asset`

- `content_item_id uuid not null`;
- `content_version_id uuid not null`;
- `asset_id uuid not null`;
- `role text not null`, one of `obverse`, `reverse`, `edge`, `texture`, `audio`, `animation`;
- primary key `(content_version_id, role)`;
- composite FK `(content_item_id, content_version_id)` to `content_version(item_id, id)`; and
- composite FK `(content_item_id, asset_id)` to `asset(content_item_id, id)`.

These keys prevent cross-item attachment and role duplication at the database boundary. All deletes are restrictive; tombstoning preserves references.

## Approved formats and limits

The server determines the canonical format from bytes and structure. Browser `accept`, extension, submitted MIME, and filename are hints only.

| Kind | Canonical MIME | Maximum | Allowed roles |
|---|---|---:|---|
| PNG | `image/png` | 10 MiB | obverse, reverse, edge, texture |
| JPEG | `image/jpeg` | 10 MiB | obverse, reverse, edge, texture |
| WebP | `image/webp` | 10 MiB | obverse, reverse, edge, texture |
| MP3 | `audio/mpeg` | 25 MiB | audio |
| AAC/ADTS | `audio/aac` | 25 MiB | audio |
| GLB 2.x | `model/gltf-binary` | 50 MiB | animation |
| self-contained GLTF 2.x | `model/gltf+json` | 50 MiB | animation |
| USDZ | `model/vnd.usdz+zip` | 50 MiB | animation |

Image validation checks the format signature and structural dimensions; dimensions must be positive and at most 8192 × 8192. GLB validates its header, declared version and total length. GLTF must parse as JSON, declare `asset.version` 2.x, and contain no external HTTP, absolute, parent-traversal, or unresolved relative buffer/image URI; embedded `data:` resources are allowed within the overall limit. USDZ must be a structurally valid uncompressed USD package with safe relative entry names and a USD root entry; a generic ZIP is rejected. MP3 and AAC require valid framing rather than filename-only recognition.

The multipart parser permits exactly one file, at most six scalar fields, field names up to 100 bytes, scalar fields up to 1 KiB, and a file up to 50 MiB. Empty, truncated, ambiguous, polyglot, malformed, mismatched-role, and unsupported files are rejected before persistence.

## Contracts and endpoints

All responses expose only safe metadata: `id`, `contentItemId`, `sha256`, `mediaType`, `byteLength`, `version`, `role`, `createdAt`, and the resulting content-version id/number. They never expose bytes, server paths, submitted filenames, cookies, or session data.

### Query

`GET /api/v1/admin/pisocamp/content/{itemId}/assets`

- Requires `content.assets.upload`.
- Returns current-version attachments and non-deleted assets owned by the item that may be reattached.
- Returns `404` for an unknown item.

### Upload and attach

`POST /api/v1/admin/pisocamp/assets`

- Multipart input: `file`, `itemId`, `expectedVersionNo`, `role`, `requestId`.
- Requires `content.assets.upload`, an active account, strict throttling, and `Idempotency-Key = requestId`.
- Computes SHA-256 server-side, validates kind/role/limit, persists object and asset, creates the new draft snapshot, attaches it, and audits `content.asset.upload` atomically.
- An occupied role returns `409`; replacement requires an explicit detach or delete first.

### Reattach an existing asset

`POST /api/v1/admin/pisocamp/assets/{assetId}/attach`

- JSON input: `itemId`, `expectedVersionNo`, `role`, `requestId`.
- Requires the same permission/idempotency controls.
- Rejects deleted, unknown, cross-item, wrong-role, non-draft, occupied-role, and stale-version requests.
- Audits `content.asset.attach`.

### Detach

`POST /api/v1/admin/pisocamp/assets/{assetId}/detach`

- JSON input: `itemId`, `expectedVersionNo`, `role`, `requestId`.
- Requires the same permission/idempotency controls.
- Creates a new draft snapshot without that exact asset-role pair.
- A missing pair returns `404`; stale or non-draft state returns `409`.
- Audits `content.asset.detach`.

### Delete

`DELETE /api/v1/admin/pisocamp/assets/{assetId}`

- Input includes `itemId`, `expectedVersionNo`, and `requestId`; the idempotency header is required.
- Requires `content.assets.upload`.
- Returns `409` when any published version references the asset.
- Otherwise creates a new draft snapshot without the asset when needed, tombstones it, and audits `content.asset.delete`.

The output of each mutation includes the resulting current version and attachment list so the UI can update without guessing version numbers.

## Authorization, idempotency, and auditing

The existing authentication/active-account check runs before permission resolution. The RBAC guard runs before multipart parsing, so a caller without `content.assets.upload` receives 403 and a durable `permission_denied` audit without causing a large file to be buffered or written.

The upload preparation interceptor streams to a private random temporary path, computes and validates the canonical digest/metadata, materializes the bounded canonical `File`, and removes the temporary file before the procedure runs. Inside the oRPC handler, the reusable `IdempotencyService` fingerprints only the digest and safe scalar fields, then executes the asset transaction under the same author-scoped advisory lock/cache semantics as other mutations. Exact retries return the original response and create no second asset, content version, attachment, object, or success audit. Reusing a key with different bytes, role, item, or expected version returns the existing idempotency-conflict response. Parser errors and client aborts also remove temporary files.

Successful audit values contain identifiers and safe metadata only:

- actor and action;
- content item id;
- source and target content-version ids/numbers;
- asset id, role, canonical MIME, byte length, version, and SHA-256; and
- for deletion, the tombstone timestamp.

Raw bytes, filenames, temporary paths, request bodies, credentials, and session material are never logged or audited. Unexpected errors use the existing structured logger with operation/correlation metadata and return a generic public message.

## Admin UI

The edit page resolves `content.assets.upload` independently from `content.items.edit` and passes `canManageAssets` to `ContentFormView`. Asset management is available only after the item exists; the create screen explains that the draft must be saved first.

The edit form adds a focused `AssetAttachmentsEditor` below related links:

- a labelled role selector;
- a labelled single-file input with the exact allowlist and size guidance;
- an Upload and attach action with an `aria-live` pending status;
- current attachments grouped by role with MIME, human-readable size, asset version, and a shortened checksum plus an accessible full-checksum label;
- an available-assets list for reattachment;
- confirmed Detach and Delete actions; and
- visible, role-specific server validation/conflict messages that retain the selected role after failure.

Asset controls are disabled while text fields are dirty, while another asset/content mutation is pending, or after a version conflict. The UI explains that text changes must be saved or discarded first. Every success updates the current version number and invalidates both content and asset query keys. A stale-version response preserves the selected file locally where the browser permits and offers Reload latest.

Users lacking `content.assets.upload` see no mutation controls. The page remains usable for their existing `content.items.edit` capabilities. Controls meet the repository's minimum 44 px target, are keyboard reachable in logical order, have programmatic names and descriptions, do not rely on color alone, and reflow without horizontal overflow at 320 CSS pixels.

## Failure semantics

- `400 Bad Request`: malformed scalar input, empty file, unsupported or structurally invalid format, unsafe GLTF/USDZ reference, or role/media mismatch.
- `401 Unauthorized`: no valid session or deactivated account, before RBAC/file parsing.
- `403 Forbidden`: missing `content.assets.upload`, with `permission_denied` audit.
- `404 Not Found`: unknown item/asset or absent exact attachment.
- `409 Conflict`: non-draft item/version, stale `expectedVersionNo`, occupied role, deleted asset, published deletion reference, or idempotency-key reuse with different input.
- `413 Payload Too Large`: multipart/file/category limit exceeded, with a plain-language allowed-size message.
- `429 Too Many Requests`: existing strict throttle response.
- `500 Internal Server Error`: safe generic message; transaction rollback leaves no asset metadata, version, attachment, object, success audit, or idempotency record.

Client aborts and timeouts retain no temporary file. A timeout after commit is safe to retry with the same request id and bytes.

## Testing and acceptance evidence

Implementation follows strict red-green-refactor cycles. Generated Drizzle migration artifacts are the only non-TDD code output.

Automated coverage includes:

- contract schemas for roles, inputs, output exactness, coercion, and `File` transport;
- migration constraints, same-item composite foreign keys, one-role uniqueness, tombstone consistency, checksum/body metadata integrity, and additive migration behavior;
- byte validators using valid and malformed fixtures for every format, extension/MIME spoofing, truncation, polyglots, unsafe GLTF URIs, ZIP traversal, generic ZIP, empty files, boundary sizes, and role mismatch;
- object-store digest verification, deduplication, corruption detection, and transaction rollback;
- service integration for upload/attach/detach/delete, version cloning, link and attachment preservation, stale writers, non-draft states, occupied roles, published deletion block, audits, and exact retry/mismatched retry idempotency;
- workflow regression proving content edit, submit, approve, reject, and publish copy exact asset references and CE-1 continues to include only published content;
- controller/guard tests proving authorized success, unauthorized 403 plus audit, deactivated 401, guard-before-parser ordering, bounded body handoff to oRPC, 413 behavior, safe errors, temp cleanup, and log redaction;
- React hook and component tests for permission branches, upload failure/retry, dirty-state lock, conflicts, focus, confirmation dialogs, cache invalidation, accessible names/status, and narrow layout; and
- Nginx/app body-limit tests proving only the exact upload route accepts the larger envelope.

Runtime acceptance uses a real migrated PostgreSQL database and production-built backend/web applications. Browser evidence exercises a permitted Content Administrator and a user without `content.assets.upload`, valid uploads for every media family, rejected spoof/oversize uploads, attach/detach/delete, stale version, retry after simulated response loss, and published deletion block. It records database rows/audits, request status and response, clean browser console/network, clean backend logs, keyboard/focus behavior, screen-reader semantics, destructive confirmations, and 320 px no-overflow evidence.

The final evidence is recorded in `docs/pisocamp/cm-2-acceptance-evidence.md`. CM-2 receives one local commit only after every criterion and gate passes. No push, branch, worktree, or pull request is created.

## Explicit acceptance-criterion mapping

1. **Allowed upload to draft:** format validators, bounded multipart controller, object store, `asset`, immutable snapshot clone, and `version_asset`; proven by database-backed integration and browser evidence.
2. **Disallowed/oversize rejection:** content sniffing, structure validators, category caps, parser/proxy caps, and visible errors; proven by spoof, malformed, and boundary tests plus browser evidence.
3. **Published-reference deletion block:** transactional published-reference query and tombstone lifecycle; proven by integration and browser 409 evidence with unchanged rows.
4. **Missing permission:** shared F2 RBAC guard before parsing and durable denial audit; proven with the negative-role browser/API branch and audit row.
5. **Upload audited:** same-transaction metadata-only `content.asset.upload` entry; proven by row assertions and log/secret scans.

## Downstream compatibility

- CM-4 can restore an immutable version and reuse its referenced asset even after a non-published logical deletion because metadata and bytes remain.
- CM-5 can query the selected version's roles for preview without changing publication state.
- CE-1/AR-3 can read verified objects by digest and classify large models as on-demand without changing CM-2 storage semantics.
- CE-2 consumes `animation` model attachments; image/audio roles remain explicit.
- AR-2 may add type-specific mandatory-role validation without altering the base asset lifecycle.
- RF-6 receives the server-generated SHA-256 and exact byte length required for manifest verification.
