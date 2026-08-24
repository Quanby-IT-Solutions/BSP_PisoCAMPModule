import 'dart:convert';
import 'dart:math';

import 'package:mobile/services/storage/secure_storage_service.dart';

/// Persists a device-local pseudonymous identity for guest continuation.
class GuestIdentityService {
  GuestIdentityService(this._storage);

  static const _devicePseudoIdKey = 'device_pseudo_id';
  static const _continuedAsGuestKey = 'pisocamp_continued_as_guest';

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

  Future<void> continueAsGuest() async {
    await getOrCreateId();
    await _storage.writeValue(_continuedAsGuestKey, 'true');
  }
}
