# ASHFALL v1.3 - Night lighting, action cues, multi-touch safety

Private source checkpoint based on owner commit ad7dc0f7b4e03807dc4ac5a7a8b8b7c381c19dc5. No repository push was made.

## Run and edit

```sh
npm ci
npm run dev
npm run lint
node --import tsx --test src/game/*.test.ts
npm run build
```

## v1.3 changes

- Night now darkens the terrain: the constant studio reflection light and hemisphere fill fade with night (sky unchanged). The flashlight, campfires and street lamps now matter.
- Action-state colours and the emergency pulse work again in the paper skin (ready green, urgent red pulse, timed amber pulse, active teal). A specificity clash had hidden them.
- COOK buttons show only near heat with ingredients for at least one recipe; unavailable Cook buttons in the menu look disabled.
- Multi-touch: held buttons track each finger, and every stick or held button releases on cancel, lost capture or when the last finger lifts.

## v1.2 base

## This version

Preserves v1.1's cream paper/book-page menus, raised cut-corner buttons, transparent day/kills and equipment-label bars, boxed facing inventory pages, and bidirectional touch/mouse drag or tap transfers. Containers and trunks retain items for the current run. No new inventory capacity rule or save/resume system.

Recorded after-sprint breathing: Joseph Sardin, CC0, approved quieter recording with the additional requested attenuation. Recovery starts after sustained sprinting ends and stops on another sprint, pause, modal, mute, background, death or driving.

The separately supplied signed v1.2 APK includes the approved Mixkit "Human single heart beat" recording (item 490). It replaces the generated heartbeat. Plays only at HP 1-30, at 1.15-second game-time cadence or 0.85 seconds at HP 1-20. Stops when healed above 30, dead, paused, in a modal, muted or backgrounded. Each sample finishes before the next beat. Trailing silence was trimmed and a tail fade applied.

## Important: heartbeat audio excluded from source

The user approved including this recording in the finished APK, but excluding it from shared source. Mixkit permits video-game end products but prohibits redistribution with source files. Therefore `public/audio/heartbeat.mp3` and `android/assets/audio/heartbeat.mp3` are deliberately absent here and ignored by git. Build output, APKs, signing material and dependency directories are also excluded.

A build from this source checkpoint will be silent at the heartbeat trigger unless an appropriately licensed heartbeat file is supplied at `public/audio/heartbeat.mp3`. The missing file is safely skipped; no generated fallback or overlapping beat is used. Do not add the Mixkit file to this shared source checkpoint or a repository.

Heartbeat source: https://mixkit.co/free-sound-effects/heartbeat/
License: https://mixkit.co/license/modal/sfxFree/
All other audio credits remain in `public/audio/CREDITS.txt`.

## Android

Package `com.exodus.ashfall`, versionCode 13, versionName 1.3.0, Android 8.0+, both landscape orientations. The separately supplied signed APK retains the original signing certificate.

Install Java and Android SDK API 35/build-tools 35.0.0. Set `ANDROID_HOME` and run `sh android/build.sh` after installing dependencies. This creates an unsigned APK; the original private signing key is required for in-place updates. Keys, passwords and account tokens are not included.

## Verification and limits

88 automated tests, TypeScript and production build passed. Browser checks used assets extracted from the signed v1.2 APK: heartbeat trigger, active stop cases, after-sprint breathing and bidirectional inventory interaction. Gameplay and book-page inventory screenshots were visually inspected. Not installed or performance-tested on an Android phone.

Do not publish or redistribute assets under an assumed project-wide license. Individual bundled font/audio licenses and credits remain included. No new project-wide license is granted by this copy.
