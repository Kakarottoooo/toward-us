import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { offlinePage, releaseProblem, shellFiles } from "../mobile/scripts/config.mjs";

// App Store readiness of the iPhone shell (mobile/): what goes to TestFlight must load a public production server, show a
// real page when that server can't be reached, and carry the privacy manifest, export answer and purpose strings.
const ios = (path) => readFileSync(new URL(`../mobile/ios/App/${path}`, import.meta.url), "utf8");

test("a release build refuses the dogfood, local and cleartext addresses and needs an explicit URL", () => {
  for (const url of ["https://node.tail3f720f.ts.net", "http://pinky.example.com", "https://localhost:5173", "https://127.0.0.1", "https://192.168.1.23:5173", "https://mac.local"]) {
    assert.notEqual(releaseProblem(new URL(url)), "", url);
    assert.throws(() => shellFiles(url, { release: true }), undefined, url);
  }
  assert.throws(() => shellFiles("", { release: true }), /production https:\/\/ URL/);
  assert.equal(releaseProblem(new URL("https://pinky.example.com")), "");
  assert.equal(shellFiles("https://pinky.example.com/path", { release: true }).config.server.url, "https://pinky.example.com");
  // Dogfood builds keep working as before, the Tailscale address included.
  assert.equal(shellFiles("https://node.tail3f720f.ts.net").config.server.url, "https://node.tail3f720f.ts.net");
  assert.equal(shellFiles("http://localhost:5173").config.server.cleartext, true);
  assert.equal(shellFiles("https://pinky.example.com").config.server.cleartext, undefined);
});

test("when the server can't be reached the shell shows a bundled offline page that retries and returns by itself", () => {
  const { config, offline } = shellFiles("https://pinky.example.com", { release: true });
  assert.equal(config.server.errorPath, "offline.html");
  assert.equal(offline, offlinePage("https://pinky.example.com"));
  assert.match(offline, /var SERVER = "https:\/\/pinky\.example\.com";/);
  for (const words of ["暂时连不上 Pinky", "Can't reach Pinky right now", "No podemos conectar con Pinky", "重试", "Try again", "Reintentar"]) assert.ok(offline.includes(words), words);
  assert.match(offline, /addEventListener\("online"/);
  assert.match(offline, /location\.replace\(SERVER \+ "\/"\)/);
  assert.doesNotMatch(offline, /<script[^>]+src=|<link[^>]+href=/, "the page must draw with no network");
});

test("the iPhone app declares no non-exempt encryption, arm64, portrait iPhone only", () => {
  const plist = ios("App/Info.plist");
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  assert.match(plist, /<key>UIRequiredDeviceCapabilities<\/key>\s*<array>\s*<string>arm64<\/string>\s*<\/array>/);
  assert.match(plist, /<key>UISupportedInterfaceOrientations<\/key>\s*<array>\s*<string>UIInterfaceOrientationPortrait<\/string>\s*<\/array>/);
  const project = ios("App.xcodeproj/project.pbxproj");
  assert.equal((project.match(/TARGETED_DEVICE_FAMILY = 1;/g) || []).length, 2);
  assert.doesNotMatch(project, /TARGETED_DEVICE_FAMILY = "1,2"/);
});

test("the privacy manifest ships in the app bundle and lists what Pinky collects, with no tracking", () => {
  const project = ios("App.xcodeproj/project.pbxproj");
  const resources = project.slice(project.indexOf("/* Begin PBXResourcesBuildPhase section */"), project.indexOf("/* End PBXResourcesBuildPhase section */"));
  assert.match(resources, /PrivacyInfo\.xcprivacy in Resources/);
  const manifest = ios("App/PrivacyInfo.xcprivacy");
  assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(manifest, /<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
  for (const type of ["EmailAddress", "Name", "UserID", "Health", "PreciseLocation", "PhotosorVideos", "AudioData", "EmailsOrTextMessages", "OtherUserContent", "PurchaseHistory", "ProductInteraction", "CustomerSupport", "PhoneNumber"]) {
    assert.match(manifest, new RegExp(`<string>NSPrivacyCollectedDataType${type}</string>`), type);
  }
  assert.doesNotMatch(manifest, /NSPrivacyCollectedDataTypeTracking<\/key>\s*<true\/>/);
  assert.doesNotMatch(manifest, /PurposeThirdPartyAdvertising|PurposeDeveloperAdvertising/);
});

test("every permission prompt is explained in all three interface languages", () => {
  const keys = [...ios("App/Info.plist").matchAll(/<key>(NS\w+UsageDescription)<\/key>/g)].map((match) => match[1]);
  assert.deepEqual(keys.sort(), ["NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSPhotoLibraryUsageDescription", "NSSpeechRecognitionUsageDescription"]);
  for (const language of ["en", "zh-Hans", "es"]) {
    const strings = ios(`App/${language}.lproj/InfoPlist.strings`);
    for (const key of keys) assert.match(strings, new RegExp(`"${key}" = "[^"]{20,}";`), `${language} ${key}`);
  }
  assert.match(ios("App/zh-Hans.lproj/InfoPlist.strings"), /人脸只在手机上比对/);
});
