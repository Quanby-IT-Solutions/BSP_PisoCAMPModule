# Piso CAMP analytics event catalog

The executable Zod schemas in `packages/contracts/src/modules/v1/pisocamp/analytics.schema.ts` are the wire-format authority. Mobile clients emit only the registered events below and validate the complete envelope before durable queueing.

| Event                  | Screen            | Feature              | Status      | Properties                                         | Emission point                                                     |
| ---------------------- | ----------------- | -------------------- | ----------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `module_entry`         | `pisocamp_home`   | `module`             | `completed` | `{ entryPoint: navigation \| deep_link \| other }` | Once per module route entry.                                       |
| `account_prompt_shown` | `pisocamp_home`   | `account_prompt`     | `completed` | `{}`                                               | Once when the optional-account prompt is displayed.                |
| `account_prompt_guest` | `pisocamp_home`   | `account_prompt`     | `completed` | `{}`                                               | After guest continuation and device pseudonym persistence succeed. |
| `content_view`         | `currency_detail` | `currency_education` | `completed` | `{ logicalId: string (1–128) }`                    | Once per opened CE-1 currency-detail route.                        |
| `first_open`           | `pisocamp_home`   | `module`             | `completed` | `{}`                                               | Once per install, at the first module entry (AN-11).               |
| `ar_start`             | `ar_viewer`       | `ar`                 | `completed` | `{ logicalId, outcome }`                           | When an AR session starts, or cannot (AR-1).                       |
| `ar_end`               | `ar_viewer`       | `ar`                 | `completed` | `{ logicalId, durationMs: 0–3600000 }`             | When an AR session ends (AR-1).                                    |
| `recognition_result`   | `recognition_scanner` | `recognition`    | `completed` or `failed` | `{ outcome, elapsedMs: 0–120000, modelVersion? }`  | When a denomination scan concludes, or cannot run (DR-1).          |
| `module_load`          | `pisocamp_home`   | `module`             | `completed` | `{ phase: cold \| warm, durationMs: 0–120000 }`     | Once per module entry, at the first frame (AN-022).                |
| `network_failure`      | `pisocamp_home`   | `module`             | `failed`    | `{ failureType, operation }`                       | When a sync or download could not finish (AN-024).                 |

`network_failure` and `recognition_result` are the only events whose `status` may
be something other than `completed`. For `network_failure` it always is: it exists
because something did not work, and reporting it as a completion would be a lie.
Its `failureType` is one of `timeout`, `no_connectivity`, `sync_failed`,
`download_failed`, `report_failed` or `upload_failed`, and its `operation` is one
of `config`, `bundle`, `asset`, `events`, `survey` or `other` — what was being
attempted, never where: a URL is content.

`ar_start` carries an `outcome` of `started`, `unsupported` or
`permission_denied`, because a low start count means something different when
devices could not run the experience at all than when people chose not to.

`recognition_result` carries an `outcome` of `recognized` — the only outcome
that makes a denomination claim, and only above the configured confidence
threshold — `demonetized` or `foreign` (confident readings that deliberately
are not denominations), `unrecognized` (the scan ran and could not read the
note confidently), `unavailable` (the recognition model was missing or corrupt)
or `permission_denied` (the camera was refused). The last two are the outcomes
where no scan ran, and they are the ones reported with `status: failed`; the
contract refuses any other pairing of the two fields. Counting a feature that
could not run as a completed scan would hide a broken model deployment, merging
a refused camera into it would hide the difference between a module nobody can
use and one nobody wants, and reporting `unrecognized` as a failure would hide
the model's real failure rate behind broken installs.

It carries no denomination, no confidence and nothing derived from the frame.
What somebody is holding is not this module's business, and DR-003 requires
that frames never leave the device. `elapsedMs` is the attempt's duration,
which is what DR-4's harness reports as p50/p95, and `modelVersion` names the
recognition model that produced the reading — absent when none was loaded,
because a scan that never ran was not run by anything.

## Common envelope

Every event has exactly these common fields: `schemaVersion` (literal `1`), UUIDv4 `eventId`, offset ISO-8601 `occurredAt`, 22-character Base64URL `subjectPseudoId`, UUIDv4 `sessionId`, `accountType` (`guest` or `registered`), `appVersion`, `osName` (`android`, `ios`, or `other`), `osVersion`, `deviceCategory` (`phone`, `tablet`, or `other`), and `networkState` (`online`, `offline`, or `unknown`). The catalog controls `eventName`, `screen`, `feature`, `status`, and the exact `properties` shape. Each event declares its own `status`; every event but `network_failure` and an unavailable `recognition_result` declares `completed`.

## Forbidden data

Events must not contain email addresses, people’s names as data fields, raw image data, `data:image/` URIs, image-shaped Base64, byte arrays, account identifiers, authentication tokens, cookies, or authorization data. The recursive properties defense rejects normalized keys containing `email`, `name`, `image`, `photo`, `frame`, `token`, `cookie`, or `authorization`. It does not try to classify human names within a valid logical ID.

Each encoded event is limited to 8 KiB. An ingestion request contains 1–100 distinct event IDs and is limited to 512 KiB. The response preserves request acknowledgement order in `ackedEventIds`.

## Registration process

Before emitting a new event, add its literal catalog variant and strict property schema, add a valid shared JSON vector, update this document, and add behavior tests. Do not introduce a generic properties map or send unregistered event names.
