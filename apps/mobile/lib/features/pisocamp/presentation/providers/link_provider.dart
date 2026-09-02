import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/pisocamp/data/link_service.dart';

/// The service that hands approved external links to the platform.
///
/// A provider so a test can watch what would have been opened without opening
/// anything, and so the approval rule has exactly one implementation.
final pisoCampLinkServiceProvider = Provider<PisoCampLinkService>(
  (ref) => const PisoCampLinkService(),
);
