import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/recognition_engine.dart';
import 'package:mobile/features/pisocamp/data/recognition_model.dart';
import 'package:mobile/features/pisocamp/data/recognition_scanner.dart';
import 'package:mobile/features/pisocamp/data/speech_announcer.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';

/// Where the screen is in DR-1's flow (RF-5).
enum RecognitionStage {
  /// Why the camera is needed, said before the OS asks.
  explaining,

  /// The model is loading and the camera is opening.
  preparing,

  /// Frames are being read.
  scanning,

  /// A denomination was read confidently.
  result,

  /// It could not run, and the screen says why.
  unavailable,
}

/// DR-1. Point the camera at a banknote; hear and see which one it is.
///
/// The module never says a note is genuine. It says what denomination the
/// model read, and it says — in the same breath, every time, in text and aloud
/// — that this is not an authenticity check. Somebody deciding whether to
/// accept a note is exactly the person who must not mistake one for the other.
class RecognitionScannerScreen extends ConsumerStatefulWidget {
  const RecognitionScannerScreen({
    super.key,
    required this.modelSource,
    required this.engine,
    required this.camera,
    this.announcer,
    this.confidenceThreshold,
    this.clock,
  });

  final RecognitionModelSource modelSource;
  final RecognitionEngine engine;
  final CameraFrameSource camera;

  /// Overridden in tests; the platform's speech engine otherwise.
  final SpeechAnnouncer? announcer;

  /// Overridden in tests; read from public configuration otherwise.
  final double? confidenceThreshold;
  final DateTime Function()? clock;

  @override
  ConsumerState<RecognitionScannerScreen> createState() =>
      _RecognitionScannerScreenState();
}

