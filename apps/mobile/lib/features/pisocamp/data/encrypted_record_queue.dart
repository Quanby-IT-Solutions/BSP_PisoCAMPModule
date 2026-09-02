import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:mobile/core/utils/uuid_v4.dart';
import 'package:path/path.dart' as paths;

const _magic = <int>[0x50, 0x43, 0x41, 0x51];
const _formatVersion = 1;
const _nonceLength = 12;
const _tagLength = 16;

final _queueUuidV4Pattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final _encodedKeyPattern = RegExp(r'^[A-Za-z0-9_-]{43}$');

/// Where the queue's data key lives. Secure storage in production.
abstract interface class RecordQueueKeyStore {
  Future<String?> readKey();
  Future<void> writeKey(String value);
}

final class RecordQueueException implements Exception {
  const RecordQueueException(this.code);

  final String code;

  @override
  String toString() => 'RecordQueueException($code)';
}

typedef RecordQueueKeyGenerator = Future<SecretKey> Function();
typedef RecordQueueDirectoryExistsProbe =
    Future<bool> Function(Directory directory);
typedef RecordQueueFileReader = Future<Uint8List> Function(File file);

/// How one kind of record is turned into bytes and back.
///
/// [decode] must throw a [FormatException] for anything it cannot read, because
/// an unreadable file is quarantined rather than allowed to stop the queue.
final class RecordQueueCodec<T> {
  const RecordQueueCodec({
    required this.idOf,
    required this.encode,
    required this.decode,
  });

  final String Function(T record) idOf;
  final Map<String, Object?> Function(T record) encode;
  final T Function(Map<String, Object?> json) decode;
}

/// What tells one queue on disk from another.
///
/// The error codes are part of it because each caller has published its own:
/// AN-1 reports `analyticsKeyUnavailable`, and a shared queue that renamed it
/// would change a contract that is already relied on.
final class RecordQueueLayout {
  const RecordQueueLayout({
    required this.directorySegments,
    required this.fileExtension,
    required this.aadPrefix,
    required this.batchEnvelopeKey,
    required this.invalidIdCode,
    required this.keyUnavailableCode,
    required this.recordTooLargeCode,
    this.maxRecords = 100,
    this.maxBytes = 512 * 1024,
  });

  final List<String> directorySegments;
  final String fileExtension;
  final String aadPrefix;

  /// The JSON key the batch is uploaded under, used only to measure a batch
  /// against [maxBytes] the way the server will see it.
  final String batchEnvelopeKey;

  final String invalidIdCode;
  final String keyUnavailableCode;
  final String recordTooLargeCode;
  final int maxRecords;
  final int maxBytes;
}

/// Durable, one-file-per-record authenticated queue rooted below app support.
///
/// Extracted from AN-1's analytics queue when EV-2 needed the same thing for
/// survey responses: an encrypted store this careful is not something to write
/// twice, and a second copy would be a second place for a mistake to live.
final class EncryptedRecordQueue<T> {
  EncryptedRecordQueue._({
    required Directory applicationSupportDirectory,
    required RecordQueueLayout layout,
    required RecordQueueCodec<T> codec,
    required RecordQueueKeyStore keyStore,
    required DateTime Function() clock,
    required AesGcm cipher,
    required RecordQueueKeyGenerator createSecretKey,
    required RecordQueueDirectoryExistsProbe queueDirectoryExists,
    required RecordQueueFileReader readFile,
  }) : _root = Directory(
         paths.joinAll([
           paths.absolute(applicationSupportDirectory.path),
           ...layout.directorySegments,
         ]),
       ),
       _layout = layout,
       _codec = codec,
       _keyStore = keyStore,
       _clock = clock,
       _cipher = cipher,
       _createSecretKey = createSecretKey,
       _queueDirectoryExists = queueDirectoryExists,
       _readFile = readFile;

