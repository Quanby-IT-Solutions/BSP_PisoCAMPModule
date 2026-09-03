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
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/data/trivia_question_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/data/pisocamp_repository.dart';
import 'package:mobile/features/pisocamp/data/advisory_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/advisory_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/exit_advisory.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/trivia_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/trivia_prompt.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_registration_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/account_prompt.dart';
import 'package:mobile/features/pisocamp/data/leaderboard_repository.dart';
import 'package:mobile/features/pisocamp/data/progress_repository.dart';
import 'package:mobile/features/pisocamp/data/push_repository.dart';
import 'package:mobile/features/pisocamp/presentation/screens/progress_screen.dart';
import 'package:mobile/services/api/api_client.dart';
import 'package:mobile/features/pisocamp/presentation/screens/leaderboard_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/privacy_settings_screen.dart';
import 'package:mobile/shared/widgets/app_card.dart';

class PisoCampHomeScreen extends ConsumerStatefulWidget {
  const PisoCampHomeScreen({super.key});
  @override
  ConsumerState<PisoCampHomeScreen> createState() => _PisoCampHomeScreenState();
}

/// Whether this process has already loaded the module once.
///
/// A cold start pays for the process as well as the module, so the second entry
/// in the same run is a warm one and reporting both as cold would flatter the
/// figures.
bool _moduleLoadedOnceThisProcess = false;

@visibleForTesting
void resetModuleLoadPhaseForTest() {
  _moduleLoadedOnceThisProcess = false;
}

class _PisoCampHomeScreenState extends ConsumerState<PisoCampHomeScreen> {
  late Future<bool> _continued;
  bool _creatingAccount = false;
  bool _continuingAsGuest = false;
  TriviaQuestionDocument? _prompt;

  /// EV-4's advisory, held while it is being read on the way out.
  AdvisoryDocument? _advisory;
  var _advisoryDismissed = false;
  @override
  void initState() {
    super.initState();
    _continued = ref.read(guestIdentityServiceProvider).hasContinuedAsGuest();
    _syncCurrencies(BundleSyncTrigger.startup);
    _syncAnalytics(AnalyticsSyncTrigger.startup);
    _emitAnalytics(const ModuleEntryIntent(ModuleEntryPoint.navigation));
    _reportFirstOpen();
    _measureLoad();
    unawaited(_offerTrivia());
  }

  /// GM-2's module-home trigger.
  ///
  /// Everything it needs is already on the device, so it runs the same way
  /// offline. A failure here is silent by design: a question is an offer, and a
  /// module that could not make one is not a module that should show an error.
  Future<void> _offerTrivia() async {
    try {
      final catalog = await ref.read(currencyCatalogViewProvider.future);
      if (!mounted || catalog.triviaQuestions.isEmpty) return;
      final question = await ref
          .read(triviaPromptCoordinatorProvider)
          .next(catalog.triviaQuestions);
      if (!mounted || question == null) return;
      setState(() => _prompt = question);
    } on Object {
      // No prompt this time.
    }
  }

  /// Opens the topic an incorrect answer offered.
  ///
  /// A push, so the guest comes back to the module rather than being sent away
  /// from it: the prompt was an aside, not a destination.
  void _openTriviaTopic(TriviaRelatedTopic topic) {
    unawaited(
      ref
          .read(currencyCatalogViewProvider.future)
          .then((catalog) {
            if (!mounted) return;
            final target = catalog.resolveTopic(topic.contentItemId);
            if (target == null) return;
            final kind = target.kind == CurrencyContentKind.banknote
                ? CurrencyRouteKind.banknotes
                : CurrencyRouteKind.coins;
            context.push(
              AppRoutes.currencyDetail(
                kind: kind.pathSegment,
                logicalId: target.logicalId,
              ),
              extra: catalog,
            );
          })
          .catchError((_) {}),
    );
  }

  void _finishTrivia(
    TriviaQuestionDocument question,
    TriviaPromptResult result,
  ) {
    setState(() => _prompt = null);
    unawaited(
      ref
          .read(triviaPromptCoordinatorProvider)
          .record(question, result)
          .catchError((_) {}),
    );
  }

