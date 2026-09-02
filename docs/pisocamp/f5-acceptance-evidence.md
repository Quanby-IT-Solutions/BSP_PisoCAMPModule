# F5 acceptance evidence

Date: 2026-09-02 (Asia/Manila)
Baseline: `70756bc` (CE-5)
Ticket: F5 — External, internal and deep links with store fallback

## Result

**PARTIAL.** Four of five acceptance criteria are **PASS**; AC4 is
**configured and unit-tested but not verifiable here**, and the Definition of
Done's "deep-link test on both stores" needs published App Store and Play
listings that do not exist yet. Two things must be supplied before release, and
both are named below rather than hidden.

## What F5 adds

| Layer | Surface |
| --- | --- |
| Contract | `link_open` event carrying a link **type**, never a URL |
| Mobile | `deep_links.dart` (one resolver for both link shapes, shareable-link builder, store fallback); `link_service.dart` (approved-destination guard around `url_launcher`); router translation of incoming links; external-link opener on the detail screen |
| Android | `bsp://pisocamp` and `https://www.bsp.gov.ph/pisocamp` intent filters, `autoVerify`, and `flutter_deeplinking_enabled` |

## AC1 — an external link opens per approved browser behaviour

**PASS.** External related links were previously shown as read-only text. They
now offer an "Open …" control that hands the address to the platform browser via
`url_launcher` in `externalApplication` mode.

The approval rule is enforced at the last possible moment, in
`PisoCampLinkService`: only an HTTPS `www.bsp.gov.ph` address with no userinfo
and no port is ever handed over. Asserted against five rejected shapes —
`http://`, a foreign host, smuggled credentials, a non-standard port, and a
`javascript:` URL — with a final check that **nothing unapproved reached the
platform at all**.

A device with no browser is handled rather than ignored: a failed or refused
launch shows a message and leaves the address on screen to be read or copied.
Asserted in the screen test.

## AC2 — an internal link navigates, and back returns to the content

**PASS.** Internal and topic links push rather than replace, so the system back
gesture returns to the item that linked out. Covered by the existing CE-1
navigation test, which follows a topic link to its destination.

## AC3 — an approved deep link opens the app on that screen

**PASS.** One resolver understands both approved shapes:

- `bsp://pisocamp/...` — the custom scheme, which only an installed app answers;
- `https://www.bsp.gov.ph/pisocamp/...` — the App Link / Universal Link.

`deep_links_test.dart` asserts home, list and denomination links in both shapes,
and **refuses thirteen** others: another scheme, a `javascript:` URL, a `file:`
URL, the right scheme with the wrong host, a foreign host, smuggled credentials,
a non-standard port, a path outside the module, an unknown currency kind, a
malformed identifier, an encoded traversal, and a trailing extra segment. A deep
link is an untrusted input from any app on the device, so the resolver is
allowed to produce only routes this build already has — asserted directly.

The Android manifest carries both intent filters plus
`flutter_deeplinking_enabled`, so an incoming link reaches the Flutter router
rather than a side channel and one resolver decides what every link means.
Verified in the **built APK** rather than only in source:

```
scheme="bsp"
autoVerify=true  scheme="https"  pathPrefix="/pisocamp"
meta-data name="flutter_deeplinking_enabled"
```

### A defect found while building this

Flutter hands the router an incoming link's *path*, so the same path may have
arrived under either scheme. The first version guessed both readings — and a
bare `/` was therefore reinterpreted as `bsp://pisocamp/` and hijacked to the
module home, breaking the app's own home route. The custom-scheme reading is now
attempted only for a path that names a currency kind, and a test pins the
behaviour for `/`, `/login`, `/profile` and the already-valid app routes.

## AC4 — not installed falls back to the store or the BSP page

**Configured, not verifiable here.** The operating system cannot run code that
is not on the device, so this criterion is a property of the *link*, not of the
app:

- the `https://www.bsp.gov.ph/pisocamp/...` App Link opens the app when
  installed and otherwise opens the BSP page in a browser — that page is the
  approved fallback, and it is the reason the shareable-link builder emits the
  https form rather than the custom scheme (asserted, and asserted to round-trip
  back through the resolver);
- `pisoCampStoreFallback` names the store listing to send someone to when the
  **app** hands out a link.

Two things must be supplied before this is real, and neither can be invented
here:

1. **`assetlinks.json` served from `https://www.bsp.gov.ph/.well-known/`**,
   matching the release signing certificate. Without it Android will not verify
   the App Link and will open the browser even when the app is installed.
2. **Real store identifiers.** `pisoCampStoreFallback` currently returns
   `id0000000000` for iOS and `ph.gov.bsp.pisocamp` for Android. The Play id is a
   plausible package name but is not confirmed, and the App Store id is a
   placeholder. These are the only invented values in this ticket, and they are
   in one function so that replacing them is a one-line change.

## AC5 — a tapped link emits `link_open` with its type

**PASS.** The event is in the shared catalog, so the TypeScript validator and the
Dart producer are checked against the same fixture vector. It carries the link
**type** (`external`, `internal`, `topic`, `deep_link`) and the logical id of the
item the link was on — **never the URL**, because a URL is content and analytics
carries none.

The screen test asserts that tapping an external link records exactly one event,
of type `external`, for the right item.

## Test evidence

| Suite | Result |
| --- | --- |
| `@repo/contracts` vitest | 17 files, 246 tests passed |
| `flutter test` | 477 passed, 1 skipped (CE-2's evidence renderer) |
| `flutter analyze` | 0 errors; 40 pre-existing infos/warnings |
| `flutter build apk --debug` | built; intent filters and deep-linking meta-data verified with `aapt2` |
| `bash scripts/check-apk-assets.sh` | both APKs clean of env files and key material |
| `pnpm typecheck` | 14/14 |
| `pnpm lint` | 14/14; only the 6 pre-existing `@repo/auth` `no-console` warnings |

One sibling test updated: the CE-1 detail test asserted the reference-only text
that F5 replaced with an opener; it now asserts the opener, and that the address
is still shown.

## What is outstanding

- A deep-link test against both store listings (the Definition of Done). Needs
  published apps.
- `assetlinks.json` on `www.bsp.gov.ph`, and the real App Store id.

Neither blocks anything else in the build order.
