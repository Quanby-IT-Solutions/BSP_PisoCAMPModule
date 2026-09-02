import 'package:flutter/material.dart';
import 'package:mobile/features/pisocamp/data/survey_document.dart';
import 'package:mobile/features/pisocamp/data/survey_response.dart';

/// What a person did with the prompt.
final class SurveyPromptResult {
  const SurveyPromptResult.declinedPrompt()
    : outcome = SurveyOutcome.declinedPrompt,
      answers = const [];

  const SurveyPromptResult.declinedNotice()
    : outcome = SurveyOutcome.declinedNotice,
      answers = const [];

  const SurveyPromptResult.submitted(this.answers)
    : outcome = SurveyOutcome.submitted;

  final SurveyOutcome outcome;
  final List<SurveyAnswer> answers;
}

/// What the prompt needs to know about consent, and how to record a decision.
final class SurveyConsentGate {
  const SurveyConsentGate({
    required this.alreadyGranted,
    required this.noticeTitle,
    required this.noticeBody,
    required this.onDecision,
  });

  /// Whether a current grant already exists, in which case no notice is shown.
  final bool alreadyGranted;

  final String noticeTitle;
  final String noticeBody;

  /// Records the decision and reports whether the survey may proceed.
  final Future<bool> Function({required bool granted}) onDecision;
}

/// EV-2 survey pop-up.
///
/// Declining is always one tap and never behind a confirmation: the ticket's
/// point is that the survey is offered, and a person who says no goes back to
/// what they were doing. Nothing at all is collected on that path — not an
/// answer, not a consent record, not a partially filled form.
class SurveyPrompt extends StatefulWidget {
  const SurveyPrompt({
    super.key,
    required this.survey,
    required this.consent,
    required this.onFinished,
  });

  final SurveyDocument survey;
  final SurveyConsentGate consent;
  final ValueChanged<SurveyPromptResult> onFinished;

  @override
  State<SurveyPrompt> createState() => _SurveyPromptState();
}

enum _Stage { invitation, notice, questions, thanks }

class _SurveyPromptState extends State<SurveyPrompt> {
  _Stage _stage = _Stage.invitation;
  final Map<String, int> _scores = {};
  final Map<String, TextEditingController> _written = {};
  String? _error;
  var _finished = false;
  var _recording = false;

  @override
  void dispose() {
    for (final controller in _written.values) {
      controller.dispose();
    }
    super.dispose();
  }

  TextEditingController _controllerFor(String questionId) =>
      _written.putIfAbsent(questionId, TextEditingController.new);

  void _finish(SurveyPromptResult result) {
    if (_finished) return;
    _finished = true;
    widget.onFinished(result);
  }

  Future<void> _beginAnswering() async {
    if (widget.consent.alreadyGranted) {
      setState(() => _stage = _Stage.questions);
      return;
    }
    setState(() => _stage = _Stage.notice);
  }

  Future<void> _decideConsent({required bool granted}) async {
    if (_recording) return;
    setState(() => _recording = true);
    final mayProceed = await widget.consent.onDecision(granted: granted);
    if (!mounted) return;
    setState(() => _recording = false);
    if (!granted) {
      _finish(const SurveyPromptResult.declinedNotice());
      return;
    }
    if (!mayProceed) {
      // Consent could not be recorded, so nothing may be collected. Saying so
      // is better than showing a form whose answers would be thrown away.
      setState(
        () => _error =
            'We could not record your consent just now, so the survey was not started.',
      );
      _finish(const SurveyPromptResult.declinedNotice());
      return;
    }
    setState(() => _stage = _Stage.questions);
  }

