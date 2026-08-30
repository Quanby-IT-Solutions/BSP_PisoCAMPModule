import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';

const _isProductBuild = bool.fromEnvironment('dart.vm.product');

final class BundleClientException implements Exception {
  const BundleClientException(this.code, {this.transient = false});

  final String code;
  final bool transient;

  @override
  String toString() => 'BundleClientException($code)';
}

final class BundleRetryPolicy {
  const BundleRetryPolicy({
    this.maximumAttempts = 3,
    this.initialBackoff = const Duration(milliseconds: 200),
    this.maximumConcurrency = 3,
  }) : assert(maximumAttempts > 0),
       assert(maximumConcurrency > 0);

  final int maximumAttempts;
  final Duration initialBackoff;
  final int maximumConcurrency;
}

final class BundleCancellationToken {
  bool _cancelled = false;
  final CancelToken _dioToken = CancelToken();
  final Completer<void> _cancelledSignal = Completer<void>();
  final Set<void Function()> _cancellationListeners = {};

  BundleCancellationToken();

  bool get isCancelled => _cancelled;
  Future<void> get whenCancelled => _cancelledSignal.future;
  _BundleCancellationRegistration _addCancellationListener(
    void Function() listener,
  ) {
    if (_cancelled) {
      listener();
      return _BundleCancellationRegistration.inactive();
    }
    _cancellationListeners.add(listener);
    return _BundleCancellationRegistration(
      () => _cancellationListeners.remove(listener),
    );
  }

  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    _cancelledSignal.complete();
    _dioToken.cancel('bundle_cancelled');
    final listeners = _cancellationListeners.toList(growable: false);
    _cancellationListeners.clear();
    for (final listener in listeners) {
      listener();
    }
  }

  void throwIfCancelled() {
    if (_cancelled) throw const BundleClientException('cancelled');
  }
}

final class _BundleCancellationRegistration {
  _BundleCancellationRegistration(this._remove);
  _BundleCancellationRegistration.inactive() : _remove = null;

  void Function()? _remove;

  void dispose() {
    _remove?.call();
    _remove = null;
  }
}

final class BundleCancellationLink {
  BundleCancellationLink(
    BundleCancellationToken source,
    BundleCancellationToken target,
  ) : _registration = source._addCancellationListener(target.cancel);

  _BundleCancellationRegistration? _registration;

  void unlink() {
    _registration?.dispose();
    _registration = null;
  }
}

final class BundleManifestHttpResponse {
  const BundleManifestHttpResponse({
    required this.notModified,
    required this.bytes,
    required this.etag,
  });

  final bool notModified;
  final Uint8List? bytes;
  final String? etag;
}

final class BundleResourceHttpResponse {
  BundleResourceHttpResponse({
    required this.statusCode,
    required this.etag,
    required this.mediaType,
    required this.contentRange,
    required this.contentLength,
    required this.stream,
    Future<void> Function()? discard,
  }) : _discard = discard;

  final int statusCode;
  final String? etag;
  final String? mediaType;
  final String? contentRange;
  final int? contentLength;
  final Stream<Uint8List> stream;
  final Future<void> Function()? _discard;

  Future<void> discard() async {
    final discardRequest = _discard;
    final streamObserved = Completer<void>();
    final subscription = stream.listen(
      (_) {
        if (!streamObserved.isCompleted) streamObserved.complete();
      },
      onError: (_) {
        if (!streamObserved.isCompleted) streamObserved.complete();
      },
      onDone: () {
        if (!streamObserved.isCompleted) streamObserved.complete();
      },
    );
    try {
      await streamObserved.future.timeout(const Duration(seconds: 1));
    } on TimeoutException {
      // Cancellation below remains authoritative for a body that never starts.
    }
    await discardRequest?.call();
    await subscription.cancel();
  }
}

