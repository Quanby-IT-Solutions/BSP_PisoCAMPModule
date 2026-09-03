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

  /// The scan ran and could not read the note (DR-006).
  unrecognized,

  /// A Philippine note from a series that no longer circulates (DR-004).
  demonetized,

  /// Not Philippine currency (DR-005).
  foreign,

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
    this.dwell = kRecognitionDwell,
    this.clock,
  });

  final RecognitionModelSource modelSource;
  final RecognitionEngine engine;
  final CameraFrameSource camera;

  /// Overridden in tests; the platform's speech engine otherwise.
  final SpeechAnnouncer? announcer;

  /// Overridden in tests; read from public configuration otherwise.
  final double? confidenceThreshold;

  /// How long to keep trying before saying the note cannot be read (DR-006).
  final Duration dwell;

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
  String? _demonetizedSeries;
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
      dwell: widget.dwell,
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
      case RecognitionDemonetized():
        setState(() {
          _stage = RecognitionStage.demonetized;
          _demonetizedSeries = state.series;
        });
        _report(RecognitionOutcome.demonetized, state.elapsedMs);
        unawaited(_say(_demonetizedMessage(state.series)));
      case RecognitionForeign():
        setState(() => _stage = RecognitionStage.foreign);
        _report(RecognitionOutcome.foreign, state.elapsedMs);
        unawaited(_say(kForeignNoteMessage));
      case RecognitionUnrecognized():
        setState(() => _stage = RecognitionStage.unrecognized);
        _report(RecognitionOutcome.unrecognized, state.elapsedMs);
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

  /// The finding, then the disclaimer, always in that order and always both.
  ///
  /// A reading with no disclaimer after it is the one thing this feature must
  /// never produce — and that holds for a demonetized or foreign note too,
  /// where somebody is even more likely to be asking whether what they hold is
  /// real.
  Future<void> _say(String finding) async {
    if (!_audioOn) return;
    await _announcer.speak('$finding $kAuthenticityDisclaimer');
  }

  Future<void> _announce(RecognitionRecognized result) =>
      _say('${result.label}.');

  void _toggleAudio() {
    setState(() => _audioOn = !_audioOn);
    if (!_audioOn) {
      unawaited(_announcer.stop());
      return;
    }
    _replay();
  }

  void _replay() {
    if (!_audioOn) return;
    final spoken = _spokenFinding;
    if (spoken != null) unawaited(_say(spoken));
  }

  /// Whatever this screen last concluded out loud, so muting, unmuting and
  /// replaying all repeat the same sentence rather than only the denomination
  /// case.
  String? get _spokenFinding => switch (_stage) {
    RecognitionStage.result => '${_result!.label}.',
    RecognitionStage.demonetized => _demonetizedMessage(_demonetizedSeries!),
    RecognitionStage.foreign => kForeignNoteMessage,
    _ => null,
  };

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
          if (_spokenFinding != null || _stage == RecognitionStage.scanning)
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
            RecognitionStage.demonetized => _Finding(
              headline: 'This note is no longer in circulation',
              detail: _demonetizedMessage(_demonetizedSeries!),
              audioOn: _audioOn,
              onReplay: _replay,
              onScanAgain: _scanAgain,
              onExit: _exit,
            ),
            RecognitionStage.foreign => _Finding(
              headline: 'This is not Philippine currency',
              detail: kForeignNoteMessage,
              audioOn: _audioOn,
              onReplay: _replay,
              onScanAgain: _scanAgain,
              onExit: _exit,
            ),
            RecognitionStage.unrecognized => _Unrecognized(
              onRetry: _scanAgain,
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

/// DR-004's wording.
///
/// It says which series and what that means, and it says what the reader is
/// for, because somebody holding an old note is asking a question this module
/// does not answer: whether a bank will still take it.
String _demonetizedMessage(String series) =>
    'It belongs to the $series, a demonetized series that is no longer '
    'circulating legal tender. This reader identifies circulating legal tender '
    'only.';

/// DR-005's wording. It says what the note is not, and stops there: which
/// currency it is is outside this module (section 17).
const String kForeignNoteMessage =
    'This does not appear to be Philippine currency, so no denomination is '
    'being shown.';

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

/// DR-006. What to try, rather than only that it did not work.
///
/// No denomination, no guess and nothing spoken: the module has nothing to say
/// about this note, and the four tips are the four things that actually change
/// the outcome of the next attempt.
class _Unrecognized extends StatelessWidget {
  const _Unrecognized({required this.onRetry, required this.onExit});

  final VoidCallback onRetry;
  final VoidCallback onExit;

  static const _tips = <(IconData, String)>[
    (
      Icons.light_mode_outlined,
      'Move somewhere brighter, and keep glare and shadows off the note.',
    ),
    (
      Icons.straighten_outlined,
      'Hold the phone about a hand-span away, close enough to fill the frame.',
    ),
    (
      Icons.screen_rotation_outlined,
      'Turn the note so it sits straight, the long way across the screen.',
    ),
    (
      Icons.crop_free_outlined,
      'Lay it flat and unfolded, with nothing covering any part of it.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: <Widget>[
        Text(
          'The note could not be read',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        const Text(
          'Nothing was recognised confidently, so no denomination is being '
          'shown. These usually help:',
        ),
        const SizedBox(height: 12),
        for (final (icon, tip) in _tips)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                // Decorative: the sentence beside it carries the whole meaning,
                // so a screen reader should not read the icon as well.
                ExcludeSemantics(child: Icon(icon, size: 24)),
                const SizedBox(width: 12),
                Expanded(child: Text(tip)),
              ],
            ),
          ),
        const SizedBox(height: 12),
        SizedBox(
          height: 48,
          child: FilledButton(onPressed: onRetry, child: const Text('Retry')),
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

/// A conclusion that is not a denomination: DR-004 and DR-005.
///
/// The same shape as a reading — a headline, the finding, the disclaimer, and
/// the same controls — because these are answers, not errors, and somebody who
/// gets one still needs to be able to replay it and scan the next note.
class _Finding extends StatelessWidget {
  const _Finding({
    required this.headline,
    required this.detail,
    required this.audioOn,
    required this.onReplay,
    required this.onScanAgain,
    required this.onExit,
  });

  final String headline;
  final String detail;
  final bool audioOn;
  final VoidCallback onReplay;
  final VoidCallback onScanAgain;
  final VoidCallback onExit;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: <Widget>[
        Text(headline, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 12),
        Text(detail),
        const SizedBox(height: 12),
        // Still, and for the same reason: somebody holding an unfamiliar note
        // is even more likely to be asking whether it is real.
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
