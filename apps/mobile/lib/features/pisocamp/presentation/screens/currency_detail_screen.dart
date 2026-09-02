import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/zoomable_currency_image.dart';

class CurrencyDetailScreen extends ConsumerStatefulWidget {
  const CurrencyDetailScreen({
    super.key,
    required this.kind,
    required this.logicalId,
    this.initialCatalog,
  });

  final CurrencyRouteKind kind;
  final String logicalId;
  final CurrencyCatalogView? initialCatalog;

  @override
  ConsumerState<CurrencyDetailScreen> createState() =>
      _CurrencyDetailScreenState();
}

class _CurrencyDetailScreenState extends ConsumerState<CurrencyDetailScreen> {
  late Future<CurrencyCatalogView> _catalog;
  late Future<_ResolvedDetail?> _detail;
  int _generation = 0;
  String? _recordedLogicalId;

  @override
  void initState() {
    super.initState();
    _catalog = widget.initialCatalog == null
        ? ref.read(currencyCatalogViewProvider.future)
        : Future.value(widget.initialCatalog!);
    _detail = _resolve(++_generation);
  }

  @override
  void didUpdateWidget(covariant CurrencyDetailScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final routeChanged =
        oldWidget.kind != widget.kind ||
        oldWidget.logicalId != widget.logicalId;
    final catalogSourceChanged = !identical(
      oldWidget.initialCatalog,
      widget.initialCatalog,
    );
    if (!routeChanged && !catalogSourceChanged) return;
    if (routeChanged) _recordedLogicalId = null;
    if (catalogSourceChanged) {
      final suppliedCatalog = widget.initialCatalog;
      _catalog = suppliedCatalog == null
          ? ref.read(currencyCatalogViewProvider.future)
          : Future.value(suppliedCatalog);
    }
    _detail = _resolve(++_generation);
  }

  Future<_ResolvedDetail?> _resolve(int generation) async {
    final kind = widget.kind;
    final logicalId = widget.logicalId;
    final catalog = await _catalog;
    if (generation != _generation) return null;
    final document = catalog.resolve(kind, logicalId);
    if (document == null) return null;
    if (_recordedLogicalId != document.logicalId) {
      _recordedLogicalId = document.logicalId;
      emitAnalyticsFuture(
        ContentViewIntent(document.logicalId),
        () => ref
            .read(contentViewAnalyticsProvider)
            .recordOpen(document.logicalId),
      );
    }
    return _ResolvedDetail(
      catalog: catalog,
      document: document,
      image: catalog.readImage(document),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.kind.title)),
      body: FutureBuilder<_ResolvedDetail?>(
        future: _detail,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: Text('Opening saved content…'));
          }
          final detail = snapshot.data;
          if (detail == null) return const _UnavailableDetail();
          return _DetailBody(detail: detail);
        },
      ),
    );
  }
}

final class _ResolvedDetail {
  const _ResolvedDetail({
    required this.catalog,
    required this.document,
    required this.image,
  });

  final CurrencyCatalogView catalog;
  final CurrencyContentDocument document;
  final Future<VerifiedCurrencyImage?> image;
}

class _DetailBody extends StatelessWidget {
  const _DetailBody({required this.detail});

  final _ResolvedDetail detail;

