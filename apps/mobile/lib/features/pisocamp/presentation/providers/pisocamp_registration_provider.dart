import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/utils/uuid_v4.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:mobile/features/pisocamp/data/guest_identity_service.dart';
import 'package:mobile/features/pisocamp/data/pisocamp_profile_repository.dart';
import 'package:mobile/services/api/api_client.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';

typedef PisoCampSignUp =
    Future<AuthSignUpOutcome?> Function({
      required String email,
      required String password,
      required String name,
    });

typedef PisoCampCreateProfile =
    Future<PisoCampProfileResult> Function({
      required String id,
      required PisoCampGender gender,
      required int age,
      required String regionCode,
      required String cityCode,
      required String devicePseudoId,
    });

class PisoCampRegistrationInput {
  const PisoCampRegistrationInput({
    this.name,
    this.email,
    this.password,
    required this.gender,
    required this.age,
    required this.regionCode,
    required this.cityCode,
  });

  final String? name;
  final String? email;
  final String? password;
  final PisoCampGender gender;
  final int age;
  final String regionCode;
  final String cityCode;
}

enum PisoCampRegistrationOutcome { complete, verificationRequired }

/// Coordinates the two-step guest flow without ever retaining form PII.
///
/// The generated record id is kept in memory across ambiguous POST failures so
/// a retry is idempotent. Once signup creates a session, retries skip signup and
/// attempt only the missing profile step.
class PisoCampRegistrationController {
  PisoCampRegistrationController({
    required PisoCampSignUp signUp,
    required PisoCampCreateProfile createProfile,
    required Future<String> Function() getDevicePseudoId,
    required String Function() createId,
  }) : _signUp = signUp,
       _createProfile = createProfile,
       _getDevicePseudoId = getDevicePseudoId,
       _createId = createId;

  final PisoCampSignUp _signUp;
  final PisoCampCreateProfile _createProfile;
  final Future<String> Function() _getDevicePseudoId;
  final String Function() _createId;

  Future<PisoCampRegistrationOutcome>? _active;
  String? _profileRecordId;
  bool _accountCreated = false;

  Future<PisoCampRegistrationOutcome> submit(
    PisoCampRegistrationInput input, {
    required bool authenticated,
  }) {
    final active = _active;
    if (active != null) return active;

    final operation = Future<PisoCampRegistrationOutcome>.sync(() async {
      try {
        if (!authenticated && !_accountCreated) {
          final name = input.name;
          final email = input.email;
          final password = input.password;
          if (name == null || email == null || password == null) {
            throw const FormatException('Missing account registration fields');
          }
          final signup = await _signUp(
            email: email,
            password: password,
            name: name,
          );
          if (signup == null) {
            throw StateError('Account registration failed');
          }
          if (signup.state == AuthSignUpState.verificationRequired) {
            return PisoCampRegistrationOutcome.verificationRequired;
          }
          _accountCreated = true;
        }

        final id = _profileRecordId ??= _createId();
        final devicePseudoId = await _getDevicePseudoId();
        final result = await _createProfile(
          id: id,
          gender: input.gender,
          age: input.age,
          regionCode: input.regionCode,
          cityCode: input.cityCode,
          devicePseudoId: devicePseudoId,
        );
        if (result.status != PisoCampProfileState.complete) {
          throw const FormatException('Profile response was not complete');
        }
        return PisoCampRegistrationOutcome.complete;
      } finally {
        _active = null;
      }
    });
    _active = operation;
    return operation;
  }
}

final pisoCampProfileRepositoryProvider = Provider<PisoCampProfileRepository>(
  (ref) => PisoCampProfileRepository(ref.watch(dioProvider)),
);

final pisoCampProfileStatusProvider =
    FutureProvider.autoDispose<PisoCampProfileResult?>((ref) async {
      final auth = ref.watch(authStateProvider);
      if (!auth.hasValue || auth.value == null) return null;
      return ref.watch(pisoCampProfileRepositoryProvider).fetchProfile();
    });

final pisoCampRegistrationControllerProvider =
    Provider.autoDispose<PisoCampRegistrationController>((ref) {
      final repository = ref.watch(pisoCampProfileRepositoryProvider);
      final identity = GuestIdentityService(ref.watch(secureStorageProvider));
      return PisoCampRegistrationController(
        signUp: ({required email, required password, required name}) => ref
            .read(authStateProvider.notifier)
            .signUp(email: email, password: password, name: name),
        createProfile: repository.createProfile,
        getDevicePseudoId: identity.getOrCreateId,
        createId: createUuidV4,
      );
    });
