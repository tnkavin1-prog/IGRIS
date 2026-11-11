/**
 * Tier 5: Adversarial Coverage Hardening & Stress Testing Suite
 * E:\Gematron\tests\e2e\tier5_adversarial.test.mjs
 *
 * Verifies system robustness under white-box adversarial stress:
 * - ADV-1: Malformed code stream attacks (partial fences, multiline header bleed, nested backticks, diverse headers)
 * - ADV-2: Path traversal, injection & Windows quirks (escapes, drive letters, UNC, null bytes, nested .git, trailing dot bypass)
 * - ADV-3: Resource & buffer exhaustion (large >5MB payloads, 50-file batches, 0-byte files, binary masquerade, Buffer handling)
 * - ADV-4: Transactional syntax failure & cryptographic SHA-256 rollback integrity
 * - ADV-5: Component-level stress (ContextPacker null boundaries, CDP fence parity, CLI flag & positional parsing)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Dynamic imports of modules under test
let packContext, scanWorkspace, isBinaryFile;
let ArenaCDPDriver;
let CodeSyncer, parseCodeBlocks, validateAndResolvePath, validateSyntax, atomicWriteFile;
let parseArgs;

try {
  const packerMod = await import('../../scripts/lib/context-packer.mjs');
  packContext = packerMod.packContext;
  scanWorkspace = packerMod.scanWorkspace;
  isBinaryFile = packerMod.isBinaryFile;
} catch (e) {}

try {
  const driverMod = await import('../../scripts/lib/arena-cdp-driver.mjs');
  ArenaCDPDriver = driverMod.ArenaCDPDriver;
} catch (e) {}

try {
  const syncerMod = await import('../../scripts/lib/code-syncer.mjs');
  CodeSyncer = syncerMod.CodeSyncer;
  parseCodeBlocks = syncerMod.parseCodeBlocks;
  validateAndResolvePath = syncerMod.validateAndResolvePath;
  validateSyntax = syncerMod.validateSyntax;
  atomicWriteFile = syncerMod.atomicWriteFile;
} catch (e) {}

try {
  const cliMod = await import('../../scripts/kimi-bridge.mjs');
  parseArgs = cliMod.parseArgs;
} catch (e) {}

export const name = 'Tier 5: Adversarial Hardening';

export async function run() {
  const results = [];

  function record(testName, fn) {
    return async () => {
      const start = Date.now();
      try {
        await fn();
        results.push({ name: testName, status: 'pass', durationMs: Date.now() - start });
      } catch (err) {
        results.push({
          name: testName,
          status: 'fail',
          error: err,
          durationMs: Date.now() - start,
        });
      }
    };
  }

  function createSandbox() {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gematron-t5-'));
    return {
      dir: sandboxDir,
      cleanup: () => {
        try {
          fs.rmSync(sandboxDir, { recursive: true, force: true });
        } catch {}
      },
    };
  }

  function sha256(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  }

  // ==========================================================================
  // SECTION 1: MALFORMED CODE STREAM ATTACKS
  // ==========================================================================

  await record('ADV-1.1: Partial & unclosed code fences are rejected before parsing', async () => {
    // 1 backtick
    const oneTick = '`\n// FILE: a.ts\nexport const x = 1;\n';
    assert.equal(
      parseCodeBlocks(oneTick).length,
      0,
      'Single backtick must not be parsed as code block',
    );

    // 3 backticks without closing fence
    const threeTicks = '```ts\n// FILE: a.ts\nexport const x = 1;\n';
    assert.throws(
      () => parseCodeBlocks(threeTicks),
      /Incomplete or unclosed markdown code fence/i,
      'Odd fence count (1 block, unclosed) must throw error',
    );

    // 5 backticks total across response (1 closed block, 1 unclosed block)
    const fiveTicks =
      '```ts\n// FILE: a.ts\nexport const x = 1;\n```\n```ts\n// FILE: b.ts\nexport const y = 2;\n';
    assert.throws(
      () => parseCodeBlocks(fiveTicks),
      /Incomplete or unclosed markdown code fence/i,
      '5 total backticks across response must throw error',
    );
  })();

  await record('ADV-1.2: Multiple code fences on the same line are cleanly isolated', async () => {
    const multiOnLine =
      '```js\n// FILE: inline1.js\nconst a = 1;\n``` ```js\n// FILE: inline2.js\nconst b = 2;\n```';
    const parsed = parseCodeBlocks(multiOnLine);
    assert.equal(parsed.length, 2, 'Must parse two distinct blocks from single-line fences');
    assert.equal(parsed[0].relativePath, 'inline1.js');
    assert.equal(parsed[1].relativePath, 'inline2.js');
    assert.equal(parsed[0].content, 'const a = 1;');
    assert.equal(parsed[1].content, 'const b = 2;');
  })();

  await record('ADV-1.3: Diverse header comment formats and quote wrapping', async () => {
    const variations = [
      { header: '// FILE: src/a.ts', expected: 'src/a.ts' },
      { header: '/* FILE: src/b.ts */', expected: 'src/b.ts' },
      { header: '<!-- FILE: src/c.html -->', expected: 'src/c.html' },
      { header: '# FILE: src/d.py', expected: 'src/d.py' },
      { header: '; FILE: src/e.ini', expected: 'src/e.ini' },
      { header: '### FILE: src/f.md', expected: 'src/f.md' },
      { header: '// FILE: "src/quoted.ts"', expected: 'src/quoted.ts' },
      { header: "// FILE: 'src/single.ts'", expected: 'src/single.ts' },
      { header: '// FILE: `src/backtick.ts`', expected: 'src/backtick.ts' },
      { header: '\t// FILE:   src/spaced.ts  ', expected: 'src/spaced.ts' },
      { header: '// file: src/lowercase.ts', expected: 'src/lowercase.ts' },
      { header: '// File: src/mixedcase.ts', expected: 'src/mixedcase.ts' },
      { header: '// DELETE_FILE: src/delete-me.ts', expected: 'src/delete-me.ts', isDelete: true },
      { header: '/* DELETE_FILE: src/delete-c.ts */', expected: 'src/delete-c.ts', isDelete: true },
      { header: '# delete_file: src/delete-py.py', expected: 'src/delete-py.py', isDelete: true },
    ];

    for (const v of variations) {
      const markdown = `\`\`\`typescript\n${v.header}\nexport const valid = true;\n\`\`\``;
      const parsed = parseCodeBlocks(markdown);
      assert.equal(parsed.length, 1, `Failed for header: ${v.header}`);
      assert.equal(parsed[0].relativePath, v.expected);
      if (v.isDelete) {
        assert.equal(parsed[0].isDelete, true);
      } else {
        assert.equal(parsed[0].isDelete, false);
        assert.equal(parsed[0].content, 'export const valid = true;');
      }
    }
  })();

  await record(
    'ADV-1.4: Empty path on // FILE: line must not consume source code as path',
    async () => {
      // If the assistant generates '// FILE:' with nothing on that line,
      // regex \s* must not greedily cross the newline to consume 'const x = 1;' as filename.
      const emptyPathStream = '```js\n// FILE:\nconst x = 1;\nexport function foo() {}\n```';
      const parsed = parseCodeBlocks(emptyPathStream);
      // The parser MUST NOT treat code as the file path
      const hasCodeAsFilename = parsed.some(
        (p) => p.relativePath.includes('const') || p.relativePath.includes('='),
      );
      assert.equal(
        hasCodeAsFilename,
        false,
        'SECURITY/INTEGRITY VULNERABILITY: Empty // FILE: consumed next line of source code ("const x = 1;") as filename',
      );
    },
  )();

  await record(
    'ADV-1.5: Nested markdown code fences are preserved without mid-content truncation',
    async () => {
      const fence = '`'.repeat(3);
      const nestedMarkdown = [
        fence + 'markdown',
        '// FILE: docs/sample.md',
        '# Usage Guide',
        'Here is the shell command:',
        fence + 'bash',
        'npm test',
        fence,
        'End of document.',
        fence,
      ].join('\n');

      const parsed = parseCodeBlocks(nestedMarkdown);
      assert.equal(parsed.length, 1, 'Should parse 1 file block for docs/sample.md');
      assert.ok(
        parsed[0].content.includes('npm test') && parsed[0].content.includes('End of document.'),
        'PARSER TRUNCATION LIMITATION: Inner code block truncated markdown document content',
      );
    },
  )();

  await record(
    'ADV-1.6: Explanatory prose and code blocks without headers are safely discarded',
    async () => {
      const responseWithChatter = [
        'Sure! Here is the plan to refactor your code:',
        '',
        'First, look at this example snippet:',
        '```javascript',
        'function helper() { return 42; }',
        '```',
        '',
        'Now, here is the actual update for your project:',
        '```typescript',
        '// FILE: src/math.ts',
        'export const answer = 42;',
        '```',
        '',
        'Hope this helps!',
      ].join('\n');

      const parsed = parseCodeBlocks(responseWithChatter);
      assert.equal(parsed.length, 1, 'Only the code block with // FILE: should be parsed');
      assert.equal(parsed[0].relativePath, 'src/math.ts');
      assert.equal(parsed[0].content, 'export const answer = 42;');
    },
  )();

  // ==========================================================================
  // SECTION 2: PATH TRAVERSAL & INJECTION ATTACKS
  // ==========================================================================

  await record('ADV-2.1: Relative path traversal escape vectors are blocked', async () => {
    const sandbox = createSandbox();
    try {
      const escapes = [
        '../escaped.txt',
        '../../escaped.txt',
        '../../../Windows/System32/config/SAM',
        '..\\..\\Windows\\System32\\cmd.exe',
        'sub/../../outside.js',
        'a/b/c/../../../../escaped.ts',
        './../outside.ts',
        'src/../../../etc/passwd',
      ];

      for (const p of escapes) {
        assert.throws(
          () => validateAndResolvePath(sandbox.dir, p),
          /Security Violation.*Path traversal/i,
          `Path escape must be blocked: ${p}`,
        );
      }
    } finally {
      sandbox.cleanup();
    }
  })();

  await record('ADV-2.2: Absolute paths and drive letters are blocked', async () => {
    const sandbox = createSandbox();
    try {
      const absolutes = [
        'C:\\Windows\\System32\\calc.exe',
        'C:/test.txt',
        'D:\\database.sqlite',
        'E:\\Gematron\\escaped.ts',
        'c:\\test.ts',
        '/etc/shadow',
        '/var/log/syslog',
        '\\Windows\\win.ini',
      ];

      for (const p of absolutes) {
        assert.throws(
          () => validateAndResolvePath(sandbox.dir, p),
          /Security Violation.*(Drive letters|Absolute paths)/i,
          `Absolute path must be blocked: ${p}`,
        );
      }
    } finally {
      sandbox.cleanup();
    }
  })();

  await record('ADV-2.3: UNC paths and extended device prefixes are blocked', async () => {
    const sandbox = createSandbox();
    try {
      const uncPaths = [
        '\\\\192.168.1.1\\share\\evil.exe',
        '\\\\attacker-smb\\public\\script.bat',
        '//attacker-smb/share/payload.sh',
        '\\\\?\\C:\\Windows\\System32\\cmd.exe',
      ];

      for (const p of uncPaths) {
        assert.throws(
          () => validateAndResolvePath(sandbox.dir, p),
          /Security Violation.*UNC paths/i,
          `UNC path must be blocked: ${p}`,
        );
      }
    } finally {
      sandbox.cleanup();
    }
  })();

  await record('ADV-2.4: Null-byte injection is blocked', async () => {
    const sandbox = createSandbox();
    try {
      const nullBytePaths = [
        'safe.ts\0.js',
        'package.json\0.bak',
        'src/index.ts\0/../../boot.ini',
        '\0evil.ts',
      ];

      for (const p of nullBytePaths) {
        assert.throws(
          () => validateAndResolvePath(sandbox.dir, p),
          /Security Violation.*Null bytes/i,
          `Null byte path must be blocked: ${p}`,
        );
      }
    } finally {
      sandbox.cleanup();
    }
  })();

  await record(
    'ADV-2.5: Direct modification of .git directory is blocked (root and nested submodules)',
    async () => {
      const sandbox = createSandbox();
      try {
        const gitPaths = [
          '.git/config',
          '.git/hooks/pre-commit',
          '.git\\HEAD',
          'submodule/.git/config',
          'nested/package/.git/hooks/pre-commit',
        ];

        for (const p of gitPaths) {
          assert.throws(
            () => validateAndResolvePath(sandbox.dir, p),
            /Security Violation.*\.git/i,
            `CRITICAL SECURITY VULNERABILITY: .git modification allowed for nested path: ${p}`,
          );
        }
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  await record(
    'ADV-2.6: Windows trailing-dot directory bypass (.git., node_modules.) is blocked',
    async () => {
      const sandbox = createSandbox();
      try {
        const trailingDotPaths = [
          '.git./hooks/pre-commit',
          '.git./config',
          'node_modules./pkg/index.js',
        ];

        for (const p of trailingDotPaths) {
          assert.throws(
            () => validateAndResolvePath(sandbox.dir, p),
            /Security Violation/i,
            `CRITICAL SECURITY VULNERABILITY: Windows trailing-dot bypass permitted write to: ${p}`,
          );
        }
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  await record(
    'ADV-2.7: Direct modification of .env files is blocked (root and subdirectories)',
    async () => {
      const sandbox = createSandbox();
      try {
        const envPaths = [
          '.env',
          '.env.production',
          '.env.local',
          '.env.development.local',
          'config/.env',
          'sub/folder/.env.secret',
        ];

        for (const p of envPaths) {
          assert.throws(
            () => validateAndResolvePath(sandbox.dir, p),
            /Security Violation.*\.env/i,
            `Protected .env path must be blocked: ${p}`,
          );
        }
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  await record(
    'ADV-2.8: Direct modification of node_modules is blocked (root and subdirectories)',
    async () => {
      const sandbox = createSandbox();
      try {
        const nmPaths = [
          'node_modules/express/index.js',
          'apps/web/node_modules/react/index.js',
          'sub/node_modules/pkg/main.js',
        ];

        for (const p of nmPaths) {
          assert.throws(
            () => validateAndResolvePath(sandbox.dir, p),
            /Security Violation.*node_modules/i,
            `Protected node_modules path must be blocked: ${p}`,
          );
        }
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  await record('ADV-2.9: Project root directory self-targeting is blocked', async () => {
    const sandbox = createSandbox();
    try {
      assert.throws(
        () => validateAndResolvePath(sandbox.dir, '.'),
        /Security Violation: Target path cannot be the project root/i,
      );
      assert.throws(
        () => validateAndResolvePath(sandbox.dir, './'),
        /Security Violation: Target path cannot be the project root/i,
      );
    } finally {
      sandbox.cleanup();
    }
  })();

  // ==========================================================================
  // SECTION 3: RESOURCE & BUFFER EXHAUSTION ATTACKS
  // ==========================================================================

  await record(
    'ADV-3.1: Large payload (>5 MB) is parsed and synchronized safely without ReDoS',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({ projectRoot: sandbox.dir });
        const bigString = 'console.log("data");\n'.repeat(250_000); // ~5.2 MB
        const payload = `\`\`\`typescript\n// FILE: src/huge.ts\n${bigString}\`\`\``;

        const parseStart = Date.now();
        const blocks = syncer.parseCodeBlocks(payload);
        const parseDuration = Date.now() - parseStart;

        assert.equal(blocks.length, 1);
        assert.ok(parseDuration < 5000, `Parse took ${parseDuration}ms - potential ReDoS`);

        const syncRes = await syncer.sync(blocks);
        assert.equal(syncRes.filesWritten.length, 1);

        const targetPath = path.join(sandbox.dir, 'src', 'huge.ts');
        assert.ok(fs.existsSync(targetPath));
        assert.equal(fs.statSync(targetPath).size, blocks[0].content.length);
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  await record(
    'ADV-3.2: High volume batch (50 files) written atomically in a single sync',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({ projectRoot: sandbox.dir });
        const blocks = [];
        for (let i = 0; i < 50; i++) {
          blocks.push({
            relativePath: `generated/module_${i}.ts`,
            content: `export const value_${i} = ${i};`,
            isDelete: false,
          });
        }

        const syncRes = await syncer.sync(blocks);
        assert.equal(syncRes.filesWritten.length, 50);

        // Verify all 50 exist on disk
        for (let i = 0; i < 50; i++) {
          const filePath = path.join(sandbox.dir, `generated/module_${i}.ts`);
          assert.ok(fs.existsSync(filePath), `Module ${i} must exist`);
          assert.equal(fs.readFileSync(filePath, 'utf8'), `export const value_${i} = ${i};`);
        }

        // Rollback all 50
        const rollbackRes = await syncer.rollback(syncRes.backupTimestamp);
        assert.equal(
          rollbackRes.removed.length,
          50,
          'All 50 newly created files must be removed on rollback',
        );
        for (let i = 0; i < 50; i++) {
          const filePath = path.join(sandbox.dir, `generated/module_${i}.ts`);
          assert.ok(!fs.existsSync(filePath), `Module ${i} must be unlinked`);
        }
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  await record(
    'ADV-3.3: Binary masquerade attack into code files is halted by pre-flight syntax checks',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({ projectRoot: sandbox.dir });

        // Simulate binary executable header masquerading as TypeScript
        const fakeBinaryTs = '\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00';
        await assert.rejects(
          () => syncer.sync([{ relativePath: 'src/payload.ts', content: fakeBinaryTs }]),
          /Syntax validation failed for "src\/payload.ts"/i,
          'Binary masquerade in .ts must be rejected by esbuild pre-flight validator',
        );

        // Simulate binary PNG masquerading as JSON
        const fakeBinaryJson = '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR';
        await assert.rejects(
          () => syncer.sync([{ relativePath: 'config/data.json', content: fakeBinaryJson }]),
          /Syntax validation failed for "config\/data.json"/i,
          'Binary masquerade in .json must be rejected by JSON.parse pre-flight validator',
        );

        // Verify no files landed on disk
        assert.ok(!fs.existsSync(path.join(sandbox.dir, 'src', 'payload.ts')));
        assert.ok(!fs.existsSync(path.join(sandbox.dir, 'config', 'data.json')));
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  await record(
    'ADV-3.4: Raw binary Buffer passed to sync() preserves byte-for-byte cryptographic hash',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({ projectRoot: sandbox.dir });
        const randomBytes = crypto.randomBytes(64 * 1024); // 64 KB random binary
        const expectedHash = crypto.createHash('sha256').update(randomBytes).digest('hex');

        await syncer.sync([
          { relativePath: 'assets/sample.bin', content: randomBytes, isDelete: false },
        ]);

        const diskPath = path.join(sandbox.dir, 'assets', 'sample.bin');
        assert.ok(fs.existsSync(diskPath));
        assert.equal(
          sha256(diskPath),
          expectedHash,
          'BUG/DATA LOSS: CodeSyncer silently discarded Buffer content and wrote 0 bytes instead of binary data',
        );
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  await record('ADV-3.5: Empty 0-byte file creation and deletion verified cleanly', async () => {
    const sandbox = createSandbox();
    try {
      const syncer = new CodeSyncer({ projectRoot: sandbox.dir });
      const emptyPath = 'empty.txt';

      await syncer.sync([{ relativePath: emptyPath, content: '', isDelete: false }]);

      const fullPath = path.join(sandbox.dir, emptyPath);
      assert.ok(fs.existsSync(fullPath));
      assert.equal(fs.statSync(fullPath).size, 0);

      // Delete empty file
      await syncer.sync([{ relativePath: emptyPath, content: '', isDelete: true }]);
      assert.ok(!fs.existsSync(fullPath));
    } finally {
      sandbox.cleanup();
    }
  })();

  // ==========================================================================
  // SECTION 4: TRANSACTIONAL SYNTAX FAILURE & ROLLBACK HASH INTEGRITY
  // ==========================================================================

  await record(
    'ADV-4.1: Mid-batch pre-flight syntax failure aborts all writes without disk side effects',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({ projectRoot: sandbox.dir });

        // Create an existing baseline file
        const baselinePath = path.join(sandbox.dir, 'src', 'baseline.ts');
        fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
        fs.writeFileSync(baselinePath, 'export const version = 1;');
        const baselineHash = sha256(baselinePath);

        // Batch with 4 valid updates and 1 broken syntax block in the middle
        const batch = [
          { relativePath: 'src/baseline.ts', content: 'export const version = 2;' },
          { relativePath: 'src/valid1.ts', content: 'export const v1 = true;' },
          { relativePath: 'src/broken.ts', content: 'export const v2 = (((' }, // INVALID SYNTAX
          { relativePath: 'src/valid2.ts', content: 'export const v3 = true;' },
        ];

        await assert.rejects(
          () => syncer.sync(batch),
          /Syntax validation failed for "src\/broken.ts"/i,
        );

        // Baseline file must remain untouched with original hash
        assert.equal(sha256(baselinePath), baselineHash, 'Baseline file hash must be unchanged');
        assert.equal(fs.readFileSync(baselinePath, 'utf8'), 'export const version = 1;');

        // No new files created
        assert.ok(!fs.existsSync(path.join(sandbox.dir, 'src', 'valid1.ts')));
        assert.ok(!fs.existsSync(path.join(sandbox.dir, 'src', 'broken.ts')));
        assert.ok(!fs.existsSync(path.join(sandbox.dir, 'src', 'valid2.ts')));

        // No backup directory created
        assert.ok(
          !fs.existsSync(syncer.backupDir),
          'Backup directory must not be created on pre-flight failure',
        );
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  await record(
    'ADV-4.2: Cryptographic SHA-256 hash match on backup and rollback of overwritten files',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({ projectRoot: sandbox.dir });

        // Create 2 original files with unique random contents
        const file1 = path.join(sandbox.dir, 'src', 'service.ts');
        const file2 = path.join(sandbox.dir, 'config', 'settings.json');
        fs.mkdirSync(path.dirname(file1), { recursive: true });
        fs.mkdirSync(path.dirname(file2), { recursive: true });

        const content1 = `export const id = "${crypto.randomUUID()}";\n`;
        const content2 = JSON.stringify({ secret: crypto.randomUUID() }, null, 2);
        fs.writeFileSync(file1, content1);
        fs.writeFileSync(file2, content2);

        const hash1 = sha256(file1);
        const hash2 = sha256(file2);

        // Overwrite both files via sync()
        const syncRes = await syncer.sync([
          { relativePath: 'src/service.ts', content: 'export const id = "OVERWRITTEN";' },
          { relativePath: 'config/settings.json', content: '{"secret": "OVERWRITTEN"}' },
        ]);

        // Verify backup manifest recorded correct original hashes
        const manifestPath = path.join(syncRes.backupDir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const b1 = manifest.filesBackedUp.find((f) => f.relative === 'src/service.ts');
        const b2 = manifest.filesBackedUp.find((f) => f.relative === 'config/settings.json');
        assert.equal(b1.sha256, hash1, 'Manifest must record original SHA-256 for file1');
        assert.equal(b2.sha256, hash2, 'Manifest must record original SHA-256 for file2');

        // Verify disk files changed
        assert.notEqual(sha256(file1), hash1);
        assert.notEqual(sha256(file2), hash2);

        // Execute rollback
        const rollbackRes = await syncer.rollback(syncRes.backupTimestamp);
        assert.equal(rollbackRes.restored.length, 2);

        // Verify restored files match pristine SHA-256 byte-for-byte
        assert.equal(sha256(file1), hash1, 'Restored file1 must match original SHA-256');
        assert.equal(sha256(file2), hash2, 'Restored file2 must match original SHA-256');
        assert.equal(fs.readFileSync(file1, 'utf8'), content1);
        assert.equal(fs.readFileSync(file2, 'utf8'), content2);
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  await record(
    'ADV-4.3: Cryptographic restoration on rollback of deleted files (// DELETE_FILE:)',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({ projectRoot: sandbox.dir });
        const targetFile = path.join(sandbox.dir, 'src', 'to-be-deleted.ts');
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        const originalContent = 'export function legacyCode() { return "do not lose me"; }';
        fs.writeFileSync(targetFile, originalContent);
        const originalHash = sha256(targetFile);

        // Delete file via sync()
        const syncRes = await syncer.sync([
          { relativePath: 'src/to-be-deleted.ts', content: '', isDelete: true },
        ]);

        assert.ok(!fs.existsSync(targetFile), 'File must be deleted from disk');
        assert.equal(syncRes.filesDeleted.length, 1);

        // Rollback
        const rollbackRes = await syncer.rollback(syncRes.backupTimestamp);
        assert.ok(rollbackRes.restored.includes('src/to-be-deleted.ts'));

        // Verify resurrected file
        assert.ok(fs.existsSync(targetFile), 'Deleted file must be restored on rollback');
        assert.equal(sha256(targetFile), originalHash, 'Restored file SHA-256 must match original');
        assert.equal(fs.readFileSync(targetFile, 'utf8'), originalContent);
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  await record(
    'ADV-4.4: Cascaded multi-turn rollbacks restore state across successive snapshots',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({ projectRoot: sandbox.dir });
        const targetFile = path.join(sandbox.dir, 'src', 'state.ts');
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });

        // State 0 (pristine)
        fs.writeFileSync(targetFile, 'export const state = 0;');
        const hash0 = sha256(targetFile);

        // Turn 1 -> State 1
        const turn1 = await syncer.sync([
          { relativePath: 'src/state.ts', content: 'export const state = 1;' },
        ]);
        const hash1 = sha256(targetFile);
        assert.notEqual(hash1, hash0);

        // Turn 2 -> State 2
        const turn2 = await syncer.sync([
          { relativePath: 'src/state.ts', content: 'export const state = 2;' },
        ]);
        const hash2 = sha256(targetFile);
        assert.notEqual(hash2, hash1);

        // Rollback Turn 2 -> should return to State 1
        await syncer.rollback(turn2.backupTimestamp);
        assert.equal(sha256(targetFile), hash1, 'Must restore State 1');
        assert.equal(fs.readFileSync(targetFile, 'utf8'), 'export const state = 1;');

        // Rollback Turn 1 -> should return to State 0
        await syncer.rollback(turn1.backupTimestamp);
        assert.equal(sha256(targetFile), hash0, 'Must restore State 0');
        assert.equal(fs.readFileSync(targetFile, 'utf8'), 'export const state = 0;');
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // ==========================================================================
  // SECTION 5: COMPONENT-LEVEL ADVERSARIAL STRESS
  // ==========================================================================

  await record(
    'ADV-5.1: Context Packer handles binary null-byte boundary tests and character caps',
    async () => {
      // Null byte at exactly offset 511 (512th byte boundary)
      const buf511 = Buffer.alloc(512, 0x61);
      buf511[511] = 0x00;
      assert.equal(isBinaryFile('sample.txt', buf511), true);

      // Null byte beyond 512 bytes (should be treated as text by first-512-byte sniffer)
      const bufBeyond = Buffer.alloc(1024, 0x61);
      bufBeyond[600] = 0x00;
      assert.equal(isBinaryFile('sample.txt', bufBeyond), false);

      // Context Packer maxChars enforcement
      const sandbox = createSandbox();
      try {
        fs.writeFileSync(path.join(sandbox.dir, 'f1.ts'), 'export const a = 1;');
        fs.writeFileSync(path.join(sandbox.dir, 'f2.ts'), 'export const b = 2;');

        const packed = await packContext({
          projectRoot: sandbox.dir,
          maxChars: 50, // tiny budget
        });

        assert.ok(
          packed.totalChars <= 50,
          `Packed characters (${packed.totalChars}) must not exceed budget (50)`,
        );
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  await record(
    'ADV-5.2: Arena CDP Driver code fence parity checker handles varied structures',
    async () => {
      // 0 fences -> even (0)
      assert.equal(ArenaCDPDriver.isCodeFenceParityEven('hello world'), true);

      // 2 fences -> even (2)
      assert.equal(ArenaCDPDriver.isCodeFenceParityEven('```js\ncode\n```'), true);

      // 1 fence -> odd (1)
      assert.equal(ArenaCDPDriver.isCodeFenceParityEven('```js\nunclosed'), false);

      // 3 fences -> odd (3)
      assert.equal(
        ArenaCDPDriver.isCodeFenceParityEven('```js\ncode\n```\n```ts\nunclosed'),
        false,
      );

      // 4 fences -> even (4)
      assert.equal(
        ArenaCDPDriver.isCodeFenceParityEven('```js\ncode\n```\n```ts\ncode2\n```'),
        true,
      );
    },
  )();

  await record(
    'ADV-5.3: CLI argument parser handles prompt passed directly without subcommand',
    async () => {
      // When invoked as: node scripts/kimi-bridge.mjs "Refactor ModelSwitchboard"
      // parseArgs should recognize "Refactor ModelSwitchboard" as prompt and default command to 'run'
      const optDirectPrompt = parseArgs(['Refactor ModelSwitchboard', 'src/ModelSwitchboard.tsx']);
      assert.equal(optDirectPrompt.command, 'run');
      assert.equal(
        optDirectPrompt.prompt,
        'Refactor ModelSwitchboard',
        'BUG: parseArgs failed to assign positional prompt when command subcommand was omitted',
      );
      assert.ok(optDirectPrompt.files.includes('src/ModelSwitchboard.tsx'));
    },
  )();

  return results;
}

// Auto-run if executed directly via node
const isDirectCli =
  Boolean(process.argv[1]) &&
  path.basename(process.argv[1]).replace(/\.[cm]?[jt]s$/, '') === 'tier5_adversarial.test';

if (isDirectCli) {
  console.log('\n================================================================================');
  console.log('         RUNNING TIER 5: ADVERSARIAL HARDENING & STRESS TEST SUITE');
  console.log('================================================================================\n');
  const start = Date.now();
  run()
    .then((results) => {
      let passed = 0;
      let failed = 0;
      for (const r of results) {
        if (r.status === 'pass') {
          passed++;
          console.log(`  [PASS] ${r.name} (${r.durationMs}ms)`);
        } else {
          failed++;
          console.log(`  [FAIL] ${r.name} (${r.durationMs}ms)`);
          if (r.error) {
            console.log(`         ERROR: ${r.error.message || r.error}`);
          }
        }
      }
      const duration = Date.now() - start;
      console.log('\n' + '='.repeat(80));
      console.log(
        `TIER 5 SUMMARY: ${passed}/${results.length} tests passed (${failed} failed) in ${duration}ms`,
      );
      console.log('='.repeat(80) + '\n');
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Fatal Test Runner Error:', err);
      process.exit(1);
    });
}
