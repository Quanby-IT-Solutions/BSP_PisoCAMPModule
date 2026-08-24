import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'connectivity_provider.g.dart';

@Riverpod(keepAlive: true)
Connectivity connectivity(Ref ref) => Connectivity();

/// Transport availability only. Network requests still independently fall
/// back when a connection is captive, timed out, or otherwise unusable.
@Riverpod(keepAlive: true)
Stream<bool> connectivityStatus(Ref ref) async* {
  final service = ref.watch(connectivityProvider);
  final initial = await service.checkConnectivity();
  yield initial.any((result) => result != ConnectivityResult.none);
  yield* service.onConnectivityChanged.map(
    (results) => results.any((result) => result != ConnectivityResult.none),
  );
}
