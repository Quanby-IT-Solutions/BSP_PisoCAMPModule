import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/utils/uuid_v4.dart';

final _uuidV4 = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
);

void main() {
  test('creates 1000 distinct lowercase UUIDv4 values', () {
    final values = List<String>.generate(1000, (_) => createUuidV4());

    expect(values.every(_uuidV4.hasMatch), isTrue);
    expect(values.toSet(), hasLength(1000));
  });

  test('sets UUIDv4 version and variant bits from injected random bytes', () {
    final value = createUuidV4(
      _SequenceRandom(<int>[
        0x00,
        0x01,
        0x02,
        0x03,
        0x04,
        0x05,
        0xff,
        0x07,
        0x3f,
        0x09,
        0x0a,
        0x0b,
        0x0c,
        0x0d,
        0x0e,
        0x0f,
      ]),
    );

    expect(value, '00010203-0405-4f07-bf09-0a0b0c0d0e0f');
  });
}

final class _SequenceRandom implements Random {
  _SequenceRandom(this._values);

  final List<int> _values;
  var _index = 0;

  @override
  bool nextBool() => nextInt(2) == 1;

  @override
  double nextDouble() => nextInt(1 << 20) / (1 << 20);

  @override
  int nextInt(int max) => _values[_index++] % max;
}
