# SA-1 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `eba1498` (AN-9)
Ticket: SA-1 — Activate and deactivate accounts

## Result

All five SA-1 acceptance criteria are **PASS**.

## What SA-1 adds

| Layer | Surface |
| --- | --- |
| Contract | `PisoCampAccountSchema`, `ListPisoCampAccountsInputSchema`, `SetPisoCampAccountStatusInputSchema`; `GET /admin/pisocamp/accounts`, `PUT /admin/pisocamp/accounts/{accountId}/status` |
| Backend | `PisoCampAccountService`, behind `admin.accounts.manage` |
| Auth | A deactivated account cannot start a session, whatever it signs in with |
| Web | `/pisocamp/accounts` |

Reused rather than rebuilt: the `pisocamp_account_state` table and
`AccountAccessService` already existed for RF-4, so every admin endpoint refuses
a deactivated caller without knowing SA-1 exists. This ticket writes that state
and closes the one hole RF-4 could not: **starting a new session**.

## AC1 — deactivating sets the status, ends the sessions, and is audited

**PASS.** The status, the reason, the session deletion and the audit entry
commit in one transaction: an account recorded as deactivated whose sessions
survived would still be signed in, and a lock-out nobody recorded is one nobody
can answer for.

- Every open session ends, not merely the newest — asserted with two sessions
  for the subject and one for a bystander, and only the bystander's survives.
- The audit entry carries the old status, the new status, the reason and the
  actor.
- **Deactivating demands a reason and reactivating refuses one.** "Why was this
  person locked out" must always have an answer, and a reason attached to
  restoring access would only ever be misread as one for removing it. The
  contract enforces this as a discriminated union, so it is not a UI convention.
- **An administrator cannot change their own status.** Locking yourself out
  mid-request leaves nobody able to undo it and no way back to the screen to
  try. Asserted, including that nothing is written.

## AC2 — a deactivated account is refused, and guest features still work

**PASS**, in both places a refusal has to happen:

- **Registered-only API calls** — `AccountAccessService.isActive` returns false,
  which is RF-4's short-circuit, so every admin endpoint refuses them. Asserted
  before and after.
- **Sign-in** — a new rule in `@repo/auth` refuses to create a session for a
  deactivated account. Deleting open sessions withdraws the access somebody
  already had; this withdraws the access they would otherwise get next.
  Without it a deactivated user simply signs in again.

The rule sits on **session creation**, not on the password check, so it covers
social sign-in on the same terms, and it is stated as a function over a status
so it is tested without standing up an auth instance.

The message is `"This account has been deactivated. Contact your administrator
to restore access."` — not "invalid credentials", which would send somebody to
reset a password that was never the problem.

Guest features are untouched: the rule refuses a *session*, and nothing about
the anonymous Piso CAMP surface needs one.

## AC3 — historical data is retained

**PASS.** Deactivation is not deletion — SA-7 owns that. Asserted after a
deactivation: the user row, their role assignments and their audit trail are all
still there. A lock-out that erased somebody's history would destroy the
evidence of what they did before it.

## AC4 — reactivation restores access and is audited

**PASS.** The account returns to active, `isActive` returns true again, and a
second audit entry records the restoration separately from the withdrawal. The
reason is cleared from the current row — it belonged to a lock-out that is over,
and the audit trail is what keeps it.

## AC5 — 403 and an audit entry without `admin.accounts.manage`

**PASS.** Both branches on both handlers. The denied user deliberately holds
`users:read`: being able to see the user directory is not being able to lock
somebody out of it. Each denial writes exactly one `permission_denied` row
naming the handler. A deactivated holder of the permission is refused at 401
before the permission is reached, so a locked-out administrator cannot unlock
themselves.

## Browser validation

`sa1-accounts.authenticated.spec.ts` — **8 passed**: find an account; deactivate
it, with the dialog refusing to proceed until a reason is given and the row then
showing the status and reason; the account is refused at sign-in with the
message on screen; reactivation lets it sign in again; no horizontal overflow at
320 px with 44 px controls; and the page is refused to a user without the
permission. Console, page errors, failed requests and error responses asserted
clean.

Re-ran the neighbouring browser specs (AN-2, AN-8, AN-9, EV-4): **24 passed**.

## Two defects found in validation, both fixed

Neither was introduced by SA-1 — both are pre-existing — but AC2 could not pass
until they were, because between them they made *every* sign-in error invisible.

1. **A failed sign-in threw an unhandled page error.** The auth forms awaited
   `mutateAsync` and never caught: TanStack Query records the failure *and*
   rejects, so the rejection escaped. Fixed with one shared helper,
   `alreadyReported`, which says at the call site that the failure is already
   displayed. Applied to all six auth forms — login, register, forgot password,
   reset password and resend verification — because it is the same defect in
   each, and leaving five of them throwing would have been a patch rather than
   a fix.

2. **The service worker reloaded the page the first time it took control.** The
   `controllerchange` reload is meant for "a replacement worker activated after
   the user agreed to update"; it also fired when the very first worker claimed
   a fresh page, reloading it underneath whatever the person was doing. That is
   what wiped the sign-in message: it rendered, then the page reloaded. Fixed by
   reloading only when a controller was already present. Proved by sampling the
   DOM every 25 ms across the sign-in: 95 of 107 samples now carry the message,
   where before the page context was destroyed outright.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 23 files, 364 tests passed |
| `@repo/auth` vitest | 8 files, 72 passed (+4) |
| backend jest `--runInBand` | 92 suites, 803 passed, 48 skipped (+17) |
| `web` vitest | 47 files, 420 passed (+12) |
| `packages/e2e-web` Playwright | 8 passed, plus 24 in the neighbouring specs |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The server log carries no error-level line. Every 403 is a deliberate denial
under test; the 429s are Better Auth's per-path sign-in limit, which the suite's
own fixture retries by design.

## Notes

- **The account list is its own query, not a widening of the RBAC user list.**
  That one answers "who holds which role" for `users:read`; this one answers
  "who can still sign in" for `admin.accounts.manage`, and they are paged,
  filtered and permissioned differently.
- **An account with no state row is active.** No row means nobody has ever
  managed the account, so the status filter treats "no row" and "active" alike —
  a plain equality would have hidden every account nobody has ever touched.
- The browser spec deliberately locks out the content editor rather than
  `userA` or `admin`: those two are what the shared sign-in setup uses, so
  deactivating either would break every other spec's stored session.
