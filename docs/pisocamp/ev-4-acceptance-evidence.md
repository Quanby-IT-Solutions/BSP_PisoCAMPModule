# EV-4 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `fc55f2a` (EV-3)
Ticket: EV-4 — Exit advisory on proper currency handling

## Result

Three of the four EV-4 acceptance criteria are **PASS**; AC1 is **PARTIAL** —
the advisory's approved text and links render, its images and audio do not,
because the bundle does not yet carry a published item's assets. Details below.

## What EV-4 adds

| Layer | Surface |
| --- | --- |
| Contract | `exit_advisory_interval_hours` on the admin and public configuration; the `advisory_shown` event |
| Backend | The interval read, written and audited as its own setting; the public config carries it |
| Web | The interval field on Module Configuration |
| Mobile | `advisory_document.dart` (reader, display store, due-check), `exit_advisory.dart`, `advisory_provider.dart`, and the module-exit hook |

## AC1 — the advisory is displayed on module exit, once per interval

**PARTIAL.**

What works and is proven: leaving the module fires the hook, the advisory is
read from the bundle, and it is shown at most once per configured interval.
`advisory_document_test.dart` asserts the due-check at its boundaries — never
shown is due, one minute short of the interval is not, exactly on it is, and a
six-hour interval behaves as six hours. `exit_advisory_test.dart` asserts the
coordinator shows it once, records the time it was **shown** (so the interval
counts from being advised rather than from being dismissed), and stays quiet
inside the interval.

Which advisory is shown is stable: the first by content item id, so somebody
leaving twice is not given different advice by accident. Asserted both ways
round.

**What does not work: images and audio.** The ticket names
"text/images/audio/links". The built bundle carries content documents only —
CE-1 renders published content as JSON and does not add a published item's
version assets to the manifest — so an advisory's image or audio is not on the
device to render. The reader and the widget carry text and links, which is
everything the bundle actually holds today. Carrying assets for published
content is a bundle change, not an advisory change, and it is called out here
rather than left to be discovered.

## AC2 — dismissing it lets the exit proceed

**PASS.** "Got it" is one tap, with no confirmation, and the widget test
asserts no dialog appears between the tap and the callback. The exit hook uses
`PopScope`: the first back gesture is intercepted to show the advisory, and the
dismissal pops the route it was holding. An advisory that is not due, or that
could not be read, pops immediately — somebody leaving the module should leave,
and an advisory that failed is not a reason to trap them.

## AC3 — it renders from the bundle when offline

**PASS.** `AdvisoryDocument.parsePublished` reads from the same verified bundle
snapshot as every other document, through `CurrencyCatalogView`. There is no
network call on the exit path. The reader is strict for the same reason the
others are — six rejection cases asserted, including a non-advisory document,
markup in the body, a plain-HTTP link, and a logical id that names another item.

The interval falls back to the contract's default until the configuration has
been read, so a device that has never reached the server still advises.

## AC4 — an `advisory_shown` event is emitted

**PASS.** A new catalog event, bound to the `exit_advisory` screen and the
`advisory` feature, carrying only the advisory's logical id. Asserted in the
coordinator (emitted exactly once, and not at all when nothing is due), in the
contract, and in `analytics-catalog.spec.ts`, which inserts one of every
declared event so the database's catalog cannot drift from the contract's.

## The interval is configuration

`exit_advisory_interval_hours` sits with the session setting in
`module_configuration`, is written through the same permission-gated route, and
is **audited as its own key**: a combined entry would hide which setting
actually moved. Asserted, including that a replay of the same idempotency key
does not double either entry.

Hours rather than days, because "once a day" and "once per visit" are both
reasonable and only one of them is a whole number of days.

## Browser validation

`ev4-advisory-interval.authenticated.spec.ts` — **5 passed** including setup.
The interval is saved through the console, and then read back from
`GET /pisocamp/config` **without a session**, which is how a device gets it. An
interval outside the range is refused with a reason on the page. At 320 px there
is no horizontal overflow and the field is keyboard-focusable. Console, network
and page errors are asserted clean.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 20 files, 317 tests passed (+6) |
| `@repo/db` vitest | 16 files, 101 passed, 32 skipped |
| backend jest `--runInBand` | 86 suites, 716 passed, 48 skipped (+1) |
| `web` vitest | 41 files, 377 passed (+2) |
| `packages/e2e-web` Playwright | 5 passed |
| `flutter test` | 686 passed, 1 skipped (+22) |
| `flutter analyze` | 0 errors; 40 pre-existing infos/warnings |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

Five sibling tests changed because the configuration grew a field they pinned
exactly, and one because the audit is now one entry per key. Both are those
tests doing their job.

## Scope notes

- **Images and audio are the gap.** See AC1. The bundle would need to carry a
  published item's assets for an advisory to show one.
- **The exit hook is the module's own back gesture.** "App background at the
  approved point" is the other exit the ticket names; a lifecycle observer is a
  second call site into the same coordinator, and the interval already stops it
  showing twice.
- **Which advisory is "the" exit advisory** is a content decision nobody has
  made yet. Until an item is marked for it, the module is at least consistent:
  the first by id, every time.
