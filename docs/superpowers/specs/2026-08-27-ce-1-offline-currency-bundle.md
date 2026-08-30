# CE-1 Offline Currency Bundle Design

## Outcome

CE-1 closes the first publish-to-offline-read loop. A successful CM-3 publication is consumed by a crash-recoverable builder that exposes one immutable, signed, published-only bundle. The Flutter client verifies that bundle, resumes changed downloads after interruption, and atomically activates it without making the previous verified content unavailable.

## Approved product ruling

The Release 1 packaged seed covers all 29 mandatory denominations using the frozen BSP source-backed catalog, neutral project-owned raster illustrations, and factual catalog-derived copy. Approval of this design designates those source-controlled seed files as CE-1's approved baseline. CM-2 remains the owner of official-media upload, review, replacement, and lifecycle management; it will attach governed media without changing CE-1's delivery protocol.

CE-1 does not fetch author-provided URLs. That would create an SSRF boundary and improperly assign CM-2's asset-ingestion responsibility to the bundle builder.

## Server architecture

The backend uses an in-process NestJS scheduled worker with PostgreSQL coordination:

1. Recover expired request leases, claim due requests, and acquire a transaction-scoped global advisory lock.
2. Read one coherent snapshot containing only items whose status is `published` and whose exact `current_published_version_id` points to a published immutable version.
3. Allocate a strictly increasing PostgreSQL bundle version. Gaps after failed builds are valid; reuse and rollback are not.
4. Render deterministic, public-only JSON resources and reuse immutable raster resources by SHA-256.
5. Store and read-back verify every immutable resource before signing the manifest.
6. Sign the exact manifest payload bytes.
7. In one transaction mark the bundle ready, advance the singleton current pointer only to a higher version, associate consumed rebuild requests, complete those requests, and clear `bundle_pending` only when the item's current published pointer still matches the included version.

Small CE-1 artifacts are stored durably in PostgreSQL behind a `BundleObjectStore` interface so multiple backend replicas see identical bytes. The initial store accepts only bounded core JSON and raster resources. CM-2 may add an object-store implementation for larger governed media without changing manifest or mobile interfaces. An uncommitted or failed bundle is never served; orphaned immutable blobs are harmless and may be garbage-collected later.

The existing CM-3 rebuild outbox gains owner, lease-expiry, processed-bundle, and retry metadata. A conservative reaper moves only expired processing claims back to a due state. Multiple workers may poll, but the advisory lock serializes full-snapshot promotion.

## Signed protocol

The public manifest response is a strict envelope:

```json
{
  "schemaVersion": 1,
  "algorithm": "Ed25519",
  "keyId": "ce1-dev-2026-01",
  "payload": "<base64url exact UTF-8 manifest JSON>",
  "signature": "<base64url signature over decoded payload bytes>"
}
```

The decoded payload has exactly these top-level fields:

- `schemaVersion: 1`
- `bundleVersion: string` containing a non-negative base-10 integer without leading zeroes except `0`
- `generatedAt: UTC ISO-8601 string ending in Z`
- `minimumClientSchemaVersion: 1`
- `entries: BundleManifestEntry[]`, sorted by `logicalId`

Each entry has:

- `logicalId`: stable lowercase identifier, maximum 160 characters
- `kind`: `content` or `image`
- `delivery`: `core` or `on_demand`
- `mediaType`: `application/json`, `image/png`, `image/jpeg`, or `image/webp`
- `byteLength`: positive integer no greater than 5 MiB per core entry
- `sha256`: 64 lowercase hexadecimal characters
- `downloadPath`: server-generated relative opaque path under the bundle resource route
- `contentItemId` and `contentVersionId`: UUIDs for published resources, otherwise absent for seed/catalog resources

The manifest is limited to 2 MiB, 2,000 entries, and 50 MiB of required `core` bytes. CE-1 downloads only `core`; `on_demand` metadata is authenticated but never fetched automatically.

Node signs exact bytes with an injected Ed25519 PKCS#8 key in development/test and a `BundleSigner` abstraction in production. The private key is never committed, returned, or logged. Flutter contains a fixed public-key ring and rejects unknown keys or algorithms. Key rotation ships the next public key before the server begins signing with it. Emergency revocation requires an application trust update or a separately governed offline root.

Trust purpose is explicit. `ce1-seed-v1` is accepted only while installing the packaged seed and is never accepted for a network manifest. `ce1-test-v1` is test-only. Debug builds may contain the matching public key for an environment-supplied `ce1-dev-2026-01` signer; release builds fail closed unless a production network verification-key ring is supplied at compile time. No production private key or production verification key is invented by CE-1.

The client stores the highest accepted version and manifest digest. It rejects lower versions and the same version with a different digest. Seed version is `0`. Reinstallation resets the high-water mark to the signed packaged seed floor.

