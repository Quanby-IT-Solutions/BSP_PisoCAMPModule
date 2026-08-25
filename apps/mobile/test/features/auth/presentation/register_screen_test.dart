import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/data/models/session_model.dart';
import 'package:mobile/features/auth/data/models/user_model.dart';
import 'package:mobile/features/auth/presentation/screens/register_screen.dart';

class _VerificationAuthRepository implements AuthRepository {
  @override
  Future<SessionModel?> getSession() async => null;

  @override
  Future<SessionModel?> signIn({
    required String email,
    required String password,
  }) async => null;

  @override
  Future<AuthSignUpOutcome> signUp({
    required String email,
    required String password,
    required String name,
  }) async => const AuthSignUpOutcome.verificationRequired(
    UserModel(id: 'pending-user', name: 'Test User', email: 'test@example.com'),
  );

  @override
  Future<void> signOut() async {}
}

void main() {
  testWidgets('verification-required signup tells the user what to do next', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(
            _VerificationAuthRepository(),
          ),
        ],
        child: const MaterialApp(home: RegisterScreen()),
      ),
    );
    await tester.pumpAndSettle();

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'Test User');
    await tester.enterText(fields.at(1), 'test@example.com');
    await tester.enterText(fields.at(2), 'password123');
    await tester.enterText(fields.at(3), 'password123');
    await tester.tap(find.text('Sign Up'));
    await tester.pumpAndSettle();

    expect(find.text('Verify your email'), findsOneWidget);
    expect(find.textContaining('Then sign in'), findsOneWidget);
  });
}
