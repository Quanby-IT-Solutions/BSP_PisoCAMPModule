import 'package:flutter/material.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_repository.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/shared/widgets/app_button.dart';

class PrivacyNoticeScreen extends StatefulWidget {
  const PrivacyNoticeScreen({
    super.key,
    required this.notice,
    required this.online,
    required this.requiresReconsent,
    required this.onDecision,
  });

  final PrivacyNotice notice;
  final bool online;
  final bool requiresReconsent;
  final Future<ConsentGateResult> Function(ConsentDecision decision) onDecision;

  @override
  State<PrivacyNoticeScreen> createState() => _PrivacyNoticeScreenState();
}

class _PrivacyNoticeScreenState extends State<PrivacyNoticeScreen> {
  bool _submitting = false;
  String? _error;

  Future<void> _submit(ConsentDecision decision) async {
    if (_submitting) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    final result = await widget.onDecision(decision);
    if (!mounted) return;
    if (result == ConsentGateResult.unavailable) {
      setState(() {
        _submitting = false;
        _error =
            'Your choice could not be saved. No information was collected.';
      });
      return;
    }
    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop(result);
    } else {
      setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final notice = widget.notice;
    return Scaffold(
      appBar: AppBar(title: const Text('Privacy Notice')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                notice.title,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              Text('Version ${notice.version}'),
              Text('Effective ${_formatDate(notice.effectiveAt)}'),
              const SizedBox(height: 16),
              if (widget.requiresReconsent) ...[
                const _NoticeMessage(
                  icon: Icons.update,
                  text:
                      'An updated privacy notice is available. Please review it before continuing.',
                ),
                const SizedBox(height: 16),
              ],
              if (!widget.online) ...[
                const _NoticeMessage(
                  icon: Icons.cloud_off_outlined,
                  text:
                      'You can save your choice offline. Internet is required to continue registration.',
                ),
                const SizedBox(height: 16),
              ],
              Text(notice.body),
              const SizedBox(height: 16),
              SelectableText('Source: ${notice.sourceUrl}'),
              const SizedBox(height: 24),
              if (_error != null) ...[
                Semantics(
                  liveRegion: true,
                  label: _error,
                  excludeSemantics: true,
                  child: Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              Semantics(
                button: true,
                label: 'Accept privacy notice',
                excludeSemantics: true,
                child: AppButton(
                  onPressed: _submitting
                      ? null
                      : () => _submit(ConsentDecision.granted),
                  isLoading: _submitting,
                  child: const Text('Accept'),
                ),
              ),
              const SizedBox(height: 12),
              Semantics(
                button: true,
                label: 'Decline privacy notice',
                excludeSemantics: true,
                child: AppButton(
                  isSecondary: true,
                  onPressed: _submitting
                      ? null
                      : () => _submit(ConsentDecision.declined),
                  child: const Text('Decline'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NoticeMessage extends StatelessWidget {
  const _NoticeMessage({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon),
        const SizedBox(width: 12),
        Expanded(child: Text(text)),
      ],
    ),
  );
}

String _formatDate(DateTime value) {
  const months = <String>[
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  final utc = value.toUtc();
  return '${months[utc.month - 1]} ${utc.day}, ${utc.year}';
}