  void _submit() {
    final answers = <SurveyAnswer>[];
    for (final question in widget.survey.questions) {
      switch (question.kind) {
        case SurveyQuestionKind.text:
          final written = _controllerFor(question.id).text.trim();
          if (written.isEmpty) {
            if (question.required) {
              setState(() => _error = 'Please answer: ${question.prompt}');
              return;
            }
            answers.add(SurveySkippedAnswer(questionId: question.id));
          } else {
            answers.add(
              SurveyTextAnswer(questionId: question.id, value: written),
            );
          }
        case SurveyQuestionKind.rating:
        case SurveyQuestionKind.nps:
          final score = _scores[question.id];
          if (score == null) {
            if (question.required) {
              setState(() => _error = 'Please answer: ${question.prompt}');
              return;
            }
            answers.add(SurveySkippedAnswer(questionId: question.id));
          } else {
            answers.add(
              SurveyScaleAnswer(questionId: question.id, value: score),
            );
          }
      }
    }
    setState(() {
      _error = null;
      _stage = _Stage.thanks;
    });
    _finish(SurveyPromptResult.submitted(answers));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      container: true,
      label: 'Survey: ${widget.survey.title}',
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 520),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(widget.survey.title, style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              ...switch (_stage) {
                _Stage.invitation => _invitation(theme),
                _Stage.notice => _notice(theme),
                _Stage.questions => _questions(theme),
                _Stage.thanks => _thanks(theme),
              },
              if (_error != null) ...[
                const SizedBox(height: 8),
                Semantics(
                  liveRegion: true,
                  child: Text(
                    _error!,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.error,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _invitation(ThemeData theme) => [
    Text(widget.survey.summary),
    const SizedBox(height: 8),
    Text(widget.survey.body, style: theme.textTheme.bodySmall),
    const SizedBox(height: 12),
    Wrap(
      spacing: 12,
      runSpacing: 8,
      children: [
        FilledButton(
          onPressed: _beginAnswering,
          child: const Text('Answer the survey'),
        ),
        TextButton(
          // One tap, no confirmation: declining is not a mistake to guard
          // against, it is the offer being declined.
          onPressed: () => _finish(const SurveyPromptResult.declinedPrompt()),
          child: const Text('Not now'),
        ),
      ],
    ),
  ];

  List<Widget> _notice(ThemeData theme) => [
    Text(widget.consent.noticeTitle, style: theme.textTheme.titleSmall),
    const SizedBox(height: 8),
    Text(widget.consent.noticeBody),
    const SizedBox(height: 12),
    Wrap(
      spacing: 12,
      runSpacing: 8,
      children: [
        FilledButton(
          onPressed: _recording ? null : () => _decideConsent(granted: true),
          child: const Text('I agree'),
        ),
        TextButton(
          onPressed: _recording ? null : () => _decideConsent(granted: false),
          child: const Text('No thanks'),
        ),
      ],
    ),
  ];

  List<Widget> _questions(ThemeData theme) => [
    for (final question in widget.survey.questions) ...[
      const SizedBox(height: 12),
      Text(
        question.required ? '${question.prompt} *' : question.prompt,
        style: theme.textTheme.bodyLarge,
      ),
      const SizedBox(height: 6),
      if (question.kind == SurveyQuestionKind.text)
        TextField(
          controller: _controllerFor(question.id),
          maxLength: 1000,
          maxLines: 3,
          decoration: InputDecoration(
            labelText: question.prompt,
            border: const OutlineInputBorder(),
          ),
        )
      else ...[
        Text(
          '${question.scaleMin} = ${question.lowLabel}, '
          '${question.scaleMax} = ${question.highLabel}',
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (
              var score = question.scaleMin;
              score <= question.scaleMax;
              score += 1
            )
              _ScoreButton(
                score: score,
                prompt: question.prompt,
                selected: _scores[question.id] == score,
                onPressed: () => setState(() => _scores[question.id] = score),
              ),
          ],
        ),
      ],
    ],
    const SizedBox(height: 16),
    Wrap(
      spacing: 12,
      runSpacing: 8,
      children: [
        FilledButton(onPressed: _submit, child: const Text('Submit')),
        TextButton(
          onPressed: () => _finish(const SurveyPromptResult.declinedPrompt()),
          child: const Text('Cancel'),
        ),
      ],
    ),
  ];

  List<Widget> _thanks(ThemeData theme) => [
    Semantics(
      liveRegion: true,
      child: const Text('Thank you. Your answers have been recorded.'),
    ),
  ];
}

/// One point on a scale, sized as a touch target and named for a screen reader.
class _ScoreButton extends StatelessWidget {
  const _ScoreButton({
    required this.score,
    required this.prompt,
    required this.selected,
    required this.onPressed,
  });

  final int score;
  final String prompt;
  final bool selected;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      inMutuallyExclusiveGroup: true,
      selected: selected,
      button: true,
      label: '$prompt: $score',
      child: ExcludeSemantics(
        child: SizedBox(
          width: 48,
          height: 48,
          child: selected
              ? FilledButton(
                  onPressed: onPressed,
                  style: FilledButton.styleFrom(
                    padding: EdgeInsets.zero,
                    minimumSize: const Size(48, 48),
                  ),
                  child: Text('$score'),
                )
              : OutlinedButton(
                  onPressed: onPressed,
                  style: OutlinedButton.styleFrom(
                    padding: EdgeInsets.zero,
                    minimumSize: const Size(48, 48),
                  ),
                  child: Text('$score'),
                ),
        ),
      ),
    );
  }
}
