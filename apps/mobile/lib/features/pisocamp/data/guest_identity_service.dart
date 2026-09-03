import 'dart:convert';
import 'dart:math';

import 'package:mobile/services/storage/secure_storage_service.dart';

/// Persists a device-local pseudonymous identity for guest continuation.
class GuestIdentityService {
  GuestIdentityService(this._storage);

  static const _devicePseudoIdKey = 'device_pseudo_id';
  static const _continuedAsGuestKey = 'pisocamp_continued_as_guest';
  static const _firstOpenReportedKey = 'pisocamp_first_open_reported';

  final SecureStorageService _storage;

  Future<String> getOrCreateId() async {
    final stored = await _storage.readValue(_devicePseudoIdKey);
    if (stored != null && stored.isNotEmpty) return stored;

    final bytes = List<int>.generate(16, (_) => Random.secure().nextInt(256));
    final id = base64Url.encode(bytes).replaceAll('=', '');
    await _storage.writeValue(_devicePseudoIdKey, id);
    return id;
  }

  Future<bool> hasContinuedAsGuest() async {
    return (await _storage.readValue(_continuedAsGuestKey)) == 'true';
  }

  /// AN-11. Whether this install has already reported its first open.
  ///
  /// Returns true exactly once per install, so a device that opens the module
  /// every day is one install rather than a hundred. Reinstalling clears the
  /// storage and counts again, which is what an install count means.
  Future<bool> claimFirstOpen() async {
    if ((await _storage.readValue(_firstOpenReportedKey)) == 'true') return false;
    await _storage.writeValue(_firstOpenReportedKey, 'true');
    return true;
  }

  Future<void> continueAsGuest() async {
    await getOrCreateId();
    await _storage.writeValue(_continuedAsGuestKey, 'true');
  }
}
