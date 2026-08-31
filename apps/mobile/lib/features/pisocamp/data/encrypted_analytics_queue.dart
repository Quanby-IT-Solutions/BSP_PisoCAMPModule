import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:mobile/core/utils/uuid_v4.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';
import 'package:path/path.dart' as paths;

const analyticsQueueKeyName = 'pisocamp.analytics.queue-key.v1';
const _magic = <int>[0x50, 0x43, 0x41, 0x51];
const _formatVersion = 1;
const _nonceLength = 12;
const _tagLength = 16;
const _defaultMaxEvents = 100;
const _defaultMaxBytes = 512 * 1024;

final _uuidV4Pattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final _encodedKeyPattern = RegExp(r'^[A-Za-z0-9_-]{43}$');

abstract interface class AnalyticsKeyStore {
  Future<String?> readKey();
  Future<void> writeKey(String value);
}

typedef AnalyticsQueueKeyGenerator = Future<SecretKey> Function();
typedef AnalyticsQueueDirectoryExistsProbe =
    Future<bool> Function(Directory directory);
typedef AnalyticsQueueFileReader = Future<Uint8List> Function(File file);

final class SecureStorageAnalyticsKeyStore implements AnalyticsKeyStore {
  SecureStorageAnalyticsKeyStore(this._storage);

  final SecureStorageService _storage;

  @override
  Future<String?> readKey() => _storage.readValue(analyticsQueueKeyName);

  @override
  Future<void> writeKey(String value) =>
      _storage.writeValue(analyticsQueueKeyName, value);
}

final class AnalyticsQueueException implements Exception {
  const AnalyticsQueueException(this.code);

  final String code;

  @override
  String toString() => 'AnalyticsQueueException($code)';
}

/// Durable, one-file-per-event authenticated queue rooted below app support.
final class EncryptedAnalyticsQueue {
  EncryptedAnalyticsQueue._({
    required Directory applicationSupportDirectory,
    required AnalyticsKeyStore keyStore,
    required DateTime Function() clock,
    required AesGcm cipher,
    required AnalyticsQueueKeyGenerator createSecretKey,
    required AnalyticsQueueDirectoryExistsProbe queueDirectoryExists,
    required AnalyticsQueueFileReader readFile,
  }) : _root = Directory(
         paths.join(
           paths.absolute(applicationSupportDirectory.path),
           'pisocamp',
           'analytics',
           'v1',
         ),
       ),
       _keyStore = keyStore,
       _clock = clock,
       _cipher = cipher,
       _createSecretKey = createSecretKey,
       _queueDirectoryExists = queueDirectoryExists,
       _readFile = readFile;

  final Directory _root;
  final AnalyticsKeyStore _keyStore;
  final DateTime Function() _clock;
  final AesGcm _cipher;
  final AnalyticsQueueKeyGenerator _createSecretKey;
  final AnalyticsQueueDirectoryExistsProbe _queueDirectoryExists;
  final AnalyticsQueueFileReader _readFile;
  Future<void> _mutations = Future<void>.value();
  late SecretKey _secretKey;

  Directory get _queue => Directory(paths.join(_root.path, 'queue'));
  Directory get _quarantine => Directory(paths.join(_root.path, 'quarantine'));
  Directory get _tmp => Directory(paths.join(_root.path, 'tmp'));

  static Future<EncryptedAnalyticsQueue> initialize({
    required Directory applicationSupportDirectory,
    required AnalyticsKeyStore keyStore,
    DateTime Function()? clock,
    AnalyticsQueueKeyGenerator? createSecretKey,
    AnalyticsQueueDirectoryExistsProbe? queueDirectoryExists,
    AnalyticsQueueFileReader? readFile,
  }) async {
    final cipher = AesGcm.with256bits();
    final queue = EncryptedAnalyticsQueue._(
      applicationSupportDirectory: applicationSupportDirectory,
      keyStore: keyStore,
      clock: clock ?? DateTime.now,
      cipher: cipher,
      createSecretKey: createSecretKey ?? cipher.newSecretKey,
      queueDirectoryExists:
          queueDirectoryExists ?? ((directory) => directory.exists()),
      readFile: readFile ?? ((file) => file.readAsBytes()),
    );
    await queue._serialized(queue._initialize);
    return queue;
  }

