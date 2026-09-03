# SA-6 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `bf51522` (SA-5)
Ticket: SA-6 — Security hardening and observability pass

## Result

Four of the five SA-6 acceptance criteria are **PASS**. The fifth is **PARTIAL**
for one reason that is stated plainly below rather than hidden.

The full checklist, with the reasoning behind each decision, is
`docs/security/sa-6-security-checklist.md`.

## AC1 — mobile hardening, no hard-coded credentials, validation and encoding

**PASS.**

- Session tokens, the guest pseudonym and the queue keys live in
  `flutter_secure_storage`; the analytics and survey queues are **AES-GCM-256**
  encrypted with the key held in secure storage rather than beside the data.
- `security-controls.spec.ts` walks every Dart file and fails if anything writes
  a token, secret, key or password to plain `SharedPreferences`.
- `scripts/scan-hardcoded-credentials.mjs` finds **0 blocking matches**. The 8
  matches it does find are in files that are test-only or example, and each
  exclusion is listed in the script with the reason it is safe. A fixture is
  allowed only when it says so **in its own contents**, so a real key cannot
  become allowed by being moved into an exempt directory.
- Every endpoint is contract-first: a Zod schema is what the handler receives.
  Asserted across every `*.contract.ts` route.

## AC2 — dependency and third-party inventory generated from lockfiles

**PASS.** `docs/security/dependency-inventory.md`, produced by
`pnpm security:inventory` from `pnpm-lock.yaml` and `apps/mobile/pubspec.lock`:
1,836 Node packages (137 direct) and 181 Dart packages.

`pnpm security:inventory:check` fails when the committed file is stale, so the
inventory cannot quietly drift from what actually ships.

## AC3 — no Critical or High vulnerability remains open

**PASS.**

| | Before | After |
| --- | --- | --- |
| Critical | 6 | **0** |
| High | 100 | **0** |
| Moderate | 59 | 3 |
| Low | 17 | 1 |

Remediated through `pnpm.overrides` plus three catalog moves: `next`
16.1.1 → 16.3.4, `better-auth` 1.4.12 → 1.6.29, `@nestjs/*` → ^11.1.19.

Three cases needed judgement rather than a blanket bump, and each is recorded in
`pnpm-workspace.yaml` beside the rule that implements it: `uuid` (a blanket
`>=11.1.1` resolves to an ESM-only 14.x that breaks `exceljs`), `better-auth`
(1.7 requires a new `issuer` column on the accounts table; 1.6.29 patches every
advisory without a schema migration) and `ajv` (no patched release on the ajv 6
line, and forcing 8.x stops ESLint working).

Every one of those was **caught by running the suites, not by reading release
notes** — the `uuid` break failed four backend suites, the better-auth break
failed every sign-up with a 500 in the browser, and the `ajv` break failed
linting.

## AC4 — logs carry correlation ids and no PII, credentials or images

**PASS for the domains that exist. PARTIAL overall**, and the gap is honest:
**recognition and AR are not built yet** (AR-1…AR-3, DR-1…DR-4), so there is no
recognition or AR failure path to point at. Ticking that box would be recording
a belief rather than a fact.

For everything that does exist — app, API, sync, publication, auth and report —
each request carries a correlation id, an inbound `X-Request-Id` is validated
before it is trusted (an id carrying a newline is refused, not trimmed), and
redaction runs from one shared manifest in the two places credentials travel:
structured fields and the query string.

## AC5 — checklist results attached to the security documentation

**PASS.** `docs/security/sa-6-security-checklist.md`, alongside the existing
eight-phase audit. Every line in it is either asserted by a test that runs on
every commit or produced by a script anybody can re-run — including the two new
`pnpm security:*` scripts.

## Test evidence

| Suite | Result |
| --- | --- |
| backend jest `--runInBand` | 111 suites, 988 passed, 48 skipped |
| `flutter test` | 716 passed, 1 skipped |
| `apps/web` vitest | 54 files, 492 passed |
| `packages/contracts` vitest | 23 files, 377 passed |
| `packages/auth` vitest | 8 files, 72 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |
| `next build` / `nest build` | both succeed on the upgraded dependencies |
| `packages/e2e-web` Playwright | every Piso CAMP spec passes on its own |

## Browser suite, stated plainly

A single `playwright test` run over everything surfaces failures that predate
this pass:

- `submit-ticket`, `authenticated todos` and `cache-isolation` are template-era
  specs that sign **up** and expect a session. This deployment requires email
  verification first, so a fresh sign-up correctly returns `token: null`.
- `cm2-assets`, `cm4-versions` and `cm5-preview` address seeded content by fixed
  id; those rows are not in this local database.
- Several analytics specs share one Playwright worker, and a spec that ends
  signed in as a user *without* the reporting permission leaves that session for
  the next one, which then records the 403s it asserts it will not see.

None is caused by the dependency work. Each affected spec passes when run alone.

## Notes

- **Penetration testing** is BSP-led and out of scope, as the ticket says.
- The better-auth 1.7 upgrade is a real piece of work — a required `issuer`
  column and a backfill, per its own upgrade guide — and belongs in its own
  ticket rather than smuggled into a security pass.
