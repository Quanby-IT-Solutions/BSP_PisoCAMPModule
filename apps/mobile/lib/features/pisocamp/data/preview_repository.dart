import 'dart:typed_data';

import 'package:crypto/crypto.dart' as hashes;
import 'package:dio/dio.dart';
import 'package:mobile/core/constants/api_constants.dart';

const int _maximumPreviewAssetBytes = 52428800;
final RegExp _sha256Pattern = RegExp(r'^[a-f0-9]{64}$');
final RegExp _uuidPattern = RegExp(
  r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
);

const Set<String> _previewableStatuses = {
  'draft',
  'submitted_for_review',
  'approved',
};

final class PisoCampPreviewException implements Exception {
  const PisoCampPreviewException(this.code);

  final String code;

  @override
  String toString() => 'PisoCampPreviewException($code)';
}

final class PisoCampPreviewAsset {
  const PisoCampPreviewAsset({
    required this.role,
    required this.assetId,
    required this.mediaType,
    required this.byteLength,
    required this.sha256,
  });

  final String role;
  final String assetId;
  final String mediaType;
  final int byteLength;
  final String sha256;

  bool get isImage => mediaType.startsWith('image/');
  bool get isAudio => mediaType.startsWith('audio/');

  factory PisoCampPreviewAsset.fromJson(Map<Object?, Object?> json) {
    final role = json['role'];
    final assetId = json['assetId'];
    final mediaType = json['mediaType'];
    final byteLength = json['byteLength'];
    final sha256 = json['sha256'];
    if (role is! String ||
        assetId is! String ||
        !_uuidPattern.hasMatch(assetId) ||
        mediaType is! String ||
        byteLength is! int ||
        byteLength < 1 ||
        byteLength > _maximumPreviewAssetBytes ||
        sha256 is! String ||
        !_sha256Pattern.hasMatch(sha256)) {
      throw const PisoCampPreviewException('invalid_preview');
    }
    return PisoCampPreviewAsset(
      role: role,
      assetId: assetId,
      mediaType: mediaType,
      byteLength: byteLength,
      sha256: sha256,
    );
  }
}

final class PisoCampPreviewRelatedLink {
  const PisoCampPreviewRelatedLink({required this.label, required this.detail});

  final String label;
  final String detail;

  factory PisoCampPreviewRelatedLink.fromJson(Map<Object?, Object?> json) {
    final label = json['label'];
    final kind = json['kind'];
    if (label is! String || kind is! String) {
      throw const PisoCampPreviewException('invalid_preview');
    }
    final detail = switch (kind) {
      'external' => json['url'],
      'internal' => json['route'],
      'topic' => json['targetContentItemId'],
      _ => null,
    };
    if (detail is! String) throw const PisoCampPreviewException('invalid_preview');
    return PisoCampPreviewRelatedLink(label: label, detail: detail);
  }
}

/// One pre-publication version, held in memory for the length of one preview.
final class PisoCampPreviewDocument {
  const PisoCampPreviewDocument({
    required this.itemId,
    required this.versionId,
    required this.versionNo,
    required this.status,
    required this.contentType,
    required this.title,
    required this.summary,
    required this.body,
    required this.relatedLinks,
    required this.assets,
  });

  final String itemId;
  final String versionId;
  final int versionNo;
  final String status;
  final String contentType;
  final String title;
  final String summary;
  final String? body;
  final List<PisoCampPreviewRelatedLink> relatedLinks;
  final List<PisoCampPreviewAsset> assets;

  factory PisoCampPreviewDocument.fromJson(Object? data) {
    if (data is! Map) throw const PisoCampPreviewException('invalid_preview');
    final itemId = data['itemId'];
    final versionId = data['versionId'];
    final versionNo = data['versionNo'];
    final status = data['status'];
    final contentType = data['contentType'];
    final content = data['content'];
    final relatedLinks = data['relatedLinks'];
    final assets = data['assets'];
    if (itemId is! String ||
        !_uuidPattern.hasMatch(itemId) ||
        versionId is! String ||
        !_uuidPattern.hasMatch(versionId) ||
        versionNo is! int ||
        versionNo < 1 ||
        status is! String ||
        !_previewableStatuses.contains(status) ||
        contentType is! String ||
        content is! Map ||
        relatedLinks is! List ||
        assets is! List) {
      throw const PisoCampPreviewException('invalid_preview');
    }

    final title = content['title'];
    final summary = content['summary'];
    final body = content['body'];
    if (title is! String ||
        summary is! String ||
        (body != null && body is! String) ||
        content['contentType'] != contentType) {
      throw const PisoCampPreviewException('invalid_preview');
    }

    return PisoCampPreviewDocument(
      itemId: itemId,
      versionId: versionId,
      versionNo: versionNo,
      status: status,
      contentType: contentType,
      title: title,
      summary: summary,
      body: body as String?,
      relatedLinks: relatedLinks
          .map(
            (link) => PisoCampPreviewRelatedLink.fromJson(
              link as Map<Object?, Object?>,
            ),
          )
          .toList(growable: false),
      assets: assets
          .map(
            (asset) =>
                PisoCampPreviewAsset.fromJson(asset as Map<Object?, Object?>),
          )
          .toList(growable: false),
    );
  }
}

/// Reads one preview grant.
///
/// Deliberately holds no store, no cache and no file handle. A preview is
/// unapproved content: it lives in the widget that asked for it and dies with
/// it, and it can never reach the offline bundle the published experience
/// reads from.
final class PisoCampPreviewRepository {
  const PisoCampPreviewRepository(this._dio);

  final Dio _dio;

  Future<PisoCampPreviewDocument> load(String token) async {
    final Response<Object?> response;
    try {
      response = await _dio.get<Object?>(
        ApiConstants.pisoCampPreview,
        queryParameters: {'token': token},
        options: Options(
          responseType: ResponseType.json,
          headers: const {'cache-control': 'no-store'},
        ),
      );
    } on DioException catch (error) {
      throw PisoCampPreviewException(
        error.response?.statusCode == 401 ? 'expired_preview' : 'preview_unavailable',
      );
    }
    return PisoCampPreviewDocument.fromJson(response.data);
  }

  /// Fetch one attachment and prove it is the exact byte sequence announced.
  Future<Uint8List> loadAsset(String token, PisoCampPreviewAsset asset) async {
    final Response<List<int>> response;
    try {
      response = await _dio.get<List<int>>(
        ApiConstants.pisoCampPreviewResource(asset.assetId),
        queryParameters: {'token': token},
        options: Options(
          responseType: ResponseType.bytes,
          headers: const {'cache-control': 'no-store'},
        ),
      );
    } on DioException catch (error) {
      throw PisoCampPreviewException(
        error.response?.statusCode == 401 ? 'expired_preview' : 'preview_unavailable',
      );
    }

    final bytes = Uint8List.fromList(response.data ?? const <int>[]);
    if (bytes.length != asset.byteLength ||
        hashes.sha256.convert(bytes).toString() != asset.sha256) {
      throw const PisoCampPreviewException('preview_asset_mismatch');
    }
    return bytes;
  }
}