  Future<void> enqueue(AnalyticsEvent event) => _serialized(() async {
    final eventId = event.eventId;
    if (!_uuidV4Pattern.hasMatch(eventId)) {
      throw const AnalyticsQueueException('invalidEventId');
    }
    final target = File(paths.join(_queue.path, '$eventId.event'));
    if (await target.exists()) return;

    try {
      final plaintext = utf8.encode(jsonEncode(event.toJson()));
      final box = await _cipher.encrypt(
        plaintext,
        secretKey: _secretKey,
        nonce: _cipher.newNonce(),
        aad: utf8.encode('PCAQ:1:$eventId'),
      );
      final temporary = File(
        paths.join(_tmp.path, '$eventId.${createUuidV4()}.part'),
      );
      await temporary.writeAsBytes(_encode(box), flush: true);
      if (await target.exists()) {
        await temporary.delete();
        return;
      }
      await temporary.rename(target.path);
    } on AnalyticsQueueException {
      rethrow;
    } on Object {
      throw const AnalyticsQueueException('enqueueFailed');
    }
  });

  Future<List<AnalyticsEvent>> readBatch({
    int maxEvents = _defaultMaxEvents,
    int maxBytes = _defaultMaxBytes,
  }) => _serialized(() async {
    if (maxEvents < 1 ||
        maxEvents > _defaultMaxEvents ||
        maxBytes < utf8.encode('{"events":[]}').length ||
        maxBytes > _defaultMaxBytes) {
      throw const AnalyticsQueueException('invalidBatchLimit');
    }
    final files = await _committedFiles();
    final events = <AnalyticsEvent>[];
    final encodedEvents = <String>[];
    for (final file in files) {
      final event = await _readOrQuarantine(file);
      if (event == null) continue;
      final encoded = jsonEncode(event.toJson());
      final candidate = <String>[...encodedEvents, encoded];
      final candidateBytes = utf8
          .encode('{"events":[${candidate.join(',')}]}')
          .length;
      if (candidateBytes > maxBytes) {
        if (events.isEmpty) {
          throw const AnalyticsQueueException('eventTooLarge');
        }
        break;
      }
      events.add(event);
      encodedEvents.add(encoded);
      if (events.length == maxEvents) break;
    }
    return List<AnalyticsEvent>.unmodifiable(events);
  });

  Future<void> acknowledge(Iterable<String> eventIds) => _serialized(() async {
    final ids = eventIds.toList(growable: false);
    if (ids.any((id) => !_uuidV4Pattern.hasMatch(id))) {
      throw const AnalyticsQueueException('invalidEventId');
    }
    for (final eventId in ids) {
      final file = File(paths.join(_queue.path, '$eventId.event'));
      try {
        if (await file.exists()) await file.delete();
      } on Object {
        throw const AnalyticsQueueException('acknowledgeFailed');
      }
    }
  });

  Future<int> pendingCount() =>
      _serialized(() async => (await _committedFiles()).length);

  Future<void> _initialize() async {
    final hasCommittedFiles = await _hasCommittedFiles();
    _secretKey = await _loadOrCreateKey(hasCommittedFiles);
    try {
      await Future.wait(<Future<void>>[
        _queue.create(recursive: true),
        _quarantine.create(recursive: true),
        _tmp.create(recursive: true),
      ]);
    } on Object {
      throw const AnalyticsQueueException('initializeFailed');
    }
    await _removeStaleParts();
  }

  Future<bool> _hasCommittedFiles() async {
    try {
      if (!await _queueDirectoryExists(_queue)) return false;
      await for (final entity in _queue.list()) {
        if (entity is File && entity.path.endsWith('.event')) return true;
      }
      return false;
    } on Object {
      throw const AnalyticsQueueException('initializeFailed');
    }
  }

  Future<SecretKey> _loadOrCreateKey(bool hasCommittedFiles) async {
    String? encoded;
    try {
      encoded = await _keyStore.readKey();
    } on Object {
      throw const AnalyticsQueueException('analyticsKeyUnavailable');
    }
    if (encoded == null) {
      if (hasCommittedFiles) {
        throw const AnalyticsQueueException('analyticsKeyUnavailable');
      }
      late List<int> bytes;
      try {
        final key = await _createSecretKey();
        bytes = await key.extractBytes();
      } on Object {
        throw const AnalyticsQueueException('analyticsKeyUnavailable');
      }
      try {
        await _keyStore.writeKey(base64Url.encode(bytes).replaceAll('=', ''));
      } on Object {
        throw const AnalyticsQueueException('analyticsKeyUnavailable');
      }
      return SecretKeyData(bytes);
    }

    final bytes = _decodeStoredKey(encoded);
    if (bytes == null) {
      throw const AnalyticsQueueException('analyticsKeyUnavailable');
    }
    return SecretKeyData(bytes);
  }

