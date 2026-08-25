import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/data/models/session_model.dart';
import 'package:mobile/features/auth/data/models/user_model.dart';
import 'package:mobile/features/pisocamp/data/pisocamp_profile_repository.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_registration_provider.dart';

const _input = PisoCampRegistrationInput(
  name: 'Test User',
  email: 'test@example.com',
  password: 'correct horse battery staple',
  gender: PisoCampGender.female,
  age: 30,
  regionCode: '1300000000',
  cityCode: '1374040000',
);

SessionModel _session() => const SessionModel(
  session: SessionData(token: 'token'),
  user: UserModel(id: 'user-1', name: 'Test User', email: 'test@example.com'),
);

PisoCampProfileResult _complete() => const PisoCampProfileResult(
  status: PisoCampProfileState.complete,
  missingFields: [],
  name: 'Test User',
  email: 'test@example.com',
  profile: PisoCampProfile(
    gender: PisoCampGender.female,
    age: 30,
    regionCode: '1300000000',
    cityCode: '1374040000',
    registrationConsentRecordId: '018f6eb8-4f57-7d2d-8d2d-f2fb359c4aac',
  ),
);

void main() {
  test('rapid submit calls signup and profile creation exactly once', () async {
    var signupCalls = 0;
    var profileCalls = 0;
    final release = Completer<void>();
    final controller = PisoCampRegistrationController(
      signUp: ({required email, required password, required name}) async {
        signupCalls++;
        return AuthSignUpOutcome.authenticated(_session());
      },
      createProfile:
          ({
            required id,
            required gender,
            required age,
            required regionCode,
            required cityCode,
            required devicePseudoId,
          }) async {
            profileCalls++;
            await release.future;
            return _complete();
          },
      getDevicePseudoId: () async => 'abcdefghijklmnopqrstuv',
      createId: () => '018f6eb8-4f57-7d2d-8d2d-f2fb359c4aac',
    );

    final first = controller.submit(_input, authenticated: false);
    final second = controller.submit(_input, authenticated: false);
    release.complete();

    expect(await first, PisoCampRegistrationOutcome.complete);
    expect(await second, PisoCampRegistrationOutcome.complete);
    expect(signupCalls, 1);
    expect(profileCalls, 1);
  });

  test(
    'after profile failure retry skips signup and reuses the UUID',
    () async {
      var signupCalls = 0;
      final ids = <String>[];
      final controller = PisoCampRegistrationController(
        signUp: ({required email, required password, required name}) async {
          signupCalls++;
          return AuthSignUpOutcome.authenticated(_session());
        },
        createProfile:
            ({
              required id,
              required gender,
              required age,
              required regionCode,
              required cityCode,
              required devicePseudoId,
            }) async {
              ids.add(id);
              if (ids.length == 1) throw StateError('temporary failure');
              return _complete();
            },
        getDevicePseudoId: () async => 'abcdefghijklmnopqrstuv',
        createId: () => '018f6eb8-4f57-7d2d-8d2d-f2fb359c4aac',
      );

      await expectLater(
        controller.submit(_input, authenticated: false),
        throwsStateError,
      );
      expect(
        await controller.submit(_input, authenticated: false),
        PisoCampRegistrationOutcome.complete,
      );

      expect(signupCalls, 1);
      expect(ids, <String>[
        '018f6eb8-4f57-7d2d-8d2d-f2fb359c4aac',
        '018f6eb8-4f57-7d2d-8d2d-f2fb359c4aac',
      ]);
    },
  );

  test(
    'verification-required signup never attempts profile creation',
    () async {
      var profileCalls = 0;
      final controller = PisoCampRegistrationController(
        signUp: ({required email, required password, required name}) async =>
            const AuthSignUpOutcome.verificationRequired(
              UserModel(
                id: 'pending-user',
                name: 'Test User',
                email: 'test@example.com',
              ),
            ),
        createProfile:
            ({
              required id,
              required gender,
              required age,
              required regionCode,
              required cityCode,
              required devicePseudoId,
            }) async {
              profileCalls++;
              return _complete();
            },
        getDevicePseudoId: () async => 'abcdefghijklmnopqrstuv',
        createId: () => '018f6eb8-4f57-7d2d-8d2d-f2fb359c4aac',
      );

      expect(
        await controller.submit(_input, authenticated: false),
        PisoCampRegistrationOutcome.verificationRequired,
      );
      expect(profileCalls, 0);
    },
  );

}
