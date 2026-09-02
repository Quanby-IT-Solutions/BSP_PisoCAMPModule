import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as hashes;
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/preview_build.dart';
import 'package:mobile/features/pisocamp/data/preview_repository.dart';

const itemId = '0a1e4d1b-6a44-4d8f-8a5c-3f47c0a4a201';
const versionId = '1b2e4d1b-6a44-4d8f-8a5c-3f47c0a4a202';
const assetId = '3d4e4d1b-6a44-4d8f-8a5c-3f47c0a4a204';
const token = 'v1.eyJhIjoxfQ.c2lnbmF0dXJl';

final imageBytes = Uint8List.fromList(utf8.encode('preview-image-bytes'));
final imageDigest = hashes.sha256.convert(imageBytes).toString();

Map<String, Object?> previewJson({Map<String, Object?> overrides = const {}}) {
  return {
    'itemId': itemId,
    'versionId': versionId,
    'versionNo': 3,
    'status': 'approved',
    'contentType': 'advisory',
    'content': {
      'contentType': 'advisory',
      'title': 'Handle banknotes with care',
      'summary': 'Approved advisory copy under review.',
      'body': 'Do not fold, staple or write on Philippine banknotes.',
    },
    'relatedLinks': [
      {
        'id': '2f08ac0e-8a78-4cee-b37c-88e2d63d8f8f',
        'position': 0,
        'kind': 'external',
        'label': 'BSP currency page',
        'url': 'https://www.bsp.gov.ph/currency',
      },
    ],
    'assets': [
      {
        'role': 'obverse',
        'assetId': assetId,
        'mediaType': 'image/png',
        'byteLength': imageBytes.length,
        'sha256': imageDigest,
      },
    ],
    'generatedAt': '2026-09-02T01:00:00.000Z',
    ...overrides,
  };
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final requested = <RequestOptions>[];

  Dio dioServing({Object? preview, Object? assetBody, int status = 200}) {
    requested.clear();
    final dio = Dio();
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requested.add(options);
          final isAsset = options.path.contains('/preview/resources/');
          if (status != 200) {
            handler.reject(
              DioException(
                requestOptions: options,
                response: Response<Object?>(
                  requestOptions: options,
                  statusCode: status,
                ),
                type: DioExceptionType.badResponse,
              ),
            );
            return;
          }
          handler.resolve(
            Response<Object?>(
              requestOptions: options,
              statusCode: 200,
              data: isAsset ? assetBody : preview,
            ),
          );
        },
      ),
    );
    return dio;
  }

  group('readPisoCampPreviewToken', () {
    test('accepts a bare grant and a scanned redemption URL', () {
      expect(readPisoCampPreviewToken('  $token '), token);
      expect(
        readPisoCampPreviewToken(
          'https://api.example.test/api/v1/pisocamp/preview?token=$token',
        ),
        token,
      );
    });

    test('refuses anything that is not a grant', () {
      expect(readPisoCampPreviewToken(''), isNull);
      expect(readPisoCampPreviewToken('v1.only-two-parts'), isNull);
      expect(readPisoCampPreviewToken('v2.aaa.bbb'), isNull);
      expect(readPisoCampPreviewToken('https://example.test/preview'), isNull);
      expect(
        readPisoCampPreviewToken('https://example.test/preview?token=nope'),
        isNull,
      );
      expect(readPisoCampPreviewToken('v1.${'a' * 4000}.bbb'), isNull);
    });
  });

  group('PisoCampPreviewRepository', () {
    test('loads a previewable version and carries the grant as a query', () async {
      final repository = PisoCampPreviewRepository(
        dioServing(preview: previewJson()),
      );

      final document = await repository.load(token);

      expect(document.itemId, itemId);
      expect(document.versionNo, 3);
      expect(document.status, 'approved');
      expect(document.title, 'Handle banknotes with care');
      expect(document.relatedLinks.single.label, 'BSP currency page');
      expect(document.assets.single.assetId, assetId);
      expect(requested.single.path, endsWith('/pisocamp/preview'));
      expect(requested.single.queryParameters['token'], token);
      expect(requested.single.headers['cache-control'], 'no-store');
    });

    test('refuses a payload claiming a published version', () async {
      final repository = PisoCampPreviewRepository(
        dioServing(preview: previewJson(overrides: {'status': 'published'})),
      );

      await expectLater(
        repository.load(token),
        throwsA(
          isA<PisoCampPreviewException>().having(
            (error) => error.code,
            'code',
            'invalid_preview',
          ),
        ),
      );
    });

    test('reports an expired grant distinctly from a transport failure', () async {
      await expectLater(
        PisoCampPreviewRepository(dioServing(status: 401)).load(token),
        throwsA(
          isA<PisoCampPreviewException>().having(
            (error) => error.code,
            'code',
            'expired_preview',
          ),
        ),
      );
      await expectLater(
        PisoCampPreviewRepository(dioServing(status: 503)).load(token),
        throwsA(
          isA<PisoCampPreviewException>().having(
            (error) => error.code,
            'code',
            'preview_unavailable',
          ),
        ),
      );
    });

    test('returns attachment bytes only when they match the announced digest', () async {
      final repository = PisoCampPreviewRepository(
        dioServing(preview: previewJson(), assetBody: imageBytes),
      );
      final document = await repository.load(token);

      final bytes = await repository.loadAsset(token, document.assets.single);
      expect(bytes, imageBytes);
      expect(requested.last.path, contains('/pisocamp/preview/resources/$assetId'));
      expect(requested.last.queryParameters['token'], token);

      final tampered = PisoCampPreviewRepository(
        dioServing(
          preview: previewJson(),
          assetBody: Uint8List.fromList(utf8.encode('preview-image-bytez')),
        ),
      );
      final tamperedDocument = await tampered.load(token);
      await expectLater(
        tampered.loadAsset(token, tamperedDocument.assets.single),
        throwsA(
          isA<PisoCampPreviewException>().having(
            (error) => error.code,
            'code',
            'preview_asset_mismatch',
          ),
        ),
      );
    });
  });
}
