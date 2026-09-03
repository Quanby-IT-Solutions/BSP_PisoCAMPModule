import 'package:dio/dio.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';

enum ConsentServerState {
  none('none'),
  granted('granted'),
  declined('declined'),
  withdrawn('withdrawn'),
  requiresReconsent('requires_reconsent');

  const ConsentServerState(this.wireValue);

  final String wireValue;

  static ConsentServerState fromWire(String value) => values.firstWhere(
    (state) => state.wireValue == value,
    orElse: () => throw const FormatException('Unknown consent state'),
  );
}

class PrivacyNotice {
  const PrivacyNotice({
    required this.id,
    required this.version,
    required this.title,
    required this.body,
    required this.sourceUrl,
    required this.contentSha256,
    required this.effectiveAt,
  });

  final String id;
  final String version;
  final String title;
  final String body;
  final Uri sourceUrl;
  final String contentSha256;
  final DateTime effectiveAt;

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'version': version,
    'title': title,
    'body': body,
    'sourceUrl': sourceUrl.toString(),
    'contentSha256': contentSha256,
    'effectiveAt': effectiveAt.toUtc().toIso8601String(),
  };

  factory PrivacyNotice.fromJson(Map<String, Object?> json) {
    _requireExactKeys(json, const <String>{
      'id',
      'version',
      'title',
      'body',
      'sourceUrl',
      'contentSha256',
      'effectiveAt',
    });
    final id = json['id'];
    final version = json['version'];
    final title = json['title'];
    final body = json['body'];
    final sourceUrl = json['sourceUrl'];
    final contentSha256 = json['contentSha256'];
    final effectiveAt = json['effectiveAt'];
    if (id is! String ||
        version is! String ||
        title is! String ||
        body is! String ||
        sourceUrl is! String ||
        contentSha256 is! String ||
        effectiveAt is! String ||
        !_uuidPattern.hasMatch(id) ||
        id.isEmpty ||
        version.isEmpty ||
        title.isEmpty ||
        body.isEmpty ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(contentSha256)) {
      throw const FormatException('Invalid privacy notice');
    }
    final uri = Uri.tryParse(sourceUrl);
    final effective = DateTime.tryParse(effectiveAt);
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.host.isEmpty ||
        effective == null) {
      throw const FormatException('Invalid privacy notice metadata');
    }
    return PrivacyNotice(
      id: id,
      version: version,
      title: title,
      body: body,
      sourceUrl: uri,
      contentSha256: contentSha256,
      effectiveAt: effective.toUtc(),
    );
  }
}

class ConsentStatus {
  const ConsentStatus({
    required this.purpose,
    required this.state,
    required this.notice,
  });

  final ConsentPurpose purpose;
  final ConsentServerState state;
  final PrivacyNotice notice;
}

class RecordedConsentAcknowledgement {
  const RecordedConsentAcknowledgement({
    required this.id,
    required this.state,
    required this.recordedAt,
  });

  final String id;
  final ConsentServerState state;
  final DateTime recordedAt;
}

/// Strict transport boundary for the public consent API.
class ConsentRepository {
  ConsentRepository(this._dio, this._store);

  final Dio _dio;
  final ConsentLocalStore _store;

  Future<ConsentStatus> fetchStatus(
    ConsentPurpose purpose, {
    required String devicePseudoId,
  }) async {
    final response = await _dio.get<Object?>(
      ApiConstants.pisoCampConsentStatus(purpose.wireValue),
      options: Options(
        headers: <String, String>{'X-Device-Pseudo-Id': devicePseudoId},
      ),
    );
    final json = _asObject(response.data, 'Invalid consent status');
    _requireExactKeys(json, const <String>{'purpose', 'state', 'notice'});
    final responsePurpose = json['purpose'];
    final state = json['state'];
    final noticeJson = json['notice'];
    if (responsePurpose is! String || state is! String || noticeJson is! Map) {
      throw const FormatException('Invalid consent status');
    }
    final parsedPurpose = _purposeFromTransport(responsePurpose);
    if (parsedPurpose != purpose) {
      throw const FormatException('Consent purpose mismatch');
    }
    final parsedState = ConsentServerState.fromWire(state);
    final notice = PrivacyNotice.fromJson(
      Map<String, Object?>.from(noticeJson),
    );
    await _store.writeCachedNotice(notice.toJson());
    return ConsentStatus(
      purpose: parsedPurpose,
      state: parsedState,
      notice: notice,
    );
  }

