# F1 Piso CAMP Guest Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver ticket F1: a public Piso CAMP section with an optional account prompt, durable guest identity, packaged offline home, connectivity feedback, and a public-safe configuration endpoint.

**Architecture:** Implement one contract-first vertical slice across `@repo/contracts`, NestJS, and Flutter. The backend exposes a strictly allowlisted anonymous configuration response backed by safe defaults; F2 will later replace the defaults with persisted `module_configuration` values. Flutter owns a feature-scoped repository/provider stack, uses the existing Dio and secure-storage instances, and always loads packaged home content before attempting network refresh.

**Tech Stack:** TypeScript, Zod, oRPC, NestJS, Jest, Flutter 3/Dart, Riverpod, GoRouter, Dio, `flutter_secure_storage`, `connectivity_plus` 6.1.5, `flutter_test`.

**Spec:** `docs/TICKETS.md` ticket F1, `docs/PRD.md`, and `docs/DOMAIN-MODEL.md`

## Global Constraints

- Work locally in the existing `dev` worktree. Do not create a branch, push, or open a pull request.
- Do not commit until F1 implementation, validation, acceptance-criterion evidence, and reviewer checks pass and the user approves the foundational commit.
- Use `pnpm` for JavaScript/TypeScript workspace commands and Flutter tooling for `apps/mobile`.
- Follow strict TDD: every production behavior starts with a test that is run and observed failing for the expected reason.
- Reuse the existing Dio client, secure-storage instance, Riverpod, GoRouter, shared widgets, oRPC registry, anonymous-controller pattern, and backend module structure.
- Do not create `module_configuration`, RBAC, audit, consent, profile, analytics, or content tables in F1; their owning tickets are F2, F4, F3, AN-1, and CM-1.
- The public endpoint is `/api/v1/pisocamp/config` after the repository's global `/api` prefix and oRPC `/v1` prefix are applied.
- Only `module_enabled`, `account_prompt_enabled`, and `config_version` are public F1 configuration keys. The response schema is strict so accidental extra fields fail serialization.
- `device_pseudo_id` is generated from 128 bits using `Random.secure()`, Base64 URL encoding without padding, and stored under a Piso CAMP-specific secure-storage key. It survives ordinary sign-out and is deleted only by an explicit full-data purge.
- The optional-account prompt appears only for an unauthenticated device without the guest-continuation flag. Authenticated users and devices that chose “Continue as Guest” enter directly.
- Packaged home content is the source of truth for first paint and offline use. Network configuration refresh may enhance state but can never block rendering.
- Connectivity transport status is advisory. Dio timeout/connection failures must also activate offline fallback because a Wi-Fi/cellular transport does not guarantee internet access.
- Do not emit analytics events in F1; event names are reserved until AN-1.
- Do not create barrel files or application type-only files; co-locate types with runtime code.
- UI must provide semantic labels, keyboard/tap reachability, visible offline/error messages, and no horizontal overflow at phone widths.

---

### Task 1: Implement and prove the complete F1 vertical slice

**Files:**

