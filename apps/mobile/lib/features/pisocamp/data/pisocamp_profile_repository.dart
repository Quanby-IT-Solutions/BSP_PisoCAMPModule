import 'package:dio/dio.dart';
import 'package:mobile/core/constants/api_constants.dart';

enum PisoCampGender {
  female('female'),
  male('male'),
  preferNotToSay('prefer_not_to_say');

  const PisoCampGender(this.wireValue);
  final String wireValue;

  static PisoCampGender parse(Object? value) => switch (value) {
    'female' => female,
    'male' => male,
    'prefer_not_to_say' => preferNotToSay,
    _ => throw const FormatException('Invalid Piso CAMP gender'),
  };
}

class PsgcCity {
  const PsgcCity({required this.code, required this.name});
  final String code;
  final String name;
}

class PsgcRegion {
  const PsgcRegion({
    required this.code,
    required this.name,
    required this.cities,
  });
  final String code;
  final String name;
  final List<PsgcCity> cities;
}

class PsgcLocationCatalog {
  const PsgcLocationCatalog({
    required this.version,
    required this.sourceUrl,
    required this.catalogSha256,
    required this.regions,
  });
  final String version;
  final String sourceUrl;
  final String catalogSha256;
  final List<PsgcRegion> regions;
}

enum PisoCampProfileState { missing, complete }

class PisoCampProfile {
  const PisoCampProfile({
    required this.gender,
    required this.age,
    required this.regionCode,
    required this.cityCode,
    required this.registrationConsentRecordId,
  });
  final PisoCampGender gender;
  final int age;
  final String regionCode;
  final String cityCode;
  final String registrationConsentRecordId;
}

class PisoCampProfileResult {
  const PisoCampProfileResult({
    required this.status,
    required this.missingFields,
    required this.name,
    required this.email,
    required this.profile,
  });
  final PisoCampProfileState status;
  final List<String> missingFields;
  final String name;
  final String email;
  final PisoCampProfile? profile;
}

class PisoCampProfileRepository {
  PisoCampProfileRepository(this._dio);