  Future<PrivacyNotice?> readCachedNotice() async {
    final cached = await _store.readCachedNotice();
    return cached == null ? null : PrivacyNotice.fromJson(cached);
  }

  Future<RecordedConsentAcknowledgement> sync(
    StoredConsentRecord record,
  ) async {
    final response = await _dio.post<Object?>(
      ApiConstants.pisoCampConsent,
      data: <String, Object?>{
        'id': record.recordId,
        'purpose': record.purpose.wireValue,
        'noticeId': record.noticeId,
        'noticeVersion': record.noticeVersion,
        'decision': record.decision.wireValue,
        'respondedAt': record.respondedAt.toUtc().toIso8601String(),
      },
      options: Options(
        headers: <String, String>{
          'X-Device-Pseudo-Id': record.devicePseudoId,
          'Idempotency-Key': record.recordId,
        },
      ),
    );
    final json = _asObject(response.data, 'Invalid consent acknowledgement');
    _requireExactKeys(json, const <String>{
      'id',
      'purpose',
      'noticeId',
      'noticeVersion',
      'decision',
      'respondedAt',
      'recordedAt',
      'state',
    });
    final id = json['id'];
    final purpose = json['purpose'];
    final noticeId = json['noticeId'];
    final noticeVersion = json['noticeVersion'];
    final decision = json['decision'];
    final respondedAt = json['respondedAt'];
    final recordedAt = json['recordedAt'];
    final state = json['state'];
    final respondedTimestamp = respondedAt is String
        ? DateTime.tryParse(respondedAt)
        : null;
    if (id is! String ||
        purpose is! String ||
        noticeId is! String ||
        noticeVersion is! String ||
        decision is! String ||
        respondedAt is! String ||
        recordedAt is! String ||
        state is! String ||
        id != record.recordId ||
        purpose != record.purpose.wireValue ||
        noticeId != record.noticeId ||
        noticeVersion != record.noticeVersion ||
        decision != record.decision.wireValue ||
        respondedTimestamp == null ||
        respondedTimestamp.toUtc().millisecondsSinceEpoch !=
            record.respondedAt.toUtc().millisecondsSinceEpoch) {
      throw const FormatException('Consent acknowledgement mismatch');
    }
    final recordedTimestamp = DateTime.tryParse(recordedAt);
    if (recordedTimestamp == null) {
      throw const FormatException('Invalid recorded consent timestamp');
    }
    final parsedState = ConsentServerState.fromWire(state);
    final expectedState = switch (record.decision) {
      ConsentDecision.granted => ConsentServerState.granted,
      ConsentDecision.declined => ConsentServerState.declined,
      ConsentDecision.withdrawn => ConsentServerState.withdrawn,
    };
    if (parsedState != expectedState) {
      throw const FormatException('Consent acknowledgement state mismatch');
    }
    return RecordedConsentAcknowledgement(
      id: id,
      state: parsedState,
      recordedAt: recordedTimestamp.toUtc(),
    );
  }
}

Map<String, Object?> _asObject(Object? value, String message) {
  if (value is! Map) throw FormatException(message);
  return Map<String, Object?>.from(value);
}

void _requireExactKeys(Map<String, Object?> json, Set<String> expected) {
  if (json.length != expected.length || !json.keys.every(expected.contains)) {
    throw const FormatException('Unexpected consent response fields');
  }
}

ConsentPurpose _purposeFromTransport(String value) {
  try {
    return ConsentPurpose.fromWire(value);
  } on ConsentStoreException {
    throw const FormatException('Unknown consent purpose');
  }
}

final RegExp _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
