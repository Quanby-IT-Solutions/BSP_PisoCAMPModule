import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:mobile/features/auth/presentation/utils/auth_error_message.dart';
import 'package:mobile/features/auth/presentation/utils/auth_validation.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/data/pisocamp_profile_repository.dart';
import 'package:mobile/features/pisocamp/presentation/providers/consent_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_registration_provider.dart';

class PisoCampRegistrationScreen extends ConsumerStatefulWidget {
  const PisoCampRegistrationScreen({super.key});

  @override
  ConsumerState<PisoCampRegistrationScreen> createState() =>
      _PisoCampRegistrationScreenState();
}

class _PisoCampRegistrationScreenState
    extends ConsumerState<PisoCampRegistrationScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();
  final _age = TextEditingController();

  PsgcLocationCatalog? _catalog;
  PisoCampProfileResult? _existingProfile;
  PisoCampGender? _gender;
  PsgcRegion? _region;
  PsgcCity? _city;
  bool _loading = true;
  bool _submitting = false;
  bool _authenticated = false;
  bool _verificationRequired = false;
  bool _complete = false;
  String? _loadMessage;
  String? _submitMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _initialize());
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _confirmPassword.dispose();
    _age.dispose();
    super.dispose();
  }

  Future<void> _initialize() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _loadMessage = null;
    });
    try {
      final transport = ref.read(connectivityStatusProvider).asData?.value;
      final consent = await ref.read(requireConsentProvider)(
        context,
        ConsentPurpose.registration,
        online: transport != false,
      );
      if (!mounted) return;
      if (consent != ConsentGateResult.grantedSynced) {
        setState(() {
          _loading = false;
          _loadMessage = consent == ConsentGateResult.unavailable
              ? 'Registration is unavailable'
              : 'Registration was not started';
        });
        return;
      }

      // A successful public request validates actual server reachability. The
      // transport signal alone can be true behind a captive or dead network.
      final catalog = await ref
          .read(pisoCampProfileRepositoryProvider)
          .fetchLocations();
      final session = await ref.read(authStateProvider.future);
      PisoCampProfileResult? profile;
      if (session != null) {
        profile = await ref
            .read(pisoCampProfileRepositoryProvider)
            .fetchProfile();
      }
      if (!mounted) return;
      setState(() {
        _catalog = catalog;
        _authenticated = session != null;
        _existingProfile = profile;
        _complete = profile?.status == PisoCampProfileState.complete;
        _loading = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadMessage = 'Registration is unavailable';
      });
    }
  }

  Future<void> _submit() async {
    if (_submitting || !_formKey.currentState!.validate()) return;
    final gender = _gender;
    final region = _region;
    final city = _city;
    final age = int.tryParse(_age.text);
    if (gender == null || region == null || city == null || age == null) {
      return;
    }
    setState(() {
      _submitting = true;
      _submitMessage = null;
    });
    try {
      final outcome = await ref
          .read(pisoCampRegistrationControllerProvider)
          .submit(
            PisoCampRegistrationInput(
              name: _authenticated ? null : _name.text.trim(),
              email: _authenticated ? null : _email.text.trim(),
              password: _authenticated ? null : _password.text,
              gender: gender,
              age: age,
              regionCode: region.code,
              cityCode: city.code,
            ),
            authenticated: _authenticated,
          );
      if (!mounted) return;
      if (outcome == PisoCampRegistrationOutcome.verificationRequired) {
        _clearAccountFields();
        setState(() => _verificationRequired = true);
      } else {
        _clearAccountFields();
        _age.clear();
        ref.invalidate(pisoCampProfileStatusProvider);
        setState(() {
          _gender = null;
          _region = null;
          _city = null;
          _existingProfile = null;
          _complete = true;
        });
      }
    } on Object {
      if (!mounted) return;
      final authState = ref.read(authStateProvider);
      setState(() {
        _submitMessage = authState.hasError
            ? authErrorMessage(authState.error)
            : 'We could not finish your Piso CAMP profile. Please retry.';
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Retry state belongs to this route. Watching keeps the auto-dispose
    // controller (and its stable idempotency UUID) alive between button taps,
    // while leaving the route still releases it.
    ref.watch(pisoCampRegistrationControllerProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Piso CAMP Registration')),
      body: SafeArea(child: _buildBody(context)),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_loadMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Semantics(
                liveRegion: true,
                child: Text(
                  _loadMessage!,
                  style: Theme.of(context).textTheme.titleLarge,
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: _initialize,
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }
    if (_verificationRequired) {
      return const _StatusPanel(
        icon: Icons.mark_email_read_outlined,
        title: 'Verify your email',
        message:
            'Check your email and verify your account. Then sign in and return to Piso CAMP to complete your profile.',
      );
    }
    if (_complete) {
      return const _StatusPanel(
        icon: Icons.check_circle_outline,
        title: 'Piso CAMP profile complete',
        message: 'Your registration details were saved successfully.',
      );
    }

    final catalog = _catalog!;
    final cities = _region?.cities ?? const <PsgcCity>[];
    return AutofillGroup(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                _authenticated
                    ? 'Complete your Piso CAMP profile'
                    : 'Create your Piso CAMP account',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              Text(
                _authenticated
                    ? 'Add the remaining required profile details. You do not need to re-enter your account credentials.'
                    : 'All fields are required. Your password and profile details are sent only to the server and are not saved offline.',
              ),
              if (_authenticated && _existingProfile != null) ...[
                const SizedBox(height: 8),
                Text('Signed in as ${_existingProfile!.name}'),
              ],
              const SizedBox(height: 24),
              if (!_authenticated) ...[
                TextFormField(
                  controller: _name,
                  decoration: const InputDecoration(
                    labelText: 'Name (Required)',
                    border: OutlineInputBorder(),
                  ),
                  autofillHints: const [AutofillHints.name],
                  textInputAction: TextInputAction.next,
                  validator: _required,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _email,
                  decoration: const InputDecoration(
                    labelText: 'Email (Required)',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                  textInputAction: TextInputAction.next,
                  validator: AuthValidation.email,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _password,
                  decoration: const InputDecoration(
                    labelText: 'Password (Required)',
                    border: OutlineInputBorder(),
                  ),
                  obscureText: true,
                  enableSuggestions: false,
                  autocorrect: false,
                  autofillHints: const [AutofillHints.newPassword],
                  textInputAction: TextInputAction.next,
                  validator: AuthValidation.password,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _confirmPassword,
                  decoration: const InputDecoration(
                    labelText: 'Confirm Password (Required)',
                    border: OutlineInputBorder(),
                  ),
                  obscureText: true,
                  enableSuggestions: false,
                  autocorrect: false,
                  textInputAction: TextInputAction.next,
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Confirm Password is required';
                    }
                    return value == _password.text
                        ? null
                        : 'Passwords do not match';
                  },
                ),
                const SizedBox(height: 12),
              ],
              DropdownButtonFormField<PisoCampGender>(
                initialValue: _gender,
                decoration: const InputDecoration(
                  labelText: 'Gender (Required)',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(
                    value: PisoCampGender.female,
                    child: Text('Female'),
                  ),
                  DropdownMenuItem(
                    value: PisoCampGender.male,
                    child: Text('Male'),
                  ),
                  DropdownMenuItem(
                    value: PisoCampGender.preferNotToSay,
                    child: Text('Prefer not to say'),
                  ),
                ],
                onChanged: _submitting
                    ? null
                    : (value) => setState(() => _gender = value),
                validator: (value) =>
                    value == null ? 'Gender is required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _age,
                decoration: const InputDecoration(
                  labelText: 'Age (Required)',
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                textInputAction: TextInputAction.next,
                validator: (value) {
                  final parsed = int.tryParse(value ?? '');
                  return parsed != null && parsed >= 1 && parsed <= 120
                      ? null
                      : 'Enter an age from 1 to 120';
                },
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<PsgcRegion>(
                initialValue: _region,
                decoration: const InputDecoration(
                  labelText: 'Region (Required)',
                  border: OutlineInputBorder(),
                ),
                isExpanded: true,
                items: [
                  for (final region in catalog.regions)
                    DropdownMenuItem(value: region, child: Text(region.name)),
                ],
                onChanged: _submitting
                    ? null
                    : (value) => setState(() {
                        if (!identical(_region, value)) _city = null;
                        _region = value;
                      }),
                validator: (value) =>
                    value == null ? 'Region is required' : null,
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<PsgcCity>(
                key: ValueKey(_region?.code),
                initialValue: _city,
                decoration: const InputDecoration(
                  labelText: 'City (Required)',
                  border: OutlineInputBorder(),
                ),
                isExpanded: true,
                items: [
                  for (final city in cities)
                    DropdownMenuItem(value: city, child: Text(city.name)),
                ],
                onChanged: _submitting || _region == null
                    ? null
                    : (value) => setState(() => _city = value),
                validator: (value) => value == null ? 'City is required' : null,
              ),
              if (_submitMessage != null) ...[
                const SizedBox(height: 16),
                Semantics(
                  liveRegion: true,
                  child: Text(
                    _submitMessage!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 24),
              Semantics(
                button: true,
                label: 'Submit Piso CAMP registration',
                child: FilledButton(
                  onPressed: _submitting ? null : _submit,
                  child: _submitting
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(
                          _authenticated ? 'Save profile' : 'Create account',
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String? _required(String? value) =>
      value == null || value.trim().isEmpty ? 'This field is required' : null;

  void _clearAccountFields() {
    _name.clear();
    _email.clear();
    _password.clear();
    _confirmPassword.clear();
  }
}

class _StatusPanel extends StatelessWidget {
  const _StatusPanel({
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Semantics(
          liveRegion: true,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 56),
              const SizedBox(height: 16),
              Text(title, style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 8),
              Text(message, textAlign: TextAlign.center),
            ],
          ),
        ),
      ),
    );
  }
}
