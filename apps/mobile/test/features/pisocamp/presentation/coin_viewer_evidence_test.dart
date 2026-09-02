import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/coin_model.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/coin_viewer.dart';

/// Writes the viewer's own output to disk so a reviewer can see what the three
/// face presets and the zoom limits actually render, without a device.
///
/// Skipped unless `CE2_EVIDENCE_DIR` names a directory to write into, so an
/// ordinary test run neither writes files nor depends on the filesystem.
const _modelAsset =
    'assets/pisocamp/bundle/seed/source/neutral-coin-education.glb';
const _size = Size(480, 480);

Future<void> _write(
  WidgetTester tester,
  CoinModel model,
  CoinOrientation orientation,
  File target,
) async {
  await tester.runAsync(() async {
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    canvas.drawRect(
      Offset.zero & _size,
      Paint()..color = const Color(0xfff2efe9),
    );
    CoinPainter(model: model, orientation: orientation).paint(canvas, _size);
    final picture = recorder.endRecording();
    final image = await picture.toImage(
      _size.width.toInt(),
      _size.height.toInt(),
    );
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    picture.dispose();
    image.dispose();
    // Written inside the same real-async turn: a widget test's fake clock does
    // not advance file I/O either.
    await target.writeAsBytes(data!.buffer.asUint8List());
  });
}

void main() {
  final directory = Platform.environment['CE2_EVIDENCE_DIR'];

  testWidgets('renders the documented views to PNG', (tester) async {
    final source = await tester.runAsync(() => File(_modelAsset).readAsBytes());
    final model = CoinModel.parse(source!);
    final output = Directory(directory!);
    await tester.runAsync(() => output.create(recursive: true));

    const views = <String, CoinOrientation>{
      'obverse': CoinOrientation.obverse,
      'reverse': CoinOrientation.reverse,
      'edge': CoinOrientation.edge,
      'tilted': CoinOrientation(yaw: 0.6, pitch: 0.45, zoom: 1),
      'zoomed': CoinOrientation(yaw: 0, pitch: 0, zoom: 2),
      'minimum-zoom': CoinOrientation(yaw: 0, pitch: 0, zoom: 0.6),
    };

    for (final view in views.entries) {
      final file = File('${output.path}/ce-2-coin-${view.key}.png');
      await _write(tester, model, view.value, file);
      final length = await tester.runAsync(file.length);
      expect(length, greaterThan(0), reason: view.key);
    }
  }, skip: directory == null);
}