  List<int>? _decodeStoredKey(String value) {
    if (!_encodedKeyPattern.hasMatch(value)) return null;
    try {
      final padded = '$value${'=' * ((4 - value.length % 4) % 4)}';
      final bytes = base64Url.decode(padded);
      return bytes.length == 32 ? bytes : null;
    } on FormatException {
      return null;
    }
  }

  Future<void> _removeStaleParts() async {
    final threshold = _clock().toUtc().subtract(const Duration(hours: 24));
    try {
      await for (final entity in _tmp.list()) {
        if (entity is! File || !entity.path.endsWith('.part')) continue;
        if (!(await entity.stat()).modified.toUtc().isAfter(threshold)) {
          await entity.delete();
        }
      }
    } on Object {
      throw const AnalyticsQueueException('initializeFailed');
    }
  }

  Future<List<File>> _committedFiles() async {
    final files = <File>[];
    try {
      await for (final entity in _queue.list()) {
        if (entity is File && entity.path.endsWith('.event')) files.add(entity);
      }
    } on Object {
      throw const AnalyticsQueueException('readFailed');
    }
    files.sort(
      (left, right) =>
          paths.basename(left.path).compareTo(paths.basename(right.path)),
    );
    return files;
  }

  Future<AnalyticsEvent?> _readOrQuarantine(File file) async {
    final basename = paths.basenameWithoutExtension(file.path);
    try {
      if (!_uuidV4Pattern.hasMatch(basename)) throw const FormatException();
      final bytes = await _readFile(file);
      final box = _decodeEnvelope(bytes);
      final plaintext = await _cipher.decrypt(
        box,
        secretKey: _secretKey,
        aad: utf8.encode('PCAQ:1:$basename'),
      );
      final decoded = jsonDecode(utf8.decode(plaintext));
      if (decoded is! Map) throw const FormatException();
      final event = AnalyticsEvent.fromJson(Map<String, Object?>.from(decoded));
      if (event.eventId != basename) throw const FormatException();
      return event;
    } on FormatException {
      await _quarantineFile(file);
      return null;
    } on SecretBoxAuthenticationError {
      await _quarantineFile(file);
      return null;
    } on AnalyticsValidationException {
      await _quarantineFile(file);
      return null;
    } on Object {
      throw const AnalyticsQueueException('readFailed');
    }
  }

  SecretBox _decodeEnvelope(Uint8List bytes) {
    if (bytes.length < _magic.length + 1 + _nonceLength + _tagLength ||
        !_samePrefix(bytes, _magic) ||
        bytes[_magic.length] != _formatVersion) {
      throw const FormatException();
    }
    final nonceStart = _magic.length + 1;
    final ciphertextStart = nonceStart + _nonceLength;
    final ciphertextEnd = bytes.length - _tagLength;
    return SecretBox(
      bytes.sublist(ciphertextStart, ciphertextEnd),
      nonce: bytes.sublist(nonceStart, nonceStart + _nonceLength),
      mac: Mac(bytes.sublist(ciphertextEnd)),
    );
  }

  bool _samePrefix(List<int> bytes, List<int> prefix) {
    for (var index = 0; index < prefix.length; index++) {
      if (bytes[index] != prefix[index]) return false;
    }
    return true;
  }

  Future<void> _quarantineFile(File file) async {
    try {
      if (!await file.exists()) return;
      final basename = paths.basenameWithoutExtension(file.path);
      var target = File(paths.join(_quarantine.path, '$basename.event'));
      if (await target.exists()) {
        target = File(
          paths.join(_quarantine.path, '$basename.${createUuidV4()}.event'),
        );
      }
      await file.rename(target.path);
    } on Object {
      throw const AnalyticsQueueException('quarantineFailed');
    }
  }

  Uint8List _encode(SecretBox box) => Uint8List.fromList(<int>[
    ..._magic,
    _formatVersion,
    ...box.nonce,
    ...box.cipherText,
    ...box.mac.bytes,
  ]);

  Future<T> _serialized<T>(Future<T> Function() action) {
    final operation = _mutations.then((_) => action());
    _mutations = operation.then<void>((_) {}, onError: (_, _) {});
    return operation;
  }
}
