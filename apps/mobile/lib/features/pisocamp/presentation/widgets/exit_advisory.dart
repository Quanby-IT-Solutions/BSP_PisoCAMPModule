import 'package:flutter/material.dart';
import 'package:mobile/features/pisocamp/data/advisory_document.dart';

/// EV-4 exit advisory.
///
/// A brief approved word on handling currency properly, shown on the way out.
/// Dismissing it is one tap and always available: it is advice, not a gate, and
/// the exit it interrupts has to proceed.
class ExitAdvisory extends StatelessWidget {
  const ExitAdvisory({
    super.key,
    required this.advisory,
    required this.onDismissed,
    this.onOpenLink,
  });

  final AdvisoryDocument advisory;
  final VoidCallback onDismissed;
  final void Function(AdvisoryLink link)? onOpenLink;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      container: true,
      label: 'Before you go: ${advisory.title}',
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 420),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(advisory.title, style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(advisory.summary),
              const SizedBox(height: 8),
              Text(advisory.body, style: theme.textTheme.bodyMedium),
              if (advisory.links.isNotEmpty) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    for (final link in advisory.links)
                      TextButton(
                        onPressed: onOpenLink == null
                            ? null
                            : () => onOpenLink!(link),
                        child: Text(link.label),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 16),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton(
                  onPressed: onDismissed,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(88, 48),
                  ),
                  child: const Text('Got it'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
