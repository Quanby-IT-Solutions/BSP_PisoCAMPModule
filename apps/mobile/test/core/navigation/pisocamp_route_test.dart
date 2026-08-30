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
    ];
    const protected = <String>[
      '/pisocamp/currency',
      '/pisocamp/currency/banknote',
      '/pisocamp/currency/coins/',
      '/pisocamp/currency/notes/catalog.ngc-banknotes.php-20',
      '/pisocamp/currency/coins/UPPER',
      '/pisocamp/currency/coins/bad%2Fid',
      '/pisocamp/currency/coins/catalog..bad',
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
}
