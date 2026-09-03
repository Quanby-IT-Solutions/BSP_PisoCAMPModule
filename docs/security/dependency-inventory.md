# Dependency and third-party inventory

**Generated** by `node scripts/security-inventory.mjs` from `pnpm-lock.yaml`
and `apps/mobile/pubspec.lock`. Do not edit by hand: run the script.

An inventory somebody has to remember to update is an inventory that is wrong
the first time somebody forgets, so this one is derived from the only record of
what actually ships.

- **Node packages in the lockfile:** 1836
  (137 named directly by a workspace, 1699 reached through them)
- **Dart packages in `pubspec.lock`:** 181

## Node dependencies named directly by a workspace

| Package | Version(s) locked | Required by |
| --- | --- | --- |
| `@base-ui/react` | 1.0.0 | apps/web |
| `@eslint/compat` | 1.4.1 | tooling/eslint |
| `@eslint/js` | 9.39.2 | tooling/eslint |
| `@hugeicons/core-free-icons` | 3.1.1 | apps/web |
| `@hugeicons/react` | 1.1.4 | apps/web |
| `@ianvs/prettier-plugin-sort-imports` | 4.7.0 | tooling/prettier |
| `@jest/globals` | 30.2.0, 30.4.1 | apps/backend |
| `@nest-lab/throttler-storage-redis` | 1.2.0 | apps/backend |
| `@nestjs/cli` | 11.0.14 | apps/backend |
| `@nestjs/common` | 11.1.11 | apps/backend |
| `@nestjs/config` | 4.0.3 | apps/backend |
| `@nestjs/core` | 11.1.11 | apps/backend |
| `@nestjs/microservices` | 12.0.1 | apps/backend |
| `@nestjs/platform-express` | 11.1.11 | apps/backend |
| `@nestjs/schedule` | 6.1.3 | apps/backend |
| `@nestjs/schematics` | 11.0.9 | apps/backend |
| `@nestjs/swagger` | 11.2.6 | apps/backend |
| `@nestjs/terminus` | 11.0.0 | apps/backend |
| `@nestjs/testing` | 11.1.11 | apps/backend |
| `@nestjs/throttler` | 6.5.0 | apps/backend |
| `@next/eslint-plugin-next` | 15.5.9 | tooling/eslint |
| `@orpc/client` | 1.15.0 | apps/web |
| `@orpc/contract` | 1.13.4, 1.15.0 | apps/backend, apps/web, packages/contracts |
| `@orpc/nest` | 1.13.4 | apps/backend, packages/contracts |
| `@orpc/openapi` | 1.15.0 | apps/backend |
| `@orpc/openapi-client` | 1.13.4, 1.15.0 | apps/web |
| `@orpc/server` | 1.13.4, 1.15.0 | apps/backend |
| `@orpc/tanstack-query` | 1.13.4 | apps/web |
| `@orpc/zod` | 1.13.4 | apps/backend |
| `@playwright/test` | 1.58.2 | packages/e2e-web |
| `@scalar/nestjs-api-reference` | 1.0.13 | apps/backend |
| `@sentry/nestjs` | 10.70.0 | apps/backend |
| `@sentry/nextjs` | 10.70.0 | apps/web |
| `@serwist/turbopack` | 9.5.11 | apps/web |
| `@swc/cli` | 0.6.0 | apps/backend |
| `@swc/core` | 1.15.32, 1.15.8 | apps/backend |
| `@t3-oss/env-core` | 0.13.10 | apps/backend, packages/auth |
| `@t3-oss/env-nextjs` | 0.13.10 | apps/web |
| `@tailwindcss/postcss` | 4.1.18 | apps/web |
| `@tanstack/eslint-plugin-query` | 5.91.2 | apps/web, tooling/eslint |
| `@tanstack/query-async-storage-persister` | 5.90.16 | apps/web |
| `@tanstack/react-form` | 1.27.7 | apps/web |
| `@tanstack/react-query` | 5.90.16 | apps/web |
| `@tanstack/react-query-devtools` | 5.91.2 | apps/web |
| `@tanstack/react-query-persist-client` | 5.90.16 | apps/web |
| `@testing-library/jest-dom` | 6.9.1 | apps/web |
| `@testing-library/react` | 16.3.2 | apps/web |
| `@testing-library/user-event` | 14.6.1 | apps/web |
| `@thallesp/nestjs-better-auth` | 2.2.0 | apps/backend |
| `@turbo/gen` | 2.7.3 | (root) |
| `@types/express` | 5.0.6 | apps/backend |
| `@types/jest` | 30.0.0 | apps/backend |
| `@types/multer` | 2.0.0 | apps/backend |
| `@types/node` | 14.18.63, 22.19.3, 25.9.5, 26.4.1 | apps/backend, apps/web, packages/auth, packages/contracts, packages/db, packages/observability, tooling/eslint, tooling/prettier |
| `@types/nodemailer` | 6.4.24 | packages/auth |
| `@types/pdfkit` | 0.17.6 | apps/backend |
| `@types/pg` | 8.16.0 | apps/backend, packages/db |
| `@types/qrcode` | 1.5.6 | apps/web |
| `@types/react` | 19.2.7 | apps/web |
| `@types/react-dom` | 19.2.3 | apps/web |
| `@types/supertest` | 6.0.3 | apps/backend |
| `@vitejs/plugin-react` | 6.0.1 | apps/web |
| `@vitest/coverage-v8` | 4.1.2 | apps/web, packages/auth, packages/contracts, packages/db, packages/observability |
| `@vitest/ui` | 4.1.2 | apps/web, packages/contracts |
| `babel-plugin-react-compiler` | 1.0.0 | apps/web |
| `baseline-browser-mapping` | 2.11.20, 2.9.11 | apps/web |
| `better-auth` | 1.6.29 | apps/backend, apps/web, packages/auth |
| `class-transformer` | 0.5.1 | apps/backend |
| `class-validator` | 0.14.3 | apps/backend |
| `class-variance-authority` | 0.7.1 | apps/web |
| `clsx` | 2.1.1 | apps/web |
| `cmdk` | 1.1.1 | apps/web |
| `cross-env` | 10.1.0 | apps/backend |
| `date-fns` | 4.1.0 | apps/web |
| `docx` | 9.7.1 | apps/backend |
| `dotenv` | 16.6.1, 17.2.3, 17.4.2 | apps/backend, apps/web, packages/db |
| `drizzle-kit` | 1.0.0-beta.9-e89174b | packages/db |
| `drizzle-orm` | 1.0.0-beta.9-e89174b | apps/backend, packages/auth, packages/db |
| `embla-carousel-react` | 8.6.0 | apps/web |
| `esbuild` | 0.25.12, 0.27.2, 0.28.1 | apps/web |
| `eslint` | 9.39.2 | apps/backend, apps/web, packages/auth, packages/contracts, packages/db, packages/observability, tooling/eslint |
| `eslint-config-prettier` | 10.1.8 | tooling/eslint |
| `eslint-plugin-react` | 7.37.5 | tooling/eslint |
| `eslint-plugin-react-hooks` | 7.0.1 | tooling/eslint |
| `exceljs` | 4.4.0 | apps/backend |
| `express` | 5.2.1 | apps/backend |
| `globals` | 14.0.0, 16.5.0 | tooling/eslint |
| `helmet` | 8.3.0 | apps/backend |
| `husky` | 9.1.7 | (root) |
| `idb-keyval` | 6.2.6 | apps/web |
| `input-otp` | 1.4.2 | apps/web |
| `ioredis` | 6.0.0 | apps/backend |
| `jest` | 30.2.0 | apps/backend |
| `jsdom` | 29.0.1 | apps/web |
| `jszip` | 3.10.1 | apps/backend |
| `lru-cache` | 11.2.7, 7.18.3 | apps/backend |
| `multer` | 2.3.0 | apps/backend |
| `nestjs-pino` | 4.6.1 | apps/backend |
| `nestjs-zod` | 5.1.1 | apps/backend, packages/contracts |
| `next` | 16.3.4 | apps/web |
| `next-themes` | 0.4.6 | apps/web |
| `nodemailer` | 9.1.1 | packages/auth |
| `pdfkit` | 0.20.2 | apps/backend |
| `pg` | 8.16.3 | apps/backend, packages/db |
| `pino-http` | 11.0.0 | apps/backend |
| `pino-pretty` | 13.1.3 | apps/backend |
| `prettier` | 3.7.4 | (root), apps/backend, apps/web, packages/auth, packages/contracts, packages/db, packages/observability, tooling/eslint, tooling/prettier |
| `prettier-plugin-tailwindcss` | 0.6.14 | tooling/prettier |
| `qrcode` | 1.5.4 | apps/web |
| `react` | 19.2.3 | apps/web |
| `react-day-picker` | 9.13.0 | apps/web |
| `react-dom` | 19.2.3 | apps/web |
| `react-resizable-panels` | 4.3.0 | apps/web |
| `recharts` | 2.15.4 | apps/web |
| `reflect-metadata` | 0.2.2 | apps/backend |
| `rxjs` | 6.6.7, 7.8.1, 7.8.2 | apps/backend |
| `serwist` | 9.5.11 | apps/web |
| `sharp` | 0.35.2, 0.35.4 | apps/web |
| `sherif` | 1.10.0 | (root) |
| `sonner` | 2.0.7 | apps/web |
| `source-map-support` | 0.5.13, 0.5.21 | apps/backend |
| `supertest` | 7.2.2 | apps/backend |
| `tailwind-merge` | 3.4.0 | apps/web |
| `tailwindcss` | 4.1.18 | apps/web |
| `ts-jest` | 29.4.6 | apps/backend |
| `ts-loader` | 9.5.4 | apps/backend |
| `ts-node` | 10.9.2 | apps/backend |
| `tsconfig-paths` | 4.2.0 | apps/backend |
| `tsx` | 4.21.0 | apps/backend, packages/db |
| `turbo` | 2.7.3 | (root) |
| `tw-animate-css` | 1.4.0 | apps/web |
| `typescript` | 5.9.3 | (root), apps/backend, apps/web, packages/auth, packages/contracts, packages/db, packages/observability, tooling/eslint, tooling/prettier |
| `typescript-eslint` | 8.52.0 | tooling/eslint |
| `vaul` | 1.1.2 | apps/web |
| `vite` | 8.2.2 | apps/web |
| `vitest` | 4.1.2 | apps/web, packages/auth, packages/contracts, packages/db, packages/observability |
| `zod` | 4.3.5, 4.4.1 | apps/backend, apps/web, packages/auth, packages/contracts |

