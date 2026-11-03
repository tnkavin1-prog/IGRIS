#!/usr/bin/env node
/**
 * Production release builder.
 *
 *  1. runs the full production build (unless --no-build),
 *  2. validates that every file the manifest references actually exists,
 *  3. writes a deterministic, dependency-free ZIP with manifest.json at the root,
 *  4. emits a SHA-256 checksum next to the archive.
 *
 * The ZIP writer is intentionally small: Chrome only needs a valid archive, and
 * avoiding a native zip dependency keeps the release path auditable on Windows.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'release', 'chrome-extension');
const zipPath = join(root, 'release', 'Gemini-Browser-Live-Chrome.zip');
const checksumPath = join(root, 'release', 'SHA256SUMS.txt');
const skipBuild = process.argv.includes('--no-build');

/* ────────────────────────────── ZIP writer ─────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

// Fixed timestamp keeps the archive byte-for-byte reproducible.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 3;
const UTF8_FLAG = 0x0800;

function walk(directory, base = directory) {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(absolute, base));
    } else if (entry.isFile()) {
      out.push({ absolute, name: relative(base, absolute).split(sep).join('/') });
    }
  }
  return out;
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const data = readFileSync(file.absolute);
    const name = Buffer.from(file.name, 'utf8');
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

/* ─────────────────────────── validation ───────────────────────────────── */

const REQUIRED_FILES = [
  'manifest.json',
  'sidepanel.html',
  'background.js',
  'content-script.js',
  'audio/worklet-capture.js',
  'audio/worklet-playback.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function validate() {
  if (!existsSync(extensionDir)) {
    fail('release/chrome-extension is missing. Run: npm run build');
  }
  for (const file of REQUIRED_FILES) {
    const path = join(extensionDir, file);
    if (!existsSync(path) || statSync(path).size === 0) {
      fail(`Required build artifact is missing or empty: ${file}`);
    }
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf8'));
  } catch (error) {
    fail(`manifest.json is not valid JSON: ${error.message}`);
  }
  if (manifest.manifest_version !== 3) fail('manifest.json must be Manifest V3.');
  if (!manifest.key)
    fail('manifest.json must keep the stable "key" so the extension id does not change.');
  if (manifest.side_panel?.default_path !== 'sidepanel.html') {
    fail('manifest.json side_panel.default_path must point at sidepanel.html.');
  }
  if (manifest.background?.service_worker !== 'background.js') {
    fail('manifest.json background.service_worker must point at background.js.');
  }
  for (const [size, icon] of Object.entries(manifest.icons ?? {})) {
    if (!existsSync(join(extensionDir, icon)))
      fail(`manifest icon ${size} points at a missing file.`);
  }
  return manifest;
}

/* ─────────────────────────────── main ────────────────────────────────── */

function build() {
  console.log('\n▸ Running the production build');
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'build.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) fail('Production build failed; refusing to package stale artifacts.');
}

function main() {
  if (!skipBuild) build();

  const manifest = validate();
  const files = walk(extensionDir).sort((a, b) => a.name.localeCompare(b.name));
  if (files.length === 0) fail('No files found to package.');

  mkdirSync(dirname(zipPath), { recursive: true });
  const archive = createZip(files);
  writeFileSync(zipPath, archive);

  const digest = createHash('sha256').update(archive).digest('hex');
  writeFileSync(checksumPath, `${digest}  Gemini-Browser-Live-Chrome.zip\n`, 'utf8');

  const totalBytes = files.reduce((sum, file) => sum + statSync(file.absolute).size, 0);
  console.log('\n▸ Release package');
  console.log(`  extension   ${manifest.name} v${manifest.version}`);
  console.log(`  files       ${files.length}`);
  console.log(`  unpacked    ${(totalBytes / 1024).toFixed(1)} kB`);
  console.log(`  archive     ${(archive.length / 1024).toFixed(1)} kB`);
  console.log(`  zip         ${zipPath}`);
  console.log(`  sha256      ${digest}`);
  console.log(
    '\n  Install: chrome://extensions → Developer mode → Load unpacked → release/chrome-extension',
  );
  console.log('  Or distribute the zip; manifest.json is at the archive root.\n');
}

main();
