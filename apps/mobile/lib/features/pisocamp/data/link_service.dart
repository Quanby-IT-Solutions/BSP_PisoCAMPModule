import 'package:url_launcher/url_launcher.dart';

/// Why a link was not opened.
enum LinkRefusal {
  /// Not an approved destination.
  notApproved,

  /// Approved, but the device had nothing to open it with.
  noHandler,
}

/// The result of asking to open an external link.
final class LinkOutcome {
  const LinkOutcome.opened() : refusal = null;
  const LinkOutcome.refused(LinkRefusal this.refusal);

  final LinkRefusal? refusal;

  bool get opened => refusal == null;
}

/// Opens approved external links.
///
/// The approval check is here rather than at the call site because a link
/// arrives as content: it is authored, travels through a bundle, and reaches a
/// device that will hand it to another application. Only an HTTPS BSP address
/// is ever handed over, which is the same rule the content documents are
/// validated against, restated at the last possible moment.
class PisoCampLinkService {
  const PisoCampLinkService({
    Future<bool> Function(Uri url, {LaunchMode mode})? launch,
  }) : _launch = launch ?? _launchUrl;

  final Future<bool> Function(Uri url, {LaunchMode mode}) _launch;

  static const String approvedHost = 'www.bsp.gov.ph';

  static Future<bool> _launchUrl(
    Uri url, {
    LaunchMode mode = LaunchMode.platformDefault,
  }) {
    return launchUrl(url, mode: mode);
  }

  /// Whether [url] is a destination this module will hand to the platform.
  static bool isApproved(Uri url) {
    return url.scheme == 'https' &&
        url.host == approvedHost &&
        url.userInfo.isEmpty &&
        !url.hasPort;
  }

  /// Opens [url] in the platform's browser, or refuses and says why.
  Future<LinkOutcome> open(Uri url) async {
    if (!isApproved(url)) {
      return const LinkOutcome.refused(LinkRefusal.notApproved);
    }
    try {
      final launched = await _launch(url, mode: LaunchMode.externalApplication);
      return launched
          ? const LinkOutcome.opened()
          : const LinkOutcome.refused(LinkRefusal.noHandler);
    } on Object {
      // A platform that cannot open a browser is a device limitation, not a
      // crash: the caller shows a message instead.
      return const LinkOutcome.refused(LinkRefusal.noHandler);
    }
  }
}
