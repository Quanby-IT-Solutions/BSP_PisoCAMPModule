import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/coin_model.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/coin_viewer.dart';

const _modelAsset =
    'assets/pisocamp/bundle/seed/source/neutral-coin-education.glb';
const _size = Size(240, 240);

/// One rendered frame, sampled by pixel. Painting the real model and reading
/// the result back is the only way a headless test can show that the coin is
/// actually drawn and that a face preset changes what is on screen.
final class _Frame {
  const _Frame(this._pixels, this._width);

  final ByteData _pixels;
  final int _width;

  ({int red, int green, int blue, int alpha}) at(int x, int y) {
    final offset = (y * _width + x) * 4;
    return (
      red: _pixels.getUint8(offset),
      green: _pixels.getUint8(offset + 1),
      blue: _pixels.getUint8(offset + 2),
      alpha: _pixels.getUint8(offset + 3),
    );
  }

  bool opaqueAt(int x, int y) => at(x, y).alpha > 200;

  Uint8List get bytes => _pixels.buffer.asUint8List();
}

/// Rasterising needs real async, not the fake clock a widget test runs on, so
/// the whole render happens inside [WidgetTester.runAsync].
Future<_Frame> _render(
  WidgetTester tester,
  CoinModel model,
  CoinOrientation orientation,
) async {
  final frame = await tester.runAsync(() async {
    final recorder = ui.PictureRecorder();
    CoinPainter(
      model: model,
      orientation: orientation,
    ).paint(Canvas(recorder), _size);
    final picture = recorder.endRecording();
    final image = await picture.toImage(
      _size.width.toInt(),
      _size.height.toInt(),
    );
    final pixels = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    picture.dispose();
    image.dispose();
    return _Frame(pixels!, _size.width.toInt());
  });
  return frame!;
}

