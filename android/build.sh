#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
: "${ANDROID_HOME:?Set ANDROID_HOME to your Android SDK}"
BT="$ANDROID_HOME/build-tools/35.0.0"
PLAT="$ANDROID_HOME/platforms/android-35/android.jar"
npm run build
mkdir -p android/.build/classes android/.build/dex
rm -rf android/assets/assets android/assets/ui android/assets/audio
cp -R dist/assets dist/ui dist/audio android/assets/
python3 - <<'PYBUILD'
from pathlib import Path
import re
s=Path('dist/index.html').read_text()
s=re.sub(r'    <link[^>]+(?:fonts.googleapis.com|fonts.gstatic.com)[^>]*>\n','',s)
s=s.replace('</head>','<link rel="stylesheet" href="/fonts.css"/>\n</head>')
Path('android/assets/index.html').write_text(s)
PYBUILD
javac -source 8 -target 8 -classpath "$PLAT" -d android/.build/classes android/src/com/exodus/ashfall/MainActivity.java
"$BT/d8" --lib "$PLAT" --min-api 26 --output android/.build/dex android/.build/classes/com/exodus/ashfall/*.class
"$BT/aapt" package -f -M android/AndroidManifest.xml -S android/res -A android/assets -I "$PLAT" -F android/.build/unsigned.apk
(cd android/.build/dex && zip -j -u ../unsigned.apk classes.dex)
"$BT/zipalign" -f 4 android/.build/unsigned.apk android/.build/ASHFALL_v1.9.12_unsigned.apk
printf '%s\n' 'Unsigned aligned APK: android/.build/ASHFALL_v1.9.12_unsigned.apk'
