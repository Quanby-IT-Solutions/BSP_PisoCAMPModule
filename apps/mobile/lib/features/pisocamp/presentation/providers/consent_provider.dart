import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_repository.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/data/consent_sync_controller.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_provider.dart';
import 'package:mobile/features/pisocamp/presentation/utils/require_consent.dart';
import 'package:mobile/services/api/api_client.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';

final consentLocalStoreProvider = Provider<ConsentLocalStore>(
  (ref) => ConsentLocalStore(ref.watch(secureStorageProvider)),
);

final consentRepositoryProvider = Provider<ConsentRepository>(
  (ref) => ConsentRepository(
    ref.watch(dioProvider),
    ref.watch(consentLocalStoreProvider),
  ),
);

final consentServiceProvider = Provider<ConsentService>(
  (ref) => ConsentService(
    ref.watch(consentRepositoryProvider),
    ref.watch(consentLocalStoreProvider),
    ref.watch(guestIdentityServiceProvider),
  ),
);

final requireConsentProvider = Provider<RequireConsent>((ref) {
  return (context, purpose, {required online}) {
    final service = ref.read(consentServiceProvider);
    return requireConsent(
      context,
      purpose,
      online: online,
      check: service.check,
      recordDecision: service.recordDecision,
    );
  };
});

/// Kept alive by [App] so an offline decision syncs even outside Piso CAMP.
final consentSyncControllerProvider = Provider<ConsentSyncController>((ref) {
  final connectivity = StreamController<bool>();
  final controller = ConsentSyncController(
    connectivity.stream,
    () => ref.read(consentServiceProvider).syncPending(),
  );
  ref.listen(connectivityStatusProvider, (_, next) {
    final value = next.asData?.value;
    if (value != null && !connectivity.isClosed) connectivity.add(value);
  }, fireImmediately: true);
  ref.onDispose(() {
    unawaited(controller.dispose());
    unawaited(connectivity.close());
  });
  return controller;
});
