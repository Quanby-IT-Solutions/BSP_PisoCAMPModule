package com.quanbyit.turbotemplate

import com.google.ar.core.ArCoreApk
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Answers AR-001's capability question.
 *
 * The renderer plugin does not expose one, and the module needs the three
 * outcomes kept apart: a phone that cannot run ARCore, a phone that could once
 * its services are installed or updated, and a build with no runtime at all.
 * Each is a different sentence on the fallback screen, so merging them would
 * cost the person the one piece of information they can act on.
 *
 * `checkAvailability` may answer "checking, ask again" while it queries the
 * Play Store. That is resolved here rather than in Dart, so the Dart side sees
 * a settled answer or nothing.
 */
class MainActivity : FlutterActivity() {
    private companion object {
        const val CHANNEL = "pisocamp/ar_availability"

        /** How long to wait for a transient result to settle before giving up. */
        const val SETTLE_ATTEMPTS = 10
        const val SETTLE_DELAY_MS = 200L
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "checkAvailability" -> resolveAvailability(result, SETTLE_ATTEMPTS)
                    else -> result.notImplemented()
                }
            }
    }

    private fun resolveAvailability(result: MethodChannel.Result, attemptsLeft: Int) {
        val availability = try {
            ArCoreApk.getInstance().checkAvailability(this)
        } catch (error: Exception) {
            // The ARCore classes are present but the query failed — treat it as
            // a device that cannot run it rather than crashing a screen the
            // person opened to look at a coin.
            result.success("unsupported")
            return
        }

        if (availability.isTransient && attemptsLeft > 0) {
            // Still asking the Play Store. Re-post rather than block: this runs
            // on the main thread and the answer arrives on it too.
            window.decorView.postDelayed(
                { resolveAvailability(result, attemptsLeft - 1) },
                SETTLE_DELAY_MS,
            )
            return
        }

        result.success(
            when (availability) {
                ArCoreApk.Availability.SUPPORTED_INSTALLED -> "supported"
                ArCoreApk.Availability.SUPPORTED_APK_TOO_OLD,
                ArCoreApk.Availability.SUPPORTED_NOT_INSTALLED,
                -> "needsUpdate"
                else -> "unsupported"
            }
        )
    }
}
