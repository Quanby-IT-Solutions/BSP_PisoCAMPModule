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