  /// AN-11. The first time this install opened the module.
  ///
  /// Claimed from storage so it is emitted once per install rather than once
  /// per launch: an install count that rose every morning would not be an
  /// install count.
  void _reportFirstOpen() {
    const intent = FirstOpenIntent();
    final sdk = _readAnalyticsSdk(intent);
    if (sdk == null) return;
    emitAnalyticsFuture(intent, () async {
      if (await ref.read(guestIdentityServiceProvider).claimFirstOpen()) {
        await sdk.emit(intent);
      }
    });
  }

  /// AN-022. How long the module took to put something on the screen.
  ///
  /// Measured to the first frame rather than to the end of the syncs: what a
  /// person waits for is something to look at, not for the network to finish.
  void _measureLoad() {
    final started = DateTime.now();
    final phase = _moduleLoadedOnceThisProcess
        ? ModuleLoadPhase.warm
        : ModuleLoadPhase.cold;
    _moduleLoadedOnceThisProcess = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _recordTechnical(
        const ModuleLoadIntent(
          phase: ModuleLoadPhase.cold,
          durationMs: 0,
        ),
        (analytics) => analytics.recordLoad(
          phase: phase,
          elapsed: DateTime.now().difference(started),
        ),
      );
    });
  }

  /// AN-024. What failed, and of what kind, when a sync could not finish.
  void _reportNetworkFailure(
    Object error,
    AnalyticsNetworkOperation operation,
  ) {
    final isOnline = ref.read(connectivityStatusProvider).asData?.value ?? true;
    final failureType = networkFailureTypeFor(error, isOnline: isOnline);
    _recordTechnical(
      NetworkFailureIntent(failureType: failureType, operation: operation),
      (analytics) => analytics.recordNetworkFailure(
        failureType: failureType,
        operation: operation,
      ),
    );
  }

  void _recordTechnical(
    AnalyticsIntent intent,
    Future<void> Function(TechnicalAnalytics analytics) record,
  ) {
    final TechnicalAnalytics analytics;
    try {
      analytics = ref.read(technicalAnalyticsProvider);
    } on Object catch (error) {
      reportAnalyticsFailure(intent, error);
      return;
    }
    emitAnalyticsFuture(intent, () => record(analytics));
  }

  void _syncCurrencies(BundleSyncTrigger trigger) {
    unawaited(
      ref
          .read(currencyBundleSyncProvider.future)
          .then((sync) => sync.sync(trigger))
          .catchError((Object error) {
            _reportNetworkFailure(error, AnalyticsNetworkOperation.bundle);
          }),
    );
  }

  void _syncAnalytics(AnalyticsSyncTrigger trigger) {
    const intent = ModuleEntryIntent(ModuleEntryPoint.navigation);
    late Future<AnalyticsSyncController> controller;
    try {
      controller = ref.read(analyticsSyncControllerProvider.future);
    } on Object catch (error) {
      reportAnalyticsFailure(intent, error);
      _reportNetworkFailure(error, AnalyticsNetworkOperation.events);
      return;
    }
    emitAnalyticsFuture(intent, () async {
      try {
        await (await controller).sync(trigger);
      } on Object catch (error) {
        _reportNetworkFailure(error, AnalyticsNetworkOperation.events);
        rethrow;
      }
    });
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
    final prompt = _prompt;
    final advisory = _advisory;
    return PopScope(
      // The advisory interrupts the exit once and then gets out of the way:
      // it is advice, not a gate.
      canPop: _advisoryDismissed || advisory != null,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        unawaited(_offerExitAdvisory());
      },
      child: _buildScaffold(
        context,
        state: state,
        authenticated: authenticated,
        profileStatus: profileStatus,
        authLoading: authLoading,
        transportAvailable: transportAvailable,
        leaderboardEnabled: state.asData?.value.leaderboardEnabled ?? false,
        prompt: prompt,
        advisory: advisory,
      ),
    );
  }

  /// Shows the approved advisory on the way out, if one is due.
  ///
  /// Silent on failure: somebody leaving the module should leave, and an
  /// advisory that could not be read is not a reason to stop them.
  Future<void> _offerExitAdvisory() async {
    try {
      final catalog = await ref.read(currencyCatalogViewProvider.future);
      if (!mounted) return;
      final advisory = await ref
          .read(exitAdvisoryCoordinatorProvider)
          .onExit(catalog.advisories);
      if (!mounted) return;
      if (advisory == null) {
        setState(() => _advisoryDismissed = true);
        if (mounted && Navigator.of(context).canPop()) {
          Navigator.of(context).pop();
        }
        return;
      }
      setState(() => _advisory = advisory);
    } on Object {
      if (!mounted) return;
      setState(() => _advisoryDismissed = true);
      if (mounted && Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      }
    }
  }

  void _dismissAdvisory() {
    setState(() {
      _advisory = null;
      _advisoryDismissed = true;
    });
    if (mounted && Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    }
  }

  Future<void> _openProgress(BuildContext context) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProgressScreen(
          repository: ProgressRepository(ref.read(dioProvider)),
        ),
      ),
    );
  }

  Future<void> _openLeaderboard(BuildContext context) async {
    final authenticated = ref.read(isAuthenticatedProvider);
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => LeaderboardScreen(
          repository: LeaderboardRepository(ref.read(dioProvider)),
          authenticated: authenticated,
        ),
      ),
    );
  }

  Future<void> _openPrivacySettings(BuildContext context) async {
    final notice = await ref
        .read(consentRepositoryProvider)
        .readCachedNotice();
    if (!context.mounted) return;

    if (notice == null) {
      // Without the notice there is nothing to withdraw *against*: a consent
      // record names the version it answered.
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Privacy settings need the module to load once first.'),
        ),
      );
      return;
    }

    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PrivacySettingsScreen(
          consentService: ref.read(consentServiceProvider),
          notice: notice,
          online: ref.read(connectivityStatusProvider).asData?.value ?? false,
          // SA-5. Only for a signed-in person: a subscription belongs to an
          // account, and offering it to a guest would open onto an apology.
          push: ref.read(currentUserProvider) == null
              ? null
              : PushRepository(ref.read(dioProvider)),
        ),
      ),
    );
  }

  Widget _buildScaffold(
    BuildContext context, {
    required AsyncValue<PisoCampHomeLoadResult> state,
    required bool authenticated,
    required AsyncValue<PisoCampProfileResult?> profileStatus,
    required bool authLoading,
    required bool? transportAvailable,
    required bool leaderboardEnabled,
    required TriviaQuestionDocument? prompt,
    required AdvisoryDocument? advisory,
  }) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Piso CAMP'),
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.insights_outlined),
            // GM-5: your own progress, so it only exists once you have an
            // account for it to be about.
            tooltip: 'Progress',
            onPressed: authenticated ? () => _openProgress(context) : null,
          ),
          IconButton(
            icon: const Icon(Icons.leaderboard_outlined),
            // GM-4: hidden entirely when the flag is off, so a switched-off
            // feature is not a door that opens onto an apology.
            tooltip: 'Leaderboard',
            onPressed: leaderboardEnabled ? () => _openLeaderboard(context) : null,
          ),
          IconButton(
            icon: const Icon(Icons.privacy_tip_outlined),
            // SA-7: withdrawing a consent is something somebody has to be able
            // to find, so it lives one tap from the module they gave it in.
            tooltip: 'Privacy',
            onPressed: () => _openPrivacySettings(context),
          ),
        ],
      ),
      bottomSheet: advisory != null
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: ExitAdvisory(
                  advisory: advisory,
                  onDismissed: _dismissAdvisory,
                ),
              ),
            )
          : prompt == null
          ? null
          // A sheet, so the module underneath stays reachable: the prompt is an
          // offer, and dismissing it costs one tap.
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: TriviaPrompt(
                  question: prompt,
                  keepResult: ref.watch(triviaKeepResultProvider),
                  onOpenTopic: (topic) => _openTriviaTopic(topic),
                  onFinished: (result) => _finishTrivia(prompt, result),
                ),
              ),
            ),
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
