import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/encrypted_record_queue.dart';
import 'package:mobile/features/pisocamp/data/survey_response.dart';
import 'package:mobile/features/pisocamp/data/survey_response_queue.dart';

final class _MemoryKeyStore implements RecordQueueKeyStore {
  String? value;

  @override
  Future<String?> readKey() async => value;

  @override
  Future<void> writeKey(String key) async => value = key;
}

SurveyResponse response(int index, {List<SurveyAnswer>? answers}) {
  return SurveyResponse(
    responseId: '7c1f9a2e-3b4d-4e5f-8a6b-${index.toString().padLeft(12, '0')}',
    contentItemId: '3f3d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61',
    contentVersionId: '0d5b0a3f-1c88-4f27-8f0e-2d0d0a6f9b74',
    consentRecordId: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
    submittedAt: DateTime.utc(2026, 9, 2, 4, index),
    answers:
        answers ??
        const [
          SurveyScaleAnswer(
            questionId: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
            value: 4,
          ),
          SurveyTextAnswer(
            questionId: 'cc33dd44-ee55-4f66-8077-112233445566',
            value: 'Nothing, it was clear.',
          ),
        ],
  );
}

void main() {
  late Directory root;
  late _MemoryKeyStore keyStore;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('ev2-queue-');
    keyStore = _MemoryKeyStore();
  });

  tearDown(() async {
    if (await root.exists()) await root.delete(recursive: true);
  });

  Future<EncryptedSurveyQueue> open() => EncryptedSurveyQueue.initialize(
    applicationSupportDirectory: root,
    keyStore: keyStore,
  );

  test('keeps a queued response across a restart', () async {
    final queue = await open();
    await queue.enqueue(response(1));

    final reopened = await open();

    final batch = await reopened.readBatch();
    expect(batch, hasLength(1));
    expect(batch.single.responseId, response(1).responseId);
    expect(batch.single.answers, hasLength(2));
    expect((batch.single.answers.first as SurveyScaleAnswer).value, 4);
  });

  test('writes nothing a reader could lift the answers from', () async {
    final queue = await open();
    await queue.enqueue(response(1));

    final file = (await Directory(
      '${root.path}/pisocamp/surveys/v1/queue',
    ).list().toList()).whereType<File>().single;
    final bytes = await file.readAsBytes();

    // The written words are the person's own, so they are not on disk in the
    // clear even for a moment.
    expect(utf8.decode(bytes, allowMalformed: true), isNot(contains('clear')));
    expect(
      utf8.decode(bytes, allowMalformed: true),
      isNot(contains('consentRecordId')),
    );
  });

  test('enqueues one file per response id, however many times it is offered', () async {
    final queue = await open();

    await queue.enqueue(response(1));
    await queue.enqueue(response(1));

    expect(await queue.pendingCount(), 1);
  });

  test('acknowledging deletes only what was acknowledged', () async {
    final queue = await open();
    await queue.enqueue(response(1));
    await queue.enqueue(response(2));

    await queue.acknowledge([response(1).responseId]);

    final remaining = await queue.readBatch();
    expect(remaining.map((entry) => entry.responseId), [
      response(2).responseId,
    ]);
  });

  test('quarantines a corrupt file without losing its neighbour', () async {
    final queue = await open();
    await queue.enqueue(response(1));
    await queue.enqueue(response(2));
    final corrupt = File(
      '${root.path}/pisocamp/surveys/v1/queue/${response(1).responseId}.response',
    );
    await corrupt.writeAsBytes(Uint8List.fromList(List.filled(64, 7)));

    final batch = await queue.readBatch();

    expect(batch.map((entry) => entry.responseId), [response(2).responseId]);
    expect(
      await Directory('${root.path}/pisocamp/surveys/v1/quarantine')
          .list()
          .length,
      1,
    );
  });

  test('caps a batch at the server limit', () async {
    final queue = await open();
    for (var index = 0; index < 25; index += 1) {
      await queue.enqueue(response(index));
    }

    expect(await queue.readBatch(), hasLength(20));
    expect(await queue.pendingCount(), 25);
  });

  test('refuses a queue whose key has gone', () async {
    final queue = await open();
    await queue.enqueue(response(1));
    keyStore.value = null;

    // A queue with files but no key is a queue nobody can read; making a new
    // key would quietly discard somebody's answers.
    await expectLater(
      open(),
      throwsA(
        isA<RecordQueueException>().having(
          (error) => error.code,
          'code',
          'surveyKeyUnavailable',
        ),
      ),
    );
  });

  test('uses its own directory and key, not the analytics queue\'s', () {
    expect(surveyQueueLayout.directorySegments, ['pisocamp', 'surveys', 'v1']);
    expect(surveyQueueKeyName, isNot('pisocamp.analytics.queue-key.v1'));
    expect(surveyQueueLayout.aadPrefix, 'PCSQ:1');
  });
}
