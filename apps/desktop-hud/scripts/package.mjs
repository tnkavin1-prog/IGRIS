import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, Platform, Arch } from 'electron-builder';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(desktop, '../..');
if (process.platform !== 'win32')
  throw new Error('The NSIS packaging script requires Windows and .NET Framework.');
const framework = join(
  process.env.SystemRoot || 'C:/Windows',
  'Microsoft.NET/Framework64/v4.0.30319',
);
const csc = join(framework, 'csc.exe');
if (!existsSync(csc)) throw new Error('Install .NET Framework 4.x to compile the native helpers.');
const native = join(root, 'temp', 'package-native');
mkdirSync(native, { recursive: true });
const references = [
  'System.Runtime.Serialization.dll',
  'WPF/UIAutomationClient.dll',
  'WPF/UIAutomationTypes.dll',
  'WPF/WindowsBase.dll',
].map((file) => `/reference:${join(framework, file)}`);
for (const [source, target, output] of [
  ['Win32Input.cs', 'exe', 'Win32Input.exe'],
  ['Win32Input.cs', 'library', 'Win32Input.dll'],
  ['Win32Pin.cs', 'library', 'Win32Pin.dll'],
]) {
  const result = spawnSync(
    csc,
    [
      '/nologo',
      `/target:${target}`,
      '/platform:x64',
      `/out:${join(native, output)}`,
      ...references,
      join(root, 'scripts', source),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  if (result.status !== 0) throw new Error(`Native helper compilation failed: ${source}`);
}
const bundle = spawnSync(process.execPath, [join(desktop, 'scripts/build.mjs')], {
  stdio: 'inherit',
  cwd: root,
});
if (bundle.status !== 0) throw new Error('Desktop bundle failed.');
if (!process.env.CSC_LINK) process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
// Stage inside the repository instead of the system temp directory: the
// staging folder holds a full unpacked Electron build (~370 MB), and leaving
// those behind in %TEMP% filled the system drive.
const stagingRoot = join(root, 'temp', 'package-staging');
rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });
const staging = join(stagingRoot, 'stage');
await build({
  projectDir: desktop,
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  config: {
    extends: join(desktop, 'electron-builder.config.cjs'),
    directories: { output: staging },
  },
  publish: 'never',
});
const release = join(root, 'release', 'desktop');
mkdirSync(release, { recursive: true });
for (const file of readdirSync(staging)) {
  if (/\.(exe|blockmap|yml)$/.test(file)) copyFileSync(join(staging, file), join(release, file));
}

// Keep a stable, current copy of the unpacked application: the staging
// directory is a temporary folder, and a stale win-unpacked from an older
// build is worse than none at all when the executable is launched for
// verification.
const unpackedSource = join(staging, 'win-unpacked');
const unpackedTarget = join(release, 'win-unpacked');
if (existsSync(unpackedSource)) {
  rmSync(unpackedTarget, { recursive: true, force: true });
  cpSync(unpackedSource, unpackedTarget, { recursive: true });
}
console.log(`Installer output: ${release}`);
console.log(`Unpacked application for verification: ${unpackedTarget}`);

// The staging build has served its purpose once the artifacts are copied.
rmSync(stagingRoot, { recursive: true, force: true });