void main() {
  late CoinModel model;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    model = CoinModel.parse(await File(_modelAsset).readAsBytes());
  });

  group('CoinOrientation', () {
    test('a horizontal drag turns the coin and a vertical drag tilts it', () {
      const start = CoinOrientation.initial;

      final turned = start.rotatedBy(const Offset(160, 0));
      expect(turned.yaw, greaterThan(start.yaw));
      expect(turned.pitch, start.pitch);

      // Dragging down tilts the top of the coin away from the viewer.
      final tilted = start.rotatedBy(const Offset(0, 160));
      expect(tilted.pitch, lessThan(start.pitch));
      expect(tilted.yaw, start.yaw);
    });

    test('zoom stays inside its limits however hard it is pushed', () {
      var orientation = CoinOrientation.initial;
      for (var step = 0; step < 20; step += 1) {
        orientation = orientation.zoomedBy(CoinOrientation.zoomStep);
      }
      expect(orientation.zoom, CoinOrientation.maximumZoom);
      expect(orientation.canZoomIn, isFalse);
      expect(orientation.canZoomOut, isTrue);

      for (var step = 0; step < 40; step += 1) {
        orientation = orientation.zoomedBy(1 / CoinOrientation.zoomStep);
      }
      expect(orientation.zoom, CoinOrientation.minimumZoom);
      expect(orientation.canZoomOut, isFalse);
      expect(orientation.canZoomIn, isTrue);
    });

    test('zooming never changes the angle the coin is seen from', () {
      const turned = CoinOrientation(yaw: 1.2, pitch: -0.4, zoom: 1);
      final zoomed = turned.zoomedBy(2);

      expect(zoomed.yaw, turned.yaw);
      expect(zoomed.pitch, turned.pitch);
    });

    test('a preset takes the short way round, not the long one', () {
      // Just short of a full turn: the shortest path to zero is forwards.
      const almostRound = CoinOrientation(
        yaw: math.pi * 2 - 0.2,
        pitch: 0,
        zoom: 1,
      );
      final halfway = almostRound.lerpTo(CoinOrientation.obverse, 0.5);

      expect(halfway.yaw, greaterThan(almostRound.yaw));
      expect(
        almostRound.lerpTo(CoinOrientation.obverse, 1).yaw,
        closeTo(math.pi * 2, 1e-9),
      );
    });
  });

  group('CoinPainter', () {
    testWidgets('draws the obverse as a warm disc', (tester) async {
      final frame = await _render(tester, model, CoinOrientation.obverse);

      expect(frame.opaqueAt(120, 120), isTrue, reason: 'the coin is drawn');
      final centre = frame.at(120, 120);
      expect(
        centre.red,
        greaterThan(centre.blue),
        reason: 'the obverse is the warm face',
      );
      // A disc, not a full square: the corners stay empty.
      expect(frame.opaqueAt(4, 4), isFalse);
      expect(frame.opaqueAt(120, 30), isTrue, reason: 'the disc is tall');
    });

    testWidgets('Reverse shows the other, cooler face', (tester) async {
      final frame = await _render(tester, model, CoinOrientation.reverse);

      expect(frame.opaqueAt(120, 120), isTrue);
      final centre = frame.at(120, 120);
      expect(
        centre.blue,
        greaterThan(centre.red),
        reason: 'the reverse is the cool face',
      );
    });

    testWidgets('Edge shows a thin band rather than a face', (tester) async {
      final frame = await _render(tester, model, CoinOrientation.edge);

      expect(frame.opaqueAt(120, 120), isTrue, reason: 'the edge is drawn');
      expect(
        frame.opaqueAt(120, 30),
        isFalse,
        reason: 'seen edge-on the coin is thin, so nothing is drawn up here',
      );
      expect(
        frame.opaqueAt(40, 120),
        isTrue,
        reason: 'and it is still as wide as the coin',
      );
    });

    testWidgets('zooming in makes the coin cover more of the view', (
      tester,
    ) async {
      const justOutside = 118; // Pixels from the centre, past the disc's rim.
      final normal = await _render(tester, model, CoinOrientation.obverse);
      final zoomed = await _render(
        tester,
        model,
        const CoinOrientation(yaw: 0, pitch: 0, zoom: 2),
      );

      expect(normal.opaqueAt(120 + justOutside, 120), isFalse);
      expect(zoomed.opaqueAt(120 + justOutside, 120), isTrue);
    });

    testWidgets('turning the coin changes what is drawn', (tester) async {
      final start = await _render(tester, model, CoinOrientation.obverse);
      final turned = await _render(
        tester,
        model,
        CoinOrientation.obverse.rotatedBy(const Offset(40, 25)),
      );

      expect(turned.bytes, isNot(start.bytes));
    });

    testWidgets('an empty view paints nothing rather than dividing by zero', (
      tester,
    ) async {
      final recorder = ui.PictureRecorder();
      CoinPainter(
        model: model,
        orientation: CoinOrientation.initial,
      ).paint(Canvas(recorder), Size.zero);

      expect(recorder.endRecording().dispose, returnsNormally);
    });
  });

  group('CoinModelView', () {
    Widget subject({
      required CoinOrientation orientation,
      required ValueChanged<CoinOrientation> onChanged,
    }) {
      return MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 300,
              height: 300,
              child: CoinModelView(
                model: model,
                orientation: orientation,
                onOrientationChanged: onChanged,
                semanticLabel: 'A neutral fictional coin, not a reproduction.',
              ),
            ),
          ),
        ),
      );
    }

    testWidgets('a drag reports a new orientation', (tester) async {
      final reported = <CoinOrientation>[];
      await tester.pumpWidget(
        subject(orientation: CoinOrientation.initial, onChanged: reported.add),
      );

      await tester.drag(find.byType(CoinModelView), const Offset(60, 0));
      await tester.pump();

      expect(reported, isNotEmpty);
      expect(reported.last.yaw, isNot(CoinOrientation.initial.yaw));
    });

    testWidgets(
      'describes itself to a screen reader without claiming to be real',
      (tester) async {
        final handle = tester.ensureSemantics();
        await tester.pumpWidget(
          subject(orientation: CoinOrientation.initial, onChanged: (_) {}),
        );

        expect(
          find.bySemanticsLabel(
            'A neutral fictional coin, not a reproduction.',
          ),
          findsOneWidget,
        );
        handle.dispose();
      },
    );
  });
}
