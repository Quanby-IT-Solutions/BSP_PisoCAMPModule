import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/theme/app_styles.dart';
import 'package:mobile/shared/widgets/inset_list_card.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/link_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/data/survey_document.dart';
import 'package:mobile/features/pisocamp/data/survey_triggers.dart';
import 'package:mobile/features/pisocamp/presentation/providers/survey_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/survey_prompt.dart';
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

  /// EV-2's seeded trigger: the survey for the topic just read, if there is
  /// one. Held here so it is offered once per visit rather than per rebuild.
  SurveyDocument? _survey;
  SurveyConsentStanding? _standing;
  String? _offeredForItemId;

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
    // A seed document has no content item id; only a published one does, and
    // only a published topic can be the subject of a survey.
    final itemId = document.contentItemId;
    if (itemId != null) unawaited(_offerSurvey(catalog, itemId));
    return _ResolvedDetail(
      catalog: catalog,
      document: document,
      image: catalog.readImage(document),
    );
  }

  /// Offers the survey whose subject is this topic.
  ///
  /// Silent on failure by design: a survey is an offer, and a module that
  /// could not make one is not a module that should show an error.
  Future<void> _offerSurvey(CurrencyCatalogView catalog, String itemId) async {
    if (_offeredForItemId == itemId) return;
    _offeredForItemId = itemId;
    try {
      final survey = await ref
          .read(surveyTriggerCoordinatorProvider)
          .fire(
            trigger: SurveyTriggerType.topicCompletion,
            surveys: catalog.surveys,
            subjectContentItemId: itemId,
          );
      if (survey == null || !mounted) return;
      final standing = await ref
          .read(surveyConsentCoordinatorProvider)
          .standing();
      // No notice means consent cannot be asked for at all, so the survey is
      // not offered rather than offered and then abandoned.
      if (!mounted || (!standing.granted && standing.notice == null)) return;
      await ref.read(surveyPromptCoordinatorProvider).recordShown(survey);
      if (!mounted) return;
      setState(() {
        _survey = survey;
        _standing = standing;
      });
    } on Object {
      // No survey this time.
    }
  }

  Future<void> _finishSurvey(
    SurveyDocument survey,
    SurveyPromptResult result,
  ) async {
    final standing = _standing;
    setState(() {
      _survey = null;
      _standing = null;
    });
    try {
      await ref
          .read(surveyPromptCoordinatorProvider)
          .record(survey, result, consentRecordId: standing?.consentRecordId);
    } on Object {
      // The answer is queued or it is not; either way the module carries on.
    }
  }

  @override
  Widget build(BuildContext context) {
    final survey = _survey;
    final standing = _standing;
    return Scaffold(
      appBar: AppBar(title: Text(widget.kind.title)),
      bottomSheet: survey == null || standing == null
          ? null
          // A sheet, so the topic underneath stays readable: the survey is an
          // offer, and declining it costs one tap.
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: SurveyPrompt(
                  survey: survey,
                  consent: SurveyConsentGate(
                    alreadyGranted: standing.granted,
                    noticeTitle: standing.notice?.title ?? 'Privacy notice',
                    noticeBody: standing.notice?.body ?? '',
                    onDecision: ({required bool granted}) async {
                      final notice = standing.notice;
                      if (notice == null) return false;
                      final recordId = await ref
                          .read(surveyConsentCoordinatorProvider)
                          .record(notice: notice, granted: granted);
                      if (recordId == null) return false;
                      setState(
                        () => _standing = SurveyConsentStanding(
                          granted: true,
                          consentRecordId: recordId,
                          notice: notice,
                        ),
                      );
                      return true;
                    },
                  ),
                  onFinished: (result) =>
                      unawaited(_finishSurvey(survey, result)),
                ),
              ),
            ),
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

    // The interactive entry points, gathered into one grouped card instead of
    // left as a stack of identical full-width buttons. Four buttons of equal
    // weight say nothing about which is worth opening, and none of them says
    // what happens after the tap; a row carries a subtitle that does.
    final explore = <Widget>[
      if (document.hasModel) ...[
        _ViewInThreeDimensions(document: document, catalog: detail.catalog),
        _PlaceInYourRoom(document: document),
      ],
      if (document.hasTactileMap)
        _FeelTactileFeatures(document: document, catalog: detail.catalog),
      if (document.hasTiltEffect)
        _TiltDynamicFeature(document: document, catalog: detail.catalog),
    ];

    return SafeArea(
      child: SingleChildScrollView(
        key: PageStorageKey<String>('currency-detail-${document.logicalId}'),
        // Vertical only. Prose takes the 24pt page gutter and the grouped
        // cards take the 16pt card gutter, so a card overhangs the text
        // column on both sides rather than lining up with it — which is the
        // whole of what makes it read as a plane under the copy.
        padding: const EdgeInsets.only(
          top: AppSpacing.s12,
          bottom: AppSpacing.s32,
        ),
        child: SelectionArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Gutter(
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
                    const SizedBox(height: AppSpacing.s8),
                    Text(
                      document.summary,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.s16),
              if (document.imageSha256 != null && document.imageAlt != null)
                if (detail.catalog.loadedImage(document) case final image?)
                  _Gutter(
                    child: _CurrencyImage(
                      image: image,
                      alt: document.imageAlt!,
                      features: features,
                    ),
                  )
                else
                  _Gutter(
                    child: FutureBuilder<VerifiedCurrencyImage?>(
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
                  ),
              if (explore.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.s24),
                const _Gutter(child: _SectionHeading('Ways to explore')),
                const SizedBox(height: AppSpacing.s8),
                InsetListCard(children: explore),
              ],
              const SizedBox(height: AppSpacing.s24),
              _Gutter(child: Text(document.body)),
              if (features.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.s24),
                const _Gutter(child: _SectionHeading('Security features')),
                const SizedBox(height: AppSpacing.s8),
                InsetListCard(
                  children: <Widget>[
                    for (final feature in features)
                      _SecurityFeature(feature: feature),
                  ],
                ),
              ],
              if (document.relatedLinks.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.s24),
                const _Gutter(child: _SectionHeading('Related information')),
                for (final link in document.relatedLinks)
                  _Gutter(
                    child: _RelatedInformation(
                      link: link,
                      catalog: detail.catalog,
                      logicalId: document.logicalId,
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Page copy sits on the 24pt gutter. Grouped cards deliberately do not.
class _Gutter extends StatelessWidget {
  const _Gutter({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.pageGutter),
      child: child,
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      header: true,
      child: Text(title, style: Theme.of(context).textTheme.titleLarge),
    );
  }
}

/// One security feature, as a band inside the grouped card.
///
/// Not a row: a feature carries a title, a summary and a body, which is more
/// than [InsetListRow]'s one-line subtitle is shaped for.
class _SecurityFeature extends StatelessWidget {
  const _SecurityFeature({required this.feature});

  final CurrencyContentDocument feature;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(feature.title, style: theme.textTheme.titleMedium),
          const SizedBox(height: AppSpacing.s8),
          Text(feature.summary),
          const SizedBox(height: AppSpacing.s8),
          Text(
            feature.body,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
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
    return InsetListRow(
      leading: const RowBadge(child: Icon(Icons.threed_rotation)),
      title: 'View in 3D',
      subtitle: 'Turn the coin and look at any face',
      onTap: () => context.push(
        AppRoutes.currencyModel(
          kind: CurrencyRouteKind.coins.pathSegment,
          logicalId: document.logicalId,
        ),
        extra: catalog,
      ),
    );
  }
}

/// AR-1 entry point.
///
/// Offered wherever a 3D model exists, because the AR screen itself explains an
/// unsupported device and hands the person to that same model. Deciding here
/// whether the phone can run AR would mean asking the camera stack a question
/// before anybody has said they want it.
class _PlaceInYourRoom extends StatelessWidget {
  const _PlaceInYourRoom({required this.document});

  final CurrencyContentDocument document;

  @override
  Widget build(BuildContext context) {
    return InsetListRow(
      leading: const RowBadge(child: Icon(Icons.view_in_ar)),
      title: 'Place in your room',
      subtitle: 'See it at life size through the camera',
      onTap: () => context.push(
        AppRoutes.currencyAr(
          kind: CurrencyRouteKind.coins.pathSegment,
          logicalId: document.logicalId,
        ),
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
    return InsetListRow(
      leading: const RowBadge(child: Icon(Icons.vibration)),
      title: 'Feel The Tactile Features',
      subtitle: 'Vibration marks the raised areas as you trace them',
      onTap: () => context.push(
        AppRoutes.currencyTactile(
          kind: CurrencyRouteKind.banknotes.pathSegment,
          logicalId: document.logicalId,
        ),
        extra: catalog,
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
    return InsetListRow(
      leading: const RowBadge(child: Icon(Icons.screen_rotation)),
      title: 'Tilt To See The Dynamic Feature',
      subtitle: 'Watch the ink change colour as the note moves',
      onTap: () => context.push(
        AppRoutes.currencyTilt(
          kind: CurrencyRouteKind.banknotes.pathSegment,
          logicalId: document.logicalId,
        ),
        extra: catalog,
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

class _RelatedInformation extends ConsumerWidget {
  const _RelatedInformation({
    required this.link,
    required this.catalog,
    required this.logicalId,
  });

  final CurrencyRelatedLink link;
  final CurrencyCatalogView catalog;
  final String logicalId;

  Future<void> _openExternal(BuildContext context, WidgetRef ref) async {
    final url = link.url!;
    emitAnalyticsFuture(
      LinkOpenIntent(
        linkType: AnalyticsLinkType.external,
        logicalId: logicalId,
      ),
      () => ref
          .read(linkAnalyticsProvider)
          .recordOpen(AnalyticsLinkType.external, logicalId),
    );
    final outcome = await ref.read(pisoCampLinkServiceProvider).open(url);
    if (outcome.opened || !context.mounted) return;
    // A device with no browser is a device limitation, not a dead end: the
    // address stays on screen so it can still be read or copied.
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'This device could not open the link. The address is shown above.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
              const SizedBox(height: 8),
              ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 48),
                child: OutlinedButton.icon(
                  onPressed: () => unawaited(_openExternal(context, ref)),
                  icon: const Icon(Icons.open_in_new),
                  label: Text('Open ${link.label}'),
                ),
              ),
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
        onPressed: () {
          emitAnalyticsFuture(
            LinkOpenIntent(
              linkType: link.kind == CurrencyRelatedLinkKind.internal
                  ? AnalyticsLinkType.internal
                  : AnalyticsLinkType.topic,
              logicalId: logicalId,
            ),
            () => ref
                .read(linkAnalyticsProvider)
                .recordOpen(
                  link.kind == CurrencyRelatedLinkKind.internal
                      ? AnalyticsLinkType.internal
                      : AnalyticsLinkType.topic,
                  logicalId,
                ),
          );
          // A push, not a replace: back returns to the content that linked
          // here, which is what the criterion asks for.
          context.push(
            AppRoutes.currencyDetail(
              kind: targetKind.pathSegment,
              logicalId: target.logicalId,
            ),
            extra: catalog,
          );
        },
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
