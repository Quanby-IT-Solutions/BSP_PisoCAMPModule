import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as hashes;
import 'package:cryptography/cryptography.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';

final class TestBundleResource {
  const TestBundleResource({
    required this.logicalId,
    required this.bytes,
    this.kind = BundleEntryKind.content,
    this.mediaType = 'application/json',
    this.contentItemId,
    this.contentVersionId,
  });

  final String logicalId;
  final Uint8List bytes;
  final BundleEntryKind kind;
  final String mediaType;
  final String? contentItemId;
  final String? contentVersionId;

  String get digest => hashes.sha256.convert(bytes).toString();
}

final class TestSignedBundle {
  const TestSignedBundle({
    required this.version,
    required this.envelopeBytes,
    required this.envelope,
    required this.resources,
    required this.keyRing,
  });

  final String version;
  final Uint8List envelopeBytes;
  final BundleEnvelope envelope;
  final Map<String, Uint8List> resources;
  final BundleKeyRing keyRing;

  static Future<TestSignedBundle> create({
    required String version,
    required List<TestBundleResource> resources,
  }) async {
    final sorted = [...resources]
      ..sort((left, right) => left.logicalId.compareTo(right.logicalId));
    final payload = Uint8List.fromList(
      utf8.encode(
        jsonEncode({
          'schemaVersion': 1,
          'bundleVersion': version,
          'generatedAt': '2026-08-27T00:00:00Z',
          'minimumClientSchemaVersion': 1,
          'entries': [
            for (final resource in sorted)
              {
                'logicalId': resource.logicalId,
                'kind': resource.kind.name,
                'delivery': 'core',
                'mediaType': resource.mediaType,
                'byteLength': resource.bytes.length,
                'sha256': resource.digest,
                'downloadPath': '/pisocamp/bundle/resources/${resource.digest}',
                if (resource.contentItemId != null)
                  'contentItemId': resource.contentItemId,
                if (resource.contentVersionId != null)
                  'contentVersionId': resource.contentVersionId,
              },
          ],
        }),
      ),
    );
    final fixture =
        jsonDecode(
              File(
                '../../packages/contracts/src/modules/v1/pisocamp/fixtures/ce1-ed25519-vector.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final privateDer = base64.decode(
      (fixture['privateKeyPkcs8Pem'] as String)
          .replaceAll('-----BEGIN PRIVATE KEY-----', '')
          .replaceAll('-----END PRIVATE KEY-----', '')
          .replaceAll(RegExp(r'\s'), ''),
    );
    final keyPair = await Ed25519().newKeyPairFromSeed(
      privateDer.sublist(privateDer.length - 32),
    );
    final signature = await Ed25519().sign(payload, keyPair: keyPair);
    final envelopeBytes = Uint8List.fromList(
      utf8.encode(
        jsonEncode({
          'schemaVersion': 1,
          'algorithm': 'Ed25519',
          'keyId': fixture['keyId'],
          'payload': base64Url.encode(payload).replaceAll('=', ''),
          'signature': base64Url.encode(signature.bytes).replaceAll('=', ''),
        }),
      ),
    );
    final keyRing = BundleKeyRing.forTests({
      fixture['keyId'] as String: fixture['publicKeySpkiPem'] as String,
    });
    return TestSignedBundle(
      version: version,
      envelopeBytes: envelopeBytes,
      envelope: await BundleEnvelope.parseAndVerify(envelopeBytes, keyRing),
      resources: {
        for (final resource in resources) resource.digest: resource.bytes,
      },
      keyRing: keyRing,
    );
  }
}

enum RangeBehavior {
  normal,
  disconnectOnce,
  ignoreRange,
  changedEtag,
  weakEtag,
  malformedContentRange,
  always416,
  malformed416,
  wrongMime,
  fallbackWrongMime,
  redirect,
  truncated,
  overflow,
  slowChunks,
  heldRejected,
}

final class RecordedBundleRequest {
  const RecordedBundleRequest({required this.path, required this.headers});

  final String path;
  final Map<String, String> headers;
}

final class LoopbackBundleServer {
  LoopbackBundleServer._(this._server);

