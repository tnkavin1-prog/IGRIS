/**
 * Unit Test Suite for Context Packer Engine
 * E:\Gematron\tests\unit\context-packer.test.mjs
 *
 * Can be executed via:
 *   node tests/unit/context-packer.test.mjs
 *   node --test tests/unit/context-packer.test.mjs
 *   npx vitest run tests/unit/context-packer.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Import the Context Packer module
import {
  packContext,
  generateDirectoryTree,
  scanWorkspace,
  assemblePrompt,
  isBinaryFile,
  parseGitignore,
  createGitignoreFilter,
  shouldExcludeDir,
  shouldExcludePath,
  getLanguageForFile,
  DEFAULT_EXCLUDED_DIRS,
  BINARY_EXTENSIONS,
  DEFAULT_EXCLUDED_FILES,
  MAX_FILE_SIZE_BYTES,
  DEFAULT_MAX_CHARS,
} from '../../scripts/lib/context-packer.mjs';

// Setup environment agnostic describe/it
let describeFn, itFn, beforeFn, afterFn;

if (typeof globalThis.describe === 'function' && typeof globalThis.it === 'function') {
  describeFn = globalThis.describe;
  itFn = globalThis.it;
  beforeFn = globalThis.beforeAll || globalThis.before;
  afterFn = globalThis.afterAll || globalThis.after;
} else {
  const nodeTest = await import('node:test');
  describeFn = nodeTest.describe;
  itFn = nodeTest.it;
  beforeFn = nodeTest.before;
  afterFn = nodeTest.after;
}

describeFn('Context Packer Engine (Milestone 1)', () => {
  let tempRoot;

  beforeFn(() => {
    // Create temporary workspace fixture directory
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gematron-test-packer-'));

    // Construct mock directory structure
    // ├── apps
    // │   └── hud
    // │       └── src
    // │           └── index.ts
    // ├── packages
    // │   └── shared
    // │       └── utils.js
    // ├── docs
    // │   └── evidence
    // │       └── run.log
    // ├── node_modules (should be excluded)
    // │   └── dep
    // │       └── index.js
    // ├── .git (should be excluded)
    // │   └── config
    // ├── .chrome-debug-profile (should be excluded)
    // │   └── Cookies
    // ├── temp (should be excluded)
    // │   └── scratch.txt
    // ├── large-file.txt (exceeds 150 KB, should be skipped in scan)
    // ├── binary-file.exe (should be excluded)
    // ├── nullbyte.dat (null-byte sniffing, should be excluded)
    // ├── .env (secret, should be excluded)
    // ├── .env.example (allowed)
    // └── README.md (normal text)

    fs.mkdirSync(path.join(tempRoot, 'apps', 'hud', 'src'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'packages', 'shared'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'docs', 'evidence'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'node_modules', 'dep'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, '.git'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, '.chrome-debug-profile'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'temp'), { recursive: true });

    // Standard valid source files
    fs.writeFileSync(
      path.join(tempRoot, 'apps', 'hud', 'src', 'index.ts'),
      'export const hudVersion = "1.0.0";\nconsole.log("HUD Loaded");\n',
    );
    fs.writeFileSync(
      path.join(tempRoot, 'packages', 'shared', 'utils.js'),
      'export function add(a, b) { return a + b; }\n',
    );
    fs.writeFileSync(
      path.join(tempRoot, 'README.md'),
      '# Test Project\nThis is a mock repository for testing context packing.\n',
    );

    // .env and .env.example
    fs.writeFileSync(path.join(tempRoot, '.env'), 'SECRET_KEY=123456\n');
    fs.writeFileSync(path.join(tempRoot, '.env.example'), 'SECRET_KEY=your_key_here\n');

    // docs/evidence/run.log (evidence log permitted by .gitignore)
    fs.writeFileSync(path.join(tempRoot, 'docs', 'evidence', 'run.log'), 'Evidence log output.\n');

    // Files in excluded directories
    fs.writeFileSync(
      path.join(tempRoot, 'node_modules', 'dep', 'index.js'),
      'module.exports = {};',
    );
    fs.writeFileSync(path.join(tempRoot, '.git', 'config'), '[core]\nrepositoryformatversion = 0');
    fs.writeFileSync(path.join(tempRoot, '.chrome-debug-profile', 'Cookies'), 'dummy cookie data');
    fs.writeFileSync(path.join(tempRoot, 'temp', 'scratch.txt'), 'scratch content');

    // Large file exceeding 150 KB (160 KB)
    const largeBuffer = Buffer.alloc(160 * 1024, 'A');
    fs.writeFileSync(path.join(tempRoot, 'large-file.txt'), largeBuffer);

    // Binary file via extension
    fs.writeFileSync(path.join(tempRoot, 'binary-file.exe'), Buffer.from([0x4d, 0x5a, 0x90, 0x00]));

    // Binary file via null byte sniffing (non-binary extension, but contains 0x00)
    const nullByteBuf = Buffer.alloc(256, 0x41);
    nullByteBuf[10] = 0x00; // Inject null byte
    fs.writeFileSync(path.join(tempRoot, 'nullbyte.dat'), nullByteBuf);

    // .gitignore file
    const gitignoreContent = [
      '# Gitignore',
      '.env',
      'node_modules/',
      '.chrome-debug-*/',
      'temp/',
      '*.log',
      '!docs/evidence/*.log',
    ].join('\n');
    fs.writeFileSync(path.join(tempRoot, '.gitignore'), gitignoreContent);
  });

  afterFn(() => {
    // Cleanup temporary workspace
    if (tempRoot && fs.existsSync(tempRoot)) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failure on Windows locks
      }
    }
  });

  describeFn('Constants & Module Exports', () => {
    itFn('exports required API functions and constants', () => {
      assert.strictEqual(typeof packContext, 'function');
      assert.strictEqual(typeof generateDirectoryTree, 'function');
      assert.strictEqual(typeof scanWorkspace, 'function');
      assert.strictEqual(typeof assemblePrompt, 'function');
      assert.strictEqual(typeof isBinaryFile, 'function');
      assert.strictEqual(typeof parseGitignore, 'function');
      assert.strictEqual(typeof getLanguageForFile, 'function');

      assert.ok(DEFAULT_EXCLUDED_DIRS.has('node_modules'));
      assert.ok(DEFAULT_EXCLUDED_DIRS.has('.git'));
      assert.ok(DEFAULT_EXCLUDED_DIRS.has('.agents'));
      assert.ok(DEFAULT_EXCLUDED_DIRS.has('dist'));
      assert.ok(DEFAULT_EXCLUDED_DIRS.has('build'));
      assert.ok(DEFAULT_EXCLUDED_DIRS.has('release'));
      assert.ok(DEFAULT_EXCLUDED_DIRS.has('test-results'));
      assert.ok(DEFAULT_EXCLUDED_DIRS.has('playwright-report'));
      assert.ok(DEFAULT_EXCLUDED_DIRS.has('coverage'));
      assert.ok(DEFAULT_EXCLUDED_DIRS.has('logs'));
      assert.ok(DEFAULT_EXCLUDED_DIRS.has('backups'));
      assert.ok(DEFAULT_EXCLUDED_DIRS.has('temp'));

      assert.ok(DEFAULT_EXCLUDED_FILES.has('.DS_Store'));
      assert.ok(DEFAULT_EXCLUDED_FILES.has('Thumbs.db'));
      assert.ok(DEFAULT_EXCLUDED_FILES.has('desktop.ini'));

      assert.strictEqual(MAX_FILE_SIZE_BYTES, 150 * 1024);
      assert.strictEqual(DEFAULT_MAX_CHARS, 100_000);
    });
  });

  describeFn('Binary File Detection (Feature 2)', () => {
    itFn('detects binary extensions listed in specification', () => {
      const exts = [
        '.exe',
        '.dll',
        '.zip',
        '.tar',
        '.gz',
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.ico',
        '.webp',
        '.mp3',
        '.wav',
        '.mp4',
        '.mov',
        '.pdf',
        '.lnk',
        '.bin',
        '.woff',
        '.woff2',
        '.ttf',
        '.eot',
      ];
      for (const ext of exts) {
        assert.ok(BINARY_EXTENSIONS.has(ext), `Extension ${ext} must be in BINARY_EXTENSIONS`);
        assert.strictEqual(
          isBinaryFile(`file${ext}`),
          true,
          `file${ext} must be classified as binary`,
        );
        assert.strictEqual(
          isBinaryFile(`file${ext.toUpperCase()}`),
          true,
          `Uppercase ${ext} must be classified as binary`,
        );
      }
    });

    itFn('detects binary files via null-byte sniffing (first 512 bytes)', () => {
      // Buffer containing 0x00
      const bufWithNull = Buffer.from('hello\x00world');
      assert.strictEqual(isBinaryFile('sample.txt', bufWithNull), true);

      // Buffer without 0x00
      const bufText = Buffer.from('console.log("clean utf-8 source code");');
      assert.strictEqual(isBinaryFile('sample.txt', bufText), false);

      // Empty buffer
      assert.strictEqual(isBinaryFile('sample.txt', Buffer.alloc(0)), false);

      // Null byte file on disk
      const nullBytePath = path.join(tempRoot, 'nullbyte.dat');
      assert.strictEqual(isBinaryFile(nullBytePath), true);

      // Clean file on disk
      const textPath = path.join(tempRoot, 'README.md');
      assert.strictEqual(isBinaryFile(textPath), false);
    });

    itFn('gracefully returns false for non-existent files without throwing', () => {
      assert.strictEqual(isBinaryFile(path.join(tempRoot, 'non-existent-xyz.txt')), false);
    });
  });

  describeFn('File & Directory Filtering (Feature 1)', () => {
    itFn('shouldExcludeDir recognizes default excluded directories and wildcards', () => {
      assert.strictEqual(shouldExcludeDir('node_modules'), true);
      assert.strictEqual(shouldExcludeDir('.git'), true);
      assert.strictEqual(shouldExcludeDir('.agents'), true);
      assert.strictEqual(shouldExcludeDir('dist'), true);
      assert.strictEqual(shouldExcludeDir('.chrome-debug-profile'), true);
      assert.strictEqual(shouldExcludeDir('.chrome-debug-data'), true);
      assert.strictEqual(shouldExcludeDir('src'), false);
      assert.strictEqual(shouldExcludeDir('apps'), false);
    });

    itFn('shouldExcludePath blocks excluded dirs, secret files, and respects gitignore', () => {
      const gitignoreFilter = createGitignoreFilter(tempRoot);

      // node_modules
      assert.strictEqual(
        shouldExcludePath('node_modules/dep/index.js', false, gitignoreFilter),
        true,
      );
      assert.strictEqual(shouldExcludePath('node_modules', true, gitignoreFilter), true);

      // .chrome-debug-*
      assert.strictEqual(
        shouldExcludePath('.chrome-debug-profile/data.bin', false, gitignoreFilter),
        true,
      );

      // .env secrets
      assert.strictEqual(shouldExcludePath('.env', false, gitignoreFilter), true);
      assert.strictEqual(shouldExcludePath('apps/hud/.env.local', false, gitignoreFilter), true);
      assert.strictEqual(shouldExcludePath('.env.example', false, gitignoreFilter), false);

      // System files
      assert.strictEqual(shouldExcludePath('desktop.ini', false, gitignoreFilter), true);
      assert.strictEqual(shouldExcludePath('.DS_Store', false, gitignoreFilter), true);

      // Gitignore negation test: docs/evidence/run.log is allowed by !docs/evidence/*.log
      assert.strictEqual(shouldExcludePath('docs/evidence/run.log', false, gitignoreFilter), false);

      // Gitignore rule: random *.log is blocked
      assert.strictEqual(shouldExcludePath('apps/app.log', false, gitignoreFilter), true);

      // Allowed source files
      assert.strictEqual(shouldExcludePath('apps/hud/src/index.ts', false, gitignoreFilter), false);
      assert.strictEqual(
        shouldExcludePath('packages/shared/utils.js', false, gitignoreFilter),
        false,
      );
    });
  });

  describeFn('Language Identifier Mapping', () => {
    itFn('maps common source code extensions to correct markdown fence tags', () => {
      assert.strictEqual(getLanguageForFile('app.ts'), 'typescript');
      assert.strictEqual(getLanguageForFile('component.tsx'), 'tsx');
      assert.strictEqual(getLanguageForFile('server.mjs'), 'javascript');
      assert.strictEqual(getLanguageForFile('client.js'), 'javascript');
      assert.strictEqual(getLanguageForFile('ui.jsx'), 'jsx');
      assert.strictEqual(getLanguageForFile('data.json'), 'json');
      assert.strictEqual(getLanguageForFile('style.css'), 'css');
      assert.strictEqual(getLanguageForFile('index.html'), 'html');
      assert.strictEqual(getLanguageForFile('script.py'), 'python');
      assert.strictEqual(getLanguageForFile('build.sh'), 'bash');
      assert.strictEqual(getLanguageForFile('deploy.ps1'), 'powershell');
      assert.strictEqual(getLanguageForFile('query.sql'), 'sql');
      assert.strictEqual(getLanguageForFile('unknown.xyz'), '');
    });
  });

  describeFn('ASCII Directory Tree Generator (Feature 2)', () => {
    itFn('generates a clean ASCII tree excluding ignored directories and binaries', () => {
      const tree = generateDirectoryTree(tempRoot);

      // Must start with root directory name followed by slash
      const rootBase = path.basename(tempRoot);
      assert.ok(tree.startsWith(`${rootBase}/`));

      // Must contain valid directories and files
      assert.ok(tree.includes('apps/'));
      assert.ok(tree.includes('hud/'));
      assert.ok(tree.includes('src/'));
      assert.ok(tree.includes('index.ts'));
      assert.ok(tree.includes('packages/'));
      assert.ok(tree.includes('shared/'));
      assert.ok(tree.includes('utils.js'));
      assert.ok(tree.includes('README.md'));

      // Must NOT contain excluded paths
      assert.ok(!tree.includes('node_modules'));
      assert.ok(!tree.includes('.git/'));
      assert.ok(!tree.includes('.chrome-debug-profile'));
      assert.ok(!tree.includes('binary-file.exe'));
      assert.ok(!tree.includes('nullbyte.dat'));

      // Must contain tree branch box characters
      assert.ok(tree.includes('├── ') || tree.includes('└── '));
    });
  });

  describeFn('Workspace Scanner & Size Caps (Feature 1 & 3)', () => {
    itFn('scans candidate files and enforces 150 KB single-file limit', () => {
      const files = scanWorkspace(tempRoot);
      const relPaths = files.map((f) => f.relativePath);

      // Allowed files present
      assert.ok(relPaths.includes('apps/hud/src/index.ts'));
      assert.ok(relPaths.includes('packages/shared/utils.js'));
      assert.ok(relPaths.includes('README.md'));
      assert.ok(relPaths.includes('.env.example'));
      assert.ok(relPaths.includes('docs/evidence/run.log'));

      // Excluded items absent
      assert.ok(!relPaths.includes('large-file.txt'), 'File > 150 KB must be excluded');
      assert.ok(!relPaths.includes('binary-file.exe'), 'Binary file must be excluded');
      assert.ok(!relPaths.includes('nullbyte.dat'), 'Null-byte file must be excluded');
      assert.ok(!relPaths.some((p) => p === 'node_modules' || p.startsWith('node_modules/')));
      assert.ok(!relPaths.some((p) => p === '.git' || p.startsWith('.git/')));
      assert.ok(
        !relPaths.some(
          (p) => p === '.chrome-debug-profile' || p.startsWith('.chrome-debug-profile/'),
        ),
      );
    });

    itFn('supports targeted file scanning with targetFiles option', () => {
      const targeted = scanWorkspace(tempRoot, {
        targetFiles: ['apps/hud/src/index.ts', 'README.md', 'non-existent.txt', 'binary-file.exe'],
      });

      const relPaths = targeted.map((f) => f.relativePath);
      assert.strictEqual(relPaths.length, 2);
      assert.ok(relPaths.includes('apps/hud/src/index.ts'));
      assert.ok(relPaths.includes('README.md'));
      assert.ok(!relPaths.includes('non-existent.txt'));
      assert.ok(!relPaths.includes('binary-file.exe'));
    });
  });

  describeFn('Coding Contract Prompt Assembler (Feature 3)', () => {
    itFn('assembles structured prompt framing task, tree, files, and Kimi K3 contract', () => {
      const userPrompt = 'Refactor HUD telemetry listener to handle reconnects.';
      const tree = 'mock-root/\n├── apps/\n└── README.md';
      const files = [
        {
          relativePath: 'apps/hud/src/index.ts',
          content: 'export const hud = true;',
          language: 'typescript',
        },
      ];

      const prompt = assemblePrompt({
        userPrompt,
        projectRoot: tempRoot,
        tree,
        files,
      });

      // 1. Task Objective
      assert.ok(prompt.includes('# TASK OBJECTIVE'));
      assert.ok(prompt.includes(userPrompt));

      // 2. Directory Structure
      assert.ok(prompt.includes('# WORKSPACE DIRECTORY STRUCTURE'));
      assert.ok(prompt.includes(tree));

      // 3. File Contents
      assert.ok(prompt.includes('# WORKSPACE CONTEXT FILES'));
      assert.ok(prompt.includes('--- FILE: apps/hud/src/index.ts ---'));
      assert.ok(prompt.includes('```typescript\nexport const hud = true;\n```'));

      // 4. Execution Contract
      assert.ok(prompt.includes('# AUTONOMOUS EXECUTION CONTRACT'));
      assert.ok(prompt.includes('// FILE: relative/path/to/file.ext'));
      assert.ok(prompt.includes('// DELETE_FILE: relative/path/to/file.ext'));
      assert.ok(prompt.includes('Do not use absolute drive paths'));
    });
  });

  describeFn('End-to-End packContext() Interface Contract (Feature 1, 2, 3)', () => {
    itFn('packs context with default options conforming to PROJECT.md contract', async () => {
      const result = await packContext({
        projectRoot: tempRoot,
        userPrompt: 'Implement ping health check.',
      });

      // Verification of return shape
      assert.strictEqual(typeof result.prompt, 'string');
      assert.strictEqual(typeof result.fileCount, 'number');
      assert.strictEqual(typeof result.totalChars, 'number');
      assert.strictEqual(typeof result.tree, 'string');
      assert.ok(Array.isArray(result.filesIncluded));

      assert.strictEqual(result.totalChars, result.prompt.length);
      assert.strictEqual(result.fileCount, result.filesIncluded.length);
      assert.ok(result.fileCount > 0);

      // Verify prompt content
      assert.ok(result.prompt.includes('# TASK OBJECTIVE'));
      assert.ok(result.prompt.includes('Implement ping health check.'));
      assert.ok(result.prompt.includes('# WORKSPACE DIRECTORY STRUCTURE'));
      assert.ok(result.prompt.includes('# WORKSPACE CONTEXT FILES'));
      assert.ok(result.prompt.includes('# AUTONOMOUS EXECUTION CONTRACT'));

      // Verify filesIncluded formatting (must use forward slashes)
      for (const relPath of result.filesIncluded) {
        assert.ok(!relPath.includes('\\'), `Path "${relPath}" must use forward slashes`);
      }
    });

    itFn('strictly enforces maxChars budget limit', async () => {
      // Set a strict budget that only allows a fraction of the content
      const budget = 1200;
      const result = await packContext({
        projectRoot: tempRoot,
        userPrompt: 'Brief test.',
        maxChars: budget,
      });

      assert.ok(
        result.totalChars <= budget,
        `Total chars (${result.totalChars}) must not exceed budget (${budget})`,
      );
      assert.strictEqual(result.prompt.length, result.totalChars);
    });

    itFn('handles extremely small maxChars budgets safely without throwing', async () => {
      const result = await packContext({
        projectRoot: tempRoot,
        userPrompt: 'Micro budget.',
        maxChars: 50,
      });

      assert.strictEqual(result.fileCount, 0);
      assert.deepStrictEqual(result.filesIncluded, []);
      assert.ok(result.totalChars <= 50);
      assert.strictEqual(result.prompt.length, result.totalChars);
    });

    itFn('packs only specified targetFiles when provided', async () => {
      const result = await packContext({
        projectRoot: tempRoot,
        targetFiles: ['apps/hud/src/index.ts'],
        userPrompt: 'Fix HUD.',
      });

      assert.strictEqual(result.fileCount, 1);
      assert.deepStrictEqual(result.filesIncluded, ['apps/hud/src/index.ts']);
      assert.ok(result.prompt.includes('--- FILE: apps/hud/src/index.ts ---'));
      assert.ok(!result.prompt.includes('--- FILE: packages/shared/utils.js ---'));
    });

    itFn('operates successfully on the live E:\\Gematron workspace', async () => {
      const projectRoot = 'E:\\Gematron';
      if (!fs.existsSync(projectRoot)) {
        return; // Skip if run in foreign environment
      }

      const result = await packContext({
        projectRoot,
        targetFiles: ['package.json', 'scripts/lib/context-packer.mjs'],
        userPrompt: 'Review context-packer implementation against package.json dependencies.',
        maxChars: 50_000,
      });

      assert.strictEqual(result.fileCount, 2);
      assert.ok(result.filesIncluded.includes('package.json'));
      assert.ok(result.filesIncluded.includes('scripts/lib/context-packer.mjs'));
      assert.ok(result.prompt.includes('gemini-browser-live'));
      assert.ok(result.prompt.includes('Context Packer Engine'));
      assert.ok(result.totalChars <= 50_000);
      assert.ok(result.tree.includes('scripts/'));
    });
  });
});
