# Maya Android Runtime

This directory is reserved for the native Android application and dedicated-device profile. The current repository is a web/Node.js project; it does not yet contain a Gradle Android application or an installable APK.

## Planned modules
- app/: Kotlin + Jetpack Compose application.
- device-policy/: Device Policy Controller and dedicated-device provisioning, if implemented separately.
- docs/: enrollment, permissions, signing, kiosk recovery, and release instructions.

## Device profiles
1. Personal profile: normal Android app on the Founder's everyday phone. Do not provision it as device owner or kiosk.
2. Dedicated profile: separate spare Android device, enrolled as fully managed/dedicated before Lock Task Mode is enabled.

## Platform constraints
- Wi-Fi is sufficient for cloud connectivity; a SIM is not required.
- Android permissions remain mandatory. Kiosk mode does not grant unrestricted access to other apps, private data, microphone, camera, or OS internals.
- Use WorkManager for persistent deferrable work, push notifications for server events, and foreground services only for permitted user-visible work.
- Keep a visible recovery/exit path and test provisioning on spare hardware.

No APK is produced by this documentation-only scaffold.
