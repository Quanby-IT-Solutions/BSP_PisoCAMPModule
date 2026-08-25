import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/data/models/session_model.dart';
import 'package:mobile/features/auth/data/models/user_model.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/data/pisocamp_profile_repository.dart';
import 'package:mobile/features/pisocamp/presentation/providers/consent_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_registration_provider.dart';
import 'package:mobile/features/pisocamp/presentation/screens/pisocamp_registration_screen.dart';

const _catalog = PsgcLocationCatalog(
  version: 'PSGC-2Q-2026',
  sourceUrl: 'https://psa.gov.ph/classification/psgc',
  catalogSha256:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  regions: <PsgcRegion>[
    PsgcRegion(
      code: '1300000000',
      name: 'National Capital Region',
      cities: <PsgcCity>[PsgcCity(code: '1374040000', name: 'Quezon City')],
    ),
    PsgcRegion(
      code: '0700000000',
      name: 'Central Visayas',
      cities: <PsgcCity>[
        PsgcCity(code: '0722170000', name: 'Cebu City'),
      ],
    ),
  ],
);

SessionModel _session() => const SessionModel(
  session: SessionData(token: 'token'),
  user: UserModel(
    id: 'user-1',
    name: 'Existing User',
    email: 'existing@example.com',
  ),
);

class _FakeAuthRepository implements AuthRepository {
  _FakeAuthRepository(this.session);
  final SessionModel? session;

  @override
  Future<SessionModel?> getSession() async => session;

  @override
  Future<SessionModel?> signIn({
    required String email,
    required String password,
  }) async => session;

  @override
  Future<AuthSignUpOutcome> signUp({
    required String email,
    required String password,
    required String name,
  }) async => AuthSignUpOutcome.authenticated(_session());

  @override
  Future<void> signOut() async {}
}

class _FakeProfileRepository extends PisoCampProfileRepository {
  _FakeProfileRepository({this.profile}) : super(Dio());
  final PisoCampProfileResult? profile;
  int profileGets = 0;

  @override
  Future<PsgcLocationCatalog> fetchLocations() async => _catalog;

  @override
  Future<PisoCampProfileResult> fetchProfile() async {
    profileGets++;
    return profile!;
  }
}

class _LifecycleAuthRepository extends _FakeAuthRepository {
  _LifecycleAuthRepository() : super(null);

  int signupCalls = 0;

  @override
  Future<AuthSignUpOutcome> signUp({
    required String email,
    required String password,
    required String name,
  }) async {
    signupCalls++;
    return AuthSignUpOutcome.authenticated(_session());
  }
}

class _LifecycleProfileRepository extends _FakeProfileRepository {
  _LifecycleProfileRepository() : super();

  final ids = <String>[];

  @override
  Future<PisoCampProfileResult> createProfile({
    required String id,
    required PisoCampGender gender,
    required int age,
    required String regionCode,
    required String cityCode,
    required String devicePseudoId,
  }) async {
    ids.add(id);
    if (ids.length == 1) throw StateError('temporary failure');
    return const PisoCampProfileResult(
      status: PisoCampProfileState.complete,
      missingFields: [],
      name: 'Test User',
      email: 'test@example.com',
      profile: PisoCampProfile(
        gender: PisoCampGender.female,
        age: 30,
        regionCode: '1300000000',
        cityCode: '1374040000',
        registrationConsentRecordId:
            '018f6eb8-4f57-7d2d-8d2d-f2fb359c4aac',
      ),
    );
  }
}

Widget _subject({
  required _FakeAuthRepository auth,
  required _FakeProfileRepository profiles,
  ConsentGateResult consent = ConsentGateResult.grantedSynced,
  double textScale = 1,
  PisoCampRegistrationController? controller,
}) {
  return ProviderScope(
    overrides: [
      authRepositoryProvider.overrideWithValue(auth),
      pisoCampProfileRepositoryProvider.overrideWithValue(profiles),
      connectivityStatusProvider.overrideWith((ref) => Stream.value(true)),
      requireConsentProvider.overrideWithValue(
        (context, purpose, {required online}) async => consent,
      ),
      if (controller != null)
        pisoCampRegistrationControllerProvider.overrideWithValue(controller),
    ],
    child: MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: const PisoCampRegistrationScreen(),
    ),
  );
}