  static final RegExp _psgcCode = RegExp(r'^\d{10}$');
  static final RegExp _sha256 = RegExp(r'^[0-9a-f]{64}$');
  static final RegExp _uuid = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    caseSensitive: false,
  );
  static final RegExp _devicePseudoId = RegExp(r'^[A-Za-z0-9_-]{22}$');
  static const _missingFields = <String>{
    'gender',
    'age',
    'regionCode',
    'cityCode',
  };

  final Dio _dio;

  Future<PsgcLocationCatalog> fetchLocations() async {
    final response = await _dio.get<Object?>(ApiConstants.pisoCampLocations);
    return _parseLocations(response.data);
  }

  Future<PisoCampProfileResult> fetchProfile() async {
    final response = await _dio.get<Object?>(ApiConstants.pisoCampProfile);
    return _parseProfileResult(response.data);
  }

  Future<PisoCampProfileResult> createProfile({
    required String id,
    required PisoCampGender gender,
    required int age,
    required String regionCode,
    required String cityCode,
    required String devicePseudoId,
  }) async {
    if (!_uuid.hasMatch(id) ||
        !_devicePseudoId.hasMatch(devicePseudoId) ||
        age < 1 ||
        age > 120 ||
        !_psgcCode.hasMatch(regionCode) ||
        !_psgcCode.hasMatch(cityCode)) {
      throw const FormatException('Invalid Piso CAMP profile request');
    }
    final response = await _dio.post<Object?>(
      ApiConstants.pisoCampProfile,
      data: <String, Object>{
        'id': id,
        'gender': gender.wireValue,
        'age': age,
        'regionCode': regionCode,
        'cityCode': cityCode,
      },
      options: Options(
        headers: <String, String>{
          'Idempotency-Key': id,
          'X-Device-Pseudo-Id': devicePseudoId,
        },
      ),
    );
    return _parseProfileResult(response.data);
  }

  PsgcLocationCatalog _parseLocations(Object? data) {
    final json = _exactMap(data, const {
      'version',
      'sourceUrl',
      'catalogSha256',
      'regions',
    }, 'location catalog');
    final version = json['version'];
    final sourceUrl = json['sourceUrl'];
    final digest = json['catalogSha256'];
    final regionsJson = json['regions'];
    final source = sourceUrl is String ? Uri.tryParse(sourceUrl) : null;
    if (version != 'PSGC-2Q-2026' ||
        source == null ||
        source.scheme != 'https' ||
        !source.hasAuthority ||
        digest is! String ||
        !_sha256.hasMatch(digest) ||
        regionsJson is! List ||
        regionsJson.length != 18) {
      throw const FormatException('Invalid Piso CAMP location catalog');
    }

    final regionCodes = <String>{};
    final globalCityCodes = <String>{};
    final regions = <PsgcRegion>[];
    for (final regionValue in regionsJson) {
      final region = _exactMap(regionValue, const {
        'code',
        'name',
        'cities',
      }, 'region');
      final code = region['code'];
      final name = region['name'];
      final citiesJson = region['cities'];
      if (code is! String ||
          !_psgcCode.hasMatch(code) ||
          !regionCodes.add(code) ||
          name is! String ||
          name.trim().isEmpty ||
          name != name.trim() ||
          citiesJson is! List ||
          citiesJson.isEmpty) {
        throw const FormatException('Invalid Piso CAMP region');
      }
      final cityCodes = <String>{};
      final cities = <PsgcCity>[];
      for (final cityValue in citiesJson) {
        final city = _exactMap(cityValue, const {'code', 'name'}, 'city');
        final cityCode = city['code'];
        final cityName = city['name'];
        if (cityCode is! String ||
            !_psgcCode.hasMatch(cityCode) ||
            !cityCodes.add(cityCode) ||
            !globalCityCodes.add(cityCode) ||
            cityName is! String ||
            cityName.trim().isEmpty ||
            cityName != cityName.trim()) {
          throw const FormatException('Invalid Piso CAMP city');
        }
        cities.add(PsgcCity(code: cityCode, name: cityName));
      }
      regions.add(PsgcRegion(code: code, name: name, cities: cities));
    }
    if (globalCityCodes.length != 149) {
      throw const FormatException('Invalid Piso CAMP city catalog');
    }
    return PsgcLocationCatalog(
      version: version as String,
      sourceUrl: sourceUrl as String,
      catalogSha256: digest,
      regions: List.unmodifiable(regions),
    );
  }

  PisoCampProfileResult _parseProfileResult(Object? data) {
    final json = _exactMap(data, const {
      'status',
      'missingFields',
      'name',
      'email',
      'profile',
    }, 'profile response');
    final status = switch (json['status']) {
      'missing' => PisoCampProfileState.missing,
      'complete' => PisoCampProfileState.complete,
      _ => throw const FormatException('Invalid Piso CAMP profile status'),
    };
    final missingJson = json['missingFields'];
    final name = json['name'];
    final email = json['email'];
    if (missingJson is! List ||
        name is! String ||
        name.trim().isEmpty ||
        email is! String ||
        email.trim().isEmpty) {
      throw const FormatException('Invalid Piso CAMP profile response');
    }
    final missing = <String>[];
    for (final value in missingJson) {
      if (value is! String ||
          !_missingFields.contains(value) ||
          missing.contains(value)) {
        throw const FormatException('Invalid Piso CAMP missing fields');
      }
      missing.add(value);
    }

    final profileJson = json['profile'];
    if (status == PisoCampProfileState.missing) {
      if (profileJson != null || missing.isEmpty) {
        throw const FormatException('Invalid missing Piso CAMP profile');
      }
      return PisoCampProfileResult(
        status: status,
        missingFields: List.unmodifiable(missing),
        name: name,
        email: email,
        profile: null,
      );
    }
    if (missing.isNotEmpty || profileJson == null) {
      throw const FormatException('Invalid complete Piso CAMP profile');
    }
    final profileMap = _exactMap(profileJson, const {
      'gender',
      'age',
      'regionCode',
      'cityCode',
      'registrationConsentRecordId',
    }, 'profile');
    final age = profileMap['age'];
    final regionCode = profileMap['regionCode'];
    final cityCode = profileMap['cityCode'];
    final consentId = profileMap['registrationConsentRecordId'];
    if (age is! int ||
        age < 1 ||
        age > 120 ||
        regionCode is! String ||
        !_psgcCode.hasMatch(regionCode) ||
        cityCode is! String ||
        !_psgcCode.hasMatch(cityCode) ||
        consentId is! String ||
        !_uuid.hasMatch(consentId)) {
      throw const FormatException('Invalid complete Piso CAMP profile');
    }
    return PisoCampProfileResult(
      status: status,
      missingFields: const [],
      name: name,
      email: email,
      profile: PisoCampProfile(
        gender: PisoCampGender.parse(profileMap['gender']),
        age: age,
        regionCode: regionCode,
        cityCode: cityCode,
        registrationConsentRecordId: consentId,
      ),
    );
  }

  Map<String, dynamic> _exactMap(
    Object? value,
    Set<String> expected,
    String label,
  ) {
    if (value is! Map<String, dynamic> ||
        value.length != expected.length ||
        !value.keys.every(expected.contains)) {
      throw FormatException('Invalid Piso CAMP $label');
    }
    return value;
  }
}
