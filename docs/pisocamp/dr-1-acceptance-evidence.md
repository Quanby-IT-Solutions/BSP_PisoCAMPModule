# DR-1 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `1f48f23`
Ticket: DR-1 — camera scan to on-device denomination, with audio and the
authenticity disclaimer

## Result

Five of the six acceptance criteria are **PASS**. The first is **PARTIAL**: the
decision logic, the announcement and the disclaimer are all proven, but no
approved model or inference runtime exists to read a real banknote with.

## The seam, and why

The recognition model is an ML deliverable BSP approves (DR-008), and the
inference plugin is chosen with it. Neither is in this repository, so three
things sit behind ports — `RecognitionModelSource`, `RecognitionEngine` and
`CameraFrameSource` — in the shape SA-5 uses for push and AN-7 for monitoring.

The scan loop itself is **not** behind a port. Everything the criteria are
strict about — the threshold, the frame's lifetime, the disclaimer, what is
said and in what order — is ordinary code in `RecognitionScanner` and the
screen, and every bit of it is exercised.

A build with no runtime reports `engineMissing` and the screen says the reader
is unavailable. That is the path this build actually runs, and it is the same
path a phone with a broken model takes. **It never guesses.**

## AC1 — a confident reading is displayed and spoken

**PARTIAL.**

Proven: above the configured threshold the denomination appears as text and is
spoken in one utterance, and the model's class list — not the screen — decides
what that denomination is called. Below the threshold nothing is shown and
nothing is said; a near miss is a wrong answer waiting to be read as a right
one. A class the approved descriptor never declared is refused outright, so a
model and a descriptor that disagree cannot produce a denomination.

The threshold is SA-3's `recognition_confidence_threshold`, read from public
configuration, with the contract's 0.8 standing until it is read: a device that
has never reached the server has to be as careful as one that has.

**Unproven here:** that the model reads a real 20-piso note correctly. That
needs the approved model and a camera.

## AC2 — the disclaimer, every time, in text and aloud

**PASS**, and it is one constant used by both, so the sentence somebody hears
and the sentence they read cannot drift apart:

> This does not verify authenticity. If in doubt, submit the banknote to an
> authorized agent bank or the Bangko Sentral ng Pilipinas.

It is on the **first** screen, before the camera opens — somebody worried about
a note is exactly the person who must not read this as a genuineness check —
and it is on every result. The reading and the disclaimer are spoken as a
single utterance, so the denomination cannot be heard without the qualification
that follows it. The home-screen entry point says the same thing before anybody
taps it.

No wording anywhere in the feature claims a note is genuine, and the
unavailable state says plainly that nothing was read.

## AC3 — frames are processed in memory only

**PASS**, and asserted rather than asserted-about:

- Every frame is released in a `finally`, so a classifier that throws still
  leaves nothing behind. Releasing **overwrites** the buffer rather than only
  dropping the reference: a reused platform buffer left legible is exactly the
  residue this criterion is about. Reading a released frame throws.
- Frames arriving while inference is running are **dropped and released**, not
  queued. A queue of camera buffers is the memory leak this feature would
  otherwise have.
- A full scan runs inside `IOOverrides.runZoned` and `HttpOverrides.runZoned`
  with recording overrides: **no file is created, no directory is created, no
  socket is opened and no HTTP client is constructed.** The scan concludes with
  a reading in the same test, so it is a real scan being observed.

The event carries nothing from the frame either — see AC6.

## AC4 — audio is optional, the text is not

**PASS.** Muting stops the speech immediately and changes nothing else: the
denomination and the disclaimer stay on screen, and "Play again" does nothing
while muted. Unmuting replays. A device with no speech engine is the same case:
`PlatformSpeechAnnouncer` guards every call and fails silently, because the
screen already shows the same words.

## AC5 — a missing or corrupt model says so and never guesses

**PASS.** The descriptor parser is strict: a schema version this build was not
written for, an empty class list, a duplicate class id, a class with no
denomination, a descriptor with no weights behind it, or bytes that are not
JSON at all — each is refused as corrupt, and none produces a partial model.

Missing and corrupt are told apart. "Not downloaded" would send somebody to
sync a bundle they already have.

The camera is **not opened** when the model cannot be loaded: asking for a
permission to then say the feature does not work spends a prompt for nothing.

Both entries are read through the active bundle snapshot, so each is checked
against the signed manifest's digest before it is used (CE-1).

## AC6 — `recognition_result{outcome}`, with no image data

**PASS.** One event per attempt, and the whole property set is
`{ outcome, elapsedMs }` — asserted by key, not by absence. No denomination, no
confidence, nothing derived from the frame: what somebody is holding is not
this module's business, and no criterion asks for it. `elapsedMs` is what
DR-4's harness reports as p50/p95.

`outcome` is `recognized`, `unavailable` (model missing or corrupt) or
`permission_denied`. The last two are the ones where no scan ran, and they are
reported with `status: failed`; the contract refuses any other pairing of the
two fields, on the device and on the server. Merging a refused camera into
"unavailable" would hide the difference between a module nobody can use and one
nobody wants.

AN-1's existing defence already refuses image-shaped strings and byte arrays
anywhere in an event; a test now pins that for this event specifically.

## Two defects found and fixed

**A guest could not open the AR view.** The guest-route pattern still listed
`3d`, `tactile` and `tilt`, so AR-1's screen redirected to login. Fixed and
committed separately as `1f48f23`; DR-1's own route is in the guest allowlist
for the same reason.

**AR and recognition were reported as unused.** AN-013's adoption report maps
events onto features, and `ar` and `recognition` had no mapping — so a feature
people were using would have read as a feature nobody touched. Both are mapped
now, counting only the attempts that actually ran: a phone that cannot open
augmented reality, or a reader that was never downloaded, is not somebody using
either. What broke is AN-7's question.

## Test evidence

| Suite | Result |
| --- | --- |
| `flutter test` | 753 passed, 1 skipped (28 new: 11 scanner, 7 model, 10 screen) |
| backend jest `--runInBand` | 113 suites passed, 1004 tests, 2 suites / 48 tests skipped |
| `packages/contracts` vitest | 23 files, 379 passed |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` warnings |
| `flutter analyze` | no new issues |

Migrations `20260903090000_dr1_recognition_events` and
`20260903091000_dr1_recognition_model_bundle_kind`, applied to all four local
databases.

## Not proven in this environment

- That the approved model reads real banknotes correctly, at any accuracy.
- Speech on a device: `flutter_tts` is wired and guarded, but nobody has heard
  it here.
- Camera behaviour on real hardware, including the OS permission prompt.

All three need the approved model, the inference plugin and physical devices.
Everything that does not depend on them is implemented and asserted.
