import 'package:flutter/material.dart';
import 'package:mobile/shared/widgets/app_button.dart';

class AccountPrompt extends StatelessWidget {
  const AccountPrompt({
    super.key,
    required this.onCreateAccount,
    required this.onContinueAsGuest,
  });
  final VoidCallback onCreateAccount;
  final VoidCallback onContinueAsGuest;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        'You can explore Piso CAMP without an account.',
        style: Theme.of(context).textTheme.bodyLarge,
      ),
      const SizedBox(height: 16),
      Semantics(
        button: true,
        label: 'Create Account',
        child: AppButton(
          onPressed: onCreateAccount,
          child: const Text('Create Account'),
        ),
      ),
      const SizedBox(height: 12),
      Semantics(
        button: true,
        label: 'Continue as Guest',
        child: AppButton(
          isSecondary: true,
          onPressed: onContinueAsGuest,
          child: const Text('Continue as Guest'),
        ),
      ),
    ],
  );
}