- Create: `packages/contracts/src/modules/v1/pisocamp/pisocamp.schema.ts`
- Create: `packages/contracts/src/modules/v1/pisocamp/pisocamp.schema.test.ts`
- Create: `packages/contracts/src/modules/v1/pisocamp/pisocamp.contract.ts`
- Modify: `packages/contracts/src/modules/v1/v1.contract.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/pisocamp.service.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/pisocamp.service.spec.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/pisocamp.controller.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/pisocamp.controller.spec.ts`
- Create: `apps/backend/src/modules/v1/pisocamp/pisocamp.module.ts`
- Modify: `apps/backend/src/modules/v1/v1.module.ts`
- Modify: `apps/mobile/pubspec.yaml`
- Modify: `apps/mobile/pubspec.lock`
- Create: `apps/mobile/assets/pisocamp/home.json`
- Modify: `apps/mobile/lib/core/constants/api_constants.dart`
- Create: `apps/mobile/lib/core/network/connectivity_provider.dart`
- Create: `apps/mobile/lib/core/network/connectivity_provider.g.dart`
- Create: `apps/mobile/lib/features/pisocamp/data/pisocamp_repository.dart`
- Create: `apps/mobile/lib/features/pisocamp/data/guest_identity_service.dart`
- Create: `apps/mobile/lib/features/pisocamp/presentation/providers/pisocamp_provider.dart`
- Create: `apps/mobile/lib/features/pisocamp/presentation/providers/pisocamp_provider.g.dart`
- Create: `apps/mobile/lib/features/pisocamp/presentation/screens/pisocamp_home_screen.dart`
- Create: `apps/mobile/lib/features/pisocamp/presentation/widgets/account_prompt.dart`
- Modify: `apps/mobile/lib/core/navigation/app_router.dart`
- Modify: `apps/mobile/lib/features/auth/presentation/screens/login_screen.dart`
- Modify: `apps/mobile/lib/features/home/presentation/widgets/dashboard_tab.dart`
- Create: `apps/mobile/test/features/pisocamp/data/guest_identity_service_test.dart`
- Create: `apps/mobile/test/features/pisocamp/data/pisocamp_repository_test.dart`
- Create: `apps/mobile/test/features/pisocamp/presentation/pisocamp_home_screen_test.dart`
- Create: `apps/mobile/test/core/navigation/pisocamp_route_test.dart`
- Create: `docs/pisocamp/f1-acceptance-evidence.md`

**Interfaces:**

- Produces contract procedure `v1.pisocamp.config.get` at `GET /v1/pisocamp/config`, marked with `security: []`.
- Produces strict response `{ module_enabled: boolean; account_prompt_enabled: boolean; config_version: string }` with defaults `{ true, true, "seed-1" }`.
- Produces `GuestIdentityService.getOrCreateId()`, `hasContinuedAsGuest()`, and `continueAsGuest()` using the existing `SecureStorageService`.
- Produces a shared Riverpod connectivity stream that exposes transport availability while preserving request-failure fallback.
- Produces `PisoCampRepository.loadHome()` returning packaged home content plus whether network configuration was unavailable.
- Produces the public GoRouter path `AppRoutes.pisoCamp = "/pisocamp"` and a redirect decision that permits this route without authentication.
- Produces UI actions with exact labels `Create Account` and `Continue as Guest`, an `Offline` indicator, and the notice `Internet connection is required to create an account.`
- F2 consumes the backend config service boundary and replaces only its value source; F3 consumes the durable `device_pseudo_id` and existing registration route.

- [ ] **Step 1: Write contract tests for the public-safe configuration shape**

Create `pisocamp.schema.test.ts` with tests that parse the three literal public keys and reject an object containing an extra `secret` key. The break each test catches is accidental response drift or exposure of a non-public value.

```typescript
import { describe, expect, it } from "vitest"

import { PisoCampPublicConfigSchema } from "./pisocamp.schema.js"

describe("PisoCampPublicConfigSchema", () => {
	it("accepts the public F1 configuration", () => {
		expect(
			PisoCampPublicConfigSchema.parse({
				module_enabled: true,
				account_prompt_enabled: true,
				config_version: "seed-1",
			})
		).toEqual({
			module_enabled: true,
			account_prompt_enabled: true,
			config_version: "seed-1",
		})
	})

	it("rejects a non-public configuration key", () => {
		expect(() =>
			PisoCampPublicConfigSchema.parse({
				module_enabled: true,
				account_prompt_enabled: true,
				config_version: "seed-1",
				secret: "must-not-leak",
			})
		).toThrow()
	})
})
```

- [ ] **Step 2: Run the contract test and verify RED**

Run from the repository root:

```powershell
pnpm --filter @repo/contracts test -- pisocamp.schema.test.ts
```

Expected: FAIL because `pisocamp.schema.ts` and `PisoCampPublicConfigSchema` do not exist.

- [ ] **Step 3: Implement the strict schema and public oRPC contract**

Create the schema with `z.object(...).strict()`, infer `PisoCampPublicConfig`, create the anonymous GET contract, and register `pisocamp: oc.router({ config: { get: ... } })` in `v1.contract.ts`. Do not add any persistence or private configuration fields.

- [ ] **Step 4: Run the contract test and package typecheck to verify GREEN**

```powershell
pnpm --filter @repo/contracts test -- pisocamp.schema.test.ts
pnpm --filter @repo/contracts typecheck
```

