import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/navigation/app_router.dart';

void main() {
  test('unauthenticated Piso CAMP route is not redirected to login', () {
    expect(
      resolveAppRedirect(
        isOnboardingDone: true,
        isAuthenticated: false,
        matchedLocation: AppRoutes.pisoCamp,
      ),
      isNull,
    );
  });

  test('other unauthenticated routes retain the login redirect', () {
    expect(
      resolveAppRedirect(
        isOnboardingDone: true,
        isAuthenticated: false,
        matchedLocation: AppRoutes.home,
      ),
      AppRoutes.login,
    );
  });

  test('only exact valid currency routes are guest-safe', () {
    const allowed = <String>[
      '/pisocamp/currency/banknotes',
      '/pisocamp/currency/coins',
      '/pisocamp/currency/banknotes/catalog.ngc-banknotes.php-20',
      '/pisocamp/currency/coins/catalog.ngc-coins.php-1',
      '/pisocamp/currency/banknotes/content%3Averified',
      // CE-2's 3D view is guest content like the detail it opens from.
      '/pisocamp/currency/coins/catalog.ngc-coins.php-1/3d',
      // CE-4's tactile simulation likewise.
      '/pisocamp/currency/banknotes/catalog.ngc-banknotes.php-20/tactile',
      // CE-5's tilt simulation likewise.
      '/pisocamp/currency/banknotes/catalog.ngc-banknotes.php-20/tilt',
    ];
    const protected = <String>[
      '/pisocamp/currency',
      '/pisocamp/currency/banknote',
      '/pisocamp/currency/coins/',
      '/pisocamp/currency/notes/catalog.ngc-banknotes.php-20',
      '/pisocamp/currency/coins/UPPER',
      '/pisocamp/currency/coins/bad%2Fid',
      '/pisocamp/currency/coins/catalog..bad',
      '/pisocamp/currency/coins/catalog.ngc-coins.php-1/4d',
      '/pisocamp/currency/banknotes/catalog.ngc-banknotes.php-20/tactile/more',
      '/pisocamp/currency/banknotes/catalog.ngc-banknotes.php-20/tilting',
      '/pisocamp/currency/banknotes/UPPER/tactile',
      '/pisocamp/currency/coins/catalog.ngc-coins.php-1/3d/more',
      '/pisocamp/currency/coins/UPPER/3d',
      '/pisocamp/currency-banknotes',
      '/pisocamp/register/currency/coins',
      '/profile',
    ];

    for (final route in allowed) {
      expect(
        resolveAppRedirect(
          isOnboardingDone: true,
          isAuthenticated: false,
          matchedLocation: route,
        ),
        isNull,
        reason: route,
      );
    }
    for (final route in protected) {
      expect(
        resolveAppRedirect(
          isOnboardingDone: true,
          isAuthenticated: false,
          matchedLocation: route,
        ),
        AppRoutes.login,
        reason: route,
      );
    }
  });

  test('currency route construction validates and percent-encodes IDs', () {
    expect(
      AppRoutes.currencyDetail(
        kind: 'banknotes',
        logicalId: 'content:8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
      ),
      '/pisocamp/currency/banknotes/content%3A8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
    );
    expect(
      () => AppRoutes.currencyDetail(kind: 'notes', logicalId: 'catalog.valid'),
      throwsArgumentError,
    );
    expect(
      () => AppRoutes.currencyDetail(kind: 'coins', logicalId: '../private'),
      throwsArgumentError,
    );
    expect(
      AppRoutes.currencyModel(
        kind: 'coins',
        logicalId: 'catalog.ngc-coins.php-1',
      ),
      '/pisocamp/currency/coins/catalog.ngc-coins.php-1/3d',
    );
    expect(
      () => AppRoutes.currencyModel(kind: 'coins', logicalId: '../private'),
      throwsArgumentError,
    );
    expect(
      AppRoutes.currencyTactile(
        kind: 'banknotes',
        logicalId: 'catalog.ngc-banknotes.php-20',
      ),
      '/pisocamp/currency/banknotes/catalog.ngc-banknotes.php-20/tactile',
    );
    expect(
      () =>
          AppRoutes.currencyTactile(kind: 'notes', logicalId: 'catalog.valid'),
      throwsArgumentError,
    );
    expect(
      AppRoutes.currencyTilt(
        kind: 'banknotes',
        logicalId: 'catalog.ngc-banknotes.php-20',
      ),
      '/pisocamp/currency/banknotes/catalog.ngc-banknotes.php-20/tilt',
    );
    expect(
      () => AppRoutes.currencyTilt(kind: 'notes', logicalId: 'catalog.valid'),
      throwsArgumentError,
    );
  });

  test(
    'dedicated Piso CAMP registration stays reachable before authentication',
    () {
      expect(
        resolveAppRedirect(
          isOnboardingDone: true,
          isAuthenticated: false,
          matchedLocation: AppRoutes.pisoCampRegistration,
        ),
        isNull,
      );
    },
  );

  test('dedicated Piso CAMP profile completion stays open after signup', () {
    expect(
      resolveAppRedirect(
        isOnboardingDone: true,
        isAuthenticated: true,
        matchedLocation: AppRoutes.pisoCampRegistration,
      ),
      isNull,
    );
  });

  group('F5 incoming approved links', () {
    void translates(String location, String route) {
      test('$location becomes $route', () {
        expect(resolvePisoCampIncomingLink(location), route);
        // And the guard runs on the translated route, not the raw link.
        expect(
          resolveAppRedirect(
            isOnboardingDone: true,
            isAuthenticated: false,
            matchedLocation: location,
          ),
          route,
        );
      });
    }

    translates('/pisocamp/coins', AppRoutes.pisoCampCoins);
    translates('/pisocamp/banknotes', AppRoutes.pisoCampBanknotes);
    translates(
      '/pisocamp/coins/catalog.ngc-coins.php-1',
      '/pisocamp/currency/coins/catalog.ngc-coins.php-1',
    );
    translates('/coins', AppRoutes.pisoCampCoins);
    translates(
      '/banknotes/catalog.ngc-banknotes.php-20',
      '/pisocamp/currency/banknotes/catalog.ngc-banknotes.php-20',
    );

    test('leaves an app location alone', () {
      // The bug this guards against: a bare path does not say which scheme it
      // arrived under, so an unrestricted guess hijacked the home route.
      for (final location in [
        AppRoutes.home,
        AppRoutes.login,
        AppRoutes.pisoCamp,
        AppRoutes.pisoCampCoins,
        '/profile',
        '/pisocamp/currency/coins/catalog.ngc-coins.php-1',
      ]) {
        expect(resolvePisoCampIncomingLink(location), isNull, reason: location);
      }
    });

    test('refuses a link it cannot account for', () {
      for (final location in [
        '/pisocamp/notes/catalog.ngc-banknotes.php-20',
        '/pisocamp/coins/UPPER',
        '/pisocamp/coins/catalog.ngc-coins.php-1/extra',
        'pisocamp/coins',
      ]) {
        expect(resolvePisoCampIncomingLink(location), isNull, reason: location);
      }
    });

    test('an unauthenticated visitor still reaches guest content', () {
      // Translated first, guarded second: the criterion is that an approved
      // link opens the screen, not that it bounces to login.
      expect(
        resolveAppRedirect(
          isOnboardingDone: true,
          isAuthenticated: false,
          matchedLocation: '/pisocamp/currency/coins/catalog.ngc-coins.php-1',
        ),
        isNull,
      );
    });
  });
}
