# The Alive Horde v1.5 - multitouch weapon switching, warning blinks, HUD resizing

Private source checkpoint based on owner commit ad7dc0f7b4e03807dc4ac5a7a8b8b7c381c19dc5.

## Run and edit

```sh
npm ci
npm run dev
npm run lint
node --import tsx --test src/game/*.test.ts
npm run build
```

## v1.5 changes

- Weapon switching (and every other HUD button) now fires on pointer-down, not click. Android Chrome only delivers click events for the first finger's tap, so item slots, the bag, eat/drink and the utility buttons were unresponsive to a second finger while walking or shooting. Reported from a real phone; fixed and verified with simulated two-finger touches.
- Item slots join the emergency cue system: a completely dry weapon (empty magazine and no reserve, or no molotovs left) turns red and blinks like the other emergency action buttons.
- Low health and low thirst now blink red: the health bar pulses at 30 HP or below, the thirst bar and its value pulse at 20 or below.
- Edit HUD can resize as well as move: in Edit HUD mode, dragging an outlined item moves it, dragging from an individual button's corner resizes just that button, and dragging from a group's corner resizes the whole group (0.6x-1.8x). Every button in the editable groups (item slots, bag, action rail, top buttons, eat/drink, fire buttons) can be sized on its own. Positions and sizes persist in the same saved layout, Reset restores defaults, and moves/resizes are clamped so a control can never leave the screen.

## v1.4 base

Autosave with Continue, game modes with Hardcore permadeath, first-run setup (name + look), Edit HUD drag positioning, The Alive Horde name and badge branding, separated bag chip left of the item slots, Reset/Audio removed from the gameplay HUD, safe normal respawn, FPS-only right-drag aim-and-fire, sprint breathing.

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

Package `com.exodus.ashfall`, versionCode 15, versionName 1.5.0, Android 8.0+, both landscape orientations. The separately supplied signed APK retains the original signing certificate.

Install Java and Android SDK API 35/build-tools 35.0.0. Set `ANDROID_HOME` and run `sh android/build.sh` after installing dependencies. This creates an unsigned APK; the original private signing key is required for in-place updates. Keys, passwords and account tokens are not included.

## Verification and limits

95 automated tests, TypeScript and production build passed. Browser checks on the production build: two-finger weapon switching while the move stick is held, while FIRE is held, and while FPS aim/fire is held with a drag (shotgun and pistol; exactly one activation per tap); dry-weapon red pulse states; low-health and low-thirst red blink states verified red through the whole pulse; individual button resize, group resize, move drag, viewport clamping and persistence in Edit HUD; HUD screenshots at 900x420 landscape, all visually inspected. Signed with the original certificate for in-place updates; saves preserved. Not installed or performance-tested on an Android phone.

Do not publish or redistribute assets under an assumed project-wide license. Individual bundled font/audio licenses and credits remain included. No new project-wide license is granted by this copy.
