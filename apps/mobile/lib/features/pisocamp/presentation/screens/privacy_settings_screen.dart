import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_repository.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/data/push_repository.dart';

/// SA-7. Where somebody takes back a permission they gave.
///
/// One screen, one purpose per row, and the withdrawal happens whether or not
/// there is a signal: the moment somebody changes their mind is rarely the
/// moment they are online, and a right that only works on Wi-Fi is a weaker
/// right. The queued record is retried with the same id, like every other
/// consent decision.
class PrivacySettingsScreen extends StatefulWidget {
  const PrivacySettingsScreen({
    super.key,
    required this.consentService,
    required this.notice,
    required this.online,
    this.push,
    this.platform = 'android',
  });

  final ConsentService consentService;
  final PrivacyNotice notice;
  final bool online;

  /// SA-5. Null for a guest, who has no account to attach a subscription to.
  final PushRepository? push;
  final String platform;

  @override
  State<PrivacySettingsScreen> createState() => _PrivacySettingsScreenState();
}

class _PrivacySettingsScreenState extends State<PrivacySettingsScreen> {
  final Set<ConsentPurpose> _withdrawing = <ConsentPurpose>{};
  final Set<ConsentPurpose> _withdrawn = <ConsentPurpose>{};
  String? _problem;

  /// SA-5 push. Null until the current state is known.
  bool? _pushSubscribed;
  bool _pushBusy = false;
  String? _pushProblem;

  @override
  void initState() {
    super.initState();
    unawaited(_loadPushStatus());
  }

  Future<void> _loadPushStatus() async {
    final push = widget.push;
    if (push == null) return;
    try {
      final status = await push.status();
      if (!mounted) return;
      setState(() => _pushSubscribed = status.subscribed);
    } on Object {
      if (!mounted) return;
      // Unknown is said out loud rather than shown as "off": somebody would
      // otherwise think they had already opted out.
      setState(() => _pushProblem = 'Could not check whether you are opted in.');
    }
  }

  Future<void> _togglePush(bool subscribe) async {
    final push = widget.push;
    if (push == null) return;
    setState(() {
      _pushBusy = true;
      _pushProblem = null;
    });
    try {
      final status = subscribe
          ? await push.subscribe(platform: widget.platform)
          : await push.unsubscribe();
      if (!mounted) return;
      setState(() => _pushSubscribed = status.subscribed);
    } on PushSubscriptionException catch (error) {
      if (!mounted) return;
      setState(
        () => _pushProblem = error.code == 'tokenUnavailable'
            // Saying what is actually wrong: this build ships no push service,
            // so there is no token to subscribe with.
            ? 'This build cannot receive notifications yet.'
            : 'That could not be saved. Please try again.',
      );
    } finally {
      if (mounted) setState(() => _pushBusy = false);
    }
  }

  static const Map<ConsentPurpose, String> _labels = <ConsentPurpose, String>{
    ConsentPurpose.registration: 'Registration',
    ConsentPurpose.survey: 'Surveys',
    ConsentPurpose.demographicAnalytics: 'Demographic analytics',
  };

  static const Map<ConsentPurpose, String> _descriptions =
      <ConsentPurpose, String>{
        ConsentPurpose.registration:
            'Holding your profile so you can sign in and keep your progress.',
        ConsentPurpose.survey: 'Asking you to answer surveys in the module.',
        ConsentPurpose.demographicAnalytics:
            'Including your age group and location in aggregate reports.',
      };

  Future<void> _withdraw(ConsentPurpose purpose) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Withdraw ${_labels[purpose]?.toLowerCase()} consent?'),
        content: const Text(
          'Collection for this purpose stops straight away. What was already '
          'collected while you agreed is kept, and you can agree again later.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Withdraw'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() {
      _withdrawing.add(purpose);
      _problem = null;
    });

    final result = await widget.consentService.recordDecision(
      purpose: purpose,
      notice: widget.notice,
      decision: ConsentDecision.withdrawn,
      online: widget.online,
    );
    if (!mounted) return;

    setState(() {
      _withdrawing.remove(purpose);
      if (result == ConsentGateResult.unavailable) {
        // Said out loud rather than shown as done: a withdrawal somebody
        // believes happened and did not is the worst outcome here.
        _problem = 'That could not be saved. Please try again.';
      } else {
        _withdrawn.add(purpose);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Privacy')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            Text(
              'What you have agreed to',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            const Text(
              'Withdrawing stops collection for that purpose from the next '
              'moment on. It does not delete what was collected while you '
              'agreed — ask BSP for that separately.',
            ),
            if (_problem != null) ...<Widget>[
              const SizedBox(height: 12),
              Text(
                _problem!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            if (widget.push != null) ...<Widget>[
              const SizedBox(height: 16),
              Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'Notifications',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Occasional messages from BSP about the module. Opting '
                        'out removes this device from the list straight away.',
                      ),
                      if (_pushProblem != null) ...<Widget>[
                        const SizedBox(height: 8),
                        Text(
                          _pushProblem!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      SizedBox(
                        height: 48,
                        child: OutlinedButton(
                          onPressed: _pushBusy || _pushSubscribed == null
                              ? null
                              : () => _togglePush(!(_pushSubscribed ?? false)),
                          child: Text(
                            _pushBusy
                                ? 'Saving…'
                                : _pushSubscribed == null
                                ? 'Checking…'
                                : (_pushSubscribed ?? false)
                                ? 'Turn off notifications'
                                : 'Turn on notifications',
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: 16),
            for (final purpose in ConsentPurpose.values)
              Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        _labels[purpose] ?? purpose.wireValue,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 4),
                      Text(_descriptions[purpose] ?? ''),
                      const SizedBox(height: 12),
                      if (_withdrawn.contains(purpose))
                        const Text('Withdrawn.')
                      else
                        SizedBox(
                          height: 48,
                          child: OutlinedButton(
                            onPressed: _withdrawing.contains(purpose)
                                ? null
                                : () => _withdraw(purpose),
                            child: Text(
                              _withdrawing.contains(purpose)
                                  ? 'Withdrawing…'
                                  : 'Withdraw consent',
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
