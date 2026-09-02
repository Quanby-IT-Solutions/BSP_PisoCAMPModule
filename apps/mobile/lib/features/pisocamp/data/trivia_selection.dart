import 'dart:math';

import 'package:mobile/features/pisocamp/data/trivia_question_document.dart';

/// How long a question stays "recently seen" unless configuration says
/// otherwise. BR-003's default.
const int kDefaultTriviaRepeatDays = 7;

/// When a question was last put in front of this device.
final class TriviaSighting {
  const TriviaSighting({required this.contentItemId, required this.shownAt});

  final String contentItemId;
  final DateTime shownAt;
}

/// Where seen-history lives.
///
/// An interface because the history is per device and never leaves it: a guest
/// has no account to attach it to, and GM-3 is the ticket that syncs anything.
abstract interface class TriviaHistoryStore {
  Future<List<TriviaSighting>> readSightings();
  Future<void> recordShown(String contentItemId, DateTime shownAt);
}

/// Chooses the next question to offer.
///
/// The rule the ticket states has a condition attached — *"excluding any shown
/// within the repeat window when enough questions exist"* — and that condition
/// is the whole difficulty. A pool of three cannot honour a seven-day window
/// without eventually offering nothing, and offering nothing is worse than
/// repeating. So the window is applied when it can be, and stood down when it
/// cannot, which is stated here rather than discovered later.
class TriviaSelector {
  TriviaSelector({Random? random, DateTime Function()? clock})
    : _random = random ?? Random.secure(),
      _clock = clock ?? DateTime.now;

  final Random _random;
  final DateTime Function() _clock;

  /// Picks a question, or null when the pool is empty.
  TriviaQuestionDocument? select({
    required List<TriviaQuestionDocument> pool,
    required List<TriviaSighting> history,
    int repeatDays = kDefaultTriviaRepeatDays,
  }) {
    if (pool.isEmpty) return null;

    final cutoff = _clock().toUtc().subtract(Duration(days: repeatDays));
    final recent = <String>{
      for (final sighting in history)
        if (!sighting.shownAt.toUtc().isBefore(cutoff)) sighting.contentItemId,
    };

    final unseen = pool
        .where((question) => !recent.contains(question.contentItemId))
        .toList(growable: false);

    // "When enough questions exist": if the window would leave nothing, it is
    // stood down for this draw rather than leaving the guest with no prompt.
    final candidates = unseen.isEmpty ? pool : unseen;
    return candidates[_random.nextInt(candidates.length)];
  }
}

/// Whether a window can be honoured against a pool of this size.
///
/// Exposed so a caller can say *why* a question repeated rather than leaving it
/// looking like the shuffle is broken.
bool triviaWindowIsHonourable({
  required int poolSize,
  required int recentlySeen,
}) {
  return poolSize > recentlySeen;
}