Expected: both commands PASS without warnings.

- [ ] **Step 5: Write backend service and controller tests before implementation**

The service test must expect the exact safe defaults. The controller test must call the handler without a session and expect the same response. Inspect the controller metadata or use the existing anonymous-controller test pattern to prove `@AllowAnonymous()` is applied; do not merely assert a mocked decorator was invoked.

```typescript
expect(await service.getPublicConfig()).toEqual({
	module_enabled: true,
	account_prompt_enabled: true,
	config_version: "seed-1",
})
```

- [ ] **Step 6: Run the backend tests and verify RED**

```powershell
pnpm --filter @repo/backend test -- --runInBand pisocamp.service.spec.ts pisocamp.controller.spec.ts
```

Expected: FAIL because the Piso CAMP NestJS files do not exist.

- [ ] **Step 7: Implement and register the anonymous backend module**

Implement a focused service returning a frozen constant typed from `V1Outputs["pisocamp"]["config"]["get"]`; implement the controller with `@AllowAnonymous()`, `@Implement(v1.pisocamp.config.get)`, and `implement(...).handler()`. Register the controller/service in `PisoCampModule` and that module in `V1Module`.

- [ ] **Step 8: Run backend unit tests and narrow typecheck to verify GREEN**

```powershell
pnpm --filter @repo/backend test -- --runInBand pisocamp.service.spec.ts pisocamp.controller.spec.ts
pnpm --filter @repo/backend typecheck
```

Expected: both commands PASS without errors or warnings attributable to F1.

- [ ] **Step 9: Add the compatible connectivity dependency and register the packaged asset path**

Use `connectivity_plus: ^6.1.5`; version 7 requires Android Gradle Plugin 8.12.1, Gradle 8.13, and Kotlin 2.2.0, while this repository currently uses 8.9.1, 8.12, and 2.1.0. Register `assets/pisocamp/home.json` in Flutter assets but do not create its contents until the repository test has failed trying to load it.

- [ ] **Step 10: Write guest identity and repository tests before implementation**

Use `FlutterSecureStorage.setMockInitialValues({})` for real plugin-backed mock storage. Tests must prove:

- two `getOrCreateId()` calls return the same non-empty Base64 URL-safe 128-bit identifier;
- `continueAsGuest()` persists both the identifier and continuation flag;
- packaged home content is returned when Dio raises `DioExceptionType.connectionError`;
- the offline flag is false only when the public configuration request succeeds and validates;
- a malformed or extra-key response falls back offline rather than crashing or exposing the value.

- [ ] **Step 11: Run mobile data tests and verify RED**

```powershell
Set-Location apps/mobile
flutter pub get
flutter test test/features/pisocamp/data
```

Expected: `flutter pub get` succeeds, then tests FAIL because the F1 services/repository do not exist.

- [ ] **Step 12: Implement guest identity, connectivity, configuration, and packaged-home loading**

Implement `GuestIdentityService` against the existing `SecureStorageService` instance. Add only narrow raw read/write/delete operations if the wrapper lacks what the feature needs; do not create another `FlutterSecureStorage`. Generate 16 secure random bytes and encode with `base64Url.encode(bytes).replaceAll("=", "")`. Create `assets/pisocamp/home.json` with the stable title `Piso CAMP`, a short guest-safe introduction, and placeholder Banknotes and Coins cards; it must contain no personal or network-only data. Implement the shared connectivity provider with injectable `Connectivity`, and implement `PisoCampRepository` so packaged JSON loads first and all timeout/connection/invalid-response paths return the packaged model with `isOffline: true`.

- [ ] **Step 13: Run mobile data tests and analyzer to verify GREEN**

```powershell
Set-Location apps/mobile
flutter test test/features/pisocamp/data
flutter analyze
```

Expected: tests and analyzer PASS with no F1 warnings.

- [ ] **Step 14: Write route and widget tests before UI implementation**

Tests must exercise real widgets and observable behavior:

