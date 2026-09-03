# SA-2 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `1f940d1` (SA-1)
Ticket: SA-2 — Assign and revoke roles

## Result

All four SA-2 acceptance criteria are **PASS**.

## What SA-2 adds

| Layer | Surface |
| --- | --- |
| Contract | `PisoCampRoleSchema`, `SetPisoCampUserRolesInputSchema`; `GET /admin/pisocamp/roles`, `PUT /admin/pisocamp/users/{userId}/roles` |
| Backend | `PisoCampRoleService`, behind `admin.roles.assign` |
| Web | The roles dialog on `/pisocamp/accounts` |

## What was reused rather than rebuilt

**The whole write path is `RbacService`.** SA-2 computes the difference between
the roles an account holds and the roles it should hold, then calls
`assignRole` / `removeRole` for each change. Everything those already guarantee
still applies:

- the audit entry written **inside the same transaction** as the change,
- the refusal to grant Admin unless the caller is one (AZ-2 / F-10),
- the refusal to remove the last Admin, with the count taken under a row lock,
- the permission cache invalidated only **after** the commit.

Re-implementing the write here would have quietly dropped all four. A test
asserts SA-2 really goes through that path rather than around it: granting
Admin as a non-Admin is still refused, and nothing is written.

**The role catalogue is `RbacAdminService.listRoles()`**, which already returns
each role with its permission keys and holder count. Two readings of one
catalogue that could disagree would be worse than none.

## AC1 — assigning a role updates permissions immediately, and is audited

**PASS.** The grant lands, the response says what changed, and a
`role.assign` audit entry names the actor and the target.

"Immediately" is asserted against a **fresh** `RbacService` with its own cache:
the permission resolves as soon as the change has committed, not after an
existing cache entry lapses.

## AC2 — revoking removes the permission from the next request

**PASS.** A role dropped from the set is revoked, `role.remove` is audited, and
the permission no longer resolves.

Two behaviours worth naming:

- **Re-sending the same set does nothing at all** — no writes, no audit rows.
  An audit trail full of no-ops is one nobody reads.
- **An empty set clears every role**, rather than being read as "no change".

## AC3 — the role list shows each role's permission keys, read-only

**PASS.** Every role is listed with the keys it carries and how many people
hold it, in the dialog beside each checkbox. A role that carries nothing says
"No permission keys" rather than showing a blank line.

Least privilege is a claim somebody has to be able to check, and an assignment
whose consequences nobody can see is not one anybody can review. Editing what a
role contains stays out of scope, as the ticket says.

## AC4 — 403 and an audit entry without `admin.roles.assign`

**PASS.** Both branches on both handlers, with the denial naming the handler
and the permission that was missing. The permission is SA-2's own: the fixture's
denied user holds `users:read`, and seeing the directory is not deciding who can
do what. The browser run adds the same refusal end to end, using an ordinary
user's own session against the endpoint.

## The set, not the change

`PUT .../roles` takes the **complete set of roles** the account should end up
with. An administrator decides what somebody should hold; sending the whole
answer means the server works out the difference, and the screen never has to
reason about what it is replacing or race with a concurrent edit that assumed a
different starting point.

An unknown role name is refused by name and **nothing is applied** — half an
assignment is worse than none, because the screen would report the whole of it.

## Browser validation

`sa2-roles.authenticated.spec.ts` — **7 passed**: the dialog lists every role
with its permission keys; assigning a role shows it against the account;
revoking removes it; the page has no horizontal overflow at 320 px and the role
checkboxes are keyboard-focusable; and the endpoint refuses a user without the
permission. Console, page errors, failed requests and error responses asserted
clean, and the spec restores the subject's roles afterwards.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 23 files, 364 tests passed |
| backend jest `--runInBand` | 93 suites, 815 passed, 48 skipped (+12) |
| `web` vitest | 47 files, 425 passed (+5) |
| `packages/e2e-web` Playwright | 7 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The server log carries no error-level line; the only 4xx are the deliberate
denials under test.

## Notes

- **The role management lives on the accounts screen**, beside the status
  controls, because "who is this person and what may they do" is one question an
  administrator asks at once.
- The existing `/rbac/users/{id}/roles` endpoints are unchanged: they are gated
  on `users:manage` and grant one role at a time. SA-2's endpoint is the
  `admin.roles.assign` view of the same underlying service.