Future<void> _fillGuestForm(
  WidgetTester tester, {
  required String email,
}) async {
  final fields = find.byType(TextFormField);
  await tester.enterText(fields.at(0), 'Test User');
  await tester.enterText(fields.at(1), email);
  await tester.enterText(fields.at(2), 'password123');
  await tester.enterText(fields.at(3), 'password123');
  await tester.enterText(fields.at(4), '30');
  final genderField = find.byType(DropdownButtonFormField<PisoCampGender>);
  await tester.ensureVisible(genderField);
  await tester.tap(genderField);
  await tester.pumpAndSettle();
  await tester.tap(find.text('Female').last);
  await tester.pumpAndSettle();
  final regionField = find.byType(DropdownButtonFormField<PsgcRegion>);
  await tester.ensureVisible(regionField);
  await tester.tap(regionField);
  await tester.pumpAndSettle();
  await tester.tap(find.text('National Capital Region').last);
  await tester.pumpAndSettle();
  final cityDropdown = find.byType(DropdownButtonFormField<PsgcCity>);
  await tester.ensureVisible(cityDropdown);
  await tester.tap(cityDropdown);
  await tester.pumpAndSettle();
  await tester.tap(find.text('Quezon City').last);
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      'device_pseudo_id': 'abcdefghijklmnopqrstuv',
    });
  });

  testWidgets('guest form marks every account and profile field Required', (
    tester,
  ) async {
    await tester.pumpWidget(
      _subject(
        auth: _FakeAuthRepository(null),
        profiles: _FakeProfileRepository(),
      ),
    );
    await tester.pumpAndSettle();

    for (final label in const <String>[
      'Name (Required)',
      'Email (Required)',
      'Password (Required)',
      'Confirm Password (Required)',
      'Gender (Required)',
      'Age (Required)',
      'Region (Required)',
      'City (Required)',
    ]) {
      expect(find.text(label), findsOneWidget, reason: label);
    }
    expect(
      find.bySemanticsLabel('Submit Piso CAMP registration'),
      findsOneWidget,
    );
  });

  testWidgets(
    'existing authenticated missing-profile user sees no account re-entry fields',
    (tester) async {
      final profiles = _FakeProfileRepository(
        profile: const PisoCampProfileResult(
          status: PisoCampProfileState.missing,
          missingFields: <String>['gender', 'age', 'regionCode', 'cityCode'],
          name: 'Existing User',
          email: 'existing@example.com',
          profile: null,
        ),
      );
      await tester.pumpWidget(
        _subject(auth: _FakeAuthRepository(_session()), profiles: profiles),
      );
      await tester.pumpAndSettle();

      expect(profiles.profileGets, 1);
      expect(find.text('Complete your Piso CAMP profile'), findsOneWidget);
      expect(find.text('Name (Required)'), findsNothing);
      expect(find.text('Email (Required)'), findsNothing);
      expect(find.text('Password (Required)'), findsNothing);
      expect(find.text('Confirm Password (Required)'), findsNothing);
      expect(find.text('Gender (Required)'), findsOneWidget);
      expect(find.text('Age (Required)'), findsOneWidget);
      expect(find.text('Region (Required)'), findsOneWidget);
      expect(find.text('City (Required)'), findsOneWidget);
    },
  );

  testWidgets('consent unavailable exposes no personal-data controls', (
    tester,
  ) async {
    await tester.pumpWidget(
      _subject(
        auth: _FakeAuthRepository(null),
        profiles: _FakeProfileRepository(),
        consent: ConsentGateResult.unavailable,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Registration is unavailable'), findsOneWidget);
    expect(find.byType(TextFormField), findsNothing);
    expect(find.byType(DropdownButtonFormField<PisoCampGender>), findsNothing);
  });

  testWidgets('form scrolls without overflow after rotation at 200% text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(720, 320));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _subject(
        auth: _FakeAuthRepository(null),
        profiles: _FakeProfileRepository(),
        textScale: 2,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(SingleChildScrollView), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('malformed email blocks an otherwise valid submission', (
    tester,
  ) async {
    var signupCalls = 0;
    final controller = PisoCampRegistrationController(
      signUp: ({required email, required password, required name}) async {
        signupCalls++;
        return const AuthSignUpOutcome.verificationRequired(
          UserModel(
            id: 'pending-user',
            name: 'Test User',
            email: 'a@',
          ),
        );
      },
      createProfile:
          ({
            required id,
            required gender,
            required age,
            required regionCode,
            required cityCode,
            required devicePseudoId,
          }) async => throw StateError('profile must not be attempted'),
      getDevicePseudoId: () async => 'abcdefghijklmnopqrstuv',
      createId: () => '018f6eb8-4f57-7d2d-8d2d-f2fb359c4aac',
    );
    await tester.pumpWidget(
      _subject(
        auth: _FakeAuthRepository(null),
        profiles: _FakeProfileRepository(),
        controller: controller,
      ),
    );
    await tester.pumpAndSettle();

    await _fillGuestForm(tester, email: 'a@');

    await tester.tap(find.text('Create account'));
    await tester.pumpAndSettle();

    expect(find.text('Enter a valid email address'), findsOneWidget);
    expect(signupCalls, 0);
  });

  testWidgets(
    'mounted screen preserves signup completion and UUID across profile retry',
    (tester) async {
      final auth = _LifecycleAuthRepository();
      final profiles = _LifecycleProfileRepository();
      await tester.pumpWidget(_subject(auth: auth, profiles: profiles));
      await tester.pumpAndSettle();
      await _fillGuestForm(tester, email: 'test@example.com');

      final submitButton = find.text('Create account');
      await tester.ensureVisible(submitButton);
      await tester.tap(submitButton);
      await tester.pumpAndSettle();
      expect(
        find.text('We could not finish your Piso CAMP profile. Please retry.'),
        findsOneWidget,
      );

      await tester.ensureVisible(submitButton);
      await tester.tap(submitButton);
      await tester.pumpAndSettle();

      expect(find.text('Piso CAMP profile complete'), findsOneWidget);
      expect(auth.signupCalls, 1);
      expect(profiles.ids, hasLength(2));
      expect(profiles.ids[1], profiles.ids[0]);
    },
  );

  testWidgets('changing region clears and filters the selected city', (
    tester,
  ) async {
    await tester.pumpWidget(
      _subject(
        auth: _FakeAuthRepository(null),
        profiles: _FakeProfileRepository(),
      ),
    );
    await tester.pumpAndSettle();

    final regionField = find.byType(DropdownButtonFormField<PsgcRegion>);
    await tester.ensureVisible(regionField);
    await tester.tap(regionField);
    await tester.pumpAndSettle();
    await tester.tap(find.text('National Capital Region').last);
    await tester.pumpAndSettle();
    final cityDropdown = find.byType(DropdownButtonFormField<PsgcCity>);
    await tester.ensureVisible(cityDropdown);
    await tester.tap(cityDropdown);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Quezon City').last);
    await tester.pumpAndSettle();

    await tester.ensureVisible(regionField);
    await tester.tap(regionField);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Central Visayas').last);
    await tester.pumpAndSettle();

    final cityField = tester.widget<DropdownButtonFormField<PsgcCity>>(
      find.byType(DropdownButtonFormField<PsgcCity>),
    );
    expect(cityField.initialValue, isNull);
    await tester.ensureVisible(cityDropdown);
    await tester.tap(cityDropdown);
    await tester.pumpAndSettle();
    expect(find.text('Cebu City'), findsOneWidget);
    expect(find.text('Quezon City'), findsNothing);
  });
}
