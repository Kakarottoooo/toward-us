import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2];
const output = join(root, 'native-check');
mkdirSync(output, { recursive: true });
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) { console.error(result.error.message); process.exit(2); }
  if (result.status !== 0) process.exit(result.status || 2);
}

if (target === 'ios') {
  if (process.platform !== 'darwin') {
    console.error('iOS compilation requires macOS and Xcode 26+. Windows cannot run Apple Simulator. Copy this project to your Mac, then run npm run check:ios.');
    process.exit(2);
  }
  run('xcodebuild', ['-version']);
  run('xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug',
    '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', join(output, 'ios'),
    // These Swift packages are public; avoid prompting for unrelated GitHub Keychain credentials.
    '-packageAuthorizationProvider', 'netrc',
    'CODE_SIGNING_ALLOWED=NO', 'build']);
} else if (target === 'android') {
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
  const version = spawnSync(java, ['-version'], { encoding: 'utf8' });
  if (version.error || version.status !== 0 || !/version "(?:2[1-9]|[3-9]\d)[.\"]/m.test(version.stderr || version.stdout || '')) {
    console.error('Android build requires JDK 21+ (Android Studio includes one). Set JAVA_HOME to that JDK. No SDK license is accepted by this script.');
    process.exit(2);
  }
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if ((!sdk || !existsSync(sdk)) && !existsSync(join(root, 'android/local.properties'))) {
    console.error('Install Android SDK 36 using Android Studio, review its license yourself, then set ANDROID_HOME.');
    process.exit(2);
  }
  const env = { ...process.env, GRADLE_USER_HOME: join(output, 'gradle') };
  const cwd = join(root, 'android');
  // Explicit .\ path: cmd.exe skips the current directory when NoDefaultCurrentDirectoryInExePath is set.
  if (process.platform === 'win32') run('cmd.exe', ['/d', '/c', '.\\gradlew.bat', 'assembleDebug', '--no-daemon'], { cwd, env });
  else run('sh', ['gradlew', 'assembleDebug', '--no-daemon'], { cwd, env });
  console.log('Debug APK: ' + join(cwd, 'app/build/outputs/apk/debug/app-debug.apk'));
} else {
  console.error('Usage: node scripts/check-native.mjs ios|android');
  process.exit(2);
}