  final Directory _root;
  final RecordQueueLayout _layout;
  final RecordQueueCodec<T> _codec;
  final RecordQueueKeyStore _keyStore;
  final DateTime Function() _clock;
  final AesGcm _cipher;
  final RecordQueueKeyGenerator _createSecretKey;
  final RecordQueueDirectoryExistsProbe _queueDirectoryExists;
  final RecordQueueFileReader _readFile;
  Future<void> _mutations = Future<void>.value();
  late SecretKey _secretKey;

  Directory get _queue => Directory(paths.join(_root.path, 'queue'));
  Directory get _quarantine => Directory(paths.join(_root.path, 'quarantine'));
  Directory get _tmp => Directory(paths.join(_root.path, 'tmp'));

  static Future<EncryptedRecordQueue<T>> initialize<T>({
    required Directory applicationSupportDirectory,
    required RecordQueueLayout layout,
    required RecordQueueCodec<T> codec,
    required RecordQueueKeyStore keyStore,
    DateTime Function()? clock,
    RecordQueueKeyGenerator? createSecretKey,
    RecordQueueDirectoryExistsProbe? queueDirectoryExists,
    RecordQueueFileReader? readFile,
  }) async {
    final cipher = AesGcm.with256bits();
    final queue = EncryptedRecordQueue<T>._(
      applicationSupportDirectory: applicationSupportDirectory,
      layout: layout,
      codec: codec,
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

  Future<void> enqueue(T record) => _serialized(() async {
    final id = _codec.idOf(record);
    if (!_queueUuidV4Pattern.hasMatch(id)) {
      throw RecordQueueException(_layout.invalidIdCode);
    }
    final target = File(
      paths.join(_queue.path, '$id.${_layout.fileExtension}'),
    );
    if (await target.exists()) return;

    try {
      final plaintext = utf8.encode(jsonEncode(_codec.encode(record)));
      final box = await _cipher.encrypt(
        plaintext,
        secretKey: _secretKey,
        nonce: _cipher.newNonce(),
        aad: utf8.encode('${_layout.aadPrefix}:$id'),
      );
      final temporary = File(
        paths.join(_tmp.path, '$id.${createUuidV4()}.part'),
      );
      await temporary.writeAsBytes(_encode(box), flush: true);
      if (await target.exists()) {
        await temporary.delete();
        return;
      }
      await temporary.rename(target.path);
    } on RecordQueueException {
      rethrow;
    } on Object {
      throw const RecordQueueException('enqueueFailed');
    }
  });

  Future<List<T>> readBatch({int? maxRecords, int? maxBytes}) => _serialized(
    () async {
      final recordLimit = maxRecords ?? _layout.maxRecords;
      final byteLimit = maxBytes ?? _layout.maxBytes;
      final emptyEnvelope = utf8
          .encode('{"${_layout.batchEnvelopeKey}":[]}')
          .length;
      if (recordLimit < 1 ||
          recordLimit > _layout.maxRecords ||
          byteLimit < emptyEnvelope ||
          byteLimit > _layout.maxBytes) {
        throw const RecordQueueException('invalidBatchLimit');
      }
      final files = await _committedFiles();
      final records = <T>[];
      final encoded = <String>[];
      for (final file in files) {
        final record = await _readOrQuarantine(file);
        if (record == null) continue;
        final line = jsonEncode(_codec.encode(record));
        final candidate = <String>[...encoded, line];
        final candidateBytes = utf8
            .encode('{"${_layout.batchEnvelopeKey}":[${candidate.join(',')}]}')
            .length;
        if (candidateBytes > byteLimit) {
          if (records.isEmpty) {
            throw RecordQueueException(_layout.recordTooLargeCode);
          }
          break;
        }
        records.add(record);
        encoded.add(line);
        if (records.length == recordLimit) break;
      }
      return List<T>.unmodifiable(records);
    },
  );

  Future<void> acknowledge(Iterable<String> ids) => _serialized(() async {
    final list = ids.toList(growable: false);
    if (list.any((id) => !_queueUuidV4Pattern.hasMatch(id))) {
      throw RecordQueueException(_layout.invalidIdCode);
    }
    for (final id in list) {
      final file = File(
        paths.join(_queue.path, '$id.${_layout.fileExtension}'),
      );
      try {
        if (await file.exists()) await file.delete();
      } on Object {
        throw const RecordQueueException('acknowledgeFailed');
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
      throw const RecordQueueException('initializeFailed');
    }
    await _removeStaleParts();
  }

  Future<bool> _hasCommittedFiles() async {
    try {
      if (!await _queueDirectoryExists(_queue)) return false;
      await for (final entity in _queue.list()) {
        if (entity is File &&
            entity.path.endsWith('.${_layout.fileExtension}')) {
          return true;
        }
      }
      return false;
    } on Object {
      throw const RecordQueueException('initializeFailed');
    }
  }

  Future<SecretKey> _loadOrCreateKey(bool hasCommittedFiles) async {
    String? encoded;
    try {
      encoded = await _keyStore.readKey();
    } on Object {
      throw RecordQueueException(_layout.keyUnavailableCode);
    }
    if (encoded == null) {
      // A queue with files but no key is a queue nobody can read. Creating a
      // fresh key would quietly discard whatever is already stored.
      if (hasCommittedFiles) {
        throw RecordQueueException(_layout.keyUnavailableCode);
      }
      late List<int> bytes;
      try {
        final key = await _createSecretKey();
        bytes = await key.extractBytes();
      } on Object {
        throw RecordQueueException(_layout.keyUnavailableCode);
      }
      try {
        await _keyStore.writeKey(base64Url.encode(bytes).replaceAll('=', ''));
      } on Object {
        throw RecordQueueException(_layout.keyUnavailableCode);
      }
      return SecretKeyData(bytes);
    }

    final bytes = _decodeStoredKey(encoded);
    if (bytes == null) throw RecordQueueException(_layout.keyUnavailableCode);
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
      throw const RecordQueueException('initializeFailed');
    }
  }

  Future<List<File>> _committedFiles() async {
    final files = <File>[];
    try {
      await for (final entity in _queue.list()) {
        if (entity is File &&
            entity.path.endsWith('.${_layout.fileExtension}')) {
          files.add(entity);
        }
      }
    } on Object {
      throw const RecordQueueException('readFailed');
    }
    files.sort(
      (left, right) =>
          paths.basename(left.path).compareTo(paths.basename(right.path)),
    );
    return files;
  }

  Future<T?> _readOrQuarantine(File file) async {
    final basename = paths.basenameWithoutExtension(file.path);
    try {
      if (!_queueUuidV4Pattern.hasMatch(basename)) {
        throw const FormatException();
      }
      final bytes = await _readFile(file);
      final box = _decodeEnvelope(bytes);
      final plaintext = await _cipher.decrypt(
        box,
        secretKey: _secretKey,
        aad: utf8.encode('${_layout.aadPrefix}:$basename'),
      );
      final decoded = jsonDecode(utf8.decode(plaintext));
      if (decoded is! Map) throw const FormatException();
      final record = _codec.decode(Map<String, Object?>.from(decoded));
      if (_codec.idOf(record) != basename) throw const FormatException();
      return record;
    } on FormatException {
      await _quarantineFile(file);
      return null;
    } on SecretBoxAuthenticationError {
      await _quarantineFile(file);
      return null;
    } on Object {
      throw const RecordQueueException('readFailed');
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
      var target = File(
        paths.join(_quarantine.path, '$basename.${_layout.fileExtension}'),
      );
      if (await target.exists()) {
        target = File(
          paths.join(
            _quarantine.path,
            '$basename.${createUuidV4()}.${_layout.fileExtension}',
          ),
        );
      }
      await file.rename(target.path);
    } on Object {
      throw const RecordQueueException('quarantineFailed');
    }
  }

  Uint8List _encode(SecretBox box) => Uint8List.fromList(<int>[
    ..._magic,
    _formatVersion,
    ...box.nonce,
    ...box.cipherText,
    ...box.mac.bytes,
  ]);

  Future<R> _serialized<R>(Future<R> Function() action) {
    final operation = _mutations.then((_) => action());
    _mutations = operation.then<void>((_) {}, onError: (_, _) {});
    return operation;
  }
}
