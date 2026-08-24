# F1 Piso CAMP acceptance evidence

Date: 2026-08-24

Automated evidence confirms the public route decision, guest identity persistence, non-blocking packaged first paint, strict remote configuration validation, offline indicator, account prompt actions, semantic labels, and 320-pixel widget layout. The configuration update now carries `module_enabled` and `account_prompt_enabled`; disabled modules do not expose collection cards and a disabled account prompt is not rendered.

The review suite additionally proves that online `Create Account` routes to `/register`, repeated guest entry suppresses the prompt, the focused `guest_identity_service_test.dart` auth sign-out regression clears only auth credentials while preserving `device_pseudo_id`, and controlled connectivity transitions update the Offline state and gate account creation in both directions.

Backend runtime evidence: a production build started locally on port 3002 with an ephemeral development auth secret. An unauthenticated `GET http://127.0.0.1:3002/api/v1/pisocamp/config` returned HTTP 200 and exactly `account_prompt_enabled`, `config_version`, and `module_enabled`. The process was stopped after the check.

Mobile runtime evidence was captured on the Pixel 9a Android 16 emulator. The rebuilt debug APK installed successfully and the application remained the resumed activity with a live process. After dismissing the Android notification prompt and skipping the existing onboarding flow, the login entry opened Piso CAMP without authentication. [Online screenshot](./f1-online.png) shows the packaged Banknotes and Coins cards, optional-account explanation, and the exact `Create Account` and `Continue as Guest` actions. Continuing as guest removed the prompt; leaving and re-entering Piso CAMP did not show it again.

For the cold offline check, only the test app's emulator data was cleared, airplane mode was enabled, and the app was relaunched. [Airplane-mode screenshot](./f1-airplane.png) shows the dedicated module, packaged cards, optional-account prompt, and visible `Offline` indicator. Tapping `Create Account` displayed the exact notice `Internet connection is required to create an account.` and remained in Piso CAMP. UI Automator confirmed all expected semantics, and the application remained the resumed activity with no fatal Flutter/Android exception after the corrected launcher-package build.

The public config contract is anonymous and exposes only `module_enabled`, `account_prompt_enabled`, and `config_version`; contract and backend unit tests passed.
