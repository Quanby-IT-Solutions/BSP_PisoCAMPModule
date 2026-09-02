import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/features/pisocamp/data/deep_links.dart';
import 'package:mobile/features/pisocamp/data/link_service.dart';
import 'package:url_launcher/url_launcher.dart';

PisoCampDeepLink? resolve(String uri) =>
    resolvePisoCampDeepLink(Uri.parse(uri));

void main() {
  group('approved links this module answers', () {
    test('opens the module home from either shape of link', () {
      for (final link in [
        'bsp://pisocamp',
        'bsp://pisocamp/',
        'https://www.bsp.gov.ph/pisocamp',
        'https://www.bsp.gov.ph/pisocamp/',
      ]) {
        final resolved = resolve(link);
        expect(resolved?.kind, PisoCampLinkKind.home, reason: link);
        expect(resolved?.route, AppRoutes.pisoCamp, reason: link);
      }
    });

    test('opens a currency list', () {
      expect(
        resolve('bsp://pisocamp/banknotes')?.route,
        AppRoutes.pisoCampBanknotes,
      );
      expect(resolve('bsp://pisocamp/coins')?.route, AppRoutes.pisoCampCoins);
      expect(
        resolve('https://www.bsp.gov.ph/pisocamp/coins')?.kind,
        PisoCampLinkKind.currencyList,
      );
    });

    test('opens one denomination', () {
      final resolved = resolve(
        'https://www.bsp.gov.ph/pisocamp/coins/catalog.ngc-coins.php-1',
      );

      expect(resolved?.kind, PisoCampLinkKind.denomination);
      expect(
        resolved?.route,
        '/pisocamp/currency/coins/catalog.ngc-coins.php-1',
      );
    });

    test('produces only routes this build already knows', () {
      // A deep link is an untrusted input from any app on the device, so it
      // may never be turned into an arbitrary location.
      for (final link in [
        'bsp://pisocamp',
        'bsp://pisocamp/coins',
        'bsp://pisocamp/banknotes/catalog.ngc-banknotes.php-20',
      ]) {
        final route = resolve(link)!.route;
        expect(route.startsWith('/pisocamp'), isTrue, reason: route);
        expect(route.contains('..'), isFalse, reason: route);
      }
    });
  });

  group('links this module refuses', () {
    const refused = <String>[
      // Another scheme entirely.
      'http://www.bsp.gov.ph/pisocamp/coins',
      'javascript:alert(1)',
      'file:///etc/passwd',
      // The right scheme, the wrong host.
      'bsp://elsewhere/coins',
      'https://evil.example/pisocamp/coins',
      // Credentials or a port smuggled into an otherwise valid link.
      'https://user:pass@www.bsp.gov.ph/pisocamp/coins',
      'https://www.bsp.gov.ph:8443/pisocamp/coins',
      // Inside the host but outside the module.
      'https://www.bsp.gov.ph/other/coins',
      'https://www.bsp.gov.ph/',
      // A kind that does not exist, and a malformed identifier.
      'bsp://pisocamp/notes/catalog.ngc-banknotes.php-20',
      'bsp://pisocamp/coins/UPPER',
      'bsp://pisocamp/coins/..%2Fprivate',
      'bsp://pisocamp/coins/catalog.ngc-coins.php-1/extra',
    ];

    for (final link in refused) {
      test('refuses $link', () => expect(resolve(link), isNull));
    }
  });

  group('handing out a link', () {
    test('shares the https form, which still works without the app', () {
      expect(
        pisoCampShareableLink(
          kind: 'coins',
          logicalId: 'catalog.ngc-coins.php-1',
        ),
        'https://www.bsp.gov.ph/pisocamp/coins/catalog.ngc-coins.php-1',
      );
    });

    test('round-trips through the resolver', () {
      final shared = pisoCampShareableLink(
        kind: 'banknotes',
        logicalId: 'catalog.ngc-banknotes.php-20',
      );

      expect(
        resolve(shared)?.route,
        AppRoutes.currencyDetail(
          kind: 'banknotes',
          logicalId: 'catalog.ngc-banknotes.php-20',
        ),
      );
    });

    test('refuses to build a link it would not accept back', () {
      expect(
        () => pisoCampShareableLink(kind: 'notes', logicalId: 'catalog.valid'),
        throwsArgumentError,
      );
      expect(
        () => pisoCampShareableLink(kind: 'coins', logicalId: '../private'),
        throwsArgumentError,
      );
    });

    test('names a store listing for a device without the app', () {
      expect(
        pisoCampStoreFallback(
          isIos: true,
        ).startsWith('https://apps.apple.com/'),
        isTrue,
      );
      expect(
        pisoCampStoreFallback(
          isIos: false,
        ).startsWith('https://play.google.com/store/apps/'),
        isTrue,
      );
    });
  });

  group('PisoCampLinkService', () {
    test('hands over only approved HTTPS BSP addresses', () async {
      final opened = <Uri>[];
      final service = PisoCampLinkService(
        launch: (url, {mode = LaunchMode.platformDefault}) async {
          opened.add(url);
          return true;
        },
      );

      final approved = Uri.parse('https://www.bsp.gov.ph/currency');
      expect((await service.open(approved)).opened, isTrue);
      expect(opened, [approved]);

      for (final url in [
        'http://www.bsp.gov.ph/currency',
        'https://evil.example/currency',
        'https://user:pass@www.bsp.gov.ph/currency',
        'https://www.bsp.gov.ph:8443/currency',
        'javascript:alert(1)',
      ]) {
        final outcome = await service.open(Uri.parse(url));
        expect(outcome.opened, isFalse, reason: url);
        expect(outcome.refusal, LinkRefusal.notApproved, reason: url);
      }
      expect(
        opened,
        hasLength(1),
        reason: 'nothing unapproved reached the platform',
      );
    });

    test(
      'reports a device with no handler instead of failing silently',
      () async {
        final service = PisoCampLinkService(
          launch: (url, {mode = LaunchMode.platformDefault}) async => false,
        );

        final outcome = await service.open(
          Uri.parse('https://www.bsp.gov.ph/currency'),
        );

        expect(outcome.opened, isFalse);
        expect(outcome.refusal, LinkRefusal.noHandler);
      },
    );

    test(
      'treats a platform failure as no handler rather than a crash',
      () async {
        final service = PisoCampLinkService(
          launch: (url, {mode = LaunchMode.platformDefault}) async =>
              throw StateError('no activity found'),
        );

        final outcome = await service.open(
          Uri.parse('https://www.bsp.gov.ph/currency'),
        );

        expect(outcome.refusal, LinkRefusal.noHandler);
      },
    );
  });
}
