# SA-3 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `d1ec3ac` (SA-2)
Ticket: SA-3 — Manage module configuration

## Result

All three SA-3 acceptance criteria are **PASS**.

## What SA-3 adds

| Layer | Surface |
| --- | --- |
| Contract | Seven new keys on `PisoCampAdminConfigSchema`, each with its own validator and default; four of them on the public config |
| Backend | The admin config service becomes a **key registry** driven by the contract |
| Mobile | The public config parser stops refusing settings it predates |
| Web | `/pisocamp/config` renders whatever the registry declares |

## The registry

The service used to hold a hand-written entry per setting, and every setting was
a whole number. SA-3 makes the contract schema itself the registry: reading,
defaulting, validating, writing and auditing are written **once over the list of
keys**, and each key's own schema carries both its validation and its default.

A new setting is now a field on `PisoCampAdminConfigSchema` — nothing else.

That is what let SA-3 add a boolean, a fraction, an enum list, a structured list
and a nullable string without a fifth copy of the same block, and it is asserted
directly: one test saves a value of every one of those shapes through the same
path.

## AC1 — every key validates by type and range, saves, and audits before/after

**PASS.** The keys the ticket names:

| Key | Shape | Validated as |
| --- | --- | --- |
| `session_inactivity_minutes` | integer | 1–1,440 |
| `exit_advisory_interval_hours` | integer | 1–8,760 |
| `churn_inactivity_days` | integer | 1–365 |
| `trivia_repeat_days` (GM-001) | integer | 1–365 |
| `leaderboard_enabled` (GM-007) | boolean | — |
| `key_action_events` (AN-010) | enum list | at least one, from the declared events |
| `age_group_buckets` (AN-10) | ranges | in order, non-overlapping, last one open |
| `suppression_minimum` (AN-10) | integer | 2–1,000 |
| `recognition_confidence_threshold` | fraction | 0.5–1 |
| `active_privacy_notice_version` (UM-005) | string or none | must name a **stored** notice |

Two validators are worth naming because a type check would not have caught what
they do:

- **Age groups must tile every age exactly once.** Overlapping buckets put one
  person in two groups and make the percentages add up to more than everybody;
  a closed last bucket leaves the oldest people in none. Both are refused.
- **At least one key action.** Time-to-first-key-action with no key actions has
  nothing to wait for.

Each change is audited with the old and new value, **one entry per key that
actually moved**. Re-saving the screen unchanged writes nothing: a trail full of
unchanged values is one nobody reads. Asserted both ways.

A stored value the contract would refuse is never served — the declared default
is. Asserted by writing `suppression_minimum: 0` and `leaderboard_enabled: "yes"`
straight into the table.

## AC2 — a saved change reaches devices through `GET /pisocamp/config`

**PASS**, end to end in the browser: the leaderboard flag is turned on in the
screen, and the unauthenticated config then carries `leaderboard_enabled: true`.

The public subset is the settings a **device acts on for itself** — the
leaderboard flag, the trivia repeat window, the recognition threshold and the
active notice version, beside EV-3's triggers and EV-4's interval. The analytics
settings stay server-side, asserted explicitly: an unauthenticated response is
no place for the suppression minimum, the key-action list, the age buckets or
the session and churn periods.

## AC3 — 403 and an audit entry without `admin.config.manage`

**PASS.** Unchanged from F2: both handlers already carry the permission and the
existing authorization spec proves both branches with the audited denial. The
browser run adds the redirect for a signed-in user without it.

## A defect this ticket had to fix first

**The mobile app refused any public config carrying a key it did not know.** The
parser compared the exact key set and threw otherwise, so the first time BSP
turned on a setting, every installed app would have treated the whole
configuration as invalid and fallen back to offline content.

SA-3 is the ticket that adds public settings, so this was blocking AC2 for real
devices. The parser now requires and type-checks the keys it uses and ignores
the rest — the same rule the file already applied to survey rules one function
below.

The allowlist that keeps anything private out of that response is enforced by
the server's strict schema, which is where it can actually be enforced and which
has its own test; refusing on the device protected nothing and guaranteed an
outage.

## A second defect, found in the browser

The notice-version guard originally validated on every save. The dev database
holds `active_privacy_notice_version: "2024-12-26"` with **no privacy notice
stored at all**, so an administrator could not save the session timeout because
of somebody else's dangling value.

It now validates only when the version **changes**: a value already stored is
not something this administrator is asserting. Pointing at a missing notice is
still refused — which matters, because F4's consent flow reads this same key and
refuses to serve consent when it names a notice that is not there.

## Browser validation

`sa3-configuration.authenticated.spec.ts` — **8 passed**: every setting is
offered with its help text; a saved change appears in the public configuration;
an unreadable age-group list is refused with the field focused; a notice version
that is not stored is refused; no horizontal overflow at 320 px with 44 px
controls; and the screen is refused to a user without the permission. Console,
page errors, failed requests and error responses asserted clean.

The neighbouring specs (EV-4, SA-1, SA-2) still pass; SA-1 needs its own run
because three sign-in-heavy spec files back to back exceed Better Auth's
per-path limit.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 23 files, 377 tests passed (+13) |
| backend jest `--runInBand` | 94 suites, 824 passed, 48 skipped (+9) |
| `web` vitest | 47 files, 432 passed (+7) |
| `flutter test` | 687 passed, 1 skipped (+1) |
| `packages/e2e-web` Playwright | 8 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

## Notes

- **`active_privacy_notice_version` stays exactly where F4 put it.** SA-3
  provides the screen; F4 owns the meaning and reads the key by name. A test
  asserts the stored row still holds the bare version string.
- **No value means no row.** Clearing the notice version deletes the row rather
  than storing a null — a not-null jsonb column could not hold one, and a
  missing row is already what "unset" means everywhere else in this table.
- Age groups are edited as `0-17, 18-24, 60+` and stored as boundaries, so the
  screen stays readable and the contract stays unambiguous.
