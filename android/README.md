# Maya Android access

## Current delivery: installable PWA

Maya is currently a responsive web application with an installable Progressive Web App shell. It is not a native Android APK and this directory does not yet contain a Gradle project.

To install on an Android phone or tablet:

1. Deploy Maya behind HTTPS using the production deployment guide.
2. Open the Maya HTTPS URL in Chrome on Android.
3. Sign in, open Chrome's menu, and select Install app or Add to Home screen (the label depends on Chrome version).
4. Launch Maya from the home screen.

The service worker caches only the public app shell and static assets. It deliberately does not cache /api/*, conversations, credentials, device tokens, files, or command results. Offline mode can show the application shell but cannot perform authenticated agent work.

## Native Android application: future module

A native Kotlin/Jetpack Compose app remains planned. It will need:

- Secure sign-in and Android Keystore-backed device credential storage.
- Push notifications for task, approval and agent status events.
- WorkManager for permitted persistent background sync.
- Explicit runtime permission prompts for microphone, camera, notifications and local network use.
- A visible recovery/exit path and accessibility checks.
- Signed release builds, Play signing configuration and end-to-end testing on physical Android devices.

## Device profiles and constraints

1. Personal profile: normal app on the Founder's everyday phone. Do not provision it as device owner or kiosk.
2. Dedicated profile: separate spare Android device, enrolled as fully managed/dedicated before Lock Task Mode is enabled.
3. Android permissions remain mandatory. Kiosk mode does not grant unrestricted access to other apps, private data, microphone, camera or OS internals.

No APK is produced by the current PWA module.