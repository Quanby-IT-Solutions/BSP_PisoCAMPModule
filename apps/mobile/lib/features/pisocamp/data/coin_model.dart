import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

/// Why a coin could not be shown in 3D. The viewer reports one of these instead
/// of an exception message so the reason reaching the screen is always one of a
/// closed set.
enum CoinModelFailure {
  /// The catalog entry carries no model — banknotes, and security features.
  unavailable,

  /// The bundle holds no resource for the digest the catalog names.
  missingResource,

  /// The bytes are not a model this reader accepts.
  unreadable,
}

final class CoinModelException implements Exception {
  const CoinModelException(this.failure);

  final CoinModelFailure failure;

  @override
  String toString() => 'CoinModelException: ${failure.name}';
}

/// A triangle mesh read from a binary glTF document.
///
/// This is a deliberately narrow reader, not a glTF loader. It accepts exactly
/// the shape the PisoCAMP coin generator emits — one mesh, one triangle
/// primitive, interleaved-free float positions and normals, unsigned-byte
/// vertex colours and unsigned-short indices — and rejects everything else. A
/// bundle resource has already been checked against its manifest digest before
/// it arrives here, so the reader's job is to refuse anything it would have to
/// guess about rather than to be permissive.
final class CoinModel {
  const CoinModel._({
    required this.positions,
    required this.normals,
    required this.colors,
    required this.indices,
    required this.radius,
    required this.halfThickness,
  });

  /// Vertex positions, three floats per vertex.
  final Float32List positions;

  /// Per-vertex normals, three floats per vertex.
  final Float32List normals;

  /// Per-vertex RGBA, four bytes per vertex.
  final Uint8List colors;

  /// Triangle indices into the vertex arrays.
  final Uint16List indices;

  /// Largest distance from the origin in the XY plane.
  final double radius;

  /// Largest distance from the origin along Z.
  final double halfThickness;

  int get vertexCount => positions.length ~/ 3;
  int get triangleCount => indices.length ~/ 3;

  static const _maximumBytes = 8 * 1024 * 1024;
  static const _maximumVertices = 65536;
  static const _maximumIndices = 300000;
  static const _maximumJsonBytes = 256 * 1024;

  static const _componentFloat = 5126;
  static const _componentUnsignedByte = 5121;
  static const _componentUnsignedShort = 5123;
  static const _modeTriangles = 4;

  /// Parses [bytes] or throws [CoinModelException] with
  /// [CoinModelFailure.unreadable]. No other exception escapes.
  static CoinModel parse(Uint8List bytes) {
    try {
      return _parse(bytes);
    } on CoinModelException {
      rethrow;
    } on Object {
      throw const CoinModelException(CoinModelFailure.unreadable);
    }
  }

  static Never _unreadable() =>
      throw const CoinModelException(CoinModelFailure.unreadable);

  static CoinModel _parse(Uint8List bytes) {
    if (bytes.length < 20 || bytes.length > _maximumBytes) _unreadable();
    final header = ByteData.sublistView(bytes);
    if (header.getUint32(0, Endian.little) != 0x46546c67) _unreadable();
    if (header.getUint32(4, Endian.little) != 2) _unreadable();
    if (header.getUint32(8, Endian.little) != bytes.length) _unreadable();

    final jsonLength = header.getUint32(12, Endian.little);
    if (header.getUint32(16, Endian.little) != 0x4e4f534a) _unreadable();
    if (jsonLength == 0 ||
        jsonLength % 4 != 0 ||
        jsonLength > _maximumJsonBytes ||
        20 + jsonLength + 8 > bytes.length) {
      _unreadable();
    }

    final binaryHeaderOffset = 20 + jsonLength;
    final binaryLength = header.getUint32(binaryHeaderOffset, Endian.little);
    if (header.getUint32(binaryHeaderOffset + 4, Endian.little) != 0x004e4942) {
      _unreadable();
    }
    if (binaryHeaderOffset + 8 + binaryLength != bytes.length) _unreadable();
    final binary = Uint8List.sublistView(
      bytes,
      binaryHeaderOffset + 8,
      binaryHeaderOffset + 8 + binaryLength,
    );

    final decoded = jsonDecode(
      utf8.decode(
        Uint8List.sublistView(bytes, 20, 20 + jsonLength),
        allowMalformed: false,
      ),
    );
    if (decoded is! Map<String, Object?>) _unreadable();
    final document = _GltfDocument(decoded, binary);

    final meshes = document.list('meshes');
    if (meshes.length != 1) _unreadable();
    final mesh = meshes.first;
    if (mesh is! Map<String, Object?>) _unreadable();
    final primitives = mesh['primitives'];
    if (primitives is! List<Object?> || primitives.length != 1) _unreadable();
    final primitive = primitives.first;
    if (primitive is! Map<String, Object?>) _unreadable();
    if ((primitive['mode'] ?? _modeTriangles) != _modeTriangles) _unreadable();

    final attributes = primitive['attributes'];
    if (attributes is! Map<String, Object?>) _unreadable();

    final positions = document.floatAccessor(
      attributes['POSITION'],
      components: 3,
      type: 'VEC3',
    );
    final vertexCount = positions.length ~/ 3;
    if (vertexCount == 0 || vertexCount > _maximumVertices) _unreadable();

    final normals = document.floatAccessor(
      attributes['NORMAL'],
      components: 3,
      type: 'VEC3',
    );
    if (normals.length != positions.length) _unreadable();

    final colors = document.byteAccessor(
      attributes['COLOR_0'],
      components: 4,
      type: 'VEC4',
    );
    if (colors.length != vertexCount * 4) _unreadable();

    final indices = document.indexAccessor(primitive['indices']);
    if (indices.isEmpty ||
        indices.length % 3 != 0 ||
        indices.length > _maximumIndices) {
      _unreadable();
    }
    for (final index in indices) {
      if (index >= vertexCount) _unreadable();
    }

    var radius = 0.0;
    var halfThickness = 0.0;
    for (var vertex = 0; vertex < vertexCount; vertex += 1) {
      final x = positions[vertex * 3];
      final y = positions[vertex * 3 + 1];
      final z = positions[vertex * 3 + 2];
      if (!x.isFinite || !y.isFinite || !z.isFinite) _unreadable();
      final planar = x * x + y * y;
      if (planar > radius) radius = planar;
      final depth = z.abs();
      if (depth > halfThickness) halfThickness = depth;
    }
    radius = radius <= 0 ? 0 : math.sqrt(radius);
    if (radius <= 0) _unreadable();

    return CoinModel._(
      positions: positions,
      normals: normals,
      colors: colors,
      indices: indices,
      radius: radius,
      halfThickness: halfThickness,
    );
  }
}