/// A public-only client deliberately isolated from the authenticated API Dio.
final class BundleClient {
  BundleClient({
    required Dio dio,
    required Uri versionedUrl,
    this.retryPolicy = const BundleRetryPolicy(),
    this.requestTimeout = const Duration(seconds: 15),
  }) : _dio = dio,
       versionedUrl = _validateVersionedUrl(versionedUrl) {
    if (_dio.interceptors.length != 1) {
      throw const BundleClientException('client_not_isolated');
    }
    _dio.interceptors.removeImplyContentTypeInterceptor();
    if (_dio.interceptors.isNotEmpty) {
      throw const BundleClientException('client_not_isolated');
    }
    _dio.options = BaseOptions(
      connectTimeout: requestTimeout,
      sendTimeout: requestTimeout,
      receiveTimeout: requestTimeout,
      followRedirects: false,
      headers: const <String, Object>{},
    );
  }

  final Dio _dio;
  final Uri versionedUrl;
  final BundleRetryPolicy retryPolicy;
  final Duration requestTimeout;
  bool _closed = false;

  bool get isClosed => _closed;

  void close() {
    if (_closed) return;
    _closed = true;
    _dio.close(force: true);
  }

  Uri get manifestUrl => versionedUrl.replace(
    path:
        '${_withoutTrailingSlash(versionedUrl.path)}/pisocamp/bundle/manifest',
    query: null,
    fragment: null,
  );