## Public HTTP behavior

- `GET /api/v1/pisocamp/bundle/manifest` is anonymous, strictly throttled, returns only the ready current envelope, uses `Cache-Control: no-cache`, and supplies a strong body-digest ETag. `If-None-Match` may return 304.
- `GET /api/v1/pisocamp/bundle/resources/{sha256}` is anonymous and accepts only a 64-character lowercase digest. It uses `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, strong digest ETag, exact `Content-Length`, and `Accept-Ranges: bytes`.
- Valid ranges return 206 with exact `Content-Range`; unsatisfiable ranges return 416. Unknown resources return 404. Compression is disabled for ranged resource responses.
- Public DTOs contain no actor IDs, approval/publication identities, comments, audits, storage internals, credentials, or raw exceptions.

## Mobile storage and activation

Bundle synchronization uses a credential-free Dio client with a fixed API origin, no cookie manager, bounded redirects/timeouts, and identity encoding for ranged resources. Connectivity is only a scheduling hint; HTTP responses are authoritative.

The application-documents layout is:

```text
pisocamp/bundles/
  objects/<sha256>.blob
  staging/<bundleVersion>/manifest.envelope.json
  staging/<bundleVersion>/downloads/<sha256>.part
  staging/<bundleVersion>/downloads/<sha256>.resume.json
  ready/<bundleVersion>/manifest.envelope.json
  active.json
  previous.json
```

On first run the app verifies the packaged signed seed, copies its resources into the same object store, creates ready version `0`, and atomically installs `active.json`. If any live pointer is corrupt or missing, startup recovers the newest completely verified ready bundle and otherwise reinstalls the seed.

On module open or reconnect, one serialized synchronization does the following:

1. Fetch and verify the signed envelope before trusting payload fields or paths.
2. Apply schema, key, version, digest, count, byte, media-type, origin, and path limits.
3. Reuse any existing object whose length and SHA-256 match.
4. Resume a partial with `Range` and `If-Range` only when its journal matches URL, expected digest, byte length, and strong ETag.
5. Validate exact 206 `Content-Range`; restart safely on 200 or an ETag mismatch; accept 416 only if the completed bytes pass length and digest verification.
6. Stream within signed byte limits, verify every required core SHA-256, and move the complete object into its immutable digest path.
7. Write a ready manifest and atomically replace the small active pointer in the same filesystem. The previous pointer is retained until the new state is established.

Staging remains invisible to readers. Cancellation, connectivity loss, invalid signature, checksum mismatch, malformed range, disk-full, permission error, or process death never changes the active pointer. List/detail readers pin one immutable manifest snapshot and therefore never mix bundle versions.

## Offline content model and UX

The seed and published resource JSON use one strict mobile model containing `logicalId`, currency kind, series code/name/order, denomination code/label/order, title, summary, body, optional image digest/alt text, and related public links. Security-feature items are grouped with their series and denomination.

Banknotes and Coins home cards become accessible navigation targets. List screens group all mandatory denominations by series and show the last verified content immediately. Detail screens show the approved title, summary, body, neutral or governed raster image with meaningful alternative text, security-feature descriptions, and safe related links.

Synchronization never replaces usable content with a spinner. Offline or paused state is announced using text and semantics, not color alone: `Offline — showing saved content`. Errors explain that saved content remains available and that updating requires internet. A successful activation produces one Riverpod state change. Opening an item calls an injectable no-op `ContentViewAnalytics` bridge; AN-1 will replace that bridge later.

Guest routing permits the `/pisocamp/currency/...` route family without allowing unrelated protected routes. Android's release manifest includes `INTERNET`. This repository contains no iOS host project, so iOS entitlement/device proof is explicitly unavailable rather than simulated.

## Security and observability

- Manifest signature is authenticity; per-resource SHA-256 is integrity.
- Resources are addressed by digest, never a manifest-derived local path. Archives, SVG, HTML, symlinks, and server-side URL fetching are prohibited.
- Image MIME and magic bytes must agree; byte and decoded-dimension/pixel caps are enforced before display.
- Structured events record operation, phase, version, entry kind, attempt, duration, byte count, outcome, and stable error code.
- Logs and stored errors exclude content bodies/titles, actor IDs, cookies, signatures, keys, query strings, local absolute paths, and upstream response bodies.

## Acceptance evidence

Completion requires contract, database, builder, controller, range, cross-language signature-vector, mobile store, interruption, recovery, and widget tests. A PostgreSQL-backed composed HTTP run must prove published-only selection, monotonic ready promotion, anonymous manifest/range responses, stale lease recovery, and removal after the next build. Flutter tests must use real temporary files and a controllable range server to prove resume and atomic old-live behavior. Rendered checks cover 320 px, landscape, 200% text, semantics/focus, no overflow, offline seed, online update, and airplane-mode list/detail use.
