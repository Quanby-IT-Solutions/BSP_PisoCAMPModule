# F2 acceptance evidence

Date: 2026-08-24 (Asia/Singapore)

## Scope proved

F2 adds the explicit permission catalog and seed mappings, request-scoped RBAC resolution, persisted permission-denial audits, Piso CAMP account deactivation checks, the protected Module Configuration API, and its permission-gated web screen. F1's anonymous public configuration contract remains unchanged.

## Automated validation

| Gate            | Command                                                            | Result                                                |
| --------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| Contracts       | `pnpm.cmd --filter @repo/contracts test`                           | 5 files, 54 tests passed                              |
| Database        | `pnpm.cmd --filter @repo/db test`                                  | 4 files, 30 tests passed                              |
| Backend         | `pnpm.cmd --filter @repo/backend test --runInBand`                 | 31 suites, 274 tests passed                           |
| Web             | `pnpm.cmd --filter @repo/web test`                                 | 17 files, 148 tests passed                            |
| TypeScript      | package `typecheck` for contracts, db, backend, and web            | all passed                                            |
| Lint            | ESLint over every touched TypeScript/TSX file in all four packages | passed                                                |
| Formatting      | Prettier check over every touched TypeScript/TSX file              | passed                                                |
| Backend build   | `pnpm.cmd --filter @repo/backend build`                            | passed, 91 files compiled                             |
| Web build       | `pnpm.cmd --filter @repo/web build`                                | passed; `/pisocamp/config` emitted as a dynamic route |
| Workspace       | `pnpm.cmd lint:ws`                                                 | no issues                                             |
| Patch integrity | `git diff --check`                                                 | passed                                                |

## Disposable PostgreSQL migration and seed smoke

The configured PostgreSQL server at `127.0.0.1:5432` was used to create a dedicated disposable database. A temporary, untracked harness ran the following workflow and was deleted afterward:

1. `pnpm.cmd --filter @repo/db migrate`
2. the same migration command again;
3. `pnpm.cmd --filter @repo/db seed`
4. the same seed command again;
5. catalog/default verification queries;
6. database drop.

The migration-only check ran before any seed and returned the same result after migration reapplication:

```json
{
	"roles": 9,
	"permissions": 27,
	"mappings": 30,
	"adminGrants": 8,
	"piiGrants": 0,
	"wrongRoleNames": 0,
	"statusChecks": 1,
	"defaults": 1
}
```

Both seeds then succeeded, the second reported that existing credentials were left untouched, and the same query remained byte-for-byte stable. This proves that the one F2 migration is self-contained: it creates the exact Annex H roles (`Guest User`, `Registered End User`, `Content Administrator`, `Content Approver`, `Reports & Analytics User`, and `System Administrator`), retains legacy `Admin`/`Manager`/`User`, provides all 27 permissions and 30 explicit mappings, gives legacy Admin eight explicit legacy grants, grants no role `reports.pii.view`, creates exactly one default, and installs the named account-status CHECK. The disposable database was dropped.

## Actual-application HTTP acceptance

A second disposable database, `f2_permission_spine_runtime_20260824`, was migrated and seeded with a temporary runtime-only password. The production-built Nest application ran on port 3099. Tests used these identities:

- `seed-user-admin`: legacy Admin plus explicit System Administrator; holds `admin.config.manage`.
- `seed-user-alex`: legacy User; does not hold `admin.config.manage`.

The runtime harness produced:

```json
{
	"adminGet": 200,
	"adminPut": [200, 200],
	"unauthorized": 403,
	"deactivated": [401, 401],
	"publicGet": 200,
	"publicKeys": ["account_prompt_enabled", "config_version", "module_enabled"],
	"configured_value": 45,
	"success_audits": 1,
	"denial_audits": 1,
	"literal_timestamped_audits": 1
}
```

The two PUTs used the same `Idempotency-Key` and the same body. Database evidence showed one effective value change (`30` to `45`) and exactly one successful `module_configuration.update` audit. That audit matched the admin actor, literal old/new JSON values, target key, and a non-null timestamp. The unprivileged request returned 403 and wrote exactly one awaited `permission_denied` audit. After inserting an account-state row with `deactivated` status, the same valid session returned 401 for both the new configuration endpoint and the existing `/api/v1/rbac/users` endpoint. Anonymous F1 GET remained 200 with exactly its original three keys. The disposable database was dropped.

A review-fix rerun against the production-built Nest application additionally recorded the exact oRPC contract URL and current transaction evidence:

```json
{
	"orpcUrl": "http://127.0.0.1:3099/api/v1/admin/pisocamp/config",
	"adminGet": 200,
	"adminPut": [200, 200],
	"unauthorized": 403,
	"deactivated": [401, 401],
	"publicGet": 200,
	"configured_value": "45",
	"success_audits": 1,
	"idempotency_rows": 1
}
```

The backend integration suite also forces the idempotency-row write to fail after the configuration service runs. It proves the root transaction rolls back both configuration and success audit, then proves a successful same-key retry invokes the handler once and persists exactly one success audit.

## Web and accessibility evidence

The web component suite covers loading, recoverable fetch error, loaded value, integer/range validation, keyboard Enter submission, pending state, success and failure announcements, programmatic label/error association, invalid-field focus, and absence of role/audit-management controls. The dynamically inserted field-validation message and save error are alert regions without changing invalid-field focus behavior. Route/access tests cover direct-route and navigation filtering by `admin.config.manage`. The shared OpenAPI oRPC client test executes the real typed contract query and proves it emits exactly `/api/v1/admin/pisocamp/config` with `credentials: "include"`; query persistence tests exclude the `pisocamp` namespace from IndexedDB.

Completed Chromium QA exercised the built application at 1440 × 900 desktop and 390 × 844 mobile viewports with no clipping, overlap, or horizontal overflow. The seeded System Administrator signed in through the rendered UI, keyboard-focused the labelled field, changed `30` to `45`, and submitted with Enter. The PUT returned 200 and announced success; a page reload refetched `45`, while PostgreSQL showed the persisted value and exactly one matching success audit (`30` → `45`). Submitting `0` displayed the accessible validation alert and returned focus to the invalid field. Browser evidence recorded zero console warnings/errors, zero `pageerror` events, and zero unexpected HTTP responses. The mobile artifact is `D:\tmp\f2-browser-qa-mobile-20260824.png`.

Residual browser risk is limited to untested Firefox/Safari, physical touch devices, and manual assistive-technology announcements. Chromium recorded unrelated aborted dashboard/PWA prefetches and health probes during teardown, but none targeted the F2 endpoint or produced an HTTP error response. The built web process also retained the existing standalone-mode startup advisory; it did not block this route or its acceptance flow.

## Unrelated pre-existing runtime warnings

These warnings were present during the successful acceptance run and were not introduced by F2:

- Better Auth OpenAPI merge reports `api.generateOpenAPISchema is not a function` while application startup continues.
- Nest reports legacy wildcard route conversion for `/api/*`.
- Without `REDIS_URL`, the application deliberately uses process-local throttling/RBAC cache and emits its documented warning.
- The Windows web production build exited successfully but reported one `EBUSY` warning while copying a Sentry symlink into the standalone trace.