  final HttpServer _server;
  Uint8List manifestBytes = Uint8List(0);
  String manifestEtag = '"manifest"';
  bool manifestNotModified = false;
  bool redirectManifest = false;
  int manifestTransientFailures = 0;
  Duration resourceDelay = Duration.zero;
  Duration midStreamDelay = const Duration(seconds: 2);
  int activeResourceRequests = 0;
  int maximumActiveResourceRequests = 0;
  final Map<String, Uint8List> resources = {};
  final Map<String, ContentType> resourceContentTypes = {};
  final Map<String, RangeBehavior> behaviors = {};
  final Map<String, int> resourceTransientFailures = {};
  final List<RecordedBundleRequest> requests = [];
  final Set<String> _disconnected = {};
  final Set<Socket> _detachedSockets = {};
  final Completer<void> rejectedResponseCancelled = Completer<void>();
  bool fallbackObservedAfterCancellation = false;

  Uri get versionedUrl =>
      Uri.parse('http://${_server.address.address}:${_server.port}/api/v1');

  static Future<LoopbackBundleServer> start() async {
    final httpServer = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final server = LoopbackBundleServer._(httpServer);
    httpServer.listen((request) async {
      try {
        await server._handle(request);
      } on Object {
        // Disconnect and cancellation cases intentionally close sockets early.
      }
    });
    return server;
  }

  Future<void> close() async {
    for (final socket in _detachedSockets.toList(growable: false)) {
      socket.destroy();
    }
    _detachedSockets.clear();
    await _server.close(force: true);
  }

