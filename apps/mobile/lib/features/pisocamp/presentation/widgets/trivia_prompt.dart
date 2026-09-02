import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile/features/pisocamp/data/trivia_question_document.dart';
import 'package:mobile/features/pisocamp/presentation/utils/reduced_motion.dart';

/// How long a correct answer stays on screen before the prompt closes itself.
const Duration kTriviaCorrectAutoCloseDelay = Duration(seconds: 5);

/// How a prompt ended.
enum TriviaPromptOutcome { skipped, answeredCorrectly, answeredIncorrectly }

/// The result a prompt reports back.
final class TriviaPromptResult {
  const TriviaPromptResult({required this.outcome, required this.openedTopic});

  final TriviaPromptOutcome outcome;

  /// Whether the guest chose to open the related topic. Only an incorrect
  /// answer is offered one.
  final bool openedTopic;
}

/// GM-2 trivia prompt.
///
/// Skippable at every moment, because the ticket's point is that learning here
/// is offered rather than required: the prompt has a Skip control before an
/// answer and a Close after one, and neither is behind a confirmation.
///
/// A correct answer closes itself after five seconds. A guest who needs longer
/// than five seconds to read a result is exactly the guest an auto-close hurts,
/// so [keepResult] holds it open indefinitely — and reduced motion turns it off
/// too, since a view that disappears under you is motion whether or not it
/// animates.
class TriviaPrompt extends StatefulWidget {
  const TriviaPrompt({
    super.key,
    required this.question,
    required this.onFinished,
    this.keepResult = false,
    this.onOpenTopic,
    this.autoCloseDelay = kTriviaCorrectAutoCloseDelay,
  });

  final TriviaQuestionDocument question;

  /// Called exactly once, when the prompt is done with.
  final ValueChanged<TriviaPromptResult> onFinished;

  /// The accessibility setting that stops a correct result closing itself.
  final bool keepResult;

  /// Opens the related topic. Absent when the question names none.
  final void Function(TriviaRelatedTopic topic)? onOpenTopic;

  final Duration autoCloseDelay;

  @override
  State<TriviaPrompt> createState() => _TriviaPromptState();
}

class _TriviaPromptState extends State<TriviaPrompt> {
  TriviaChoice? _answer;
  Timer? _autoClose;
  bool _finished = false;
  bool _openedTopic = false;

  bool get _answered => _answer != null;
  bool get _correct => _answer?.correct ?? false;

  @override
  void dispose() {
    _autoClose?.cancel();
    super.dispose();
  }

  void _finish(TriviaPromptOutcome outcome) {
    if (_finished) return;
    _finished = true;
    _autoClose?.cancel();
    widget.onFinished(
      TriviaPromptResult(outcome: outcome, openedTopic: _openedTopic),
    );
  }

  void _answerWith(TriviaChoice choice) {
    if (_answered) return;
    setState(() => _answer = choice);
    if (!choice.correct) return;
    if (widget.keepResult || prefersReducedMotion(context)) return;
    _autoClose = Timer(widget.autoCloseDelay, () {
      if (mounted) _finish(TriviaPromptOutcome.answeredCorrectly);
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final question = widget.question;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text(
                question.question,
                style: theme.textTheme.titleMedium,
              ),
            ),
            const SizedBox(height: 8),
            Text(question.summary, style: theme.textTheme.bodyMedium),
            const SizedBox(height: 12),
            for (final choice in question.choices)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 48),
                  child: OutlinedButton(
                    onPressed: _answered ? null : () => _answerWith(choice),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(choice.label, textAlign: TextAlign.left),
                    ),
                  ),
                ),
              ),
            if (_answered) ...[
              const SizedBox(height: 4),
              Semantics(
                liveRegion: true,
                child: Text(
                  _correct ? 'Correct. Well done.' : 'Not quite.',
                  style: theme.textTheme.titleSmall,
                ),
              ),
              if (!_correct) ...[
                const SizedBox(height: 8),
                Text('The answer is: ${question.correctChoice.label}'),
                const SizedBox(height: 8),
                Text(question.explanation),
                for (final topic in question.relatedTopics)
                  ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 48),
                    child: TextButton.icon(
                      onPressed: () {
                        _openedTopic = true;
                        widget.onOpenTopic?.call(topic);
                        _finish(TriviaPromptOutcome.answeredIncorrectly);
                      },
                      icon: const Icon(Icons.arrow_forward),
                      label: Text('Read about ${topic.label}'),
                    ),
                  ),
              ],
            ],
            const SizedBox(height: 4),
            ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 48),
              child: TextButton(
                onPressed: () => _finish(
                  !_answered
                      ? TriviaPromptOutcome.skipped
                      : _correct
                      ? TriviaPromptOutcome.answeredCorrectly
                      : TriviaPromptOutcome.answeredIncorrectly,
                ),
                child: Text(_answered ? 'Close' : 'Skip'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
