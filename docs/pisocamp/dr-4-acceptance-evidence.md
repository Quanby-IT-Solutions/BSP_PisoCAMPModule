# DR-4 acceptance evidence

Date: 2026-09-03 (Asia/Manila)
Baseline: `3104c68` (DR-3)
Ticket: DR-4 — recognition model versioning, threshold configuration and
accuracy harness

## Result

All four acceptance criteria are **PASS** for everything that does not require
the approved model and the device matrix. What needs those is named at the end.

## AC1 — a published model is stored and delivered

**PASS**, end to end.

A model is published with its **version, class list and thresholds** under
`admin.config.manage`. The weights go into the bundle object store addressed by
digest, exactly like every other bundle object, so the file a device verifies
against the signed manifest is the one this record describes.

Two entries reach the bundle: `recognition-model.active`, the JSON descriptor a
device validates, and `recognition-model.weights`, opaque bytes whose digest is
the whole guarantee. Proven against a real build — signed, reconciled and
promoted — by fetching the descriptor back out of the store by digest, the way
a device fetches it.

The weights are **not** re-read during a build. They are already stored under
that digest, and pulling megabytes through every build to hash them again would
prove nothing the digest does not already say.

Publishing **retires** the previous model, and the database enforces one live
model with a partial unique index — asserted by a direct insert that the
constraint refuses. Two live models would mean the bundle had to choose, and
whichever it chose would be a coin toss over which weights every phone runs.

Republishing a version is refused: a version is how a figure is traced back to
the weights that produced it.

**Devices report which version they run.** `recognition_result` now carries
`modelVersion`, absent when no model was ever loaded — a scan that never ran was
not run by anything.

### A defect this ticket had to fix

CM-6 installed a trigger requiring every rebuild request to name a
bundle-affecting *content version*. A model publication names none, so the
trigger refused it and **the model would have sat in the database while every
device kept running the old one**. The rebuild request now carries a `reason`,
the trigger applies only to content rows, and a check keeps a content request
naming its version and any other naming neither.

## AC2 — the accuracy harness

**PASS** as a tool; the measurement itself needs the dataset and the devices.

`scripts/recognition-accuracy-harness.mjs` takes the approved dataset, the raw
results a device produced for it, and the model's own thresholds, and reports:

- **recognition accuracy** — did it reach the right *kind* of answer;
- **classification accuracy** — did it also name the right class;
- **wrong-claim rate** — the gap between those two, which is the number to read
  first: the module said something and the something was wrong;
- **failure rate**, per class, per device and per lighting/distance/wear variant;
- **p50 / p95 / max response time**, by nearest rank — with twenty samples an
  interpolated p95 invents a number between two real measurements.

It **applies the threshold itself** rather than trusting the device's verdict.
That is the point: runs recorded once can be replayed against candidate
thresholds without going back to the lab, which is exactly what "UAT thresholds
are demonstrably met" requires. Asserted by replaying the same fixture at 0.7,
0.8 and 0.99 and watching the figures move.

A dataset sample with no recorded run is **named**, never scored. Counting it as
a pass would let an untested class reach UAT looking measured.

The spec runs the CLI the way an operator runs it, so the number in a report
attached to the TCP and the number asserted in CI cannot drift apart. A worked
dataset and run file live in `docs/pisocamp/fixtures/`.

## AC3 — threshold edits are audited and take effect on the next sync

**PASS.** Editing thresholds records the old and new values against the actor
and the model version, and enqueues a bundle rebuild so the change actually
reaches devices — "takes effect on the next bundle sync" is only true if a sync
is due.

Editing a **retired** model's thresholds audits but does not rebuild: it changes
nothing on any device, and a rebuild carrying no change is a sync every phone
pays for.

The thresholds travel **with the model**, and the device prefers them over
configuration. A confidence tuned against one set of weights says nothing about
another; SA-3's configured value is what a device uses before any model reaches
it. Asserted on the device: a reading above the configured bar but below the
model's approved bar is refused, and the dwell the model carries replaces the
built-in one.

The descriptor parser refuses a confidence outside 0.5–1 or a dwell outside
1–60 seconds rather than obeying it. A confidence of zero would have the scanner
naming notes on a coin flip.

## AC4 — without the permission, 403 and an audit entry

**PASS**, both branches, for all three endpoints (`list`, `publish`,
`updateThresholds`). A holder of `admin.config.manage` passes; a Reports &
Analytics user is refused with 403 and the denial is recorded with the handler,
the required permission and the missing one. Reading the dashboards is no reason
to be allowed to replace the model every phone runs on people's money.

## A second defect, found while proving AC1

The bundle integration suite — skipped unless `PISOCAMP_BUNDLE_TEST_DATABASE_URL`
is set, which is why nobody had seen it — had two tests comparing **PostgreSQL
timestamps against `Date.now()`**. The container's clock runs tens of
milliseconds ahead of the host's, so a lease-expiry assertion and a retry wait
failed at random. Both now read the database's clock. Three consecutive full
runs of that suite pass.

## Test evidence

| Suite | Result |
| --- | --- |
| backend jest `--runInBand` | 116 suites passed, 1028 tests (21 new: 11 service, 4 authorization, 6 harness) |
| bundle integration (env-gated) | 13 passed, three consecutive runs, including the new delivery test |
| `flutter test` | 776 passed, 1 skipped (7 new for the model's own thresholds) |
| `packages/contracts` vitest | 23 files, 381 passed |
| `pnpm typecheck` | 18/18 |
| `pnpm lint` | 18/18; only the 6 pre-existing `@repo/auth` warnings |

Migration `20260903092000_dr4_recognition_models`, applied to all four local
databases.

## Deliberate limits

- **A model must fit in 5 MiB.** Not a preference: bundle core entries are
  capped at that on the device, which reads and digests each object whole. A
  model that cannot travel in the bundle cannot reach anybody. The upload
  refuses a larger file rather than accepting one that would never ship.
- **No admin screen.** The ticket's scope is the endpoint, the delivery, the
  harness and the config keys; publishing a model is a deliberate operation
  performed with the approved file in hand.

## Not proven in this environment

- Any accuracy figure. There is no approved model and no dataset; the harness
  computes what it is given, and what it will be given comes from the ML
  deliverable (DR-008).
- The device matrix, and therefore the response times on real hardware.
- An end-to-end publish through HTTP with a real multipart upload: the service
  and the guard are tested directly, as the other admin endpoints are.