  Future<void> _handle(HttpRequest request) async {
    final headers = <String, String>{};
    request.headers.forEach((name, values) {
      headers[name.toLowerCase()] = values.join(',');
    });
    requests.add(
      RecordedBundleRequest(path: request.uri.path, headers: headers),
    );
    if (request.uri.path == '/api/v1/pisocamp/bundle/manifest') {
      if (manifestTransientFailures > 0) {
        manifestTransientFailures -= 1;
        request.response.statusCode = HttpStatus.serviceUnavailable;
        await request.response.close();
        return;
      }
      if (redirectManifest) {
        request.response
          ..statusCode = HttpStatus.found
          ..headers.set(HttpHeaders.locationHeader, '/redirected');
        await request.response.close();
        return;
      }
      if (manifestNotModified &&
          request.headers.value(HttpHeaders.ifNoneMatchHeader) ==
              manifestEtag) {
        request.response.statusCode = HttpStatus.notModified;
        await request.response.close();
        return;
      }
      request.response
        ..statusCode = HttpStatus.ok
        ..headers.contentType = ContentType.json
        ..headers.set(HttpHeaders.etagHeader, manifestEtag)
        ..add(manifestBytes);
      await request.response.close();
      return;
    }

    const prefix = '/api/v1/pisocamp/bundle/resources/';
    if (!request.uri.path.startsWith(prefix)) {
      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
      return;
    }
    final digest = request.uri.path.substring(prefix.length);
    final bytes = resources[digest];
    if (bytes == null) {
      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
      return;
    }
    final behavior = behaviors[digest] ?? RangeBehavior.normal;
    final range = request.headers.value(HttpHeaders.rangeHeader);
    if (behavior == RangeBehavior.heldRejected && range == null) {
      try {
        await rejectedResponseCancelled.future.timeout(
          const Duration(seconds: 5),
        );
      } on TimeoutException {
        request.response.statusCode = HttpStatus.serviceUnavailable;
        await request.response.close();
        return;
      }
      fallbackObservedAfterCancellation = true;
    }
    activeResourceRequests += 1;
    maximumActiveResourceRequests =
        maximumActiveResourceRequests < activeResourceRequests
        ? activeResourceRequests
        : maximumActiveResourceRequests;
    if (resourceDelay > Duration.zero) {
      await Future<void>.delayed(resourceDelay);
    }
    final failures = resourceTransientFailures[digest] ?? 0;
    if (failures > 0) {
      resourceTransientFailures[digest] = failures - 1;
      request.response.statusCode = HttpStatus.serviceUnavailable;
      await request.response.close();
      activeResourceRequests -= 1;
      return;
    }
    if (behavior == RangeBehavior.redirect) {
      request.response
        ..statusCode = HttpStatus.found
        ..headers.set(HttpHeaders.locationHeader, '/redirected');
      await request.response.close();
      activeResourceRequests -= 1;
      return;
    }
    final strongEtag = '"$digest"';
    final start = range == null
        ? 0
        : int.tryParse(
                RegExp(r'^bytes=([0-9]+)-$').firstMatch(range)?.group(1) ?? '',
              ) ??
              0;

    if (behavior == RangeBehavior.heldRejected && range != null) {
      request.response
        ..statusCode = HttpStatus.partialContent
        ..headers.contentType = ContentType.json
        ..headers.set(HttpHeaders.etagHeader, '"changed-$digest"')
        ..headers.set(
          HttpHeaders.contentRangeHeader,
          'bytes $start-${bytes.length - 1}/${bytes.length}',
        )
        ..contentLength = bytes.length - start;
      final socket = await request.response.detachSocket();
      _detachedSockets.add(socket);
      final peerDisconnected = Completer<void>();
      socket.listen(
        (_) {},
        onError: (_) {
          if (!peerDisconnected.isCompleted) peerDisconnected.complete();
        },
        onDone: () {
          if (!peerDisconnected.isCompleted) peerDisconnected.complete();
        },
        cancelOnError: true,
      );
      socket.add(bytes.sublist(start, start + 1));
      await socket.flush();
      var cancellationObserved = false;
      try {
        await peerDisconnected.future.timeout(const Duration(seconds: 5));
        cancellationObserved = true;
      } on TimeoutException {
        socket.destroy();
      } on Object {
        cancellationObserved = true;
      }
      _detachedSockets.remove(socket);
      socket.destroy();
      activeResourceRequests -= 1;
      if (cancellationObserved && !rejectedResponseCancelled.isCompleted) {
        rejectedResponseCancelled.complete();
      }
      return;
    }
    if (behavior == RangeBehavior.always416 ||
        behavior == RangeBehavior.malformed416) {
      request.response
        ..statusCode = HttpStatus.requestedRangeNotSatisfiable
        ..headers.contentType = ContentType.json
        ..headers.set(
          HttpHeaders.contentRangeHeader,
          behavior == RangeBehavior.malformed416
              ? 'bytes */${bytes.length + 1}'
              : 'bytes */${bytes.length}',
        )
        ..headers.set(HttpHeaders.etagHeader, strongEtag);
      await request.response.close();
      activeResourceRequests -= 1;
      return;
    }
    if (behavior == RangeBehavior.disconnectOnce &&
        !_disconnected.contains(digest)) {
      _disconnected.add(digest);
      request.response
        ..statusCode = HttpStatus.ok
        ..headers.contentType = ContentType.json
        ..headers.set(HttpHeaders.etagHeader, strongEtag)
        ..contentLength = bytes.length;
      final socket = await request.response.detachSocket();
      _detachedSockets.add(socket);
      socket.add(bytes.sublist(0, bytes.length ~/ 2));
      await socket.flush();
      socket.destroy();
      _detachedSockets.remove(socket);
      activeResourceRequests -= 1;
      return;
    }
    if (behavior == RangeBehavior.slowChunks) {
      request.response
        ..statusCode = HttpStatus.ok
        ..headers.contentType = resourceContentTypes[digest] ?? ContentType.json
        ..headers.set(HttpHeaders.etagHeader, strongEtag)
        ..contentLength = bytes.length
        ..add(bytes.sublist(0, bytes.length ~/ 2));
      await request.response.flush();
      await Future<void>.delayed(midStreamDelay);
      request.response.add(bytes.sublist(bytes.length ~/ 2));
      await request.response.close();
      activeResourceRequests -= 1;
      return;
    }

    final useRange = range != null && behavior != RangeBehavior.ignoreRange;
    final selected = useRange ? bytes.sublist(start) : bytes;
    final body = switch (behavior) {
      RangeBehavior.truncated => selected.sublist(0, selected.length - 1),
      RangeBehavior.overflow => Uint8List.fromList([...selected, 0]),
      _ => selected,
    };
    request.response.statusCode = useRange
        ? HttpStatus.partialContent
        : HttpStatus.ok;
    request.response.headers.set(HttpHeaders.etagHeader, switch (behavior) {
      RangeBehavior.weakEtag => 'W/$strongEtag',
      RangeBehavior.changedEtag => '"changed-$digest"',
      RangeBehavior.fallbackWrongMime when range != null => '"changed-$digest"',
      _ => strongEtag,
    });
    request.response.headers.contentType =
        behavior == RangeBehavior.wrongMime ||
            (behavior == RangeBehavior.fallbackWrongMime && range == null)
        ? ContentType.text
        : resourceContentTypes[digest] ?? ContentType.json;
    if (useRange) {
      request.response.headers.set(
        HttpHeaders.contentRangeHeader,
        behavior == RangeBehavior.malformedContentRange
            ? 'bytes ${start + 1}-${bytes.length - 1}/${bytes.length}'
            : 'bytes $start-${bytes.length - 1}/${bytes.length}',
      );
    }
    request.response.add(body);
    await request.response.close();
    activeResourceRequests -= 1;
  }
}

Future<Uint8List> loadSeedAsset(String assetPath) async {
  return File(assetPath).readAsBytes();
}
