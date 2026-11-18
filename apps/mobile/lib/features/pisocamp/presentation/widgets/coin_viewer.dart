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

/// Projects the mesh and lights it as struck metal.
///
/// The mesh is flat-shaded by construction — the generator hands every
/// triangle its own three vertices carrying the face normal — so both coin
/// faces arrive here with the single normal (0, 0, ±1). Lit literally, a whole
/// face is one constant tone and the coin reads as a printed disc. Three
/// things put the metal back:
///
///  * the faces are shaded against a *domed* normal rather than their true
///    one, so light sweeps across the field and gathers on the rim the way it
///    does on a struck planchet;
///  * a tight specular lobe and a fresnel rim sit on top of the diffuse term,
///    because what separates metal from plastic on a screen is the highlight,
///    not the base colour;
///  * a screen-space sheen, clipped to the silhouette the mesh actually drew,
///    supplies the smooth component per-vertex interpolation cannot — a face
///    carries only seven rings of vertices to interpolate between.
///
/// The reeded edge keeps its true normals throughout: its facets *are* the
/// detail, and doming them would smear the reeding into a plain band.
@visibleForTesting
class CoinPainter extends CustomPainter {
  CoinPainter({required this.model, required this.orientation});

  final CoinModel model;
  final CoinOrientation orientation;

  /// A fixed key light in view space, so the shading reads as one lit object
  /// rather than following the coin as it turns. Above and to the left, which
  /// is where someone holding a coin under a room light expects it to be.
  static const _keyX = -0.30;
  static const _keyY = 0.42;
  static const _keyZ = 0.855;

  /// A dimmer, lower fill from the opposite corner, so the side turned away
  /// from the key reads as shadowed metal rather than as a hole in the coin.
  static const _fillX = 0.55;
  static const _fillY = -0.42;
  static const _fillZ = 0.72;

  static const _ambient = 0.26;
  static const _keyStrength = 0.58;
  static const _fillStrength = 0.26;

  /// How far each channel is pushed away from its own luminance before any
  /// light touches it. The generator's palette is a printed-ink gold; lit
  /// directly it comes out as pale sand, because a flat diffuse term raises
  /// every channel towards white together and chroma is what it costs.
  ///
  /// The push is scaled by how chromatic the vertex already is, over
  /// [_chromaFloor]. Applied flat it would take the reverse's near-neutral
  /// alloy — which is meant to read as nickel — and tip it into blue, because
  /// amplifying a tiny cast is all a saturation boost can do to a grey.
  static const _chroma = 1.38;
  static const _chromaFloor = 0.12;

  /// The key's half vector, for Blinn-Phong. The camera is orthographic at
  /// +Z, so `normalize(light + view)` is a constant and the specular costs one
  /// dot product and five multiplications per vertex.
  static const _halfX = -0.1558;
  static const _halfY = 0.2181;
  static const _halfZ = 0.9634;

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

    // The silhouette's bounds, gathered while projecting: the contact shadow
    // and the sheen are both sized from what the coin actually covers, so they
    // narrow with it when it turns edge-on.
    var minX = double.infinity;
    var maxX = -double.infinity;
    var minY = double.infinity;
    var maxY = -double.infinity;

    for (var vertex = 0; vertex < model.vertexCount; vertex += 1) {
      final x = model.positions[vertex * 3];
      final y = model.positions[vertex * 3 + 1];
      final z = model.positions[vertex * 3 + 2];
      final screenX = centre.dx + rotatedX(x, y, z) * scale;
      // Screen Y grows downwards while the model's Y grows upwards.
      final screenY = centre.dy - rotatedY(x, y, z) * scale;
      projectedX[vertex] = screenX;
      projectedY[vertex] = screenY;
      projectedZ[vertex] = rotatedZ(x, y, z);
      if (screenX < minX) minX = screenX;
      if (screenX > maxX) maxX = screenX;
      if (screenY < minY) minY = screenY;
      if (screenY > maxY) maxY = screenY;
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

    final bounds = Rect.fromLTRB(minX, minY, maxX, maxY);
    _paintContactShadow(canvas, bounds);

    final positions = Float32List(visible.length * 6);
    final colors = Int32List(visible.length * 3);
    for (var slot = 0; slot < visible.length; slot += 1) {
      final triangle = visible[slot];
      for (var corner = 0; corner < 3; corner += 1) {
        final vertex = model.indices[triangle * 3 + corner];
        positions[slot * 6 + corner * 2] = projectedX[vertex];
        positions[slot * 6 + corner * 2 + 1] = projectedY[vertex];
        // Shaded per vertex, not per triangle. The generator's normals are
        // per-face, so this is not smooth shading of the mesh — it is the
        // domed normal below varying across each triangle, which is the whole
        // reason the field gets a gradient instead of a flat tone.
        colors[slot * 3 + corner] = _shadeOf(
          vertex,
          rotatedX,
          rotatedY,
          rotatedZ,
        );
      }
    }

    final vertices = ui.Vertices.raw(
      ui.VertexMode.triangles,
      positions,
      colors: colors,
    );
    // The layer exists so the sheen can be clipped by the coin's own coverage.
    canvas.saveLayer(Offset.zero & size, Paint());
    // `BlendMode.dst` keeps the vertex colours and ignores the paint's colour,
    // which is what flat-shaded geometry wants.
    canvas.drawVertices(vertices, BlendMode.dst, Paint());
    vertices.dispose();
    _paintSheen(canvas, bounds);
    canvas.restore();
  }

