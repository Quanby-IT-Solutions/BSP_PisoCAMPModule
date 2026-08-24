import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/presentation/providers/consent_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/account_prompt.dart';
import 'package:mobile/shared/widgets/app_card.dart';

class PisoCampHomeScreen extends ConsumerStatefulWidget {
  const PisoCampHomeScreen({super.key});
  @override
  ConsumerState<PisoCampHomeScreen> createState() => _PisoCampHomeScreenState();
}

class _PisoCampHomeScreenState extends ConsumerState<PisoCampHomeScreen> {
  late Future<bool> _continued;
  bool _creatingAccount = false;
  @override
  void initState() {
    super.initState();
    _continued = ref.read(guestIdentityServiceProvider).hasContinuedAsGuest();
  }

  Future<void> _continue() async {
    await ref.read(guestIdentityServiceProvider).continueAsGuest();
    if (mounted) {
      setState(() {
        _continued = Future.value(true);
      });
    }
  }

  Future<void> _create(bool offline) async {
    if (_creatingAccount) return;
    setState(() => _creatingAccount = true);
    try {
      final result = await ref.read(requireConsentProvider)(
        context,
        ConsentPurpose.registration,
        online: !offline,
      );
      if (!mounted) return;
      if (result == ConsentGateResult.unavailable) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'The privacy notice is unavailable. No information was collected.',
            ),
          ),
        );
        return;
      }
      if (offline || result == ConsentGateResult.grantedQueued) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Internet connection is required to create an account.',
            ),
          ),
        );
        return;
      }
      if (result == ConsentGateResult.grantedSynced) {
        context.push(AppRoutes.register);
      }
    } finally {
      if (mounted) setState(() => _creatingAccount = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(connectivityStatusProvider, (previous, next) {
      final wasAvailable = previous?.asData?.value;
      final isAvailable = next.asData?.value;
      if (wasAvailable == false && isAvailable == true) {
        final home = ref.read(pisoCampHomeProvider).asData?.value;
        if (home?.isOffline == true) {
          ref.invalidate(pisoCampHomeProvider);
        }
      }
    });
    final state = ref.watch(pisoCampHomeProvider);
    final authenticated = ref.watch(isAuthenticatedProvider);
    final authLoading = ref.watch(authStateProvider).isLoading;
    final transportAvailable = ref
        .watch(connectivityStatusProvider)
        .asData
        ?.value;
    return Scaffold(
      appBar: AppBar(title: const Text('Piso CAMP')),
      body: state.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) =>
            const Center(child: Text('Piso CAMP is unavailable.')),
        data: (result) {
          final offline = result.isOffline || transportAvailable == false;
          if (!result.moduleEnabled) {
            return const Center(
              child: Text('Piso CAMP is currently unavailable.'),
            );
          }
          return SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (offline)
                    Semantics(
                      label: 'Offline',
                      child: Chip(
                        avatar: const Icon(Icons.cloud_off_outlined),
                        label: const Text('Offline'),
                      ),
                    ),
                  Text(
                    result.home.title,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(result.home.introduction),
                  const SizedBox(height: 20),
                  for (final card in result.home.cards) ...[
                    AppCard(
                      child: ListTile(
                        title: Text(card.title),
                        subtitle: Text(card.description),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (!authenticated &&
                      !authLoading &&
                      result.accountPromptEnabled)
                    FutureBuilder<bool>(
                      future: _continued,
                      builder: (_, snapshot) {
                        if (snapshot.connectionState != ConnectionState.done ||
                            snapshot.data == true) {
                          return const SizedBox.shrink();
                        }
                        return AccountPrompt(
                          onCreateAccount: _creatingAccount
                              ? null
                              : () => _create(offline),
                          onContinueAsGuest: _continue,
                        );
                      },
                    ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
