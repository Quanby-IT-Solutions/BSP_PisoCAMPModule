import 'package:mobile/features/pisocamp/data/guest_identity_service.dart';
import 'package:mobile/features/pisocamp/data/pisocamp_repository.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'pisocamp_provider.g.dart';

@riverpod
GuestIdentityService guestIdentityService(Ref ref) =>
    GuestIdentityService(ref.watch(secureStorageProvider));

@riverpod
Stream<PisoCampHomeLoadResult> pisoCampHome(Ref ref) =>
    ref.watch(pisoCampRepositoryProvider).loadHome();
