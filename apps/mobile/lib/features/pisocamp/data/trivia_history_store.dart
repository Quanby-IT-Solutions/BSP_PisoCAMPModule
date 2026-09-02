import 'dart:convert';

import 'package:mobile/features/pisocamp/data/trivia_selection.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Seen-history kept on the device, in shared preferences.
///
/// Not secure storage and not the analytics queue: this is a list of content
/// identifiers and timestamps, it identifies nobody, and it exists only so the
/// same question is not offered twice in a week. It never leaves the device —
/// GM-3 is the ticket that syncs anything about answers.
class PreferencesTriviaHistoryStore implements TriviaHistoryStore {
  PreferencesTriviaHistoryStore(this._preferences);

  final SharedPreferences _preferences;

  static const String storageKey = 'pisocamp.trivia.seen.v1';

  /// How many sightings are kept. A window is days, not entries, but an
  /// unbounded list on a device with a large pool is a slow leak.
  static const int maximumEntries = 500;

  @override
  Future<List<TriviaSighting>> readSightings() async {
    final raw = _preferences.getString(storageKey);
    if (raw == null || raw.isEmpty) return const [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      final sightings = <TriviaSighting>[];
      for (final entry in decoded) {
        if (entry is! Map<String, Object?>) continue;
        final id = entry['id'];
        final at = entry['at'];
        if (id is! String || at is! String) continue;
        final shownAt = DateTime.tryParse(at);
        if (shownAt == null) continue;
        sightings.add(
          TriviaSighting(contentItemId: id, shownAt: shownAt.toUtc()),
        );
      }
      return sightings;
    } on Object {
      // Unreadable history is history the device forgets, not an error a guest
      // has to see: the worst outcome is a question repeating sooner.
      return const [];
    }
  }

  @override
  Future<void> recordShown(String contentItemId, DateTime shownAt) async {
    final existing = await readSightings();
    final updated = [
      for (final sighting in existing)
        if (sighting.contentItemId != contentItemId) sighting,
      TriviaSighting(contentItemId: contentItemId, shownAt: shownAt.toUtc()),
    ];
    updated.sort((left, right) => right.shownAt.compareTo(left.shownAt));
    final kept = updated.take(maximumEntries);
    await _preferences.setString(
      storageKey,
      jsonEncode([
        for (final sighting in kept)
          {
            'id': sighting.contentItemId,
            'at': sighting.shownAt.toIso8601String(),
          },
      ]),
    );
  }
}
