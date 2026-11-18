import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/core/theme/app_styles.dart';
import 'package:mobile/shared/widgets/inset_list_card.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/features/pisocamp/data/bundle_sync_controller.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';

class CurrencyListScreen extends ConsumerStatefulWidget {
  const CurrencyListScreen({
    super.key,
    required this.kind,
    this.initialCatalog,
  });

  final CurrencyRouteKind kind;
  final CurrencyCatalogView? initialCatalog;

  @override
  ConsumerState<CurrencyListScreen> createState() => _CurrencyListScreenState();
}

class _CurrencyListScreenState extends ConsumerState<CurrencyListScreen> {
  late Future<CurrencyCatalogView> _catalog;

  @override
  void initState() {
    super.initState();
    _catalog = widget.initialCatalog == null
        ? ref.read(currencyCatalogViewProvider.future)
        : Future.value(widget.initialCatalog!);
    _sync(BundleSyncTrigger.startup);
  }

  void _sync(BundleSyncTrigger trigger) {
    unawaited(
      ref
          .read(currencyBundleSyncProvider.future)
          .then((sync) => sync.sync(trigger))
          .catchError((_) {}),
    );
  }

  void _retryCatalog() {
    setState(() {
      _catalog = ref.refresh(currencyCatalogViewProvider.future);
    });
    _sync(BundleSyncTrigger.manual);
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(connectivityStatusProvider, (previous, next) {
      if (previous?.asData?.value == false && next.asData?.value == true) {
        _sync(BundleSyncTrigger.connectivity);
      }
    });
    final connected = ref.watch(connectivityStatusProvider).asData?.value;
    final sync = ref.watch(currencyBundleSyncStateProvider);
    return Scaffold(
      appBar: AppBar(title: Text(widget.kind.title)),
      body: FutureBuilder<CurrencyCatalogView>(
        future: _catalog,
        builder: (context, snapshot) {
          final catalog = snapshot.data;
          if (catalog == null) {
            if (snapshot.hasError) return _Unavailable(onRetry: _retryCatalog);
            return const Center(child: Text('Opening saved content…'));
          }
          final groups = catalog.seriesFor(widget.kind);
          if (groups.isEmpty) return _Unavailable(onRetry: _retryCatalog);
          return SafeArea(
            child: ListView(
              key: PageStorageKey<String>(
                'currency-${widget.kind.pathSegment}-${catalog.snapshot.version}',
              ),
              padding: const EdgeInsets.only(top: 12, bottom: 32),
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.cardGutter,
                  ),
                  child: _SyncStatus(
                    connected: connected,
                    state: sync.asData?.value,
                    onRetry: () => _sync(BundleSyncTrigger.manual),
                  ),
                ),
                const SizedBox(height: AppSpacing.s24),
                // A series is one grouped plane rather than a run of separate
                // cards: the denominations belong to the series, and stacking
                // them as individual objects loses that relationship.
                for (final group in groups) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.pageGutter,
                      0,
                      AppSpacing.pageGutter,
                      AppSpacing.s8,
                    ),
                    child: Semantics(
                      header: true,
                      child: Text(
                        group.name,
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                    ),
                  ),
                  InsetListCard(
                    children: <Widget>[
                      for (final document in group.documents)
                        InsetListRow(
                          title: document.title,
                          subtitle: _subtitle(catalog, document),
                          leading: RowBadge(
                            child: Icon(
                              widget.kind == CurrencyRouteKind.coins
                                  ? Icons.monetization_on_outlined
                                  : Icons.account_balance_wallet_outlined,
                            ),
                          ),
                          trailing: const Icon(Icons.chevron_right, size: 20),
                          onTap: () => context.push(
                            AppRoutes.currencyDetail(
                              kind: widget.kind.pathSegment,
                              logicalId: document.logicalId,
                            ),
                            extra: catalog,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.s24),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  String _subtitle(
    CurrencyCatalogView catalog,
    CurrencyContentDocument document,
  ) {
    final features = catalog.securityFeaturesFor(document).length;
    return features == 0
        ? document.summary
        : '${document.summary}\n$features security feature ${features == 1 ? 'article' : 'articles'}';
  }
}

class _Unavailable extends StatelessWidget {
  const _Unavailable({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Semantics(
                header: true,
                child: Text(
                  'Currency content unavailable',
                  style: Theme.of(context).textTheme.titleLarge,
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Saved currency content could not be opened safely.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              Semantics(
                container: true,
                button: true,
                label: 'Retry currency update',
                onTap: onRetry,
                child: ExcludeSemantics(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(
                      minHeight: 48,
                      minWidth: 48,
                    ),
                    child: FilledButton(
                      onPressed: onRetry,
                      child: const Text('Retry'),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SyncStatus extends StatelessWidget {
  const _SyncStatus({
    required this.connected,
    required this.state,
    required this.onRetry,
  });

  final bool? connected;
  final BundleSyncState? state;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final message = _message();
    return Semantics(
      container: true,
      explicitChildNodes: true,
      liveRegion: true,
      label: message,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              ExcludeSemantics(child: Icon(_icon())),
              const SizedBox(width: 8),
              Expanded(child: ExcludeSemantics(child: Text(message))),
              const SizedBox(width: 8),
              Semantics(
                container: true,
                button: true,
                label: 'Retry currency update',
                onTap: onRetry,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    minHeight: 48,
                    minWidth: 48,
                  ),
                  child: ExcludeSemantics(
                    child: FilledButton.tonal(
                      onPressed: onRetry,
                      child: const Text('Retry'),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _message() {
    // Only the transport being down is "offline".
    //
    // A paused sync used to be reported as offline too, which told anyone on a
    // working connection something plainly untrue about their own device. The
    // pause means the update service could not be reached — a 503 from the
    // bundle endpoint pauses exactly like a dead network does — and the honest
    // difference is that the connection is fine and the update is not
    // available. Saying "offline" sends somebody to check their wifi over a
    // problem that is not theirs.
    if (connected == false) {
      return 'Offline — showing saved content';
    }
    return switch (state?.phase) {
      BundleSyncPhase.checking => 'Checking for updates',
      BundleSyncPhase.downloading =>
        'Downloading update — showing saved content',
      BundleSyncPhase.paused =>
        'Update unavailable right now — showing saved content',
      BundleSyncPhase.failed =>
        'Saved content remains available. Connect to the internet and Retry to update.',
      BundleSyncPhase.active => 'Saved content is up to date',
      _ => 'Saved content is available',
    };
  }

  IconData _icon() {
    if (connected == false) return Icons.cloud_off_outlined;
    return switch (state?.phase) {
      BundleSyncPhase.failed => Icons.error_outline,
      BundleSyncPhase.active => Icons.check_circle_outline,
      BundleSyncPhase.checking ||
      BundleSyncPhase.downloading => Icons.sync_outlined,
      // Not a cloud with a line through it: nothing is wrong with the
      // connection, only with the update.
      BundleSyncPhase.paused => Icons.sync_problem_outlined,
      _ => Icons.offline_pin_outlined,
    };
  }
}
