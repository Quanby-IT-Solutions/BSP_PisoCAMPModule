import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/ar_narration.dart';
import 'package:mobile/features/pisocamp/data/ar_session.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';

/// Where the screen is in AR-001's flow.
enum ArExperienceStage {
  /// Why the module needs the camera, said before the OS asks.
  explaining,

  /// The session is being started.
  loading,

  /// The animation is playing.
  running,

  /// It cannot run here, and the screen says why and offers CE-2 instead.
  unavailable,
}

/// AR-1. One coin, placed in the room.
///
/// The permission explanation comes **before** the OS prompt, because a system
/// dialog with no context is one people refuse and cannot be asked again. When
/// the device, the build or the person says no, the screen says which and
/// offers CE-2's 3D viewer: a dead end here would strand somebody who came to
/// look at a coin.
class ArExperienceScreen extends ConsumerStatefulWidget {
  const ArExperienceScreen({
    super.key,
    required this.kind,
    required this.logicalId,
    required this.probe,
    required this.sessions,
    this.narration,
    this.narrationTranscript,
    this.animationDuration = const Duration(seconds: 12),
    this.clock,
  });

  final CurrencyRouteKind kind;
  final String logicalId;
  final ArCapabilityProbe probe;
  final ArSessionFactory sessions;

  /// Overridden in tests; the platform's player otherwise. A build with no
  /// audio runtime plays nothing and still shows the captions.
  final ArNarrationPlayer? narration;

  /// What the narration says, from the published experience. Null when the
  /// experience has not been synced, in which case there is nothing to caption.
  final String? narrationTranscript;

  /// How long the animation runs, which is the timeline the narration follows.
  final Duration animationDuration;

  /// Injectable so a test can measure a session without waiting for one.
  final DateTime Function()? clock;

  @override
  ConsumerState<ArExperienceScreen> createState() => _ArExperienceScreenState();
}

class _ArExperienceScreenState extends ConsumerState<ArExperienceScreen> {
  ArExperienceStage _stage = ArExperienceStage.explaining;
  ArUnavailableReason? _reason;
  ArSession? _session;
  DateTime? _startedAt;
  bool _endReported = false;
  late final ArNarrationSync _narration = ArNarrationSync(
    player: widget.narration ?? const SilentArNarrationPlayer(),
    animationDuration: widget.animationDuration,
  );
  var _captionsOn = true;

  /// Held from the moment the session starts.
  ///
  /// `dispose` runs after the element is detached, and reading a provider then
  /// throws — which turned every ordinary exit into a reported analytics
  /// failure. The reference is taken while the screen is still mounted.
  AnalyticsSdk? _analytics;

  DateTime get _now => (widget.clock ?? DateTime.now)();

  @override
  void dispose() {
    // The session is released whatever ends the screen — Exit, the system back
    // gesture, or a route change. Ten open-and-close cycles leave nothing
    // behind because every one of them passes through here.
    _reportEnd();
    unawaited(_narration.dispose());
    unawaited(_session?.dispose());
    _session = null;
    super.dispose();
  }

  Future<void> _begin() async {
    setState(() {
      _stage = ArExperienceStage.loading;
      _reason = null;
    });

    final capability = await widget.probe.check();
    if (!mounted) return;
    if (!capability.supported) {
      _fallBack(capability.reason ?? ArUnavailableReason.deviceUnsupported);
      return;
    }

    try {
      // The OS prompt happens inside start(), after the explanation above.
      final session = await widget.sessions.start(logicalId: widget.logicalId);
      await session.ready;
      if (!mounted) {
        await session.dispose();
        return;
      }
      _session = session;
      _startedAt = _now;
      _analytics = _readAnalytics(
        ArEndIntent(logicalId: widget.logicalId, durationMs: 0),
      );
      _emit(
        ArStartIntent(
          logicalId: widget.logicalId,
          outcome: ArStartOutcome.started,
        ),
      );
      // Started with the animation, not before it: audio that begins while the
      // scene is still placing itself describes something nobody can see yet.
      await _narration.start();
      setState(() => _stage = ArExperienceStage.running);
    } on ArSessionException catch (error) {
      if (!mounted) return;
      _fallBack(error.reason);
    } on Object {
      if (!mounted) return;
      _fallBack(ArUnavailableReason.deviceUnsupported);
    }
  }

  void _fallBack(ArUnavailableReason reason) {
    _emit(
      ArStartIntent(
        logicalId: widget.logicalId,
        outcome: reason == ArUnavailableReason.permissionDenied
            ? ArStartOutcome.permissionDenied
            : ArStartOutcome.unsupported,
      ),
    );
    setState(() {
      _stage = ArExperienceStage.unavailable;
      _reason = reason;
    });
  }

  void _reportEnd() {
    if (_endReported || _startedAt == null) return;
    _endReported = true;
    final elapsed = _now.difference(_startedAt!).inMilliseconds;
    _emit(
      ArEndIntent(
        logicalId: widget.logicalId,
        // Clamped to the contract's hour: a session left open overnight is not
        // an hour of looking at a coin.
        durationMs: elapsed.clamp(0, 3600000),
      ),
    );
  }

  void _emit(AnalyticsIntent intent) {
    final sdk = _analytics ?? _readAnalytics(intent);
    if (sdk != null) emitAnalytics(sdk, intent);
  }

