// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pisocamp_provider.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, type=warning

@ProviderFor(guestIdentityService)
const guestIdentityServiceProvider = GuestIdentityServiceProvider._();

final class GuestIdentityServiceProvider
    extends
        $FunctionalProvider<
          GuestIdentityService,
          GuestIdentityService,
          GuestIdentityService
        >
    with $Provider<GuestIdentityService> {
  const GuestIdentityServiceProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'guestIdentityServiceProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$guestIdentityServiceHash();

  @$internal
  @override
  $ProviderElement<GuestIdentityService> $createElement(
    $ProviderPointer pointer,
  ) => $ProviderElement(pointer);

  @override
  GuestIdentityService create(Ref ref) {
    return guestIdentityService(ref);
  }

  /// {@macro riverpod.override_with_value}
  Override overrideWithValue(GuestIdentityService value) {
    return $ProviderOverride(
      origin: this,
      providerOverride: $SyncValueProvider<GuestIdentityService>(value),
    );
  }
}

String _$guestIdentityServiceHash() =>
    r'7da88c9eb82e31f4a85788388a0508a970c6afb2';

@ProviderFor(pisoCampHome)
const pisoCampHomeProvider = PisoCampHomeProvider._();

final class PisoCampHomeProvider
    extends
        $FunctionalProvider<
          AsyncValue<PisoCampHomeLoadResult>,
          PisoCampHomeLoadResult,
          Stream<PisoCampHomeLoadResult>
        >
    with
        $FutureModifier<PisoCampHomeLoadResult>,
        $StreamProvider<PisoCampHomeLoadResult> {
  const PisoCampHomeProvider._()
    : super(
        from: null,
        argument: null,
        retry: null,
        name: r'pisoCampHomeProvider',
        isAutoDispose: true,
        dependencies: null,
        $allTransitiveDependencies: null,
      );

  @override
  String debugGetCreateSourceHash() => _$pisoCampHomeHash();

  @$internal
  @override
  $StreamProviderElement<PisoCampHomeLoadResult> $createElement(
    $ProviderPointer pointer,
  ) => $StreamProviderElement(pointer);

  @override
  Stream<PisoCampHomeLoadResult> create(Ref ref) {
    return pisoCampHome(ref);
  }
}

String _$pisoCampHomeHash() => r'2ce64b3f958f4145ee18254ffcf503b59e03be7c';
