import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/survey_document.dart';

const surveyItemId = '3f3d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61';
const ratingId = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
const npsId = 'bb22cc33-dd44-4e55-8f66-001122334455';
const textId = 'cc33dd44-ee55-4f66-8077-112233445566';

Map<String, Object?> ratingQuestion({String id = ratingId}) => {
  'id': id,
  'kind': 'rating',
  'prompt': 'How clear was this topic?',
  'required': true,
  'lowLabel': 'Not clear at all',
  'highLabel': 'Very clear',
};

Map<String, Object?> npsQuestion({String id = npsId}) => {
  'id': id,
  'kind': 'nps',
  'prompt': 'How likely are you to recommend Piso CAMP?',
  'required': true,
  'lowLabel': 'Not at all likely',
  'highLabel': 'Extremely likely',
};

Map<String, Object?> textQuestion({String id = textId, bool required = false}) => {
  'id': id,
  'kind': 'text',
  'prompt': 'What would you change?',
  'required': required,
};

Uint8List surveyBytes({
  String itemId = surveyItemId,
  String purpose = 'satisfaction',
  Object? subject,
  List<Map<String, Object?>>? questions,
  Map<String, Object?> overrides = const {},
}) {
  return Uint8List.fromList(
    utf8.encode(
      jsonEncode({
        'schemaVersion': 1,
        'logicalId': 'content.$itemId',
        'contentItemId': itemId,
        'contentVersionId': '0d5b0a3f-1c88-4f27-8f0e-2d0d0a6f9b74',
        'versionNo': 4,
        'contentType': 'survey',
        'title': 'How did we do?',
        'summary': 'A short evaluation shown after a topic.',
        'body': 'Answering is optional and takes less than a minute.',
        'seriesCode': null,
        'denominationCode': null,
        'primaryUrl': null,
        'featureLevel': null,
        'hotspot': null,
        'purpose': purpose,
        'subjectContentItemId': subject,
        'questions': questions ?? [ratingQuestion(), textQuestion()],
        'relatedLinks': const [],
        ...overrides,
      }),
    ),
  );
}

void main() {
  group('reading a published survey', () {
    test('reads the whole survey, questions and scales included', () {
      final parsed = SurveyDocument.parsePublished(
        surveyBytes(
          purpose: 'nps',
          subject: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          questions: [ratingQuestion(), npsQuestion(), textQuestion()],
        ),
      );

      expect(parsed.title, 'How did we do?');
      expect(parsed.purpose, SurveyPurpose.nps);
      expect(parsed.subjectContentItemId, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      expect(parsed.questions, hasLength(3));
      // A response names the question it answers, so the id has to survive the
      // journey into the bundle.
      expect(parsed.questions.first.id, ratingId);
      expect(parsed.questions.first.scaleMin, 1);
      expect(parsed.questions.first.scaleMax, 5);
      expect(parsed.questions[1].scaleMin, 0);
      expect(parsed.questions[1].scaleMax, 10);
      expect(parsed.questions.last.kind, SurveyQuestionKind.text);
      expect(parsed.questions.last.lowLabel, isNull);
    });

    test('reads a survey about the module as a whole', () {
      expect(
        SurveyDocument.parsePublished(surveyBytes()).subjectContentItemId,
        isNull,
      );
    });

    void rejects(String reason, Uint8List bytes) {
      test('rejects $reason', () {
        expect(
          () => SurveyDocument.parsePublished(bytes),
          throwsA(isA<BundleValidationException>()),
        );
      });
    }

    rejects('a survey with no questions', surveyBytes(questions: const []));
    rejects(
      'a survey with twenty-one questions',
      surveyBytes(
        questions: List.generate(
          21,
          (index) => {
            ...textQuestion(),
            'id': 'cc33dd44-ee55-4f66-8077-${index.toString().padLeft(12, '0')}',
            'prompt': 'Question $index',
          },
        ),
      ),
    );
    rejects(
      'a repeated question',
      surveyBytes(questions: [ratingQuestion(), ratingQuestion(id: npsId)]),
    );
    rejects(
      'a repeated question id',
      surveyBytes(
        questions: [
          ratingQuestion(),
          {...textQuestion(), 'id': ratingId},
        ],
      ),
    );
    rejects(
      'two NPS questions',
      surveyBytes(
        questions: [
          npsQuestion(),
          {...npsQuestion(id: textId), 'prompt': 'And again?'},
        ],
      ),
    );
    rejects(
      'a scaled question with no wording',
      surveyBytes(
        questions: [
          {
            'id': ratingId,
            'kind': 'rating',
            'prompt': 'How clear?',
            'required': true,
          },
        ],
      ),
    );
    rejects(
      'a written question carrying scale wording',
      surveyBytes(
        questions: [
          {...textQuestion(), 'lowLabel': 'Low', 'highLabel': 'High'},
        ],
      ),
    );
    rejects(
      'a question with no id',
      surveyBytes(
        questions: [
          {
            'kind': 'text',
            'prompt': 'What would you change?',
            'required': false,
          },
        ],
      ),
    );
    rejects(
      'an unknown question kind',
      surveyBytes(
        questions: [
          {...textQuestion(), 'kind': 'ranking'},
        ],
      ),
    );
    rejects('an unknown purpose', surveyBytes(purpose: 'vibes'));
    rejects(
      'a non-survey document',
      surveyBytes(overrides: {'contentType': 'advisory'}),
    );
    rejects(
      'a survey carrying a disclosure level',
      surveyBytes(overrides: {'featureLevel': 'first'}),
    );
    rejects(
      'markup in a prompt',
      surveyBytes(
        questions: [
          {...textQuestion(), 'prompt': '<b>Tell us</b>'},
        ],
      ),
    );
    rejects(
      'a logicalId that names another item',
      surveyBytes(overrides: {'logicalId': 'content.something-else'}),
    );
  });
}
