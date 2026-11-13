# ASHFALL v0.7

Private temporary working copy of the full current game. The original repository is unchanged. No automatic deletion date has been set.

## Run and edit

```sh
npm ci
npm run dev
```

```sh
npm run lint
node --import tsx --test src/game/*.test.ts
npm run build
```

## Included

- React/TypeScript game source, pixel-art generators and UI assets.
- Licensed audio and credits in `public/audio/CREDITS.txt`.
- Android WebView wrapper, manifest, icon, local fonts and packaging script.
- Current signed landscape test APK in `builds/ASHFALL_v0.7_landscape.apk`. Earlier APKs are retained.

v0.7 adds action-button cues (steady readiness/active states, slow urgent and timed pulses, missing-supply warnings, reduced-motion support), a one-minute awake-play rest cooldown with countdown, approved recorded swing/hurt/drink/repair/refuel/fishing sounds, and six material-specific footstep banks. Tile footsteps use the selected soft-soled option B. Footsteps follow actual movement and stop when blocked. All audio sources and edits are credited in `public/audio/CREDITS.txt`. The previously approved day/night ambience is unchanged.

v0.6 adds vehicle-relative touch driving: stick up/down controls forward/reverse along the car's heading, and left/right steers its wheels. Diagonals combine both axes. Analog deadzones prevent tiny finger drift, and reverse uses normal wheel-steering behavior. Keyboard driving and walking are unchanged.

v0.5 builds on the user's cooking QTE, expanded rooms, furniture and animation work. It fixes the active cooking layout on short landscape screens, prevents repeated taps stacking bed rests, labels bed actions REST, moves the southeast checkpoint exterior door one tile west so its west room is accessible, and lights the loot button only when the current interaction can loot an unopened object.

54 automated tests, TypeScript checks, production build and browser interaction/layout checks passed. This revision still needs on-device testing. Android 8.0+; both landscape orientations. The package and signing certificate are unchanged for in-place updates; versionCode is 7. APK SHA256: `9ba64c98d4f6c05b4ace542f447476960af1e66d755f1f3e652549dfb2cedeaa`.

## Android build

Install Java and Android SDK API35/build-tools35.0.0. Set `ANDROID_HOME` to the SDK directory. Run `sh android/build.sh` after `npm ci`. The script builds an unsigned APK. Sign it using your own securely stored key with Android `apksigner`; the same private signing key used for earlier versions is required for in-place updates. Signing keys, passwords and account tokens are deliberately excluded.

Do not publish the repository or redistribute assets under an assumed project-wide license. Individual bundled font/audio licenses and credits remain included. No new project-wide license is granted by this copy.
