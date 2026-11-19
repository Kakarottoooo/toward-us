#!/bin/bash
# Archive and export a local App Store Connect IPA. Upload is a separate, explicitly authorized step.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
team=693NJRHRV5
key_id=84D46DS7L4
issuer=ba362bc2-cfc7-4e4a-8dca-455f7bb5d9b1
signing="$HOME/.appstoreconnect/witnora-signing"
keychain="$HOME/Library/Keychains/witnora-signing.keychain-db"
key="$HOME/.appstoreconnect/private_keys/AuthKey_${key_id}.p8"
out="${1:?Supply an absolute output directory for the release artifacts}"
export_only=false
if [[ "$out" == --export ]]; then
  export_only=true
  out="${2:?Supply the directory containing the existing Pinky.xcarchive}"
fi
[[ "$out" = /* && -r "$key" && -r "$signing/kc-pass" && -f "$keychain" ]]
mkdir -p "$out"
security unlock-keychain -p "$(cat "$signing/kc-pass")" "$keychain"
if "$export_only"; then
  destination="$out"
  [[ -d "$destination/Pinky.xcarchive" ]]
else
number=$(python3 - "$signing/pinky-build-number" <<'PY'
from datetime import datetime, timezone
import fcntl, os, sys
# One release host reserves numbers shared by the app and extension, including concurrent archives and retries.
with open(sys.argv[1], "a+") as counter:
    fcntl.flock(counter, fcntl.LOCK_EX)
    counter.seek(0)
    previous = tuple(map(int, (counter.read().strip() or "0.0.0").split(".")))
    today = datetime.now(timezone.utc)
    prefix = (int(today.strftime("%y%m")), today.day)
    if prefix > previous[:2]:
        build = (*prefix, 1)
    else:
        major, minor, patch = previous
        if patch >= 99:
            raise SystemExit("Daily build-number range exhausted.")
        build = (major, minor, patch + 1)
    number = ".".join(map(str, build))
    counter.seek(0)
    counter.truncate()
    counter.write(number)
    counter.flush()
    os.fsync(counter.fileno())
    print(number)
PY
)
destination="$out/$number"
mkdir "$destination"
node scripts/config.mjs --release
./node_modules/.bin/cap sync ios
auth=(-authenticationKeyPath "$key" -authenticationKeyID "$key_id" -authenticationKeyIssuerID "$issuer")
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath "$out/DerivedData" \
  -archivePath "$destination/Pinky.xcarchive" -allowProvisioningUpdates "${auth[@]}" \
  DEVELOPMENT_TEAM="$team" CURRENT_PROJECT_VERSION="$number" archive
fi
cat > "$destination/ExportOptions.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>teamID</key><string>693NJRHRV5</string>
<key>destination</key><string>export</string>
<key>signingStyle</key><string>manual</string>
<key>signingCertificate</key><string>Apple Distribution</string>
<key>provisioningProfiles</key><dict>
<key>us.toward.app</key><string>Pinky App Store</string>
<key>us.toward.app.widget</key><string>Pinky Widget App Store</string>
</dict>
<key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$destination/Pinky.xcarchive" \
  -exportPath "$destination/export" -exportOptionsPlist "$destination/ExportOptions.plist"
echo "Exported Pinky to $destination/export"
