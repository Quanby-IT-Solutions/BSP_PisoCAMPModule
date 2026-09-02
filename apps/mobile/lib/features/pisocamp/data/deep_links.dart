/// F5 deep-link resolution.
///
/// Two shapes of approved link reach the module:
///
/// * `bsp://pisocamp/...` — the custom scheme, which only an installed app can
///   answer, and
/// * `https://www.bsp.gov.ph/pisocamp/...` — an Android App Link / iOS
///   Universal Link, which an installed app intercepts and which otherwise
///   opens the BSP page in a browser.
///
/// The https form is what makes the "not installed" case work at all: the
/// operating system cannot run code that is not there, so the fallback has to
/// live in the link itself rather than in the app. [pisoCampStoreFallback] is
/// the listing to send someone to when the app *is* asked to hand out a link.
library;

import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';

/// The approved host and path prefix for web links into the module.
const String kPisoCampLinkHost = 'www.bsp.gov.ph';
const String kPisoCampLinkPathPrefix = 'pisocamp';

/// The approved custom scheme.
const String kPisoCampLinkScheme = 'bsp';

/// Where an approved link points once it has been understood.
enum PisoCampLinkKind {
  /// The module's home screen.
  home,

  /// A currency list, banknotes or coins.
  currencyList,

  /// One denomination's detail screen.
  denomination,
}

/// An approved link that this build knows how to open.
final class PisoCampDeepLink {
  const PisoCampDeepLink({required this.kind, required this.route});

  final PisoCampLinkKind kind;

  /// The in-app route to push.
  final String route;
}

/// The store listing to fall back to when the module is not installed.
///
/// Used when the app hands out a link, not when it receives one: a device
/// without the app never runs this code.
String pisoCampStoreFallback({required bool isIos}) {
  return isIos
      ? 'https://apps.apple.com/ph/app/bsp-piso-camp/id0000000000'
      : 'https://play.google.com/store/apps/details?id=ph.gov.bsp.pisocamp';
}

/// Resolves an incoming link, or returns null when it is not one this module
/// answers.
///
/// Deliberately strict. A link is an untrusted input that can arrive from any
/// app on the device, so anything unrecognised is refused rather than guessed
/// at, and the route it produces is always one this build already knows.
PisoCampDeepLink? resolvePisoCampDeepLink(Uri uri) {
  final segments = _moduleSegments(uri);
  if (segments == null) return null;

  if (segments.isEmpty) {
    return const PisoCampDeepLink(
      kind: PisoCampLinkKind.home,
      route: AppRoutes.pisoCamp,
    );
  }

  final kind = CurrencyRouteKind.fromPathSegment(segments.first);
  if (kind == null) return null;

  if (segments.length == 1) {
    return PisoCampDeepLink(
      kind: PisoCampLinkKind.currencyList,
      route: kind == CurrencyRouteKind.banknotes
          ? AppRoutes.pisoCampBanknotes
          : AppRoutes.pisoCampCoins,
    );
  }
  if (segments.length != 2) return null;

  final logicalId = segments[1];
  if (!isValidCurrencyLogicalId(logicalId)) return null;
  return PisoCampDeepLink(
    kind: PisoCampLinkKind.denomination,
    route: AppRoutes.currencyDetail(
      kind: kind.pathSegment,
      logicalId: logicalId,
    ),
  );
}

/// The path segments inside the module, or null when the link is not ours.
List<String>? _moduleSegments(Uri uri) {
  final segments = uri.pathSegments
      .where((segment) => segment.isNotEmpty)
      .toList(growable: false);

  if (uri.scheme == kPisoCampLinkScheme) {
    // bsp://pisocamp/<rest>. A custom scheme puts the first label in the host.
    if (uri.host != kPisoCampLinkPathPrefix) return null;
    if (uri.userInfo.isNotEmpty || uri.hasPort) return null;
    return segments;
  }

  if (uri.scheme == 'https') {
    if (uri.host != kPisoCampLinkHost) return null;
    if (uri.userInfo.isNotEmpty || uri.hasPort) return null;
    if (segments.isEmpty || segments.first != kPisoCampLinkPathPrefix) {
      return null;
    }
    return segments.sublist(1);
  }

  return null;
}

/// Builds the shareable https form of an in-module destination.
///
/// The https form rather than the custom scheme, because it is the one that
/// still does something useful on a device without the app.
String pisoCampShareableLink({
  required String kind,
  required String logicalId,
}) {
  if (CurrencyRouteKind.fromPathSegment(kind) == null) {
    throw ArgumentError.value(kind, 'kind', 'Unsupported currency kind');
  }
  if (!isValidCurrencyLogicalId(logicalId)) {
    throw ArgumentError.value(logicalId, 'logicalId', 'Invalid logical ID');
  }
  return 'https://$kPisoCampLinkHost/$kPisoCampLinkPathPrefix/'
      '${Uri.encodeComponent(kind)}/${Uri.encodeComponent(logicalId)}';
}
