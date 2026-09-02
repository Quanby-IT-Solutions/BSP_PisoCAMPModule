import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as hashes;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/features/pisocamp/data/preview_build.dart';
import 'package:mobile/features/pisocamp/presentation/screens/pisocamp_preview_screen.dart';
import 'package:mobile/services/api/api_client.dart';

const _assetId = '3d4e4d1b-6a44-4d8f-8a5c-3f47c0a4a204';
const _token = 'v1.eyJhIjoxfQ.c2lnbmF0dXJl';

final _imageBytes = Uint8List.fromList(utf8.encode('preview-image-bytes'));
final _imageDigest = hashes.sha256.convert(_imageBytes).toString();

Map<String, Object?> _previewJson() => {
  'itemId': '0a1e4d1b-6a44-4d8f-8a5c-3f47c0a4a201',
  'versionId': '1b2e4d1b-6a44-4d8f-8a5c-3f47c0a4a202',
  'versionNo': 3,
  'status': 'approved',
  'contentType': 'advisory',
  'content': {
    'contentType': 'advisory',
    'title': 'Handle banknotes with care',
    'summary': 'Approved advisory copy under review.',
    'body': 'Do not fold, staple or write on Philippine banknotes.',
  },
  'relatedLinks': const <Object?>[],
  'assets': [
    {
      'role': 'obverse',
      'assetId': _assetId,
      'mediaType': 'image/png',
      'byteLength': 19,
      'sha256': _imageDigest,
    },
  ],
  'generatedAt': '2026-09-02T01:00:00.000Z',
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final requestedPaths = <String>[];

  Dio previewDio() {
    requestedPaths.clear();
    final dio = Dio();
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requestedPaths.add(options.path);
          final isAsset = options.path.contains('/preview/resources/');
          handler.resolve(
            Response<Object?>(
              requestOptions: options,
              statusCode: 200,
              data: isAsset ? _imageBytes : _previewJson(),
            ),
          );
        },
      ),
    );
    return dio;
  }

  Widget subject({String? initialCode}) => ProviderScope(
    overrides: [dioProvider.overrideWithValue(previewDio())],
    child: MaterialApp(home: PisoCampPreviewScreen(initialCode: initialCode)),
  );

  test('the preview route exists only in a preview build', () {
    expect(
      resolveAppRedirect(
        isOnboardingDone: true,
        isAuthenticated: false,
        matchedLocation: AppRoutes.pisoCampPreview,
      ),
      kPisoCampPreviewBuild ? isNull : AppRoutes.login,
    );
  });

  if (!kPisoCampPreviewBuild) {
    testWidgets('a store build refuses to render any preview', (tester) async {
      await tester.pumpWidget(subject(initialCode: _token));
      await tester.pumpAndSettle();

      expect(
        find.text(
          'Content preview is available only in a BSP-approved preview build.',
        ),
        findsOneWidget,
      );
      expect(find.text('Handle banknotes with care'), findsNothing);
      expect(requestedPaths, isEmpty);
    });
    return;
  }

  testWidgets('renders a scanned version once and labels it unpublished', (
    tester,
  ) async {
    await tester.pumpWidget(subject(initialCode: _token));
    await tester.pumpAndSettle();

    expect(find.text('Preview only — not published'), findsOneWidget);
    expect(find.text('Handle banknotes with care'), findsOneWidget);
    expect(find.text('Version 3 · approved'), findsOneWidget);
    expect(
      find.text('Do not fold, staple or write on Philippine banknotes.'),
      findsOneWidget,
    );
    expect(find.byType(Image), findsOneWidget);

    final previewRequests =
        requestedPaths.where((path) => path.endsWith('/pisocamp/preview')).length;
    expect(previewRequests, 1);

    // A rebuild must not re-fetch: the render is bound to the scanned code.
    await tester.pump();
    await tester.pumpAndSettle();
    expect(
      requestedPaths.where((path) => path.endsWith('/pisocamp/preview')).length,
      1,
    );
  });

  testWidgets('accepts a scanned redemption URL as the preview code', (
    tester,
  ) async {
    await tester.pumpWidget(
      subject(initialCode: 'https://api.example.test/api/v1/pisocamp/preview?token=$_token'),
    );
    await tester.pumpAndSettle();

    expect(find.text('Handle banknotes with care'), findsOneWidget);
  });

  testWidgets('refuses an unusable code before any network call', (
    tester,
  ) async {
    await tester.pumpWidget(subject());
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'not-a-preview-code');
    await tester.tap(find.text('Render preview'));
    await tester.pumpAndSettle();

    expect(
      find.text('That preview code is not valid. Scan or paste it again.'),
      findsOneWidget,
    );
    expect(requestedPaths, isEmpty);
    expect(find.text('Handle banknotes with care'), findsNothing);
  });

  testWidgets('renders a pasted code and stays readable at 200 percent text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [dioProvider.overrideWithValue(previewDio())],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: const TextScaler.linear(2),
            ),
            child: child!,
          ),
          home: const PisoCampPreviewScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), _token);
    await tester.ensureVisible(find.text('Render preview'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Render preview'));
    await tester.pumpAndSettle();

    expect(find.text('Handle banknotes with care'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
