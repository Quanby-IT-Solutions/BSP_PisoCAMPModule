import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/data/pisocamp_profile_repository.dart';
import 'package:mobile/features/pisocamp/data/bundle_sync_controller.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/analytics_sync_controller.dart';
import 'package:mobile/features/pisocamp/presentation/providers/consent_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_registration_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
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
  bool _continuingAsGuest = false;
  @override
  void initState() {
    super.initState();
    _continued = ref.read(guestIdentityServiceProvider).hasContinuedAsGuest();
    _syncCurrencies(BundleSyncTrigger.startup);
    _syncAnalytics(AnalyticsSyncTrigger.startup);
    _emitAnalytics(const ModuleEntryIntent(ModuleEntryPoint.navigation));
  }

  void _syncCurrencies(BundleSyncTrigger trigger) {
    unawaited(
      ref
          .read(currencyBundleSyncProvider.future)
          .then((sync) => sync.sync(trigger))
          .catchError((_) {}),
    );
  }

  void _syncAnalytics(AnalyticsSyncTrigger trigger) {
    const intent = ModuleEntryIntent(ModuleEntryPoint.navigation);
    late Future<AnalyticsSyncController> controller;
    try {
      controller = ref.read(analyticsSyncControllerProvider.future);
    } on Object catch (error) {
      reportAnalyticsFailure(intent, error);
      return;
    }
    emitAnalyticsFuture(intent, () async => (await controller).sync(trigger));
  }

  void _emitAnalytics(AnalyticsIntent intent) {
    final sdk = _readAnalyticsSdk(intent);
    if (sdk != null) emitAnalytics(sdk, intent);
  }

  AnalyticsSdk? _readAnalyticsSdk(AnalyticsIntent intent) {
    try {
      return ref.read(analyticsSdkProvider);
    } on Object catch (error) {
      reportAnalyticsFailure(intent, error);
      return null;
    }
  }

  Future<void> _continue() async {
    if (_continuingAsGuest) return;
    setState(() => _continuingAsGuest = true);
    const intent = AccountPromptGuestIntent();
    final sdk = _readAnalyticsSdk(intent);
    var persisted = false;
    try {
      await ref.read(guestIdentityServiceProvider).continueAsGuest();
      persisted = true;
    } on Object {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Unable to continue as guest. Please try again.'),
          ),
        );
      }
    } finally {
      _continuingAsGuest = false;
      if (mounted) {
        setState(() {
          if (persisted) _continued = Future.value(true);
        });
      }
    }
    if (persisted && sdk != null) emitAnalytics(sdk, intent);
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
        context.push(AppRoutes.pisoCampRegistration);
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
        _syncCurrencies(BundleSyncTrigger.connectivity);
        _syncAnalytics(AnalyticsSyncTrigger.reconnect);
        final home = ref.read(pisoCampHomeProvider).asData?.value;
        if (home?.isOffline == true) {
          ref.invalidate(pisoCampHomeProvider);
        }
      }
    });
    final state = ref.watch(pisoCampHomeProvider);
    final authenticated = ref.watch(isAuthenticatedProvider);
    final profileStatus = authenticated
        ? ref.watch(pisoCampProfileStatusProvider)
        : const AsyncData<PisoCampProfileResult?>(null);
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
                        minTileHeight: 64,
                        trailing: _currencyRoute(card.title) == null
                            ? null
                            : const Icon(Icons.chevron_right),
                        onTap: switch (_currencyRoute(card.title)) {
                          final route? => () => context.push(route),
                          null => null,
                        },
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
                          onContinueAsGuest: _continuingAsGuest
                              ? null
                              : _continue,
                          onShown: () =>
                              _emitAnalytics(const AccountPromptShownIntent()),
                        );
                      },
                    ),
                  if (authenticated && profileStatus.hasError)
                    AppCard(
                      child: ListTile(
                        leading: const Icon(Icons.error_outline),
                        title: const Text('Piso CAMP profile is unavailable.'),
                        subtitle: const Text(
                          'Check your connection and try again.',
                        ),
                        trailing: FilledButton(
                          onPressed: () =>
                              ref.invalidate(pisoCampProfileStatusProvider),
                          child: const Text('Retry'),
                        ),
                      ),
                    ),
                  if (authenticated &&
                      profileStatus.asData?.value?.status ==
                          PisoCampProfileState.missing)
                    AppCard(
                      child: ListTile(
                        leading: const Icon(Icons.person_add_alt_1_outlined),
                        title: const Text('Complete Piso CAMP profile'),
                        subtitle: const Text(
                          'Add the remaining required demographic and location details.',
                        ),
                        trailing: FilledButton(
                          onPressed: _creatingAccount
                              ? null
                              : () => _create(offline),
                          child: const Text('Complete'),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  String? _currencyRoute(String title) {
    return switch (title.trim().toLowerCase()) {
      'banknotes' => AppRoutes.pisoCampBanknotes,
      'coins' => AppRoutes.pisoCampCoins,
      _ => null,
    };
  }
}