## Flutter dependencies (`apps/mobile/pubspec.lock`)

| Package | Version |
| --- | --- |
| `_fe_analyzer_shared` | 91.0.0 |
| `analyzer` | 8.4.0 |
| `analyzer_buffer` | 0.1.11 |
| `analyzer_plugin` | 0.13.10 |
| `args` | 2.7.0 |
| `async` | 2.13.0 |
| `awesome_notifications` | 0.11.0 |
| `awesome_snackbar_content` | 0.1.8 |
| `boolean_selector` | 2.1.2 |
| `build` | 3.0.1 |
| `build_config` | 1.1.2 |
| `build_daemon` | 4.1.1 |
| `build_resolvers` | 3.0.1 |
| `build_runner` | 2.6.1 |
| `build_runner_core` | 9.2.1 |
| `built_collection` | 5.1.1 |
| `built_value` | 8.12.3 |
| `characters` | 1.4.1 |
| `checked_yaml` | 2.0.4 |
| `ci` | 0.1.0 |
| `cli_config` | 0.2.0 |
| `cli_util` | 0.4.2 |
| `clock` | 1.1.2 |
| `code_builder` | 4.11.1 |
| `collection` | 1.19.1 |
| `connectivity_plus` | 6.1.5 |
| `connectivity_plus_platform_interface` | 2.1.0 |
| `convert` | 3.1.2 |
| `cookie_jar` | 4.0.8 |
| `coverage` | 1.15.0 |
| `crypto` | 3.0.7 |
| `cryptography` | 2.9.0 |
| `cupertino_icons` | 1.0.8 |
| `custom_lint` | 0.8.1 |
| `custom_lint_builder` | 0.8.1 |
| `custom_lint_core` | 0.8.1 |
| `custom_lint_visitor` | 1.0.0+8.4.0 |
| `dart_style` | 3.1.3 |
| `dbus` | 0.7.15 |
| `dio` | 5.9.1 |
| `dio_cookie_manager` | 3.3.0 |
| `dio_web_adapter` | 2.1.1 |
| `dots_indicator` | 4.0.1 |
| `equatable` | 2.0.8 |
| `fake_async` | 1.3.3 |
| `ffi` | 2.1.5 |
| `file` | 7.0.1 |
| `fixnum` | 1.1.1 |
| `flex_color_scheme` | 8.3.1 |
| `flex_seed_scheme` | 3.6.1 |
| `flutter` | 0.0.0 |
| `flutter_dotenv` | 6.0.0 |
| `flutter_keyboard_visibility_linux` | 1.0.0 |
| `flutter_keyboard_visibility_macos` | 1.0.0 |
| `flutter_keyboard_visibility_platform_interface` | 2.0.0 |
| `flutter_keyboard_visibility_temp_fork` | 0.1.5 |
| `flutter_keyboard_visibility_windows` | 1.0.0 |
| `flutter_lints` | 6.0.0 |
| `flutter_localizations` | 0.0.0 |
| `flutter_riverpod` | 3.0.3 |
| `flutter_secure_storage` | 10.0.0 |
| `flutter_secure_storage_darwin` | 0.2.0 |
| `flutter_secure_storage_linux` | 3.0.0 |
| `flutter_secure_storage_platform_interface` | 2.0.1 |
| `flutter_secure_storage_web` | 2.1.0 |
| `flutter_secure_storage_windows` | 4.1.0 |
| `flutter_svg` | 2.2.3 |
| `flutter_test` | 0.0.0 |
| `flutter_web_plugins` | 0.0.0 |
| `freezed` | 3.2.3 |
| `freezed_annotation` | 3.1.0 |
| `frontend_server_client` | 4.0.0 |
| `glob` | 2.1.3 |
| `go_router` | 16.3.0 |
| `graphs` | 2.3.2 |
| `hotreloader` | 4.3.0 |
| `http` | 1.6.0 |
| `http_multi_server` | 3.2.2 |
| `http_parser` | 4.1.2 |
| `iconsax_flutter` | 1.0.1 |
| `intl` | 0.20.2 |
| `introduction_screen` | 4.0.0 |
| `io` | 1.0.5 |
| `jni` | 0.14.2 |
| `json_annotation` | 4.9.0 |
| `json_serializable` | 6.11.2 |
| `leak_tracker` | 11.0.2 |
| `leak_tracker_flutter_testing` | 3.0.10 |
| `leak_tracker_testing` | 3.0.2 |
| `lints` | 6.0.0 |
| `logging` | 1.3.0 |
| `matcher` | 0.12.19 |
| `material_color_utilities` | 0.13.0 |
| `meta` | 1.17.0 |
| `mime` | 2.0.0 |
| `mockito` | 5.6.4 |
| `nm` | 0.5.0 |
| `node_preamble` | 2.0.2 |
| `package_config` | 2.2.0 |
| `package_info_plus` | 9.0.1 |
| `package_info_plus_platform_interface` | 3.2.1 |
| `path` | 1.9.1 |
| `path_parsing` | 1.1.0 |
| `path_provider` | 2.1.5 |
| `path_provider_android` | 2.2.22 |
| `path_provider_foundation` | 2.5.1 |
| `path_provider_linux` | 2.2.1 |
| `path_provider_platform_interface` | 2.1.2 |
| `path_provider_windows` | 2.3.0 |
| `pausable_timer` | 3.1.0+3 |
| `persistent_bottom_nav_bar_v2` | 6.2.0 |
| `petitparser` | 7.0.1 |
| `platform` | 3.1.6 |
| `plugin_platform_interface` | 2.1.8 |
| `pool` | 1.5.2 |
| `pub_semver` | 2.2.0 |
| `pubspec_parse` | 1.5.0 |
| `riverpod` | 3.0.3 |
| `riverpod_analyzer_utils` | 1.0.0-dev.7 |
| `riverpod_annotation` | 3.0.3 |
| `riverpod_generator` | 3.0.3 |
| `riverpod_lint` | 3.0.3 |
| `rxdart` | 0.28.0 |
| `sensors_plus` | 7.1.0 |
| `sensors_plus_platform_interface` | 2.0.2 |
| `sentry` | 9.26.0 |
| `sentry_flutter` | 9.26.0 |
| `shared_preferences` | 2.5.4 |
| `shared_preferences_android` | 2.4.20 |
| `shared_preferences_foundation` | 2.5.6 |
| `shared_preferences_linux` | 2.4.1 |
| `shared_preferences_platform_interface` | 2.4.1 |
| `shared_preferences_web` | 2.4.3 |
| `shared_preferences_windows` | 2.4.1 |
| `shelf` | 1.4.2 |
| `shelf_packages_handler` | 3.0.2 |
| `shelf_static` | 1.1.3 |
| `shelf_web_socket` | 3.0.0 |
| `showcaseview` | 5.0.1 |
| `sky_engine` | 0.0.0 |
| `source_gen` | 4.2.0 |
| `source_helper` | 1.3.8 |
| `source_map_stack_trace` | 2.1.2 |
| `source_maps` | 0.10.13 |
| `source_span` | 1.10.1 |
| `stack_trace` | 1.12.1 |
| `state_notifier` | 1.0.0 |
| `stream_channel` | 2.1.4 |
| `stream_transform` | 2.1.1 |
| `string_scanner` | 1.4.1 |
| `term_glyph` | 1.2.2 |
| `test` | 1.30.0 |
| `test_api` | 0.7.10 |
| `test_core` | 0.6.16 |
| `timing` | 1.0.2 |
| `toastification` | 3.0.3 |
| `typed_data` | 1.4.0 |
| `universal_io` | 2.3.1 |
| `url_launcher` | 6.3.2 |
| `url_launcher_android` | 6.3.30 |
| `url_launcher_ios` | 6.4.2 |
| `url_launcher_linux` | 3.2.3 |
| `url_launcher_macos` | 3.2.6 |
| `url_launcher_platform_interface` | 2.3.2 |
| `url_launcher_web` | 2.4.3 |
| `url_launcher_windows` | 3.1.6 |
| `uuid` | 4.5.2 |
| `vector_graphics` | 1.1.19 |
| `vector_graphics_codec` | 1.1.13 |
| `vector_graphics_compiler` | 1.1.20 |
| `vector_math` | 2.2.0 |
| `vm_service` | 15.0.2 |
| `watcher` | 1.2.1 |
| `web` | 1.1.1 |
| `web_socket` | 1.0.1 |
| `web_socket_channel` | 3.0.3 |
| `webkit_inspection_protocol` | 1.2.1 |
| `win32` | 5.15.0 |
| `xdg_directories` | 1.1.0 |
| `xml` | 6.6.1 |
| `yaml` | 3.1.3 |
