import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:mobile/features/pisocamp/data/coin_model.dart';

/// Where the camera is relative to the coin, and how close.
///
/// Yaw turns the coin about the vertical axis, pitch about the horizontal one,
/// and zoom scales it within fixed limits. The identity orientation looks
/// straight at the obverse, which is the face the generator puts on +Z.
@immutable
final class CoinOrientation {
  const CoinOrientation({
    required this.yaw,
    required this.pitch,
    required this.zoom,
  });

  static const minimumZoom = 0.6;
  static const maximumZoom = 3.0;
  static const zoomStep = 1.25;

  static const obverse = CoinOrientation(yaw: 0, pitch: 0, zoom: 1);
  static const reverse = CoinOrientation(yaw: math.pi, pitch: 0, zoom: 1);
  static const edge = CoinOrientation(yaw: 0, pitch: math.pi / 2, zoom: 1);

  /// The view Reset returns to.
  static const initial = obverse;

  final double yaw;
  final double pitch;
  final double zoom;

  CoinOrientation rotatedBy(Offset delta) {
    // A drag of the view's shorter side turns the coin roughly half a turn.
    const radiansPerPixel = math.pi / 320;
    return CoinOrientation(
      yaw: yaw + delta.dx * radiansPerPixel,
      pitch: pitch - delta.dy * radiansPerPixel,
      zoom: zoom,
    );
  }

  CoinOrientation zoomedBy(double factor) {
    final scaled = zoom * factor;
    return CoinOrientation(
      yaw: yaw,
      pitch: pitch,
      zoom: scaled < minimumZoom
          ? minimumZoom
          : scaled > maximumZoom
          ? maximumZoom
          : scaled,
    );
  }

  bool get canZoomIn => zoom < maximumZoom - 1e-9;
  bool get canZoomOut => zoom > minimumZoom + 1e-9;

  /// Interpolates towards [end] along the shortest turn, so animating from a
  /// hand-dragged angle never spins the long way round.
  CoinOrientation lerpTo(CoinOrientation end, double t) {
    return CoinOrientation(
      yaw: yaw + _shortestTurn(yaw, end.yaw) * t,
      pitch: pitch + _shortestTurn(pitch, end.pitch) * t,
      zoom: zoom + (end.zoom - zoom) * t,
    );
  }

  static double _shortestTurn(double from, double to) {
    const fullTurn = math.pi * 2;
    var difference = (to - from) % fullTurn;
    if (difference > math.pi) difference -= fullTurn;
    if (difference < -math.pi) difference += fullTurn;
    return difference;
  }

  @override
  bool operator ==(Object other) =>
      other is CoinOrientation &&
      other.yaw == yaw &&
      other.pitch == pitch &&
      other.zoom == zoom;

  @override
  int get hashCode => Object.hash(yaw, pitch, zoom);
}

/// Renders a [CoinModel] and turns drag and pinch into orientation changes.
///
/// The model is drawn by projecting its triangles here rather than by a native
/// 3D plugin: the coin is a small, closed mesh, the bytes are already verified
/// against the bundle manifest, and a widget that draws with the framework's
/// own canvas keeps the viewer working offline on every platform the app
/// targets, including in tests.
class CoinModelView extends StatelessWidget {
  const CoinModelView({
    super.key,
    required this.model,
    required this.orientation,
    required this.onOrientationChanged,
    required this.semanticLabel,
  });

  final CoinModel model;
  final CoinOrientation orientation;
  final ValueChanged<CoinOrientation> onOrientationChanged;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semanticLabel,
      image: true,
      container: true,
      child: ExcludeSemantics(
        child: _CoinGestureSurface(
          orientation: orientation,
          onOrientationChanged: onOrientationChanged,
          child: CustomPaint(
            painter: CoinPainter(model: model, orientation: orientation),
            child: const SizedBox.expand(),
          ),
        ),
      ),
    );
  }
}

class _CoinGestureSurface extends StatefulWidget {
  const _CoinGestureSurface({
    required this.orientation,
    required this.onOrientationChanged,
    required this.child,
  });

  final CoinOrientation orientation;
  final ValueChanged<CoinOrientation> onOrientationChanged;
  final Widget child;

  @override
  State<_CoinGestureSurface> createState() => _CoinGestureSurfaceState();
}

class _CoinGestureSurfaceState extends State<_CoinGestureSurface> {
  double _lastScale = 1;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onScaleStart: (details) => _lastScale = 1,
      onScaleUpdate: (details) {
        // One gesture recogniser serves both: a single pointer drags, two
        // pointers additionally pinch, and both may happen at once.
        var next = widget.orientation.rotatedBy(details.focalPointDelta);
        if (details.pointerCount > 1 && details.scale > 0) {
          final step = details.scale / _lastScale;
          _lastScale = details.scale;
          next = next.zoomedBy(step);
        }
        widget.onOrientationChanged(next);
      },
      child: widget.child,
    );
  }
}

/// Projects the mesh and paints it with flat per-triangle shading.
@visibleForTesting
class CoinPainter extends CustomPainter {
  CoinPainter({required this.model, required this.orientation});

  final CoinModel model;
  final CoinOrientation orientation;

