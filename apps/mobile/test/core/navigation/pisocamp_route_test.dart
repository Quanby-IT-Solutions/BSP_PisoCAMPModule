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
}
