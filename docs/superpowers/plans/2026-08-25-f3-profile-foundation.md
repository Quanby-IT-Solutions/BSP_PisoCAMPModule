# F3 Piso CAMP Profile Foundation

Implement F3 as a recoverable post-sign-up profile-completion saga. Better Auth owns account name and email; `piso_camp_profile` stores only gender, age, and frozen PSGC region/city codes. Account creation may precede profile completion, and authenticated GET exposes `missing` versus `complete` without accepting a client account ID.

The public catalog is the city-level subset of the official PSA PSGC publication as of 30 June 2026 (`PSGC-2Q-2026`). It is normalized from all 18 official per-region HTML city tables, pinned by a normalized JSON SHA-256, embedded in the single F3 migration, and reapplied idempotently by the supported seed path. Municipalities are excluded.

The profile POST requires a verified active Better Auth session, exact 22-character device pseudo-ID, and an `Idempotency-Key` equal to the body UUID. In one shared transaction it validates the city/region pair, selects the latest current registration decision with account consent taking precedence over the device grant, creates the immutable consent linkage and profile, assigns `Registered End User`, then persists replay state. No generic audit duplicates consent evidence.

TDD order: contracts; catalog/schema/migration/seed; profile service; controller; idempotency and rollback; exact linked-consent derivation; package checks; disposable PostgreSQL and live HTTP acceptance.