  @override
  Widget build(BuildContext context) {
    final document = detail.document;
    final features = detail.catalog.securityFeaturesFor(document);
    return SafeArea(
      child: SingleChildScrollView(
        key: PageStorageKey<String>('currency-detail-${document.logicalId}'),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        child: SelectionArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(
                header: true,
                child: Text(
                  document.title,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                document.summary,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 16),
              if (document.imageSha256 != null && document.imageAlt != null)
                if (detail.catalog.loadedImage(document) case final image?)
                  _CurrencyImage(
                    image: image,
                    alt: document.imageAlt!,
                    features: features,
                  )
                else
                  FutureBuilder<VerifiedCurrencyImage?>(
                    future: detail.image,
                    builder: (context, snapshot) {
                      final image = snapshot.data;
                      return image == null
                          ? const SizedBox.shrink()
                          : _CurrencyImage(
                              image: image,
                              alt: document.imageAlt!,
                              features: features,
                            );
                    },
                  ),
              if (document.hasModel) ...[
                const SizedBox(height: 16),
                _ViewInThreeDimensions(
                  document: document,
                  catalog: detail.catalog,
                ),
              ],
              if (document.hasTactileMap) ...[
                const SizedBox(height: 16),
                _FeelTactileFeatures(
                  document: document,
                  catalog: detail.catalog,
                ),
              ],
              if (document.hasTiltEffect) ...[
                const SizedBox(height: 16),
                _TiltDynamicFeature(
                  document: document,
                  catalog: detail.catalog,
                ),
              ],
              const SizedBox(height: 16),
              Text(document.body),
              if (features.isNotEmpty) ...[
                const SizedBox(height: 24),
                Semantics(
                  header: true,
                  child: Text(
                    'Security features',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                for (final feature in features)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            feature.title,
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          Text(feature.summary),
                          const SizedBox(height: 8),
                          Text(feature.body),
                        ],
                      ),
                    ),
                  ),
              ],
              if (document.relatedLinks.isNotEmpty) ...[
                const SizedBox(height: 24),
                Semantics(
                  header: true,
                  child: Text(
                    'Related information',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                for (final link in document.relatedLinks)
                  _RelatedInformation(link: link, catalog: detail.catalog),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// CE-2 entry point. Offered only when the frozen catalog carries a model for
/// this denomination, so the button never leads to a fallback notice.
class _ViewInThreeDimensions extends StatelessWidget {
  const _ViewInThreeDimensions({required this.document, required this.catalog});

  final CurrencyContentDocument document;
  final CurrencyCatalogView catalog;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 48),
      child: OutlinedButton.icon(
        onPressed: () => context.push(
          AppRoutes.currencyModel(
            kind: CurrencyRouteKind.coins.pathSegment,
            logicalId: document.logicalId,
          ),
          extra: catalog,
        ),
        icon: const Icon(Icons.threed_rotation),
        label: const Text('View in 3D'),
      ),
    );
  }
}

/// CE-4 entry point. Offered only when the frozen catalog carries an approved
/// tactile map for this denomination.
class _FeelTactileFeatures extends StatelessWidget {
  const _FeelTactileFeatures({required this.document, required this.catalog});

  final CurrencyContentDocument document;
  final CurrencyCatalogView catalog;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 48),
      child: OutlinedButton.icon(
        onPressed: () => context.push(
          AppRoutes.currencyTactile(
            kind: CurrencyRouteKind.banknotes.pathSegment,
            logicalId: document.logicalId,
          ),
          extra: catalog,
        ),
        icon: const Icon(Icons.vibration),
        label: const Text('Feel The Tactile Features'),
      ),
    );
  }
}

/// CE-5 entry point. Offered only when the frozen catalog carries an approved
/// tilt effect for this denomination.
class _TiltDynamicFeature extends StatelessWidget {
  const _TiltDynamicFeature({required this.document, required this.catalog});

  final CurrencyContentDocument document;
  final CurrencyCatalogView catalog;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 48),
      child: OutlinedButton.icon(
        onPressed: () => context.push(
          AppRoutes.currencyTilt(
            kind: CurrencyRouteKind.banknotes.pathSegment,
            logicalId: document.logicalId,
          ),
          extra: catalog,
        ),
        icon: const Icon(Icons.screen_rotation),
        label: const Text('Tilt To See The Dynamic Feature'),
      ),
    );
  }
}

class _CurrencyImage extends StatelessWidget {
  const _CurrencyImage({
    required this.image,
    required this.alt,
    required this.features,
  });

  final VerifiedCurrencyImage image;
  final String alt;
  final List<CurrencyContentDocument> features;

  @override
  Widget build(BuildContext context) {
    return ZoomableCurrencyImage(image: image, alt: alt, features: features);
  }
}

class _RelatedInformation extends StatelessWidget {
  const _RelatedInformation({required this.link, required this.catalog});

  final CurrencyRelatedLink link;
  final CurrencyCatalogView catalog;

  @override
  Widget build(BuildContext context) {
    if (link.kind == CurrencyRelatedLinkKind.external && link.url != null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(link.label, style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 4),
              Text(link.url.toString(), softWrap: true),
              const SizedBox(height: 4),
              const Text('BSP HTTPS address — shown for reference'),
            ],
          ),
        ),
      );
    }

    final target = switch (link.kind) {
      CurrencyRelatedLinkKind.internal => catalog.resolveInternalRoute(
        link.route,
      ),
      CurrencyRelatedLinkKind.topic => catalog.resolveTopic(
        link.targetContentItemId,
      ),
      CurrencyRelatedLinkKind.external => null,
    };
    final targetKind = target == null
        ? null
        : target.kind == CurrencyContentKind.banknote
        ? CurrencyRouteKind.banknotes
        : target.kind == CurrencyContentKind.coin
        ? CurrencyRouteKind.coins
        : null;
    if (target == null || targetKind == null) return const SizedBox.shrink();
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 48),
      child: TextButton.icon(
        onPressed: () => context.push(
          AppRoutes.currencyDetail(
            kind: targetKind.pathSegment,
            logicalId: target.logicalId,
          ),
          extra: catalog,
        ),
        icon: const Icon(Icons.arrow_forward),
        label: Text(link.label),
      ),
    );
  }
}

class _UnavailableDetail extends StatelessWidget {
  const _UnavailableDetail();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Center(
        child: Semantics(
          header: true,
          child: Text(
            'Currency content unavailable',
            style: Theme.of(context).textTheme.titleLarge,
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
