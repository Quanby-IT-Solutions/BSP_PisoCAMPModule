# AR-3 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `ce49ae9` (DR-4)
Ticket: AR-3 — synchronized audio, full mandatory coverage and offline packaging

## Result

Four of the five acceptance criteria are **PASS**. The audio-sync criterion is
**PARTIAL**: the synchronisation rule is implemented and measured to the ±100 ms
the criterion names, but nobody has heard it on a device, because this build
ships no AR runtime and no audio runtime (AR-1's limit, unchanged).

## AC1 — audio in sync with the animation timeline (±100 ms)

**PARTIAL**, and the half that can be measured is measured.

`ArNarrationSync` holds the narration to the animation's timeline. **The
animation is the clock**: it is what somebody is looking at, so when the two
disagree the narration is what moves. Asserted in both directions — narration
running late and narration running early — and each correction is proven to land
the narration within the tolerance of the animation's position.

A difference **inside** ±100 ms is deliberately left alone. Correcting a 10 ms
drift is audible and fixes nothing.

When the animation ends the narration stops, and stays stopped. Audio still
talking over a finished scene is the same defect as audio that started late.

The narration starts **with** the animation, not before it: audio that begins
while the scene is still placing itself describes something nobody can see yet.

**Unproven here:** the drift a real recording exhibits against a real animation
on a real device. That needs the approved plugin, the approved audio, and
hardware.

## AC2 — mute, replay and captions

**PASS.**

Mute silences the narration and nothing else; unmute resumes it; replay starts
it again from the beginning. **Muted means muted** — the replay control stays
silent rather than overriding it, because a replay button that starts talking in
a quiet room is a bug somebody experiences in public.

The transcript is a **required** field on an AR experience, stored, carried in
the bundle and shown on the running screen **by default**. Somebody who cannot
hear the audio should not have to discover that a transcript exists. It can be
hidden by anyone who does not want it, and hiding it does not touch the audio.

The parser refuses an experience with no transcript rather than showing an empty
caption box: an experience whose narration nobody can read is one a deaf visitor
cannot use at all.

## AC3 — on-demand download, per item or all, working offline

**PASS.**

`BundleStore.fetchOnDemand` fetches a single on-demand object through the same
verified path the core objects use, and refuses an entry that is not on-demand —
fetching a core object here would be a second, unmanaged copy of something the
sync already owns.

`ArDownloadManager` works **per experience**, because that is the unit somebody
chooses: nobody wants the animation but not the narration. An experience is
`ready` only when *every* asset it needs is verified on disk, proven by a case
where the model is present and the narration is not — calling that ready would
be a promise the AR screen cannot keep.

Progress is reported in bytes as they arrive, not just at 0% and 100%, which is
the difference between "it is working" and "it is stuck" on a slow connection.
What is already downloaded is read **from disk** on every visit rather than
remembered, and is never fetched twice — re-downloading a verified object costs
somebody their data for a file they already have.

"Downloaded experiences open with no connection at all, including in airplane
mode" is what the screen says, and it is true by construction: the assets are in
the content-addressed store, which is where the AR screen reads them from.
**Airplane mode itself is not exercised here** — that is a device test.

## AC4 — coverage of all 24 mandatory items

**PASS**, as a check. Fourteen coins and ten banknotes are listed in
`AR_MANDATORY_EXPERIENCES`, and the check reports which of them have a published
experience, which do not **by name**, and any published experience for something
the list does not name.

Listed rather than derived from the catalogue, because "everything we ship"
would quietly redefine what is mandatory the day somebody adds a denomination.
A test pins the count at 24 and the split at 14 + 10, so an edit that loses an
item fails rather than passing with a smaller list.

Only **published** experiences count. A draft is a promise, not coverage.

> **For BSP:** the membership of that list is yours under BR-010 change control.
> The count and the shape are asserted; which ten banknotes are mandatory is a
> decision this repository records rather than makes, and it should be confirmed
> against Annex H before UAT.

## AC5 — interrupted downloads resume (RF-6)

**PASS.** An interrupted download keeps what arrived — the store's part file and
resume journal, already RF-6's machinery for core objects — and the experience
is reported as *partly downloaded* rather than absent. Asking again continues:
proven by failing a transfer mid-run and then completing it, with the finished
assets not re-fetched.

The screen says so in words somebody can act on — "What arrived is kept — try
again and it will carry on" — and the button reads **Resume**, not Download.

A failed run stops rather than ploughing on through the rest: the person asked
for these, and they can ask again.

## A pre-existing failure fixed on the way

The web suite had one test failing **in the full run and passing alone** — thirty
real interactions against the default five-second per-test timeout, which the
suite exceeds under parallel load. Confirmed on the baseline before this ticket's
changes, so it was not caused here; it now has the time it actually needs, with
the reason written down. The web suite is 498/498.

## Test evidence

| Suite | Result |
| --- | --- |
| `flutter test` | 806 passed, 1 skipped (30 new: 9 narration, 6 downloads, 6 downloads screen, 5 document, 4 captions) |
| backend jest `--runInBand` | 117 suites passed, 1033 tests (5 new coverage tests) |
| `apps/web` vitest | 54 files, 498 passed |
| `packages/contracts` vitest | 23 files, 381 passed |
| `pnpm typecheck` | 18/18 |
| `pnpm lint` | 18/18; only the 6 pre-existing `@repo/auth` warnings |
| `flutter analyze` | no new issues |

Migration `20260903093000_ar3_narration_transcript`, applied to all four local
databases. It adds the column nullable, backfills, then makes it required: a
NOT NULL column added to a populated table fails, and a migration that only
works on an empty database is not a migration. The backfill text says plainly
that no narration has been supplied rather than inventing one.

## Not proven in this environment

- Audio playing in sync on a device, and the drift a real recording exhibits.
- Airplane mode on real hardware.
- That the 24 mandatory items are in fact covered: nothing is published in this
  environment, so what is proven is that the check would say so.