- unauthenticated `/pisocamp` is not redirected to `/login`;
- an unauthenticated first entry shows the optional-account explanation plus both exact action labels;
- tapping `Continue as Guest` persists identity, closes the prompt, and leaves the home visible;
- a repeated entry does not show the prompt;
- an authenticated entry does not show the prompt;
- offline home shows the `Offline` indicator and packaged Banknotes/Coins cards;
- tapping `Create Account` offline shows the exact plain-language notice and does not navigate;
- tapping `Create Account` online navigates to the existing registration route;
- entry controls and prompt actions have semantic button labels and fit a 320-pixel-wide surface without overflow.

- [ ] **Step 15: Run route/widget tests and verify RED**

```powershell
Set-Location apps/mobile
flutter test test/core/navigation/pisocamp_route_test.dart test/features/pisocamp/presentation/pisocamp_home_screen_test.dart
```

Expected: FAIL because the public route, entry points, account prompt, and home screen do not exist.

- [ ] **Step 16: Implement the public route, entry points, prompt, and offline home**

Extract the redirect decision in `app_router.dart` into a pure function exercised by the route test. Permit `/pisocamp` while unauthenticated, preserve existing onboarding/auth redirects elsewhere, and add entry controls to the login screen and authenticated dashboard. Compose the home from existing theme/shared widgets, show a visible and semantic offline badge, and use `ScaffoldMessenger` for the offline account notice. Do not add F3 registration/profile fields or AN-1 events.

- [ ] **Step 17: Run all F1 mobile tests and verify GREEN**

```powershell
Set-Location apps/mobile
flutter test test/core/navigation/pisocamp_route_test.dart test/features/pisocamp
flutter analyze
```

Expected: all tests and analyzer PASS without overflow, exception, or warning output from F1.

- [ ] **Step 18: Generate Riverpod code and format touched sources**

```powershell
Set-Location apps/mobile
dart run build_runner build --delete-conflicting-outputs
dart format lib/core/constants/api_constants.dart lib/core/network lib/features/pisocamp lib/core/navigation/app_router.dart lib/features/auth/presentation/screens/login_screen.dart lib/features/home/presentation/widgets/dashboard_tab.dart test/core/navigation/pisocamp_route_test.dart test/features/pisocamp
Set-Location ../..
pnpm --filter @repo/contracts format:fix
pnpm --filter @repo/backend format:fix
```

Review generated diffs and retain only files corresponding to F1 providers.

- [ ] **Step 19: Run narrow and workspace validation**

```powershell
pnpm --filter @repo/contracts test -- pisocamp.schema.test.ts
pnpm --filter @repo/backend test -- --runInBand pisocamp.service.spec.ts pisocamp.controller.spec.ts
pnpm typecheck
pnpm lint
pnpm lint:ws
Set-Location apps/mobile
flutter test
flutter analyze
```

Expected: every command PASS. Treat any F1-related warning, unhandled exception, failed request, or log error as a defect and return to the failing TDD cycle.

- [ ] **Step 20: Exercise the F1 runtime and capture acceptance evidence**

Run the backend and Flutter app with available local tooling. Verify and record in `docs/pisocamp/f1-acceptance-evidence.md`:

- navigation entry opens the dedicated module using the current design system;
- first unauthenticated entry shows optional wording and both choices;
- Continue as Guest creates/persists the device ID and suppresses later prompts;
- airplane mode renders packaged content with the Offline indicator and no crash;
- Create Account offline shows the internet-required notice;
- the public config endpoint succeeds without a session and returns only the three allowlisted keys;
- mobile logs and backend logs are clean; no failed request remains unhandled;
- keyboard/focus, semantic labels, 320-pixel layout, and visible errors pass.

If an emulator/device is unavailable, do not mark the airplane-mode or runtime criteria passed; record the exact missing environment as a blocker.

- [ ] **Step 21: Review the complete working-tree diff without committing**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Dispatch the project `code-reviewer` agent against the full working-tree diff. Resolve every Critical/Important finding through tested fixes and scoped re-review. Then report F1 as `PARTIAL` pending the mandated user pre-commit review. Do not run `git add` or `git commit` yet.

- [ ] **Step 22: Commit only after user approval**

After the user reviews the foundational implementation and explicitly approves the commit:

```powershell
git add -A
git commit -m "F1: add offline guest Piso CAMP home"
```

Confirm the commit is local and do not push.