  AnalyticsSdk? _readAnalytics(AnalyticsIntent intent) {
    try {
      return ref.read(analyticsSdkProvider);
    } on Object catch (error) {
      reportAnalyticsFailure(intent, error);
      return null;
    }
  }

  Future<void> _toggleNarration() async {
    await _narration.setMuted(!_narration.muted);
    if (mounted) setState(() {});
  }

  Future<void> _replayNarration() async {
    await _narration.replay();
    if (mounted) setState(() {});
  }

  Future<void> _exit() async {
    _reportEnd();
    await _narration.stopForExit();
    final session = _session;
    _session = null;
    await session?.dispose();
    if (!mounted) return;
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(AppRoutes.pisoCamp);
    }
  }

  void _openThreeDimensionalViewer() {
    context.push(
      AppRoutes.currencyModel(
        kind: widget.kind.pathSegment,
        logicalId: widget.logicalId,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Augmented reality'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          tooltip: 'Exit',
          onPressed: _exit,
        ),
        actions: <Widget>[
          if (_stage == ArExperienceStage.running) ...<Widget>[
            IconButton(
              icon: Icon(_narration.muted ? Icons.volume_off : Icons.volume_up),
              tooltip: _narration.muted
                  ? 'Unmute the narration'
                  : 'Mute the narration',
              onPressed: _toggleNarration,
            ),
            IconButton(
              icon: Icon(
                _captionsOn ? Icons.closed_caption : Icons.closed_caption_off,
              ),
              tooltip: _captionsOn ? 'Hide the captions' : 'Show the captions',
              onPressed: () => setState(() => _captionsOn = !_captionsOn),
            ),
          ],
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: switch (_stage) {
            ArExperienceStage.explaining => _Explanation(onContinue: _begin),
            ArExperienceStage.loading => const _Loading(),
            ArExperienceStage.running => _Running(
              onExit: _exit,
              onReplayNarration: _replayNarration,
              transcript: widget.narrationTranscript,
              captionsOn: _captionsOn,
            ),
            ArExperienceStage.unavailable => _Unavailable(
              reason: _reason ?? ArUnavailableReason.deviceUnsupported,
              onOpenViewer: _openThreeDimensionalViewer,
              onExit: _exit,
            ),
          },
        ),
      ),
    );
  }
}

class _Explanation extends StatelessWidget {
  const _Explanation({required this.onContinue});

  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: <Widget>[
        Text(
          'Before the camera opens',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        const Text(
          'Placing a coin in your surroundings needs the camera and the motion '
          'sensors. The camera view stays on your device: nothing is recorded, '
          'saved or sent anywhere.',
        ),
        const SizedBox(height: 12),
        const Text(
          'Your phone will ask for permission next. You can say no and still '
          'look at the coin in 3D.',
        ),
        const SizedBox(height: 24),
        SizedBox(
          height: 48,
          child: FilledButton(
            onPressed: onContinue,
            child: const Text('Continue'),
          ),
        ),
      ],
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          CircularProgressIndicator(),
          SizedBox(height: 16),
          Text('Starting the experience…'),
        ],
      ),
    );
  }
}

class _Running extends StatelessWidget {
  const _Running({
    required this.onExit,
    required this.onReplayNarration,
    required this.transcript,
    required this.captionsOn,
  });

  final VoidCallback onExit;
  final VoidCallback onReplayNarration;
  final String? transcript;
  final bool captionsOn;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: <Widget>[
        Text(
          'Move your phone slowly',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        const Text(
          'Point the camera at a flat surface, then walk around the coin to see '
          'it from every side. Tap Exit when you are finished.',
        ),
        if (transcript != null && captionsOn) ...<Widget>[
          const SizedBox(height: 16),
          // The narration in writing. Shown by default rather than behind a
          // setting: somebody who cannot hear the audio should not have to find
          // out that a transcript exists.
          Semantics(
            label: 'Narration transcript',
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(transcript!),
            ),
          ),
        ],
        const SizedBox(height: 24),
        SizedBox(
          height: 48,
          child: OutlinedButton(
            onPressed: onReplayNarration,
            child: const Text('Play the narration again'),
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 48,
          child: OutlinedButton(onPressed: onExit, child: const Text('Exit')),
        ),
      ],
    );
  }
}

class _Unavailable extends StatelessWidget {
  const _Unavailable({
    required this.reason,
    required this.onOpenViewer,
    required this.onExit,
  });

  final ArUnavailableReason reason;
  final VoidCallback onOpenViewer;
  final VoidCallback onExit;

  String get _message => switch (reason) {
    ArUnavailableReason.permissionDenied =>
      'Without camera access the coin cannot be placed in your surroundings.',
    ArUnavailableReason.deviceUnsupported =>
      'This phone does not support augmented reality.',
    ArUnavailableReason.assetsMissing =>
      'This experience has not been downloaded yet.',
    ArUnavailableReason.runtimeMissing =>
      'This build cannot open augmented reality yet.',
  };

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: <Widget>[
        Text(
          'Augmented reality is not available',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        Text(_message),
        const SizedBox(height: 12),
        const Text(
          'You can still look at the same coin in 3D, turn it, and zoom in.',
        ),
        const SizedBox(height: 24),
        SizedBox(
          height: 48,
          child: FilledButton(
            onPressed: onOpenViewer,
            child: const Text('Open the 3D viewer'),
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 48,
          child: OutlinedButton(onPressed: onExit, child: const Text('Exit')),
        ),
      ],
    );
  }
}
