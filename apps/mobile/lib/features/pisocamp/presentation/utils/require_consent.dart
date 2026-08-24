import 'package:flutter/material.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_repository.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/presentation/screens/privacy_notice_screen.dart';

typedef CheckConsent =
    Future<ConsentRequirement> Function(
      ConsentPurpose purpose, {
      required bool online,
    });

typedef RecordConsentDecision =
    Future<ConsentGateResult> Function({
      required ConsentPurpose purpose,
      required PrivacyNotice notice,
      required ConsentDecision decision,
      required bool online,
    });

typedef RequireConsent =
    Future<ConsentGateResult> Function(
      BuildContext context,
      ConsentPurpose purpose, {
      required bool online,
    });

/// Reusable presentation guard for every consent-dependent action.
Future<ConsentGateResult> requireConsent(
  BuildContext context,
  ConsentPurpose purpose, {
  required bool online,
  required CheckConsent check,
  required RecordConsentDecision recordDecision,
}) async {
  final requirement = await check(purpose, online: online);
  if (!context.mounted) return ConsentGateResult.cancelled;
  switch (requirement.state) {
    case ConsentRequirementState.grantedSynced:
      return ConsentGateResult.grantedSynced;
    case ConsentRequirementState.grantedQueued:
      return ConsentGateResult.grantedQueued;
    case ConsentRequirementState.unavailable:
      return ConsentGateResult.unavailable;
    case ConsentRequirementState.needsDecision:
      final notice = requirement.notice;
      if (notice == null) return ConsentGateResult.unavailable;
      final result = await Navigator.of(context).push<ConsentGateResult>(
        MaterialPageRoute<ConsentGateResult>(
          settings: RouteSettings(
            name: '/pisocamp/privacy-notice/${purpose.wireValue}',
          ),
          builder: (_) => PrivacyNoticeScreen(
            notice: notice,
            online: online,
            requiresReconsent: requirement.requiresReconsent,
            onDecision: (decision) => recordDecision(
              purpose: purpose,
              notice: notice,
              decision: decision,
              online: online,
            ),
          ),
        ),
      );
      return result ?? ConsentGateResult.cancelled;
  }
}
