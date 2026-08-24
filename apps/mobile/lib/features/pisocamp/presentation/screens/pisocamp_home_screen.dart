import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/features/auth/presentation/providers/auth_provider.dart';
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

  void _create(bool offline) {
    if (offline) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Internet connection is required to create an account.',
          ),
        ),
      );
    } else {
      context.push(AppRoutes.register);
    }
  }

  @override
  Widget build(BuildContext context) {
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
                          onCreateAccount: () => _create(offline),
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
