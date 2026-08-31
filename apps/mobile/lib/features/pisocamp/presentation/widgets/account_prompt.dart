import 'package:flutter/material.dart';
import 'package:mobile/shared/widgets/app_button.dart';

class AccountPrompt extends StatefulWidget {
  const AccountPrompt({
    super.key,
    required this.onCreateAccount,
    required this.onContinueAsGuest,
    this.onShown,
  });
  final VoidCallback? onCreateAccount;
  final VoidCallback? onContinueAsGuest;
  final VoidCallback? onShown;

  @override
  State<AccountPrompt> createState() => _AccountPromptState();
}

class _AccountPromptState extends State<AccountPrompt> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onShown?.call();
    });
  }

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
          onPressed: widget.onCreateAccount,
          child: const Text('Create Account'),
        ),
      ),
      const SizedBox(height: 12),
      Semantics(
        button: true,
        label: 'Continue as Guest',
        child: AppButton(
          isSecondary: true,
          onPressed: widget.onContinueAsGuest,
          child: const Text('Continue as Guest'),
        ),
      ),
    ],
  );
}