final class _GltfDocument {
  const _GltfDocument(this._json, this._binary);

  final Map<String, Object?> _json;
  final Uint8List _binary;

  List<Object?> list(String key) {
    final value = _json[key];
    if (value is! List<Object?>) CoinModel._unreadable();
    return value;
  }

  Map<String, Object?> _accessor(Object? index) {
    if (index is! int || index < 0) CoinModel._unreadable();
    final accessors = list('accessors');
    if (index >= accessors.length) CoinModel._unreadable();
    final accessor = accessors[index];
    if (accessor is! Map<String, Object?>) CoinModel._unreadable();
    return accessor;
  }

  /// A bufferView's slice of the single embedded binary chunk. Interleaving is
  /// refused rather than supported: the generator never emits it.
  Uint8List _view(Object? index, {required int requiredLength}) {
    if (index is! int || index < 0) CoinModel._unreadable();
    final views = list('bufferViews');
    if (index >= views.length) CoinModel._unreadable();
    final view = views[index];
    if (view is! Map<String, Object?>) CoinModel._unreadable();
    if ((view['buffer'] ?? 0) != 0) CoinModel._unreadable();
    if (view.containsKey('byteStride')) CoinModel._unreadable();
    final offset = view['byteOffset'] ?? 0;
    final length = view['byteLength'];
    if (offset is! int || length is! int || offset < 0 || length < 0) {
      CoinModel._unreadable();
    }
    if (length < requiredLength) CoinModel._unreadable();
    // The declared length must fit the chunk too, not merely the part read:
    // a view that claims more than the buffer holds is a malformed document.
    if (offset + length > _binary.length) CoinModel._unreadable();
    return Uint8List.sublistView(_binary, offset, offset + requiredLength);
  }

  int _count(Map<String, Object?> accessor, String type, int componentType) {
    if (accessor['type'] != type) CoinModel._unreadable();
    if (accessor['componentType'] != componentType) CoinModel._unreadable();
    final count = accessor['count'];
    if (count is! int || count <= 0) CoinModel._unreadable();
    return count;
  }

  Float32List floatAccessor(
    Object? index, {
    required int components,
    required String type,
  }) {
    final accessor = _accessor(index);
    final count = _count(accessor, type, CoinModel._componentFloat);
    final bytes = _view(
      accessor['bufferView'],
      requiredLength: count * components * 4,
    );
    // A copy, because a Float32List view demands four-byte alignment that a
    // bufferView offset does not promise.
    final values = Float32List(count * components);
    final data = ByteData.sublistView(bytes);
    for (var element = 0; element < values.length; element += 1) {
      values[element] = data.getFloat32(element * 4, Endian.little);
    }
    return values;
  }

  Uint8List byteAccessor(
    Object? index, {
    required int components,
    required String type,
  }) {
    final accessor = _accessor(index);
    if (accessor['normalized'] != true) CoinModel._unreadable();
    final count = _count(accessor, type, CoinModel._componentUnsignedByte);
    return Uint8List.fromList(
      _view(accessor['bufferView'], requiredLength: count * components),
    );
  }

  Uint16List indexAccessor(Object? index) {
    final accessor = _accessor(index);
    final count = _count(accessor, 'SCALAR', CoinModel._componentUnsignedShort);
    final bytes = _view(accessor['bufferView'], requiredLength: count * 2);
    final values = Uint16List(count);
    final data = ByteData.sublistView(bytes);
    for (var element = 0; element < count; element += 1) {
      values[element] = data.getUint16(element * 2, Endian.little);
    }
    return values;
  }
}
