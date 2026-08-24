import 'dart:async';

/// Starts a serialized consent-queue drain whenever transport reconnects.
class ConsentSyncController {
  ConsentSyncController(
    Stream<bool> connectivity,
    Future<void> Function() synchronize,
  ) : _synchronize = synchronize {
    _subscription = connectivity.listen(_onConnectivity);
  }

  final Future<void> Function() _synchronize;
  late final StreamSubscription<bool> _subscription;
  bool? _lastOnline;
  bool _running = false;
  bool _followUp = false;

  void _onConnectivity(bool online) {
    final reconnect = online && _lastOnline != true;
    _lastOnline = online;
    if (!reconnect) return;
    if (_running) {
      _followUp = true;
      return;
    }
    _startDrain();
  }

  void _startDrain() {
    _running = true;
    unawaited(
      _synchronize().catchError((Object _) {}).whenComplete(() {
        _running = false;
        final shouldFollowUp = _followUp && _lastOnline == true;
        _followUp = false;
        if (shouldFollowUp) _startDrain();
      }),
    );
  }

  Future<void> dispose() => _subscription.cancel();
}
