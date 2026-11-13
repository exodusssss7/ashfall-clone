# ASHFALL v0.4

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
- Current signed landscape test APK in `builds/ASHFALL_v0.4_landscape.apk`.

v0.4 removes stamina, adds action animations, moves idle thumbsticks to the approved reference positions and places quick actions in a right-edge column. Floating touch control and inner aim-only / outer aim-and-attack behavior remain.

30 automated tests and browser checks passed. v0.3 was played on the user's phone; v0.4 still needs on-device testing. Android 8.0+; both landscape orientations. APK SHA256: `f84a66b9016dbc5663ab32736faab977f00178c036e26e03e682a1d21c29ce3d`.

## Android build

Install Java and Android SDK API35/build-tools35.0.0. Set `ANDROID_HOME` to the SDK directory. Run `sh android/build.sh` after `npm ci`. The script builds an unsigned APK. Sign it using your own securely stored key with Android `apksigner`; the same private signing key used for earlier versions is required for in-place updates. Signing keys, passwords and account tokens are deliberately excluded.

Do not publish the repository or redistribute assets under an assumed project-wide license. Individual bundled font/audio licenses and credits remain included. No new project-wide license is granted by this copy.
