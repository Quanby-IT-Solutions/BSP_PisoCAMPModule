import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_repository.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/data/guest_identity_service.dart';
import 'package:mobile/features/pisocamp/presentation/providers/consent_provider.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  test(
    'app restart retains an offline grant and reconnect drains it once',
    () async {
      final firstStore = ConsentLocalStore(SecureStorageService());
      final firstService = ConsentService(
        _RecordingConsentRepository(),
        firstStore,
        GuestIdentityService(SecureStorageService()),
        idGenerator: () => 'fd7c903f-b547-4186-b5bd-292f91d2e4bb',
        clock: () => DateTime.parse('2026-08-24T01:02:03.000Z'),
      );
      final notice = PrivacyNotice(
        id: 'cdf17c95-93f5-40b5-bdf5-4117236d52d0',
        version: '2026-08-24-test-v2',
        title: 'Test notice',
        body: 'Explicit fake notice body for reconnect testing.',
        sourceUrl: Uri.parse('https://example.test/privacy-v2'),
        contentSha256:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        effectiveAt: DateTime.utc(2026, 8, 24),
      );

      expect(
        await firstService.recordDecision(
          purpose: ConsentPurpose.registration,
          notice: notice,
          decision: ConsentDecision.granted,
          online: false,
        ),
        ConsentGateResult.grantedQueued,
      );

      final restoredStore = ConsentLocalStore(SecureStorageService());
      final repository = _RecordingConsentRepository();
      final restoredService = ConsentService(
        repository,
        restoredStore,
        GuestIdentityService(SecureStorageService()),
      );
      final connectivity = StreamController<bool>();
      addTearDown(connectivity.close);
      final container = ProviderContainer(
        overrides: [
          connectivityStatusProvider.overrideWith((ref) => connectivity.stream),
          consentServiceProvider.overrideWithValue(restoredService),
        ],
      );
      addTearDown(container.dispose);
      final subscription = container.listen(
        consentSyncControllerProvider,
        (_, _) {},
        fireImmediately: true,
      );
      addTearDown(subscription.close);

      connectivity.add(false);
      await Future<void>.delayed(Duration.zero);
      expect(await restoredStore.readPending(), hasLength(1));

      connectivity.add(true);
      await repository.synchronized.future.timeout(const Duration(seconds: 1));
      await Future<void>.delayed(Duration.zero);

      expect(repository.syncCount, 1);
      expect(await restoredStore.readPending(), isEmpty);
    },
  );
}

class _RecordingConsentRepository implements ConsentRepository {
  final synchronized = Completer<void>();
  int syncCount = 0;

  @override
  Future<ConsentStatus> fetchStatus(
    ConsentPurpose purpose, {
    required String devicePseudoId,
  }) => throw UnimplementedError();

  @override
  Future<PrivacyNotice?> readCachedNotice() async => null;

  @override
  Future<RecordedConsentAcknowledgement> sync(
    StoredConsentRecord record,
  ) async {
    syncCount++;
    if (!synchronized.isCompleted) synchronized.complete();
    return RecordedConsentAcknowledgement(
      id: record.recordId,
      state: ConsentServerState.granted,
      recordedAt: DateTime.utc(2026, 8, 24, 1, 3),
    );
  }
}
