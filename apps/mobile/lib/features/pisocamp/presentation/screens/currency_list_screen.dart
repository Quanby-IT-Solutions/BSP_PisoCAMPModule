import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/navigation/app_router.dart';
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
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
              children: [
                _SyncStatus(
                  connected: connected,
                  state: sync.asData?.value,
                  onRetry: () => _sync(BundleSyncTrigger.manual),
                ),
                const SizedBox(height: 16),
                for (final group in groups) ...[
                  Semantics(
                    header: true,
                    child: Text(
                      group.name,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                  const SizedBox(height: 8),
                  for (final document in group.documents)
                    Card(
                      clipBehavior: Clip.antiAlias,
                      child: ListTile(
                        minTileHeight: 64,
                        title: Text(document.title),
                        subtitle: Text(
                          _subtitle(catalog, document),
                          maxLines: 4,
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => context.push(
                          AppRoutes.currencyDetail(
                            kind: widget.kind.pathSegment,
                            logicalId: document.logicalId,
                          ),
                          extra: catalog,
                        ),
                      ),
                    ),
                  const SizedBox(height: 20),
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
    if (connected == false || state?.phase == BundleSyncPhase.paused) {
      return 'Offline — showing saved content';
    }
    return switch (state?.phase) {
      BundleSyncPhase.checking => 'Checking for updates',
      BundleSyncPhase.downloading =>
        'Downloading update — showing saved content',
      BundleSyncPhase.failed =>
        'Saved content remains available. Connect to the internet and Retry to update.',
      BundleSyncPhase.active => 'Saved content is up to date',
      _ => 'Saved content is available',
    };
  }

  IconData _icon() {
    if (connected == false || state?.phase == BundleSyncPhase.paused) {
      return Icons.cloud_off_outlined;
    }
    return switch (state?.phase) {
      BundleSyncPhase.failed => Icons.error_outline,
      BundleSyncPhase.active => Icons.check_circle_outline,
      BundleSyncPhase.checking ||
      BundleSyncPhase.downloading => Icons.sync_outlined,
      _ => Icons.offline_pin_outlined,
    };
  }
}