  /// A soft pool under the coin.
  ///
  /// Without it the coin floats: an orthographic view carries nothing that
  /// says how far the object is from anything else. The pool is drawn from the
  /// silhouette's own width, and kept far below the opacity the disc itself
  /// reaches, so it reads as a shadow rather than as a second object.
  void _paintContactShadow(Canvas canvas, Rect bounds) {
    final width = bounds.width;
    if (width <= 0) return;
    final rect = Rect.fromCenter(
      // Offset along the key light's direction, so the shadow falls away from
      // the lit side instead of sitting symmetrically under the coin.
      center: Offset(
        bounds.center.dx + width * 0.045,
        bounds.bottom + width * 0.06,
      ),
      width: width * 0.92,
      height: width * 0.17,
    );
    canvas.drawOval(
      rect,
      Paint()
        ..color = const Color(0x332A2118)
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, width * 0.055),
    );
  }

  /// The smooth part of the highlight, laid over the silhouette the mesh has
  /// just drawn.
  ///
  /// `srcATop` does the clipping: it composites only where the layer already
  /// has coverage, so the sweep follows the reeded outline exactly without
  /// anyone having to compute that outline. It also leaves the layer's alpha
  /// untouched, so the coin gains light without gaining size.
  void _paintSheen(Canvas canvas, Rect bounds) {
    if (bounds.isEmpty) return;
    final sweep = Rect.fromCenter(
      center: bounds.center,
      width: bounds.width * 1.6,
      height: bounds.height * 1.6,
    );
    canvas.drawRect(
      sweep,
      Paint()
        ..blendMode = BlendMode.srcATop
        ..shader = ui.Gradient.linear(
          sweep.topLeft,
          sweep.bottomRight,
          const <Color>[
            Color(0x18FFFFFF),
            Color(0x00FFFFFF),
            Color(0x14FFFFFF),
            Color(0x26000000),
          ],
          const <double>[0.0, 0.34, 0.52, 1.0],
        ),
    );
  }

  int _shadeOf(
    int vertex,
    double Function(double, double, double) rotatedX,
    double Function(double, double, double) rotatedY,
    double Function(double, double, double) rotatedZ,
  ) {
    var nx = model.normals[vertex * 3];
    var ny = model.normals[vertex * 3 + 1];
    var nz = model.normals[vertex * 3 + 2];

    // The two faces, and only them: the edge's normals lie in the XY plane,
    // and they are the reeding.
    if (nz > 0.5 || nz < -0.5) {
      final x = model.positions[vertex * 3];
      final y = model.positions[vertex * 3 + 1];
      final planar = math.sqrt(x * x + y * y);
      if (planar > 1e-6) {
        final radial = planar / model.radius;
        final squared = radial * radial;
        final fourth = squared * squared;
        // A gentle lift across the field, and a rim that turns hard over the
        // last tenth of the radius. Both tilt the normal outwards along the
        // radius, never sideways, so the coin keeps its axial symmetry.
        final bevel = 0.26 * squared + 0.55 * fourth * fourth * squared;
        nx += (x / planar) * bevel;
        ny += (y / planar) * bevel;
        final length = math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= length;
        ny /= length;
        nz /= length;
      }
    }

    final viewX = rotatedX(nx, ny, nz);
    final viewY = rotatedY(nx, ny, nz);
    final viewZ = rotatedZ(nx, ny, nz);

    final key = viewX * _keyX + viewY * _keyY + viewZ * _keyZ;
    final fill = viewX * _fillX + viewY * _fillY + viewZ * _fillZ;
    // A dim floor rather than black, so a face turned away still reads as
    // metal rather than as a hole in the coin.
    var diffuse = _ambient;
    if (key > 0) diffuse += key * _keyStrength;
    if (fill > 0) diffuse += fill * _fillStrength;

    final specAngle = viewX * _halfX + viewY * _halfY + viewZ * _halfZ;
    var highlight = 0.0;
    if (specAngle > 0) {
      final squared = specAngle * specAngle;
      final fourth = squared * squared;
      // Two lobes: a tight one for the glint, a broad one for the polish
      // around it. One lobe alone reads either as a laser dot or as haze.
      // Both are kept well under 1 — a highlight that clips to white is a
      // highlight that has taken the band detail under it with it.
      final tight = _raisedTo32(specAngle);
      highlight = tight * tight * 0.44 + fourth * 0.10;
    }

    // Fresnel. Metal turned away from the camera throws light back along its
    // silhouette, and that is what draws the coin's outline without a stroke.
    final facing = viewZ < 0 ? -viewZ : viewZ;
    final grazing = 1 - facing;
    final grazingSquared = grazing * grazing;
    highlight += grazingSquared * grazingSquared * 0.20;

    // The three channels are lit together rather than one at a time: the
    // chroma push below is defined against the vertex's own luminance, which
    // no single channel knows on its own.
    final red = model.colors[vertex * 4] / 255;
    final green = model.colors[vertex * 4 + 1] / 255;
    final blue = model.colors[vertex * 4 + 2] / 255;
    final luma = red * 0.30 + green * 0.59 + blue * 0.11;
    final alpha = model.colors[vertex * 4 + 3];

    final fromLumaRed = red - luma;
    final fromLumaGreen = green - luma;
    final fromLumaBlue = blue - luma;
    var spread = fromLumaRed < 0 ? -fromLumaRed : fromLumaRed;
    final green0 = fromLumaGreen < 0 ? -fromLumaGreen : fromLumaGreen;
    if (green0 > spread) spread = green0;
    final blue0 = fromLumaBlue < 0 ? -fromLumaBlue : fromLumaBlue;
    if (blue0 > spread) spread = blue0;
    final push = spread >= _chromaFloor
        ? _chroma
        : 1 + (_chroma - 1) * (spread / _chromaFloor);

    return (alpha << 24) |
        (_channel(luma + fromLumaRed * push, diffuse, highlight) << 16) |
        (_channel(luma + fromLumaGreen * push, diffuse, highlight) << 8) |
        _channel(luma + fromLumaBlue * push, diffuse, highlight);
  }

  /// `x` to the 32nd by squaring rather than by `pow`. The specular is
  /// evaluated once per vertex per frame — around ten thousand times — and a
  /// library call there is the difference between a viewer that holds its
  /// frame budget while the coin spins and one that does not.
  static double _raisedTo32(double x) {
    final x2 = x * x;
    final x4 = x2 * x2;
    final x8 = x4 * x4;
    final x16 = x8 * x8;
    return x16 * x16;
  }

  /// One channel of lit metal, from an already chroma-pushed base.
  ///
  /// The highlight is only part-way whitened before it is added: a metal's
  /// specular carries the metal's own colour, and taking it all the way to
  /// white turns the gold face into chrome.
  static int _channel(double base, double diffuse, double highlight) {
    // A metal's tonal range is wider than a pigment's: its light values sit
    // lower than a flat albedo suggests, and that headroom is what keeps the
    // silver face reading as metal instead of as white plastic once the
    // highlight lands on it. Gamma 1.5, by one square root rather than `pow`.
    final clamped = base < 0 ? 0.0 : (base > 1 ? 1.0 : base);
    final deep = clamped * math.sqrt(clamped);
    final lit = deep * diffuse + (deep * 0.55 + 0.45) * highlight;
    final scaled = (lit * 255).round();
    return scaled < 0 ? 0 : (scaled > 255 ? 255 : scaled);
  }

  @override
  bool shouldRepaint(CoinPainter oldDelegate) =>
      !identical(oldDelegate.model, model) ||
      oldDelegate.orientation != orientation;
}