class _RecognitionScannerScreenState
    extends ConsumerState<RecognitionScannerScreen> {
  RecognitionStage _stage = RecognitionStage.explaining;
  RecognitionScanner? _scanner;
  StreamSubscription<RecognitionScanState>? _states;
  RecognitionRecognized? _result;
  RecognitionUnavailableReason? _reason;
  late final SpeechAnnouncer _announcer =
      widget.announcer ?? PlatformSpeechAnnouncer();
  var _audioOn = true;
  var _reported = false;

  /// Held while the screen is mounted, because `dispose` runs after the element
  /// is detached and reading a provider then throws.
  AnalyticsSdk? _analytics;

  @override
  void dispose() {
    unawaited(_announcer.dispose());
    unawaited(_states?.cancel());
    unawaited(_scanner?.dispose());
    super.dispose();
  }

  double get _threshold =>
      widget.confidenceThreshold ?? kDefaultRecognitionConfidenceThreshold;

  Future<void> _begin() async {
    setState(() {
      _stage = RecognitionStage.preparing;
      _reason = null;
      _result = null;
    });
    _analytics = _readAnalytics(
      const RecognitionResultIntent(
        outcome: RecognitionOutcome.unavailable,
        elapsedMs: 0,
      ),
    );

    final scanner = RecognitionScanner(
      modelSource: widget.modelSource,
      engine: widget.engine,
      camera: widget.camera,
      confidenceThreshold: _threshold,
      clock: widget.clock,
    );
    _scanner = scanner;
    _states = scanner.states.listen(_onState);
    await scanner.start();
  }

  void _onState(RecognitionScanState state) {
    if (!mounted) return;
    switch (state) {
      case RecognitionPreparing():
        setState(() => _stage = RecognitionStage.preparing);
      case RecognitionScanning():
        setState(() => _stage = RecognitionStage.scanning);
      case RecognitionRecognized():
        setState(() {
          _stage = RecognitionStage.result;
          _result = state;
        });
        _report(RecognitionOutcome.recognized, state.elapsedMs);
        unawaited(_announce(state));
      case RecognitionUnavailable():
        setState(() {
          _stage = RecognitionStage.unavailable;
          _reason = state.reason;
        });
        _report(
          state.reason == RecognitionUnavailableReason.permissionDenied
              ? RecognitionOutcome.permissionDenied
              : RecognitionOutcome.unavailable,
          state.elapsedMs,
        );
    }
  }

  /// The denomination, then the disclaimer, always in that order and always
  /// both. A reading with no disclaimer after it is the one thing this feature
  /// must never produce.
  Future<void> _announce(RecognitionRecognized result) async {
    if (!_audioOn) return;
    await _announcer.speak('${result.label}. $kAuthenticityDisclaimer');
  }

  void _toggleAudio() {
    setState(() => _audioOn = !_audioOn);
    if (!_audioOn) {
      unawaited(_announcer.stop());
      return;
    }
    final result = _result;
    if (result != null) unawaited(_announce(result));
  }

  void _replay() {
    final result = _result;
    if (result == null || !_audioOn) return;
    unawaited(_announce(result));
  }

  /// One event per attempt.
  void _report(RecognitionOutcome outcome, int elapsedMs) {
    if (_reported) return;
    _reported = true;
    final intent = RecognitionResultIntent(
      outcome: outcome,
      elapsedMs: elapsedMs,
    );
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

  /// Starts a fresh attempt.
  ///
  /// Only reachable from a finished scan — a reading or a failure — and a scan
  /// releases the camera and the runtime the moment it concludes. What is left
  /// here is a subscription to a stream that is already over, so this tidies up
  /// rather than waiting on a release that has happened.
  Future<void> _scanAgain() async {
    final previous = _scanner;
    final states = _states;
    _scanner = null;
    _states = null;
    unawaited(states?.cancel());
    unawaited(previous?.dispose());
    _reported = false;
    await _announcer.stop();
    await _begin();
  }

  Future<void> _exit() async {
    await _announcer.stop();
    if (!mounted) return;
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(AppRoutes.pisoCamp);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Identify a banknote'),
        actions: <Widget>[
          if (_stage == RecognitionStage.result ||
              _stage == RecognitionStage.scanning)
            IconButton(
              icon: Icon(_audioOn ? Icons.volume_up : Icons.volume_off),
              tooltip: _audioOn ? 'Mute the spoken result' : 'Unmute',
              onPressed: _toggleAudio,
            ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: switch (_stage) {
            RecognitionStage.explaining => _Explanation(onContinue: _begin),
            RecognitionStage.preparing => const _Busy(
              message: 'Preparing the scanner…',
            ),
            RecognitionStage.scanning => _Scanning(onExit: _exit),
            RecognitionStage.result => _Result(
              result: _result!,
              audioOn: _audioOn,
              onReplay: _replay,
              onScanAgain: _scanAgain,
              onExit: _exit,
            ),
            RecognitionStage.unavailable => _Unavailable(
              reason: _reason ?? RecognitionUnavailableReason.modelMissing,
              onRetry: _scanAgain,
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
          'Reading a banknote needs the camera. Each frame is examined on this '
          'phone and discarded straight away: no photo is saved, and nothing '
          'is sent anywhere.',
        ),
        const SizedBox(height: 12),
        // Said before anybody points a camera at money, not only after a
        // reading appears.
        const Text(kAuthenticityDisclaimer),
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

class _Busy extends StatelessWidget {
  const _Busy({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(message),
        ],
      ),
    );
  }
}

class _Scanning extends StatelessWidget {
  const _Scanning({required this.onExit});

  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: <Widget>[
        Text(
          'Point the camera at the banknote',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        const Text(
          'Lay the note flat in good light and hold the phone steady. The '
          'result appears as soon as it can be read confidently.',
        ),
        const SizedBox(height: 24),
        SizedBox(
          height: 48,
          child: OutlinedButton(onPressed: onExit, child: const Text('Exit')),
        ),
      ],
    );
  }
}

class _Result extends StatelessWidget {
  const _Result({
    required this.result,
    required this.audioOn,
    required this.onReplay,
    required this.onScanAgain,
    required this.onExit,
  });

  final RecognitionRecognized result;
  final bool audioOn;
  final VoidCallback onReplay;
  final VoidCallback onScanAgain;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: <Widget>[
        // The reading, large enough to be the answer, and never phrased as a
        // verdict on the note.
        Text(result.label, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 12),
        // Shown whether or not audio is available: the criteria require the
        // visible result to stand on its own.
        const Text(kAuthenticityDisclaimer),
        const SizedBox(height: 24),
        SizedBox(
          height: 48,
          child: OutlinedButton(
            onPressed: audioOn ? onReplay : null,
            child: const Text('Play again'),
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 48,
          child: FilledButton(
            onPressed: onScanAgain,
            child: const Text('Scan another note'),
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
    required this.onRetry,
    required this.onExit,
  });

  final RecognitionUnavailableReason reason;
  final VoidCallback onRetry;
  final VoidCallback onExit;

  String get _message => switch (reason) {
    RecognitionUnavailableReason.modelMissing =>
      'The banknote reader has not been downloaded to this phone yet.',
    RecognitionUnavailableReason.modelCorrupt =>
      'The banknote reader on this phone could not be read.',
    RecognitionUnavailableReason.engineMissing =>
      'This build cannot read banknotes yet.',
    RecognitionUnavailableReason.permissionDenied =>
      'Without camera access a banknote cannot be read.',
    RecognitionUnavailableReason.cameraUnavailable =>
      'The camera could not be opened.',
  };

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: <Widget>[
        Text(
          'The banknote reader is not available',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        Text(_message),
        const SizedBox(height: 12),
        // No denomination is offered, guessed at or implied here. Saying
        // nothing is the correct answer when the module cannot read the note.
        const Text(
          'Nothing has been read from your camera, so no denomination can be '
          'shown.',
        ),
        const SizedBox(height: 24),
        SizedBox(
          height: 48,
          child: FilledButton(
            onPressed: onRetry,
            child: const Text('Try again'),
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
