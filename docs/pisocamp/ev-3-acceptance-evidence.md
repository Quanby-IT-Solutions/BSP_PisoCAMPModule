# EV-3 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `f381468` (EV-2)
Ticket: EV-3 — Configurable survey triggers and frequency

## Result

All four EV-3 acceptance criteria are **PASS**.

## What EV-3 adds

| Layer | Surface |
| --- | --- |
| Database | `survey_trigger_rule` — one rule per survey and trigger type, with four CHECK constraints |
| Contract | `SURVEY_TRIGGER_TYPES`, the upsert/list/delete routes, and `survey_triggers` on the public configuration |
| Backend | `SurveyTriggerService` behind `surveys.triggers.configure`, audited on every change; the public config carries the enabled rules |
| Web | `/pisocamp/survey-triggers` — arrange, list and remove rules |
| Mobile | `survey_triggers.dart` — the rule reader, the frequency store and the engine that chooses |

## AC1 — a rule saves and reaches devices through the config

**PASS.** `survey-trigger.spec.ts` asserts a saved rule keeps its trigger,
its parameters, its cap and its priority; that a page-depth rule keeps its
depth; and that the same survey may carry a rule per trigger type while a
second rule for the same pair replaces the first rather than adding one.

A rule may only name a **published** survey. A trigger for a draft would fire
on nothing, because a draft is not in the bundle the device reads — asserted,
along with the refusal for an item that is not a survey at all.

The device is told through the configuration it already reads. `survey_triggers`
carries only what a device needs — the survey, the trigger, the depth, the cap
and the priority — and nothing about who arranged it or when. Asserted, both in
the contract (a rule carrying a title is refused) and in the service.

Enabled rules on published surveys only: a disabled rule and a withdrawn survey
are both things the device must stop asking about, and the way to stop it is to
stop sending the rule. Withdrawing a survey removes it from the configuration
while **keeping** the rule, so republishing does not mean arranging it again
from nothing. Both asserted.

## AC2 — the highest priority shows, and the cap is enforced locally

**PASS.** `survey_triggers_test.dart` — eighteen cases on the device, where the
decision is actually made.

Priority: 1 is the highest, stated once in the contract and in the schema
because "higher priority" reads both ways. Of three eligible surveys, the one
with priority 10 wins over 30 and 50. Equal priorities are settled by content
item id, so the same device does not shuffle its own answer between runs —
asserted across five attempts.

The cap: a survey offered 29 days ago with a 30-day cap is skipped, and the
next-highest eligible survey is offered instead of nothing. At exactly 30 days
it is due again; one minute short of it, it is not. A rule with no cap is always
due. When every eligible survey is capped, nothing is offered.

The cap is enforced on the device because a guest has no account for a server to
count against, and because the offer happens whether or not there is a
connection. The offering is recorded when the survey is **shown**, not when it is
answered: declining is still being asked, and the cap exists so people are not
asked too often.

A trigger fires only on what it is about: rules for another trigger type are
ignored, a topic survey is matched to the topic just read, a survey about the
module follows any topic, a page-depth rule waits for its depth, and a rule for
a survey this device does not hold is ignored — the bundle decides what exists.

A rule this build does not understand is dropped and the rest are kept: a newer
console arranging a trigger a released app has never heard of should cost that
rule, not the module. Asserted, along with a depth on the wrong trigger, a
depth trigger with none, and a priority off the scale.

## AC3 — 403 and an audit entry without `surveys.triggers.configure`

**PASS.** Both branches, on the route that arranges a rule
(`survey-trigger.authorization.spec.ts`): a holder of the permission arranges
one and the rule is written; a caller without it gets 403, **no rule is
written**, and exactly one `permission_denied` audit row names the handler. An
unauthenticated request is refused with 401 before any denial is recorded.

The browser run adds the other half: a signed-in user without the permission
never reaches the screen.

## AC4 — every rule change is audited

**PASS.** Creating, changing and removing a rule record
`survey_trigger.create`, `survey_trigger.update` and `survey_trigger.delete`
against the rule's id, in that order. A change names what it changed on both
sides — priority 10 before, 2 after. Removing a rule that was not there reports
`deleted: false` and audits nothing, because nothing happened.

## Browser validation

`ev3-survey-triggers.authenticated.spec.ts`, Playwright/Chromium against the
built web app and the running backend — **7 passed**, including the two setup
projects.

- A rule is arranged end to end and appears in the list with its trigger and cap.
- The depth field appears only for a page-depth trigger, and saving without one
  says why on the page rather than failing quietly at the server.
- A rule is removed and leaves the list.
- At 320 px there is **no horizontal overflow**, and the survey field and the
  trigger select are keyboard-focusable with 44 px touch targets.
- Every test asserts the console carries no errors or warnings, no request
  failed, and no response was 4xx or 5xx.

The backend log for the run carries nothing attributable to EV-3.

## Notes on the design

- **One rule per survey and trigger type.** The same satisfaction survey can
  reasonably follow a topic *and* a module exit, so the pair is what is unique.
  Priority resolves between surveys, not within one.
- **The rules are public.** They name a content item, a trigger and a number;
  they name nobody. A guest's device needs them and has no session.
- **The frequency store sits beside the trivia sighting history**, in shared
  preferences, for the same reason: it is a list of content ids and times.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 20 files, 311 tests passed (+15) |
| `@repo/db` vitest | 16 files, 101 passed, 32 skipped |
| backend jest `--runInBand` | 86 suites, 715 passed, 48 skipped (+2 suites, +17) |
| `web` vitest | 41 files, 375 passed (+9) |
| `packages/e2e-web` Playwright | 7 passed |
| `flutter test` | 664 passed, 1 skipped (+17) |
| `flutter analyze` | 0 errors; 40 pre-existing infos/warnings |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

Three sibling tests changed because the public configuration grew a field they
pinned exactly — the contract test, the mobile repository test and the backend
controller test. That is those tests doing their job: the public config is a
strict allowlist on purpose, and widening it is a deliberate act recorded here.

EV-2's seeded `surveyForCompletedTopic` is gone: EV-3 replaced it with the
engine, and the test that pinned the seed now pins the engine's topic matching.

## Scope notes

- **Only the topic-completion trigger is wired to a call site.** The engine
  handles all five, and `module_exit`, `app_exit`, `activity_completion` and
  `page_depth` are asserted at the engine; the screens that would fire them are
  where they will be called from. EV-4 wires the exit hook.
- **The console takes a survey's content id rather than offering a picker.**
  The list of published surveys is one screen away and the id is what the rule
  is keyed on; a picker is a refinement, not a criterion.
