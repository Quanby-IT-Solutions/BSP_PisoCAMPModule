import 'package:flutter/material.dart';

/// Whether this device is asking for less movement.
///
/// F6 gives the module one place to ask. Every animated surface reads the same
/// signal, so "reduced motion is honoured" is a property of the module rather
/// than a habit each screen has to remember — and a future signal (a setting of
/// our own, say) is added here instead of in every viewer.
///
/// Honouring it never means removing the feature: a face preset still lands,
/// a tilt effect still responds. Only the movement between states goes.
bool prefersReducedMotion(BuildContext context) {
  return MediaQuery.disableAnimationsOf(context);
}
