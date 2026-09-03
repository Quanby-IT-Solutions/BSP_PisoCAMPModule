# DR-2 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `c4efe8c` (DR-1)
Ticket: DR-2 — uncertain or failed recognition handling

## Result

All four acceptance criteria are **PASS**.

DR-1 already refused to name a note below the threshold; what it did then was
keep looking, forever. DR-2 is the answer to "and then what?".

## AC1 — below the threshold for the dwell time, it says so and says what to try

**PASS.** After the dwell elapses with nothing read confidently, the screen says
the note could not be read and shows four tips, one for each thing the criterion
names:

| | |
| --- | --- |
| Lighting | Move somewhere brighter, and keep glare and shadows off the note. |
| Distance | Hold the phone about a hand-span away, close enough to fill the frame. |
| Orientation | Turn the note so it sits straight, the long way across the screen. |
| Visibility | Lay it flat and unfolded, with nothing covering any part of it. |

Advice, not a diagnosis. The module cannot tell which of the four was wrong, so
it offers all four in the order somebody would try them.

The dwell is a **timer**, not a frame count. A camera that stops delivering
frames therefore ends the same way as one delivering unreadable ones: proven by
a test that feeds nothing at all and still reaches the unrecognised state.
Somebody is not left holding a note in front of a screen that will never answer.

The value is 8 seconds — long enough to move the phone and let the light change,
short enough not to feel broken. **DR-4 owns the approved value** along with the
threshold; this is what stands until it is configured, and the constant says so.

A confident reading arriving before the dwell expires wins, and the timer does
not then fire on top of it: one scan, one answer.

## AC2 — Retry resumes, Exit goes back

**PASS.** Retry starts a fresh attempt — the model is loaded again and the
screen returns to scanning — and Exit returns to the screen the scanner was
opened from, proven by pushing it from another route and asserting that route
is showing afterwards.

Both controls are 48 dp. The guidance is long enough that they sit below the
fold at 320 px, so the test scrolls to them and checks them where a person would
actually reach them.

## AC3 — no denomination text and no audio

**PASS**, asserted directly: no denomination anywhere on the unrecognised
screen, and the announcer was never asked to say anything. DR-009 is the whole
point of this state — a hedged guess would be worse than silence, because the
person reading it is deciding whether to accept a banknote.

The screen says plainly that nothing was recognised, rather than leaving a blank
where a denomination would go.

## AC4 — `recognition_result{outcome:unrecognized}`

**PASS.** One event per attempt, carrying `{ outcome: "unrecognized",
elapsedMs }` and nothing else.

Its `status` is **`completed`**, and the contract now refuses it as `failed`.
A scan that ran and could not read the note is the model's answer, not a broken
install; reporting it as a failure would bury the model's real failure rate —
the number DR-4's harness exists to measure — underneath devices that never had
a model at all.

That also makes it a use of the feature in AN-013's adoption report, unlike
`unavailable` and `permission_denied`: the person used the reader; it could not
read their note.

## Test evidence

| Suite | Result |
| --- | --- |
| `flutter test` | 760 passed, 1 skipped (7 new: 3 scanner, 4 screen) |
| backend jest `--runInBand` | 113 suites passed, 1004 tests, 2 suites / 48 tests skipped |
| `packages/contracts` vitest | 23 files, 380 passed |
| `pnpm typecheck` | 18/18 |
| `pnpm lint` | 18/18; only the 6 pre-existing `@repo/auth` warnings |
| `flutter analyze` | no new issues |

No migration: the analytics CHECK constrains the event's name, screen, feature
and status, and a new outcome is a property value, so `unrecognized` needed only
the contract and the device.

## Not proven in this environment

How often real notes fall below the threshold, and whether 8 seconds is the
right dwell for them. Both are measurements against the approved model on real
hardware, which is DR-4's harness.
