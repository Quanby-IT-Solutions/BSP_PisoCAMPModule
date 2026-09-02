# GM-2 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `a490ad0` (GM-1)
Ticket: GM-2 — Random trivia prompt with skip, correct and incorrect behaviour

## Result

All six GM-2 acceptance criteria are **PASS**.

## What GM-2 adds

| Layer | Surface |
| --- | --- |
| Contract | `trivia_prompt_shown`, `trivia_prompt_answered`, `trivia_prompt_skipped` |
| Mobile | `trivia_question_document.dart` (strict reader), `trivia_selection.dart` (selector and window), `trivia_history_store.dart` (seen-history), `trivia_prompt.dart` (the prompt), `trivia_provider.dart` (config, analytics, coordinator), and the module-home trigger |

## The decision the ticket forces

AC1's rule carries a condition — *"excluding any shown within the repeat window
**when enough questions exist**"* — and that condition is the whole difficulty. A
pool of three cannot honour a seven-day window without eventually offering
nothing, and offering nothing is worse than repeating.

So the window is applied when it can be and **stood down** when it cannot, and
that is stated in the selector rather than discovered later.
`triviaWindowIsHonourable` is exported so a caller can say *why* a question
repeated instead of leaving it looking like the shuffle is broken. Both branches
are asserted.

## AC1 — a random question, excluding those seen inside the repeat window

**PASS.** `trivia_selection_test.dart`:

- a question seen three days ago is skipped in favour of one that was not;
- a question seen eight days ago is offered again;
- **exactly seven days is still recent** — the window edge is inclusive, pinned
  because an off-by-one here is invisible until someone sees the same question
  twice in a week;
- with a one-question pool that was just shown, the question is offered rather
  than nothing;
- a configured window other than the default changes which questions are
  eligible;
- across thirty draws from a pool of three, all three are drawn — the selection
  is random over the whole eligible pool, not a first-entry bias.

The window is configuration with the ticket's default of 7 days, read through
`triviaRepeatDaysProvider` so F2's config service can supply it later without
touching the selector.

The sighting is recorded when the question is **shown**, not when it is
answered. A guest who skips has still seen it, and offering it again tomorrow is
the repeat the window exists to prevent. Asserted.

## AC2 — dismissing or skipping closes it and leaves the module usable

**PASS.** The prompt has a Skip control before an answer and a Close after one,
neither behind a confirmation, and it is presented as a bottom sheet so the
module underneath stays reachable. Skipping reports `skipped` and the prompt
goes.

It also finishes exactly once however many times its controls are pressed:
choices are disabled after the first answer, and a second Close changes nothing.
Asserted, because a prompt that marked a guest twice would corrupt the very
record GM-3 will sync.

## AC3 — a correct answer congratulates, records, and auto-closes after 5s

**PASS.** A correct answer shows "Correct. Well done." in a live region, and the
prompt closes itself five seconds later — asserted at four seconds (still open)
and at five (closed), so the delay is the stated one rather than approximately
it.

`keepResult` holds it open indefinitely: five seconds is not long for everyone,
and the people it is shortest for are exactly the ones an auto-close hurts. Held
for thirty seconds in the test, then closed by hand.

Reduced motion turns the auto-close off too. A view that disappears out from
under you is motion whether or not it animates, so the same signal that F6
established governs it.

Recording the answer for GM-3 is that ticket's scope; GM-2 emits the event and
reports the outcome to its caller.

## AC4 — an incorrect answer shows the answer, the explanation and a topic link

**PASS.** "Not quite.", then the correct choice, then the approved explanation,
then an offer to read the related topic — an offer, not a redirect: opening it is
a tap the guest chooses, and it is a push, so they come back to the module.
Asserted, including that a question with no topic simply offers none.

An incorrect answer **never** auto-closes: there is more to read. Asserted at
thirty seconds.

## AC5 — prompts work offline

**PASS.** The pool is read from the same verified bundle snapshot as everything
else, in `CurrencyCatalogView.load`, so no second read and no network. The
correct answer travels with the question, so a device with no connection still
marks the answer and explains it. The whole Flutter suite runs with no network.

The reader is strict for the same reason the currency reader is: a question is
the thing a guest is marked against. Ten rejection cases are asserted — one
choice, seven choices, no correct answer, two correct answers, a repeated
choice, a marked-up choice, an unknown difficulty, a non-question document, a
question carrying a disclosure level, and a related link that is not a topic.

## AC6 — shown, answered and skipped events

**PASS.** Three events in the shared catalog. Each carries the question's logical
id, category and difficulty; `answered` adds whether the answer was **right** and
whether the topic was opened — never *which* answer was chosen, because the
chosen label is content and analytics carries none.

The coordinator emits shown on selection and exactly one of skipped/answered on
completion; all three are asserted, including that an empty pool records nothing
at all.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 17 files, 254 tests passed |
| `flutter test` | 540 passed, 1 skipped (CE-2's evidence renderer) |
| `flutter analyze` | 0 errors; 40 pre-existing infos/warnings |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

No sibling test needed changing.

## Scope notes

- **The prompt is not registered in F6's audit.** It is a widget inside the home
  screen rather than a screen of its own, and the home screen is not yet
  registered there (F6 records why). A ticket that registers the home screen
  should cover the prompt with it.
- **"Topic completion" as a second trigger** is not wired. The ticket names two
  triggers — module home visit and topic completion — and the home visit is
  built; the coordinator takes a pool and returns a question, so the second
  trigger is a call site rather than new machinery. It is called out here rather
  than left to be discovered.
- **The accessibility "keep result" setting** is a provider with a default of
  off. The prompt honours it and the behaviour is asserted; a screen for a
  person to change it belongs with the module's other settings.
