import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/pisocamp_profile_repository.dart';

Map<String, dynamic> _profileResponse() => <String, dynamic>{
  'status': 'complete',
  'missingFields': <String>[],
  'name': 'Test User',
  'email': 'test@example.com',
  'profile': <String, dynamic>{
    'gender': 'prefer_not_to_say',
    'age': 36,
    'regionCode': '1300000000',
    'cityCode': '1374040000',
    'registrationConsentRecordId': '018f6eb8-4f57-7d2d-8d2d-f2fb359c4aac',
  },
};

Map<String, dynamic> _locationResponse() {
  var cityNumber = 0;
  final regions = <Map<String, dynamic>>[];
  for (var regionIndex = 0; regionIndex < 18; regionIndex++) {
    final cityCount = regionIndex < 5 ? 9 : 8;
    regions.add(<String, dynamic>{
      'code': (regionIndex + 1).toString().padLeft(10, '0'),
      'name': 'Region ${regionIndex + 1}',
      'cities': List<Map<String, dynamic>>.generate(cityCount, (_) {
        cityNumber++;
        return <String, dynamic>{
          'code': (1000000000 + cityNumber).toString(),
          'name': 'City $cityNumber',
        };
      }),
    });
  }
  return <String, dynamic>{
    'version': 'PSGC-2Q-2026',
    'sourceUrl': 'https://psa.gov.ph/classification/psgc',
    'catalogSha256': 'a' * 64,
    'regions': regions,
  };
}

void main() {
  test(
    'parses the frozen location catalog and rejects unexpected fields',
    () async {
      var includeUnexpectedField = false;
      final dio = Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              final data = _locationResponse();
              if (includeUnexpectedField) data['cached'] = true;
              handler.resolve(
                Response<Map<String, dynamic>>(
                  requestOptions: options,
                  statusCode: 200,
                  data: data,
                ),
              );
            },
          ),
        );
      final repository = PisoCampProfileRepository(dio);

      final catalog = await repository.fetchLocations();
      expect(catalog.version, 'PSGC-2Q-2026');
      expect(catalog.regions.length, 18);
      expect(catalog.regions.expand((region) => region.cities).length, 149);

      includeUnexpectedField = true;
      await expectLater(repository.fetchLocations(), throwsFormatException);
    },
  );

  test(
    'rejects partial catalogs and city codes duplicated across regions',
    () async {
      late Map<String, dynamic> responseData;
      final dio = Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) => handler.resolve(
              Response<Map<String, dynamic>>(
                requestOptions: options,
                statusCode: 200,
                data: responseData,
              ),
            ),
          ),
        );
      final repository = PisoCampProfileRepository(dio);

      responseData = _locationResponse();
      (responseData['regions'] as List).removeLast();
      await expectLater(repository.fetchLocations(), throwsFormatException);

      responseData = _locationResponse();
      final regions = responseData['regions'] as List<dynamic>;
      final firstCity =
          (regions.first as Map<String, dynamic>)['cities'] as List;
      final secondCity = (regions[1] as Map<String, dynamic>)['cities'] as List;
      (secondCity.first as Map<String, dynamic>)['code'] =
          (firstCity.first as Map<String, dynamic>)['code'];
      await expectLater(repository.fetchLocations(), throwsFormatException);
    },
  );

  test(
    'profile POST sends exact idempotency and device headers and body',
    () async {
      late RequestOptions sent;
      final dio = Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              sent = options;
              handler.resolve(
                Response<Map<String, dynamic>>(
                  requestOptions: options,
                  statusCode: 200,
                  data: _profileResponse(),
                ),
              );
            },
          ),
        );
      final repository = PisoCampProfileRepository(dio);
      const id = '018f6eb8-4f57-7d2d-8d2d-f2fb359c4aac';

      final result = await repository.createProfile(
        id: id,
        gender: PisoCampGender.preferNotToSay,
        age: 36,
        regionCode: '1300000000',
        cityCode: '1374040000',
        devicePseudoId: 'abcdefghijklmnopqrstuv',
      );

      expect(result.status, PisoCampProfileState.complete);
      expect(sent.headers['Idempotency-Key'], id);
      expect(sent.headers['X-Device-Pseudo-Id'], 'abcdefghijklmnopqrstuv');
      expect(sent.data, <String, Object>{
        'id': id,
        'gender': 'prefer_not_to_say',
        'age': 36,
        'regionCode': '1300000000',
        'cityCode': '1374040000',
      });
    },
  );

  test(
    'a missing profile accepts only the frozen missing-field vocabulary',
    () async {
      final dio = Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) => handler.resolve(
              Response<Map<String, dynamic>>(
                requestOptions: options,
                statusCode: 200,
                data: <String, dynamic>{
                  'status': 'missing',
                  'missingFields': <String>['age', 'regionCode', 'cityCode'],
                  'name': 'Test User',
                  'email': 'test@example.com',
                  'profile': null,
                },
              ),
            ),
          ),
        );

      final result = await PisoCampProfileRepository(dio).fetchProfile();

      expect(result.status, PisoCampProfileState.missing);
      expect(result.missingFields, <String>['age', 'regionCode', 'cityCode']);
      expect(result.profile, isNull);
    },
  );
}
