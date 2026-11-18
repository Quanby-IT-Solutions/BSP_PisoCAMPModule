import 'package:flutter/material.dart';
import 'package:mobile/core/theme/app_styles.dart';
import 'package:mobile/features/pisocamp/data/progress_repository.dart';
import 'package:mobile/shared/widgets/inset_list_card.dart';

/// GM-5's screen: what one person has done, and nothing about anybody else.
class ProgressScreen extends StatefulWidget {
  const ProgressScreen({super.key, required this.repository});

  final ProgressRepository repository;

  @override
  State<ProgressScreen> createState() => _ProgressScreenState();
}

class _ProgressScreenState extends State<ProgressScreen> {
  ProgressLoadResult? _result;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final result = await widget.repository.load();
    if (!mounted) return;
    setState(() {
      _result = result;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final progress = _result?.progress;

    return Scaffold(
      appBar: AppBar(title: const Text('Progress')),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.s16),
                children: <Widget>[
                  if (_result?.isOffline ?? false)
                    const _StaleNotice(
                      // Said out loud: figures somebody believes are current
                      // and are not are worse than no figures.
                      'Offline — showing what was last synced.',
                    ),
                  if (progress == null)
                    const Padding(
                      padding: EdgeInsets.symmetric(
                        horizontal: AppSpacing.pageGutter,
                        vertical: AppSpacing.s24,
                      ),
                      child: Text(
                        'Your progress will appear here once you have been '
                        'online at least once.',
                      ),
                    )
                  else
                    // One plane with eight bands rather than eight cards. The
                    // figures are one reading of one person's activity, and
                    // separate cards would claim they were eight unrelated
                    // facts.
                    InsetListCard(
                      children: <Widget>[
                        _Figure(
                          label: 'Topics viewed',
                          value: '${progress.topicsViewed}',
                        ),
                        _Figure(
                          label: 'Topics with questions',
                          value: '${progress.topicsAnswered}',
                        ),
                        _Figure(
                          label: 'Questions answered',
                          value: '${progress.questionsAnswered}',
                        ),
                        _Figure(
                          label: 'Answered correctly',
                          value: '${progress.questionsCorrect}',
                        ),
                        _Figure(
                          label: 'Skipped',
                          value: '${progress.questionsSkipped}',
                        ),
                        _Figure(
                          label: 'Accuracy',
                          value:
                              '${progress.accuracyPercent.toStringAsFixed(progress.accuracyPercent % 1 == 0 ? 0 : 2)}%',
                        ),
                        _Figure(label: 'Points', value: '${progress.points}'),
                        _Figure(
                          label: 'Last activity',
                          // Nothing yet is said in words, not as a blank.
                          value: progress.lastActivityAt ?? 'Nothing yet',
                        ),
                      ],
                    ),
                ],
              ),
      ),
    );
  }
}

/// A band saying the module is showing something it could not re-check.
class _StaleNotice extends StatelessWidget {
  const _StaleNotice(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.fromLTRB(
        AppSpacing.cardGutter,
        0,
        AppSpacing.cardGutter,
        AppSpacing.s16,
      ),
      padding: const EdgeInsets.all(AppSpacing.s16),
      decoration: BoxDecoration(
        color: colors.secondaryContainer,
        borderRadius: AppRadii.cardRadius,
      ),
      child: Text(
        message,
        style: TextStyle(color: colors.onSecondaryContainer),
      ),
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Semantics(
      label: '$label: $value',
      child: ExcludeSemantics(
        child: InsetListRow(
          title: label,
          // The figure carries the weight, not the label beside it: this is a
          // screen somebody reads by scanning the right-hand column.
          trailing: Text(
            value,
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
              color: theme.colorScheme.primary,
            ),
          ),
        ),
      ),
    );
  }
}
