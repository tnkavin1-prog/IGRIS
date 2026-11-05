#!/usr/bin/env node
/**
 * Pre-flight validation for the GitHub Actions workflow.
 *
 * CI cannot run from this machine (no git remote, no Docker), but the failure
 * modes that make a first push go red are all static: a script name that does
 * not exist, a lockfile out of sync with package.json (`npm ci` hard-fails),
 * an artifact path that the release script never writes, or a Node version the
 * project does not support. This script checks those before you push.
 *
 * Run: npm run check:ci
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = join(root, '.github', 'workflows', 'ci.yml');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lockPath = join(root, 'package-lock.json');

const problems = [];
const notes = [];

if (!existsSync(workflowPath)) {
  console.error('✖ .github/workflows/ci.yml is missing');
  process.exit(1);
}

const workflow = readFileSync(workflowPath, 'utf8');

/* ------------------------------------------------------------------ steps */

// Every `npm run <name>` must resolve to a real script.
for (const match of workflow.matchAll(/npm run ([\w:-]+)/g)) {
  const name = match[1];
  if (!pkg.scripts?.[name])
    problems.push(`workflow calls "npm run ${name}" but package.json has no such script`);
}

// Every `npx <bin>` must be a declared dependency (or an official installer).
const NPX_ALLOWED = new Set(['playwright']);
for (const match of workflow.matchAll(/npx ([\w@/-]+)/g)) {
  const bin = match[1];
  if (bin.startsWith('playwright')) continue;
  if (NPX_ALLOWED.has(bin)) continue;
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!declared[bin]) notes.push(`workflow uses "npx ${bin}" which is not a declared dependency`);
}

/* ------------------------------------------------------------- node match */

const workflowNode = workflow.match(/node-version:\s*['"]?(\d+)/)?.[1];
const engineFloor = String(pkg.engines?.node ?? '').match(/(\d+)/)?.[1];
if (workflowNode && engineFloor) {
  if (Number(workflowNode) < Number(engineFloor)) {
    problems.push(`workflow uses Node ${workflowNode} but package.json requires >=${engineFloor}`);
  } else {
    notes.push(`Node ${workflowNode} satisfies engines.node (>=${engineFloor})`);
  }
} else if (!workflowNode) {
  problems.push('workflow has no actions/setup-node node-version');
}

/* ---------------------------------------------------------- lockfile sync */

// `npm ci` fails when the lockfile's root package does not match package.json.
// This is the single most common reason a first CI run goes red.
if (!existsSync(lockPath)) {
  problems.push('package-lock.json is missing; npm ci requires it');
} else {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const lockRoot = lock.packages?.[''] ?? {};
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const want = pkg[field] ?? {};
    const have = lockRoot[field] ?? {};
    const keys = new Set([...Object.keys(want), ...Object.keys(have)]);
    for (const key of keys) {
      if (want[key] === undefined) {
        problems.push(`lockfile has ${field}.${key} that package.json does not`);
      } else if (have[key] === undefined) {
        problems.push(
          `lockfile is missing ${field}.${key}; run npm install and commit the lockfile`,
        );
      } else if (want[key] !== have[key]) {
        problems.push(
          `lockfile ${field}.${key} is "${have[key]}" but package.json says "${want[key]}"; npm ci will fail`,
        );
      }
    }
  }
  if (lock.lockfileVersion !== 3) {
    notes.push(`lockfileVersion is ${lock.lockfileVersion} (expected 3 for npm 11)`);
  }
}

/* --------------------------------------------------------- artifact paths */

const artifactPaths = [...workflow.matchAll(/path:\s*\|\s*\n((?:\s{10,}.+\n)+)/g)].flatMap((m) =>
  m[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
);

const releaseScript = readFileSync(join(root, 'scripts', 'release.mjs'), 'utf8');
for (const path of artifactPaths) {
  const base = path.replace(/\/+$/, '');
  if (base.startsWith('release/')) {
    const fileName = base.split('/').pop();
    if (!releaseScript.includes(fileName)) {
      problems.push(
        `workflow uploads "${path}" but scripts/release.mjs never mentions "${fileName}"`,
      );
    }
  }
}

/* ------------------------------------------------------------- action pins */

for (const match of workflow.matchAll(/uses:\s*([\w-]+\/[\w-]+)@(\S+)/g)) {
  const [, action, ref] = match;
  if (/^[0-9a-f]{40}$/.test(ref)) continue; // commit SHA: ideal
  if (/^v\d+(\.\d+)*$/.test(ref)) {
    notes.push(`${action}@${ref} is a floating major tag (pin a SHA for supply-chain safety)`);
  } else {
    problems.push(`${action}@${ref} is not a version tag or commit SHA`);
  }
}

/* --------------------------------------------------------------- reporting */

for (const note of new Set(notes)) console.log(`  · ${note}`);

if (problems.length > 0) {
  console.error(`\n✖ ${problems.length} CI pre-flight problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  '\n✔ CI pre-flight clean: workflow commands, Node version, lockfile, and artifact paths all agree.',
);
