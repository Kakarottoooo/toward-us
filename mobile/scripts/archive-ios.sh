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
# Several apps can use different Apple Distribution certificates with the same display name.
# Pin export to the identity embedded in both installed provisioning profiles.
python3 - "$destination/ExportOptions.plist" "$keychain" <<'PYTHON'
import hashlib, plistlib, re, subprocess, sys
from datetime import datetime
from pathlib import Path

options_path, keychain_path = sys.argv[1:]
options = plistlib.loads(Path(options_path).read_bytes())
available = subprocess.check_output(["security", "find-identity", "-v", "-p", "codesigning", keychain_path], text=True)
certificates = set(re.findall(r'([0-9A-F]{40}) "Apple Distribution:', available))
folders = [Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles",
           Path.home() / "Library/MobileDevice/Provisioning Profiles"]
profiles = []
for folder in folders:
    for item in folder.glob("*.mobileprovision"):
        raw = item.read_bytes()
        start, end = raw.find(b"<?xml"), raw.find(b"</plist>")
        if start < 0 or end < start:
            continue
        profile = plistlib.loads(raw[start:end + len(b"</plist>")])
        if profile["ExpirationDate"] > datetime.utcnow() and options["teamID"] in profile.get("TeamIdentifier", []):
            profiles.append(profile)
for bundle, name in options["provisioningProfiles"].items():
    candidates = [profile for profile in profiles if profile.get("Name") == name and
                  profile["Entitlements"].get("application-identifier") == options["teamID"] + "." + bundle]
    if not candidates:
        raise SystemExit("Missing current distribution profile for " + bundle)
    profile = max(candidates, key=lambda candidate: candidate["CreationDate"])
    options["provisioningProfiles"][bundle] = profile["UUID"]
    certificates &= {hashlib.sha1(der).hexdigest().upper() for der in profile["DeveloperCertificates"]}
if not certificates:
    raise SystemExit("No installed distribution identity matches both app and widget profiles.")
options["signingCertificate"] = sorted(certificates)[0]
Path(options_path).write_bytes(plistlib.dumps(options))
PYTHON
xcodebuild -exportArchive -archivePath "$destination/Pinky.xcarchive" \
  -exportPath "$destination/export" -exportOptionsPlist "$destination/ExportOptions.plist"
echo "Exported Pinky to $destination/export"
