import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/consent_sync_controller.dart';

void main() {
  test(
    'syncs on initial online state and each offline-to-online reconnect',
    () async {
      final connectivity = StreamController<bool>();
      addTearDown(connectivity.close);
      var syncs = 0;
      final controller = ConsentSyncController(
        connectivity.stream,
        () async => syncs++,
      );
      addTearDown(controller.dispose);

      connectivity.add(false);
      await Future<void>.delayed(Duration.zero);
      expect(syncs, 0);

      connectivity.add(true);
      connectivity.add(true);
      await Future<void>.delayed(Duration.zero);
      expect(syncs, 1);

      connectivity.add(false);
      connectivity.add(true);
      await Future<void>.delayed(Duration.zero);
      expect(syncs, 2);
    },
  );

  test('never overlaps reconnect drains', () async {
    final connectivity = StreamController<bool>();
    addTearDown(connectivity.close);
    final release = Completer<void>();
    var active = 0;
    var maximumActive = 0;
    final controller = ConsentSyncController(connectivity.stream, () async {
      active++;
      if (active > maximumActive) maximumActive = active;
      await release.future;
      active--;
    });
    addTearDown(controller.dispose);

    connectivity.add(true);
    connectivity.add(false);
    connectivity.add(true);
    await Future<void>.delayed(Duration.zero);
    expect(maximumActive, 1);
    release.complete();
    await Future<void>.delayed(Duration.zero);
  });

  test('reconnect during a drain schedules one serialized follow-up', () async {
    final connectivity = StreamController<bool>();
    addTearDown(connectivity.close);
    final releaseFirst = Completer<void>();
    var calls = 0;
    var active = 0;
    var maximumActive = 0;
    final controller = ConsentSyncController(connectivity.stream, () async {
      calls++;
      active++;
      if (active > maximumActive) maximumActive = active;
      if (calls == 1) await releaseFirst.future;
      active--;
    });
    addTearDown(controller.dispose);

    connectivity.add(true);
    await Future<void>.delayed(Duration.zero);
    expect(calls, 1);

    connectivity.add(false);
    connectivity.add(true);
    await Future<void>.delayed(Duration.zero);
    expect(calls, 1);
    expect(maximumActive, 1);

    releaseFirst.complete();
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);

    expect(calls, 2);
    expect(maximumActive, 1);
    await Future<void>.delayed(Duration.zero);
    expect(calls, 2);
  });
}
