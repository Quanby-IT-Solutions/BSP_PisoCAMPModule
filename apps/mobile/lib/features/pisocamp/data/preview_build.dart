/// CM-5 preview mode.
///
/// A preview renders BSP content that has **not** been approved for the public,
/// so the whole feature is compiled out unless a build explicitly opts in:
///
/// ```bash
/// flutter build apk --dart-define=PISOCAMP_PREVIEW_BUILD=true
/// ```
///
/// A `const bool.fromEnvironment` gate (not a runtime flag) is what makes this
/// a build property: the route, the screen and the network calls are absent
/// from a store build, so no configuration mistake can switch them on later.
const bool kPisoCampPreviewBuild = bool.fromEnvironment('PISOCAMP_PREVIEW_BUILD');

const int _maximumPreviewCodeLength = 2048;
final RegExp _previewTokenPattern = RegExp(r'^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');

/// Extract the opaque grant from a scanned or pasted preview code.
///
/// The console encodes the redemption URL, which is what a camera hands back,
/// but an operator may equally paste the bare token. Both are accepted and both
/// are validated to the same shape, so nothing reaches the network until the
/// code at least looks like a grant.
String? readPisoCampPreviewToken(String scanned) {
  final trimmed = scanned.trim();
  if (trimmed.isEmpty || trimmed.length > _maximumPreviewCodeLength) return null;

  if (_previewTokenPattern.hasMatch(trimmed)) return trimmed;

  final uri = Uri.tryParse(trimmed);
  if (uri == null) return null;
  final token = uri.queryParameters['token'];
  if (token == null) return null;
  final candidate = token.trim();
  if (candidate.length > _maximumPreviewCodeLength) return null;
  return _previewTokenPattern.hasMatch(candidate) ? candidate : null;
}
