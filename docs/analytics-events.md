# Piso CAMP analytics event catalog

The executable Zod schemas in `packages/contracts/src/modules/v1/pisocamp/analytics.schema.ts` are the wire-format authority. Mobile clients emit only the registered events below and validate the complete envelope before durable queueing.

| Event                  | Screen            | Feature              | Status      | Properties                                         | Emission point                                                     |
| ---------------------- | ----------------- | -------------------- | ----------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `module_entry`         | `pisocamp_home`   | `module`             | `completed` | `{ entryPoint: navigation \| deep_link \| other }` | Once per module route entry.                                       |
| `account_prompt_shown` | `pisocamp_home`   | `account_prompt`     | `completed` | `{}`                                               | Once when the optional-account prompt is displayed.                |
| `account_prompt_guest` | `pisocamp_home`   | `account_prompt`     | `completed` | `{}`                                               | After guest continuation and device pseudonym persistence succeed. |
| `content_view`         | `currency_detail` | `currency_education` | `completed` | `{ logicalId: string (1–128) }`                    | Once per opened CE-1 currency-detail route.                        |
| `first_open`           | `pisocamp_home`   | `module`             | `completed` | `{}`                                               | Once per install, at the first module entry (AN-11).               |
| `module_load`          | `pisocamp_home`   | `module`             | `completed` | `{ phase: cold \| warm, durationMs: 0–120000 }`     | Once per module entry, at the first frame (AN-022).                |
| `network_failure`      | `pisocamp_home`   | `module`             | `failed`    | `{ failureType, operation }`                       | When a sync or download could not finish (AN-024).                 |

`network_failure` is the only event whose `status` is not `completed`: it exists
because something did not work, and reporting it as a completion would be a lie.
Its `failureType` is one of `timeout`, `no_connectivity`, `sync_failed`,
`download_failed`, `report_failed` or `upload_failed`, and its `operation` is one
of `config`, `bundle`, `asset`, `events`, `survey` or `other` — what was being
attempted, never where: a URL is content.

## Common envelope

Every event has exactly these common fields: `schemaVersion` (literal `1`), UUIDv4 `eventId`, offset ISO-8601 `occurredAt`, 22-character Base64URL `subjectPseudoId`, UUIDv4 `sessionId`, `accountType` (`guest` or `registered`), `appVersion`, `osName` (`android`, `ios`, or `other`), `osVersion`, `deviceCategory` (`phone`, `tablet`, or `other`), and `networkState` (`online`, `offline`, or `unknown`). The catalog controls `eventName`, `screen`, `feature`, `status`, and the exact `properties` shape. Each event declares its own `status`; every event but `network_failure` declares `completed`.

## Forbidden data

Events must not contain email addresses, people’s names as data fields, raw image data, `data:image/` URIs, image-shaped Base64, byte arrays, account identifiers, authentication tokens, cookies, or authorization data. The recursive properties defense rejects normalized keys containing `email`, `name`, `image`, `photo`, `frame`, `token`, `cookie`, or `authorization`. It does not try to classify human names within a valid logical ID.

Each encoded event is limited to 8 KiB. An ingestion request contains 1–100 distinct event IDs and is limited to 512 KiB. The response preserves request acknowledgement order in `ackedEventIds`.

## Registration process

Before emitting a new event, add its literal catalog variant and strict property schema, add a valid shared JSON vector, update this document, and add behavior tests. Do not introduce a generic properties map or send unregistered event names.