  Uri resourceUrl(String digest) {
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(digest)) {
      throw const BundleClientException('invalid_resource_digest');
    }
    return versionedUrl.replace(
      path:
          '${_withoutTrailingSlash(versionedUrl.path)}/pisocamp/bundle/resources/$digest',
      query: null,
      fragment: null,
    );
  }

  Future<BundleManifestHttpResponse> fetchManifest({
    String? ifNoneMatch,
    BundleCancellationToken? cancellation,
  }) async {
    cancellation?.throwIfCancelled();
    return _retry(() async {
      try {
        final response = await _dio.getUri<ResponseBody>(
          manifestUrl,
          cancelToken: cancellation?._dioToken,
          options: Options(
            responseType: ResponseType.stream,
            followRedirects: false,
            validateStatus: (status) => status == 200 || status == 304,
            headers: {
              'accept': 'application/json',
              if (ifNoneMatch != null) 'if-none-match': ifNoneMatch,
            },
          ),
        );
        if (response.realUri.origin != versionedUrl.origin ||
            response.realUri != manifestUrl) {
          throw const BundleClientException('cross_origin_response');
        }
        if (response.statusCode == 304) {
          return const BundleManifestHttpResponse(
            notModified: true,
            bytes: null,
            etag: null,
          );
        }
        final body = response.data;
        if (body == null) {
          throw const BundleClientException('manifest_response_invalid');
        }
        final data = <int>[];
        await for (final chunk in body.stream) {
          data.addAll(chunk);
          if (data.length > 3000000) {
            throw const BundleClientException('manifest_response_invalid');
          }
        }
        if (data.isEmpty) {
          throw const BundleClientException('manifest_response_invalid');
        }
        return BundleManifestHttpResponse(
          notModified: false,
          bytes: Uint8List.fromList(data),
          etag: response.headers.value('etag'),
        );
      } on BundleClientException {
        rethrow;
      } on DioException catch (error) {
        if (CancelToken.isCancel(error)) {
          throw const BundleClientException('cancelled');
        }
        throw BundleClientException(
          'manifest_transport_failed',
          transient: _isTransient(error),
        );
      }
    }, cancellation);
  }

  Future<BundleResourceHttpResponse> openResource({
    required String digest,
    int? start,
    String? ifRange,
    BundleCancellationToken? cancellation,
  }) async {
    cancellation?.throwIfCancelled();
    if ((start == null) != (ifRange == null) || (start != null && start < 0)) {
      throw const BundleClientException('invalid_range_request');
    }
    final requestCancellation = BundleCancellationToken();
    final cancellationLink = cancellation == null
        ? null
        : BundleCancellationLink(cancellation, requestCancellation);
    var responseReturned = false;
    try {
      final target = resourceUrl(digest);
      final response = await _dio.getUri<ResponseBody>(
        target,
        cancelToken: requestCancellation._dioToken,
        options: Options(
          responseType: ResponseType.stream,
          followRedirects: false,
          validateStatus: (status) =>
              status == 200 || status == 206 || status == 416,
          headers: {
            'accept': 'application/octet-stream',
            if (start != null) 'range': 'bytes=$start-',
            if (ifRange != null) 'if-range': ifRange,
          },
        ),
      );
      if (response.realUri.origin != versionedUrl.origin ||
          response.realUri != target ||
          response.data == null) {
        throw const BundleClientException('resource_response_invalid');
      }
      final stream = _cancellableResponseStream(
        response.data!,
        requestCancellation,
        cancellationLink,
      );
      responseReturned = true;
      return BundleResourceHttpResponse(
        statusCode: response.statusCode!,
        etag: response.headers.value('etag'),
        mediaType: response.headers
            .value(Headers.contentTypeHeader)
            ?.split(';')
            .first
            .trim()
            .toLowerCase(),
        contentRange: response.headers.value('content-range'),
        contentLength: int.tryParse(
          response.headers.value(Headers.contentLengthHeader) ?? '',
        ),
        stream: stream,
        discard: () async {
          requestCancellation.cancel();
          cancellationLink?.unlink();
        },
      );
    } on BundleClientException {
      rethrow;
    } on DioException catch (error) {
      if (CancelToken.isCancel(error)) {
        throw const BundleClientException('cancelled');
      }
      throw BundleClientException(
        'resource_transport_failed',
        transient: _isTransient(error),
      );
    } finally {
      if (!responseReturned) cancellationLink?.unlink();
    }
  }

  Stream<Uint8List> _cancellableResponseStream(
    ResponseBody body,
    BundleCancellationToken requestCancellation,
    BundleCancellationLink? cancellationLink,
  ) {
    StreamSubscription<List<int>>? source;
    late final StreamController<Uint8List> controller;
    void unlink() => cancellationLink?.unlink();
    controller = StreamController<Uint8List>(
      sync: true,
      onListen: () {
        source = body.stream.listen(
          (chunk) => controller.add(Uint8List.fromList(chunk)),
          onError: (Object error, StackTrace stackTrace) {
            unlink();
            controller.addError(error, stackTrace);
          },
          onDone: () {
            unlink();
            controller.close();
          },
        );
      },
      onPause: () => source?.pause(),
      onResume: () => source?.resume(),
      onCancel: () async {
        requestCancellation.cancel();
        unlink();
        await source?.cancel();
      },
    );
    return controller.stream;
  }

  Future<T> _retry<T>(
    Future<T> Function() operation,
    BundleCancellationToken? cancellation,
  ) async {
    for (var attempt = 1; attempt <= retryPolicy.maximumAttempts; attempt++) {
      cancellation?.throwIfCancelled();
      try {
        return await operation();
      } on BundleClientException catch (error) {
        if (!error.transient || attempt == retryPolicy.maximumAttempts) rethrow;
        await waitBeforeRetry(attempt, cancellation);
      }
    }
    throw const BundleClientException('retry_exhausted');
  }

  Future<void> waitBeforeRetry(
    int failedAttempt,
    BundleCancellationToken? cancellation,
  ) async {
    final multiplier = 1 << (failedAttempt - 1);
    final delay = Future<void>.delayed(retryPolicy.initialBackoff * multiplier);
    if (cancellation == null) {
      await delay;
      return;
    }
    await Future.any<void>([delay, cancellation.whenCancelled]);
    cancellation.throwIfCancelled();
  }

  static bool _isTransient(DioException error) {
    final status = error.response?.statusCode;
    if (status == 408 || status == 429 || (status != null && status >= 500)) {
      return true;
    }
    return switch (error.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.receiveTimeout ||
      DioExceptionType.connectionError => true,
      _ => false,
    };
  }
}

Uri normalizeBundleVersionedUrl(Uri value) {
  if (!value.hasAuthority ||
      (value.scheme != 'https' &&
          (_isProductBuild || value.scheme != 'http')) ||
      value.userInfo.isNotEmpty ||
      value.hasQuery ||
      value.hasFragment) {
    throw const BundleClientException('invalid_bundle_origin');
  }
  return value.replace(path: _withoutTrailingSlash(value.path));
}

Uri _validateVersionedUrl(Uri value) => normalizeBundleVersionedUrl(value);

String _withoutTrailingSlash(String value) {
  return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
}
