# AN-7 monitoring interface (§12)

How the module receives crash and API figures from the monitoring tool, and how
performance-test results are recorded.

## Why an import rather than a live query

A process that has crashed cannot report its own death, and a request that never
reached the API leaves nothing in the API's own logs. Both facts are known only
to the tool watching from outside, so the module takes them as an import instead
of pretending it can observe them.

The module does **not** hold credentials for the monitoring tool. Whatever runs
the export — a scheduled job, an operator, the tool's own webhook — authenticates
as a user holding `admin.integrations.manage` and posts a period of figures.

## Endpoints

| Method | Path | Permission |
| --- | --- | --- |
| `POST` | `/api/v1/admin/pisocamp/monitoring/metrics` | `admin.integrations.manage` |
| `POST` | `/api/v1/admin/pisocamp/monitoring/performance-tests` | `admin.integrations.manage` |
| `GET` | `/api/v1/admin/pisocamp/analytics/technical` | `reports.dashboards.view` |

Reading technical health and feeding the module figures from outside it are
different permissions on purpose: somebody who may read a dashboard has no
business writing to it.

## Importing a period

```http
POST /api/v1/admin/pisocamp/monitoring/metrics
Content-Type: application/json

{
  "source": "sentry",
  "periodStart": "2026-09-01",
  "periodEnd": "2026-09-07",
  "crashes": {
    "crashCount": 12,
    "affectedUsers": 7,
    "affectedSessions": 10,
    "totalSessions": 1000
  },
  "endpoints": [
    {
      "endpoint": "GET /pisocamp/config",
      "requestCount": 1000,
      "errorCount": 20,
      "timeoutCount": 5,
      "authFailureCount": 2,
      "latencyP50Ms": 40,
      "latencyP95Ms": 180
    }
  ]
}
```

- `source` names the tool. Figures from two tools for the same period are kept
  apart rather than merged, because they count sessions differently.
- `crashes` may be `null`, and `endpoints` may be empty: a tool that reports one
  and not the other should send what it has rather than zeros for the rest.
- **Importing the same `source` and period again replaces it.** A retried import
  after a dropped connection cannot double a crash count.
- The request is refused if a period ends before it starts, if more sessions
  crashed than the tool saw, if an endpoint reports more failures than requests,
  or if its p95 is below its p50.
- Every import writes an audit entry (`pisocamp` / `monitoring.import`) naming
  the actor, the source and the period.

## Recording a performance test

```http
POST /api/v1/admin/pisocamp/monitoring/performance-tests
Content-Type: application/json

{
  "testedAt": "2026-09-05",
  "appVersion": "1.2.0+8",
  "platform": "android",
  "deviceModel": "Pixel 7a",
  "appSizeMb": 84.5,
  "moduleSizeIncreaseMb": 12.25,
  "downloadedAssetsMb": 30,
  "localStorageMb": 45.75,
  "batteryImpactPercent": 3.5,
  "notes": "Thirty minutes of continuous use on Wi-Fi."
}
```

These figures come from a measured build on real hardware, so the row records
who entered them and an audit entry (`pisocamp` / `performance_test.record`)
says so: a size or a battery figure with nobody behind it cannot be checked by
anybody later. The same payload is what the "Record a performance test" form on
`/pisocamp/technical` sends.

## What the module measures itself

Load time and network failures come from the device, because only the device
knows how long it waited and what it could not reach:

- `module_load` — `{ phase: cold | warm, durationMs }`, emitted at the first
  frame after module entry. Cold and warm are reported apart because a cold
  start pays for the process as well as the module.
- `network_failure` — `{ failureType, operation }`, emitted when a sync or
  download could not finish. It is the one event whose status is `failed`.

Both are in the shared event catalog, so the same envelope validation, the same
forbidden-data defence and the same idempotent ingestion apply to them as to
every other event.
