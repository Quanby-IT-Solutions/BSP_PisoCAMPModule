// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pisocamp_repository.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(pisoCampRepository)
const pisoCampRepositoryProvider = PisoCampRepositoryProvider._();

final class PisoCampRepositoryProvider
    extends
        $FunctionalProvider<
          PisoCampRepository,
          PisoCampRepository,
          PisoCampRepository
        >
    with $Provider<PisoCampRepository> {
  const PisoCampRepositoryProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'pisoCampRepositoryProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$pisoCampRepositoryHash();

  @$internal
  @override
  $ProviderElement<PisoCampRepository> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  PisoCampRepository create(Ref ref) {
    return pisoCampRepository(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(PisoCampRepository value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<PisoCampRepository>(value),
    );
  }
}

String _$pisoCampRepositoryHash() =>
    r'0e92735675b43ccce83627d8e23399e1e0ae7eeb';
