# SA-5 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `c0b2dd8` (AN-11)
Ticket: SA-5 — Push notifications: opt-in, send approved notification, metrics

## Result

All four SA-5 acceptance criteria are **PASS**.

## What SA-5 adds

| Layer | Surface |
| --- | --- |
| Schema | `push_subscription`, `push_notification`, `push_delivery` |
| Contract | The person's own subscription, the send, and AN-014's rates |
| Backend | `PushService`, `PushDispatcherService`, two controllers |
| Mobile | Push opt-in and opt-out in Privacy settings |
| Web | `/pisocamp/notifications`, with the send form |
| Config | `PISOCAMP_PUSH_SERVICE_URL` / `_TOKEN` (§12) |

Migration `20260903060000_sa5_push_notifications`, applied to all four local
databases.

## AC1 — opting in stores a subscription, opting out removes it

**PASS.** Opting in from Privacy settings stores a `push_subscription` for the
account; opting out **deletes** the row.

Deleting rather than flagging is the point: a subscription kept "disabled" is
still a token the module could send to, and the whole meaning of opting out is
that it cannot. Asserted directly — after an opt-out the table is empty.

**A device token belongs to a device, not a person.** Claiming a token another
account holds moves it, so a shared handset cannot deliver one person's
notification to the other. Asserted.

An account keeps **one** subscription: registering a new device replaces the old
one rather than accumulating tokens nobody will ever reach.

Both the opt-in and the opt-out are audited, and **the token never appears in
the audit trail** — it is a credential for reaching a device, and an audit trail
is not a place to keep one. Asserted by searching the recorded rows for it.

On the device, the token comes from a `PushTokenProvider` port. A build that
ships no push service returns none, and the settings screen says "This build
cannot receive notifications yet" instead of storing a token nothing could
deliver to. Asserted in the mobile suite.

## AC2 — a send is dispatched and audited

**PASS.** A send goes to every opted-in account (segmentation is out of scope),
hands the message and the tokens to the configured push service, and records
what actually came back:

- delivered, with the time;
- failed, with a **reason code** and no delivery time;
- queued, when **no service is configured** — nothing was dispatched, so
  claiming a delivery would make the delivery rate a fiction and recording a
  failure would blame a service nobody asked.

All three asserted. The response says which happened, and the send form repeats
it rather than showing a uniform "sent".

**The approval reference is required** and is written into the audit entry with
the actor: §3.2 allows only BSP-approved text, and a record of what was sent
without a record of who approved it cannot show that rule was kept.

The service itself is one small seam (`PushDispatcherService`) reading
`PISOCAMP_PUSH_SERVICE_URL`, documented as §12 configuration in
`.env.example`. The module hands over tokens only — the service has no business
knowing who anybody is.

A deep link may only be an internal path, enforced in the contract, in the form
and by a database CHECK: a push that could open any URL would be a phishing
surface with BSP's name on it.

## AC3 — the rates

**PASS**, all six, each divided by the pool it is actually about:

| Rate | Pool |
| --- | --- |
| Opt-in | Subscribed accounts ÷ registered accounts |
| Delivery | Delivered ÷ attempted |
| Failed delivery | Failed ÷ attempted |
| Open | Opened ÷ **delivered** |
| Click | Clicked ÷ **delivered** |
| Re-engagement | Opens followed by a session within 24 h ÷ opens |

**Opens are divided by what arrived, not by what was attempted.** Something that
never arrived was never ignored, and dividing by everything sent would report a
delivery problem as people ignoring BSP. Asserted with a send where every
delivery failed: the failed-delivery rate is 100% and the open rate is 0 over
nothing, not a 0% that blames the audience.

**Re-engagement is an open followed by a session within 24 hours** — after,
because the question is whether the notification brought somebody back.
Asserted both ways: a session after the open counts, one before it does not.

Everything reports zero rather than dividing by an empty pool.

A tap counts as an open as well, because it was one, and a receipt from somebody
who was not sent the notification is refused — otherwise the rates would be
reporting on strangers.

## AC4 — permission, three ways

**PASS**, and the three levels are deliberately different:

- **Your own subscription** needs a session and no permission at all. A
  permission here would mean asking an administrator to be allowed to control
  notifications to your own device. Asserted that the guard lets an ordinary
  signed-in user through all four handlers and writes no audit, and that none of
  them is marked anonymous, so the auth guard still requires a session.
- **Sending** needs `admin.notifications.send`. A holder of
  `reports.dashboards.view` alone is refused 403 with a handler-targeted
  `permission_denied` audit naming the missing permission.
- **The rates** need `reports.dashboards.view`. A holder of
  `admin.notifications.send` alone is refused the same way — being allowed to
  send is not being allowed to read the reporting.

## Browser validation

`sa5-notifications.authenticated.spec.ts` — the page shows all six rates with
their pools; the send form asks for confirmation before reaching every opted-in
device and then records the send in the table beneath it; a deep link that is
not an internal path is refused before anything is sent; no horizontal overflow
at 320 px with 44 px controls; and a user without `reports.dashboards.view` is
redirected away.

## Test evidence

| Suite | Result |
| --- | --- |
| backend jest `--runInBand` | 110 suites, 981 passed, 48 skipped |
| `flutter test` | 716 passed, 1 skipped |
| `apps/web` vitest | 54 files, 492 passed |
| `packages/contracts` vitest | 23 files, 377 passed |
| `packages/e2e-web` Playwright | 7 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

The API log carries no error-level line; every notifications request answered
200. The only non-2xx are the deliberate 403s from the permission case and
better-auth's own sign-in rate limit.

## A flake fixed at the root

Three tickets in a row saw a full backend run fail a suite on a **5-second hook
timeout** in teardown — `pisocamp-profile.idempotency`,
`pisocamp-consent.idempotency`, `pisocamp-admin-config.idempotency` — each of
which drops a database or a trigger in `afterAll`. Five seconds is not a timeout
for DDL on a loaded machine, and a suite that fails for being slow teaches
everybody to re-run instead of to read.

Fixed where it belongs: `testTimeout: 30000` in the backend jest configuration.
A genuinely hung hook still fails; a slow one no longer does. The full run after
the change is clean: **110 suites, 981 passed**, no failures.

## Notes

- **Scheduling and segmentation stay out of scope**, as the ticket says: the
  audience is everybody opted in, and the form says so rather than implying a
  targeting feature the module does not have.
- The device half needs whatever push SDK the shipping build carries. The token
  provider is the seam for it; this build has none, and says so plainly instead
  of pretending.