  /// A fixed key light in view space, so the shading reads as one lit object
  /// rather than following the coin as it turns.
  static const _lightX = 0.35;
  static const _lightY = -0.45;
  static const _lightZ = 0.82;
  static const _ambient = 0.34;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final sine = math.sin(orientation.yaw);
    final cosine = math.cos(orientation.yaw);
    final pitchSine = math.sin(orientation.pitch);
    final pitchCosine = math.cos(orientation.pitch);

    // Rotate about X (pitch) then about Y (yaw), so a horizontal drag always
    // spins the coin about the screen's vertical axis.
    double rotatedX(double x, double y, double z) =>
        cosine * x + sine * (y * pitchSine + z * pitchCosine);
    double rotatedY(double x, double y, double z) =>
        y * pitchCosine - z * pitchSine;
    double rotatedZ(double x, double y, double z) =>
        -sine * x + cosine * (y * pitchSine + z * pitchCosine);

    final extent = math.max(model.radius, model.halfThickness);
    final scale =
        (math.min(size.width, size.height) / (2 * extent)) *
        0.86 *
        orientation.zoom;
    final centre = Offset(size.width / 2, size.height / 2);

    final triangleCount = model.triangleCount;
    final depths = Float32List(triangleCount);
    final projectedX = Float32List(model.vertexCount);
    final projectedY = Float32List(model.vertexCount);
    final projectedZ = Float32List(model.vertexCount);

    for (var vertex = 0; vertex < model.vertexCount; vertex += 1) {
      final x = model.positions[vertex * 3];
      final y = model.positions[vertex * 3 + 1];
      final z = model.positions[vertex * 3 + 2];
      projectedX[vertex] = centre.dx + rotatedX(x, y, z) * scale;
      // Screen Y grows downwards while the model's Y grows upwards.
      projectedY[vertex] = centre.dy - rotatedY(x, y, z) * scale;
      projectedZ[vertex] = rotatedZ(x, y, z);
    }

    final visible = <int>[];
    for (var triangle = 0; triangle < triangleCount; triangle += 1) {
      final a = model.indices[triangle * 3];
      final b = model.indices[triangle * 3 + 1];
      final c = model.indices[triangle * 3 + 2];
      final area =
          (projectedX[b] - projectedX[a]) * (projectedY[c] - projectedY[a]) -
          (projectedX[c] - projectedX[a]) * (projectedY[b] - projectedY[a]);
      // Screen Y is flipped, so a front face winds clockwise on screen and its
      // signed area comes out negative.
      if (area >= 0) continue;
      depths[triangle] = (projectedZ[a] + projectedZ[b] + projectedZ[c]) / 3;
      visible.add(triangle);
    }
    if (visible.isEmpty) return;

    // Back to front: the reeded edge is not convex, so culling alone can leave
    // a valley facet drawn over the peak in front of it.
    visible.sort((left, right) => depths[left].compareTo(depths[right]));

    final positions = Float32List(visible.length * 6);
    final colors = Int32List(visible.length * 3);
    for (var slot = 0; slot < visible.length; slot += 1) {
      final triangle = visible[slot];
      final first = model.indices[triangle * 3];
      final shade = _shadeOf(first, rotatedX, rotatedY, rotatedZ);
      for (var corner = 0; corner < 3; corner += 1) {
        final vertex = model.indices[triangle * 3 + corner];
        positions[slot * 6 + corner * 2] = projectedX[vertex];
        positions[slot * 6 + corner * 2 + 1] = projectedY[vertex];
        colors[slot * 3 + corner] = shade;
      }
    }

    final vertices = ui.Vertices.raw(
      ui.VertexMode.triangles,
      positions,
      colors: colors,
    );
    // `BlendMode.dst` keeps the vertex colours and ignores the paint's colour,
    // which is what flat-shaded geometry wants.
    canvas.drawVertices(vertices, BlendMode.dst, Paint());
    vertices.dispose();
  }

  int _shadeOf(
    int vertex,
    double Function(double, double, double) rotatedX,
    double Function(double, double, double) rotatedY,
    double Function(double, double, double) rotatedZ,
  ) {
    final nx = model.normals[vertex * 3];
    final ny = model.normals[vertex * 3 + 1];
    final nz = model.normals[vertex * 3 + 2];
    final viewX = rotatedX(nx, ny, nz);
    final viewY = rotatedY(nx, ny, nz);
    final viewZ = rotatedZ(nx, ny, nz);
    final lambert = viewX * _lightX + viewY * _lightY + viewZ * _lightZ;
    // A dim floor rather than black, so a face turned away still reads as
    // metal rather than as a hole in the coin.
    final intensity = _ambient + (lambert > 0 ? lambert * 0.66 : 0);

    final red = model.colors[vertex * 4];
    final green = model.colors[vertex * 4 + 1];
    final blue = model.colors[vertex * 4 + 2];
    final alpha = model.colors[vertex * 4 + 3];
    return (alpha << 24) |
        (_channel(red, intensity) << 16) |
        (_channel(green, intensity) << 8) |
        _channel(blue, intensity);
  }

  static int _channel(int value, double intensity) {
    final scaled = (value * intensity).round();
    return scaled < 0 ? 0 : (scaled > 255 ? 255 : scaled);
  }

  @override
  bool shouldRepaint(CoinPainter oldDelegate) =>
      !identical(oldDelegate.model, model) ||
      oldDelegate.orientation != orientation;
}
