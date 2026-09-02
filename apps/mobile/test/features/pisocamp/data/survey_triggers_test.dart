import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/survey_document.dart';
import 'package:mobile/features/pisocamp/data/survey_triggers.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'survey_document_test.dart' show ratingQuestion, surveyBytes, textQuestion;

String itemId(int index) =>
    '3f3d4c0e-9f7c-4f3a-9d8e-${index.toString().padLeft(12, '0')}';

SurveyDocument survey(int index, {String? subject}) {
  return SurveyDocument.parsePublished(
    surveyBytes(
      itemId: itemId(index),
      subject: subject,
      questions: [ratingQuestion(), textQuestion()],
    ),
  );
}

SurveyTriggerRule rule(
  int index, {
  SurveyTriggerType trigger = SurveyTriggerType.topicCompletion,
  int priority = 50,
  int? pageDepth,
  int? cap,
}) {
  return SurveyTriggerRule(
    contentItemId: itemId(index),
    triggerType: trigger,
    priority: priority,
    pageDepth: pageDepth,
    frequencyCapDays: cap,
  );
}

void main() {
  final now = DateTime.utc(2026, 9, 2, 12);
  const engine = SurveyTriggerEngine();
  SurveyTriggerEngine engineAt(DateTime at) =>
      SurveyTriggerEngine(clock: () => at);

  group('reading the rules a device is given', () {
    test('reads a whole rule', () {
      final parsed = SurveyTriggerRule.tryFromJson({
        'contentItemId': itemId(1),
        'triggerType': 'page_depth',
        'pageDepth': 5,
        'frequencyCapDays': 30,
        'priority': 10,
      });

      expect(parsed?.triggerType, SurveyTriggerType.pageDepth);
      expect(parsed?.pageDepth, 5);
      expect(parsed?.frequencyCapDays, 30);
      expect(parsed?.priority, 10);
    });

    test('drops a rule this build does not understand, and keeps the rest', () {
      // A newer console arranging a trigger a released app has never heard of
      // should cost that rule, not the module.
      final rules = SurveyTriggerRule.listFromJson([
        {
          'contentItemId': itemId(1),
          'triggerType': 'on_a_full_moon',
          'pageDepth': null,
          'frequencyCapDays': null,
          'priority': 10,
        },
        {
          'contentItemId': itemId(2),
          'triggerType': 'module_exit',
          'pageDepth': null,
          'frequencyCapDays': null,
          'priority': 10,
        },
      ]);

      expect(rules.map((entry) => entry.contentItemId), [itemId(2)]);
    });

    test('drops a depth that does not belong and a depth trigger with none', () {
      expect(
        SurveyTriggerRule.tryFromJson({
          'contentItemId': itemId(1),
          'triggerType': 'module_exit',
          'pageDepth': 3,
          'frequencyCapDays': null,
          'priority': 10,
        }),
        isNull,
      );
      expect(
        SurveyTriggerRule.tryFromJson({
          'contentItemId': itemId(1),
          'triggerType': 'page_depth',
          'pageDepth': null,
          'frequencyCapDays': null,
          'priority': 10,
        }),
        isNull,
      );
    });

    test('drops a priority off the scale', () {
      for (final priority in [0, 101]) {
        expect(
          SurveyTriggerRule.tryFromJson({
            'contentItemId': itemId(1),
            'triggerType': 'module_exit',
            'pageDepth': null,
            'frequencyCapDays': null,
            'priority': priority,
          }),
          isNull,
        );
      }
    });
  });

  group('AC2 — the highest priority wins, and the cap is enforced', () {
    test('offers the highest-priority eligible survey', () {
      final selected = engine.select(
        trigger: SurveyTriggerType.moduleExit,
        rules: [
          rule(1, trigger: SurveyTriggerType.moduleExit, priority: 50),
          rule(2, trigger: SurveyTriggerType.moduleExit, priority: 10),
          rule(3, trigger: SurveyTriggerType.moduleExit, priority: 30),
        ],
        surveys: [survey(1), survey(2), survey(3)],
        lastOffered: const {},
      );

      // 1 is highest, so 10 beats 30 beats 50.
      expect(selected?.contentItemId, itemId(2));
    });

    test('settles equal priorities the same way every time', () {
      final rules = [
        rule(3, trigger: SurveyTriggerType.moduleExit, priority: 10),
        rule(1, trigger: SurveyTriggerType.moduleExit, priority: 10),
      ];

      for (var attempt = 0; attempt < 5; attempt += 1) {
        expect(
          engine
              .select(
                trigger: SurveyTriggerType.moduleExit,
                rules: rules,
                surveys: [survey(1), survey(3)],
                lastOffered: const {},
              )
              ?.contentItemId,
          itemId(1),
        );
      }
    });

    test('skips a survey inside its frequency cap', () {
      final selected = engineAt(now).select(
        trigger: SurveyTriggerType.moduleExit,
        rules: [
          rule(1, trigger: SurveyTriggerType.moduleExit, priority: 10, cap: 30),
          rule(2, trigger: SurveyTriggerType.moduleExit, priority: 50),
        ],
        surveys: [survey(1), survey(2)],
        lastOffered: {itemId(1): now.subtract(const Duration(days: 29))},
      );

      // The higher-priority survey is capped, so the lower one is offered
      // rather than nothing.
      expect(selected?.contentItemId, itemId(2));
    });

    test('offers again once the cap has run out, exactly on the day', () {
      final rules = [
        rule(1, trigger: SurveyTriggerType.moduleExit, priority: 10, cap: 30),
      ];

      expect(
        engineAt(now)
            .select(
              trigger: SurveyTriggerType.moduleExit,
              rules: rules,
              surveys: [survey(1)],
              lastOffered: {itemId(1): now.subtract(const Duration(days: 30))},
            )
            ?.contentItemId,
        itemId(1),
      );
      expect(
        engineAt(now).select(
          trigger: SurveyTriggerType.moduleExit,
          rules: rules,
          surveys: [survey(1)],
          lastOffered: {
            itemId(1): now.subtract(const Duration(days: 30)).add(
              const Duration(minutes: 1),
            ),
          },
        ),
        isNull,
      );
    });

    test('a rule with no cap is always due', () {
      expect(
        engineAt(now)
            .select(
              trigger: SurveyTriggerType.moduleExit,
              rules: [rule(1, trigger: SurveyTriggerType.moduleExit)],
              surveys: [survey(1)],
              lastOffered: {itemId(1): now},
            )
            ?.contentItemId,
        itemId(1),
      );
    });

    test('offers nothing when every eligible survey is capped', () {
      expect(
        engineAt(now).select(
          trigger: SurveyTriggerType.moduleExit,
          rules: [
            rule(1, trigger: SurveyTriggerType.moduleExit, cap: 30),
            rule(2, trigger: SurveyTriggerType.moduleExit, cap: 30),
          ],
          surveys: [survey(1), survey(2)],
          lastOffered: {itemId(1): now, itemId(2): now},
        ),
        isNull,
      );
    });
  });

  group('a trigger only fires on what it is about', () {
    test('ignores rules for another trigger type', () {
      expect(
        engine.select(
          trigger: SurveyTriggerType.appExit,
          rules: [rule(1, trigger: SurveyTriggerType.moduleExit)],
          surveys: [survey(1)],
          lastOffered: const {},
        ),
        isNull,
      );
    });

    test('matches a topic survey to the topic just read', () {
      final about = survey(1, subject: itemId(9));
      final elsewhere = survey(2, subject: itemId(8));

      expect(
        engine
            .select(
              trigger: SurveyTriggerType.topicCompletion,
              rules: [rule(1), rule(2)],
              surveys: [about, elsewhere],
              lastOffered: const {},
              subjectContentItemId: itemId(9),
            )
            ?.contentItemId,
        itemId(1),
      );
    });

    test('lets a survey about the module follow any topic', () {
      // No subject means "about the module", which every topic completes.
      expect(
        engine
            .select(
              trigger: SurveyTriggerType.topicCompletion,
              rules: [rule(1)],
              surveys: [survey(1)],
              lastOffered: const {},
              subjectContentItemId: itemId(9),
            )
            ?.contentItemId,
        itemId(1),
      );
    });

    test('waits for the configured depth', () {
      final rules = [
        rule(1, trigger: SurveyTriggerType.pageDepth, pageDepth: 5),
      ];

      expect(
        engine.select(
          trigger: SurveyTriggerType.pageDepth,
          rules: rules,
          surveys: [survey(1)],
          lastOffered: const {},
          pageDepth: 4,
        ),
        isNull,
      );
      expect(
        engine
            .select(
              trigger: SurveyTriggerType.pageDepth,
              rules: rules,
              surveys: [survey(1)],
              lastOffered: const {},
              pageDepth: 5,
            )
            ?.contentItemId,
        itemId(1),
      );
    });

    test('ignores a rule for a survey this device does not hold', () {
      // The bundle decides what exists; a rule for something absent is a rule
      // for a survey that cannot be shown.
      expect(
        engine.select(
          trigger: SurveyTriggerType.moduleExit,
          rules: [rule(4, trigger: SurveyTriggerType.moduleExit)],
          surveys: [survey(1)],
          lastOffered: const {},
        ),
        isNull,
      );
    });
  });

  group('the frequency store', () {
    setUp(() => SharedPreferences.setMockInitialValues(const {}));

    test('remembers when a survey was last offered, across a restart', () async {
      final store = PreferencesSurveyFrequencyStore(
        await SharedPreferences.getInstance(),
      );

      await store.recordOffered(itemId(1), now);

      final reopened = PreferencesSurveyFrequencyStore(
        await SharedPreferences.getInstance(),
      );
      expect(await reopened.readLastOffered(), {itemId(1): now});
    });

    test('keeps the most recent offering of each survey', () async {
      final store = PreferencesSurveyFrequencyStore(
        await SharedPreferences.getInstance(),
      );

      await store.recordOffered(itemId(1), now.subtract(const Duration(days: 2)));
      await store.recordOffered(itemId(1), now);

      expect(await store.readLastOffered(), {itemId(1): now});
    });

    test('forgets unreadable history rather than failing', () async {
      SharedPreferences.setMockInitialValues({
        PreferencesSurveyFrequencyStore.storageKey: 'not json',
      });
      final store = PreferencesSurveyFrequencyStore(
        await SharedPreferences.getInstance(),
      );

      expect(await store.readLastOffered(), isEmpty);
    });
  });
}
