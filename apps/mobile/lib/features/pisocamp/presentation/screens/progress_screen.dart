import 'package:flutter/material.dart';
import 'package:mobile/features/pisocamp/data/progress_repository.dart';

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
                padding: const EdgeInsets.all(16),
                children: <Widget>[
                  if (_result?.isOffline ?? false)
                    Card(
                      color: Theme.of(context).colorScheme.surfaceContainerHighest,
                      child: const Padding(
                        padding: EdgeInsets.all(16),
                        child: Text(
                          // Said out loud: figures somebody believes are current
                          // and are not are worse than no figures.
                          'Offline — showing what was last synced.',
                        ),
                      ),
                    ),
                  if (progress == null)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: Text(
                        'Your progress will appear here once you have been '
                        'online at least once.',
                      ),
                    )
                  else ...<Widget>[
                    _Figure(label: 'Topics viewed', value: '${progress.topicsViewed}'),
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
                    _Figure(label: 'Skipped', value: '${progress.questionsSkipped}'),
                    _Figure(
                      label: 'Accuracy',
                      value:
                          '${progress.accuracyPercent.toStringAsFixed(progress.accuracyPercent % 1 == 0 ? 0 : 2)}%',
                    ),
                    _Figure(label: 'Points', value: '${progress.points}'),
                    _Figure(
                      label: 'Last activity',
                      // Nothing yet is said in words rather than as a blank.
                      value: progress.lastActivityAt ?? 'Nothing yet',
                    ),
                  ],
                ],
              ),
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
    return Semantics(
      label: '$label: $value',
      child: ExcludeSemantics(
        child: Card(
          child: ListTile(title: Text(label), trailing: Text(value)),
        ),
      ),
    );
  }
}
