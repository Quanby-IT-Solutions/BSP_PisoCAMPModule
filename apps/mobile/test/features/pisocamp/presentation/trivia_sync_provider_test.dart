import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/features/pisocamp/data/trivia_repository.dart';
import 'package:mobile/features/pisocamp/data/trivia_response.dart';
import 'package:mobile/features/pisocamp/data/trivia_response_store.dart';
import 'package:mobile/features/pisocamp/data/trivia_sync_controller.dart';
import 'package:mobile/features/pisocamp/presentation/providers/trivia_provider.dart';
import 'package:mobile/services/storage/theme_storage_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/trivia_response_store_test.dart' show record;

/// Stands in for the signed-in account, so a test can register mid-session.
final class _AccountNotifier extends Notifier<TriviaSyncAccount?> {
  @override
  TriviaSyncAccount? build() => null;

  void signIn(String accountId) =>
      state = TriviaSyncAccount(accountId: accountId);
}

final _signedInProvider =
    NotifierProvider<_AccountNotifier, TriviaSyncAccount?>(
      _AccountNotifier.new,
    );

final class _RecordingUploader implements TriviaUploadPort {
  final List<List<String>> batches = [];

  @override
  Future<List<String>> upload(List<TriviaResponseRecord> responses) async {
    final ids = [for (final response in responses) response.responseId];
    batches.add(ids);
    return ids;
  }
}

void main() {
  late SharedPreferences preferences;

  setUp(() async {
    SharedPreferences.setMockInitialValues(const {});
    preferences = await SharedPreferences.getInstance();
  });

  /// Keeps the controller alive the way [App] does.
  ///
  /// Riverpod pauses a provider that nothing is listening to, and a paused
  /// controller never hears the connectivity change it exists to react to —
  /// which is why the app watches this provider at the root rather than
  /// reading it from a screen.
  TriviaSyncController keepAlive(ProviderContainer container) => container
      .listen(triviaSyncControllerProvider, (_, _) {}, fireImmediately: true)
      .read();

  ProviderContainer containerFor({
    required TriviaUploadPort uploader,
    required TriviaSyncAccount? account,
    bool online = true,
  }) {
    final container = ProviderContainer(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(preferences),
        triviaResponseStoreProvider.overrideWithValue(
          PreferencesTriviaResponseStore(preferences),
        ),
        triviaRepositoryProvider.overrideWithValue(uploader),
        triviaSyncAccountProvider.overrideWithValue(account),
        connectivityStatusProvider.overrideWith(
          (ref) => Stream.value(online),
        ),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  test('a guest keeps their answers on the device', () async {
    final uploader = _RecordingUploader();
    final container = containerFor(uploader: uploader, account: null);
    final controller = keepAlive(container);

    await controller.record(record(1));

    expect(uploader.batches, isEmpty);
    expect(
      await container.read(triviaResponseStoreProvider).readPending(),
      hasLength(1),
    );
  });

  test('an account already present at startup claims the backlog once', () async {
    final store = PreferencesTriviaResponseStore(preferences);
    await store.record(record(1));
    await store.record(record(2));
    final uploader = _RecordingUploader();
    final container = containerFor(
      uploader: uploader,
      account: const TriviaSyncAccount(accountId: 'account-one'),
    );

    // Reading the provider is what a screen does; the merge is wired to the
    // account rather than to the sign-up screen, so an interrupted
    // registration still merges on the next launch. Nothing else is called:
    // connectivity arriving is what starts the upload, exactly as it does on
    // a device that opens the module before the radio has settled.
    keepAlive(container);
    await Future<void>.delayed(const Duration(milliseconds: 10));

    expect(uploader.batches, hasLength(1));
    expect(uploader.batches.single, [
      record(1).responseId,
      record(2).responseId,
    ]);
    expect(await store.readMergedAccountId(), 'account-one');
  });

  test('a guest who registers mid-session hands their backlog over', () async {
    final store = PreferencesTriviaResponseStore(preferences);
    final uploader = _RecordingUploader();
    final container = ProviderContainer(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(preferences),
        triviaResponseStoreProvider.overrideWithValue(store),
        triviaRepositoryProvider.overrideWithValue(uploader),
        triviaSyncAccountProvider.overrideWith(
          (ref) => ref.watch(_signedInProvider),
        ),
        connectivityStatusProvider.overrideWith((ref) => Stream.value(true)),
      ],
    );
    addTearDown(container.dispose);
    final controller = keepAlive(container);

    await controller.record(record(1));
    expect(uploader.batches, isEmpty, reason: 'a guest uploads nothing');

    container.read(_signedInProvider.notifier).signIn('account-one');
    await Future<void>.delayed(const Duration(milliseconds: 10));

    expect(uploader.batches.single, [record(1).responseId]);
    expect(await store.readMergedAccountId(), 'account-one');
    expect(await store.readPending(), isEmpty);
  });

  test('the prompt coordinator records answers through the sync controller', () async {
    final uploader = _RecordingUploader();
    final container = containerFor(
      uploader: uploader,
      account: const TriviaSyncAccount(accountId: 'account-one'),
    );

    expect(
      container.read(triviaPromptCoordinatorProvider).responses,
      same(keepAlive(container)),
    );
  });

  test('nothing is uploaded while the device is offline', () async {
    final uploader = _RecordingUploader();
    final container = containerFor(
      uploader: uploader,
      account: const TriviaSyncAccount(accountId: 'account-one'),
      online: false,
    );
    final controller = keepAlive(container);

    await controller.record(record(1));

    expect(uploader.batches, isEmpty);
    expect(controller.state.value.reasonCode, 'offline');
  });
}
