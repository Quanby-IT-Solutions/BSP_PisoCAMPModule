import 'dart:async';
import 'dart:math';

/// A cancellable wait between retry attempts.
///
/// An interface so a test can drive a backoff without spending the wall-clock
/// time, and so a reconnect can cut a long wait short.
abstract interface class RetryWaiter {
  Future<void> wait(Duration delay);
  void cancel();
}

final class TimerRetryWaiter implements RetryWaiter {
  Timer? _timer;
  Completer<void>? _completion;

  @override
  Future<void> wait(Duration delay) {
    cancel();
    final completion = Completer<void>();
    _completion = completion;
    _timer = Timer(delay, () {
      if (!completion.isCompleted) completion.complete();
      if (identical(_completion, completion)) {
        _completion = null;
        _timer = null;
      }
    });
    return completion.future;
  }

  @override
  void cancel() {
    _timer?.cancel();
    _timer = null;
    final completion = _completion;
    if (completion != null && !completion.isCompleted) completion.complete();
    _completion = null;
  }
}

/// Doubling backoff, capped at five minutes.
Duration retryBackoff(int attempt) =>
    Duration(seconds: min(300, 1 << min(attempt - 1, 9)));

/// Spreads retries either side of the delay so devices that dropped together
/// do not all return together.
Duration secureRetryJitter(Duration base) {
  final factor = .8 + Random.secure().nextDouble() * .4;
  return Duration(microseconds: (base.inMicroseconds * factor).round());
}
