/**
 * Code Syncer & Backup Engine for Autonomous Kimi K3 Bridge
 *
 * Provides:
 * - Multi-fence markdown code block parsing with FILE / DELETE_FILE headers
 * - Strict path traversal and security validation (E: Gematron containment)
 * - Pre-flight syntax validation using esbuild (TS/JS) and JSON.parse
 * - Safe timestamped backups with manifest indexing (backups/kimi-history/<timestamp>/)
 * - Atomic file writer with Windows file-lock fallback
 * - Instant rollback engine to restore previous workspace snapshots
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import * as esbuild from 'esbuild';

// Regular expressions for detecting headers inside markdown code blocks
const FILE_HEADER_REGEX =
  /^\s*(?:\/\/|#|###|<!--|\/\*|;)\s*FILE:[^\S\r\n]*([^\r\n*]+?)(?:\s*\*\/|\s*-->)?[^\S\r\n]*(?:\r?\n|$)/i;
const DELETE_HEADER_REGEX =
  /^\s*(?:\/\/|#|###|<!--|\/\*|;)\s*DELETE_FILE:[^\S\r\n]*([^\r\n*]+?)(?:\s*\*\/|\s*-->)?[^\S\r\n]*(?:\r?\n|$)/i;

/**
 * Parses markdown response text to extract code blocks with file headers.
 *
 * @param {string} responseText - Assistant markdown generation
 * @returns {Array<{ relativePath: string, content: string, isDelete?: boolean }>}
 * @throws {Error} If incomplete or unclosed code fence is detected
 */
export function parseCodeBlocks(responseText) {
  if (typeof responseText !== 'string' || responseText.length === 0) {
    return [];
  }

  // Detect unclosed / incomplete markdown code fences
  const fenceMatches = responseText.match(/```/g) || [];
  if (fenceMatches.length % 2 !== 0) {
    throw new Error('Incomplete or unclosed markdown code fence detected in response');
  }

  const results = [];
  const openFenceRegex = /```[^\r\n]*\r?\n/g;

  while (openFenceRegex.exec(responseText) !== null) {
    const contentStartIndex = openFenceRegex.lastIndex;
    let searchIndex = contentStartIndex;
    let nestedDepth = 0;
    let blockEndIndex = -1;

    // Scan forward for closing or nested opening fences
    while (true) {
      const fencePos = responseText.indexOf('```', searchIndex);
      if (fencePos === -1) {
        break;
      }

      // Check what follows the ```
      const after = responseText.slice(fencePos + 3);
      const langMatch = after.match(/^([a-zA-Z0-9_-]+)[^`\r\n]*(?:\r?\n|$)/);

      if (langMatch) {
        // This is an inner opening fence (e.g. ```bash\n)
        nestedDepth++;
        searchIndex = fencePos + 3 + langMatch[0].length;
      } else {
        // This is a closing fence
        if (nestedDepth > 0) {
          nestedDepth--;
          searchIndex = fencePos + 3;
        } else {
          // Found outer closing fence!
          blockEndIndex = fencePos;
          searchIndex = fencePos + 3;
          break;
        }
      }
    }

    if (blockEndIndex === -1) {
      throw new Error('Incomplete or unclosed markdown code fence detected in response');
    }

    // Set openFenceRegex to continue scanning after the closing fence
    openFenceRegex.lastIndex = searchIndex;

    const rawBlock = responseText.slice(contentStartIndex, blockEndIndex);

    // Check DELETE_FILE header first
    const deleteMatch = rawBlock.match(DELETE_HEADER_REGEX);
    if (deleteMatch) {
      const rawPath = deleteMatch[1]
        .trim()
        .replace(/^['"`]|['"`]$/g, '')
        .trim();
      if (rawPath) {
        results.push({
          relativePath: rawPath.replace(/\\/g, '/'),
          content: '',
          isDelete: true,
        });
      }
      continue;
    }

    // Check FILE header
    const fileMatch = rawBlock.match(FILE_HEADER_REGEX);
    if (fileMatch) {
      const rawPath = fileMatch[1]
        .trim()
        .replace(/^['"`]|['"`]$/g, '')
        .trim();
      if (rawPath) {
        // Strip the header line from the content and trim trailing whitespace
        const content = rawBlock.slice(fileMatch[0].length).trimEnd();
        results.push({
          relativePath: rawPath.replace(/\\/g, '/'),
          content,
          isDelete: false,
        });
      }
      continue;
    }

    // Explanatory code blocks without FILE or DELETE_FILE headers are ignored
  }

  return results;
}

/**
 * Validates and resolves a target relative path strictly within projectRoot.
 *
 * @param {string} projectRoot - Base workspace directory
 * @param {string} relativePath - Target file path
 * @returns {{ resolved: string, relative: string }}
 * @throws {Error} On path traversal, absolute path, drive letters, UNC, or protected files
 */
export function validateAndResolvePath(projectRoot, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('Path must be a non-empty string');
  }

  const clean = relativePath
    .trim()
    .replace(/^['"`]|['"`]$/g, '')
    .trim();

  // Null byte injection check
  if (clean.includes('\0')) {
    throw new Error('Security Violation: Null bytes detected in path');
  }

  // Reject drive letters: C:, D:, etc.
  if (/^[a-zA-Z]:/.test(clean)) {
    throw new Error(`Security Violation: Drive letters not permitted in path: "${clean}"`);
  }

  // Reject UNC network shares: \\server\share or //server/share
  if (clean.startsWith('\\\\') || clean.startsWith('//')) {
    throw new Error(`Security Violation: UNC paths not permitted in path: "${clean}"`);
  }

  // Reject absolute paths
  if (path.isAbsolute(clean) || clean.startsWith('/') || clean.startsWith('\\')) {
    throw new Error(`Security Violation: Absolute paths not permitted: "${clean}"`);
  }

  const rootResolved = path.resolve(projectRoot);
  const resolved = path.resolve(rootResolved, clean);
  const normalizedRoot = path.normalize(rootResolved).toLowerCase();
  const normalizedResolved = path.normalize(resolved).toLowerCase();

  // Reject pointing directly to project root
  if (normalizedResolved === normalizedRoot) {
    throw new Error('Security Violation: Target path cannot be the project root directory');
  }

  // Containment verification: resolved path must be inside projectRoot
  if (!normalizedResolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Security Violation: Path traversal outside project root detected: "${clean}"`);
  }

  // Check forbidden system / sensitive directories and files
  const rel = path.relative(rootResolved, resolved).replace(/\\/g, '/');
  const relLower = rel.toLowerCase();

  const segments = relLower.split('/').map((s) => s.replace(/[. ]+$/, ''));
  if (segments.some((s) => s === '.git')) {
    throw new Error(`Security Violation: Direct modification of .git is forbidden: "${rel}"`);
  }

  if (segments.some((s) => s === '.env' || s.startsWith('.env.')) || relLower.includes('/.env')) {
    throw new Error(`Security Violation: Writing to .env files is blocked for safety: "${rel}"`);
  }

  if (segments.some((s) => s === 'node_modules')) {
    throw new Error(
      `Security Violation: Direct modification of node_modules is forbidden: "${rel}"`,
    );
  }

  return { resolved, relative: rel };
}

export const validatePath = validateAndResolvePath;

/**
 * Pre-flight syntax validation using esbuild (JS/TS) and JSON.parse.
 *
 * @param {string} filePath - Path or filename with extension
 * @param {string} content - Source code content
 * @returns {boolean} True if syntax is valid
 * @throws {Error} If syntax check fails
 */
export function validateSyntax(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();

  // Validate JSON files
  if (ext === '.json') {
    try {
      JSON.parse(content);
    } catch (err) {
      throw new Error(`Syntax validation failed for "${filePath}": Invalid JSON - ${err.message}`, {
        cause: err,
      });
    }
    return true;
  }

  // Validate TS / TSX / JS / MJS files via esbuild transformSync
  const loaderMap = {
    '.ts': 'ts',
    '.tsx': 'tsx',
    '.js': 'js',
    '.mjs': 'js',
    '.jsx': 'jsx',
    '.cjs': 'js',
  };

  const loader = loaderMap[ext];
  if (loader) {
    try {
      esbuild.transformSync(content, {
        loader,
        target: 'esnext',
      });
    } catch (err) {
      const detail =
        err.errors && err.errors[0]
          ? `${err.errors[0].text} (line ${err.errors[0].location?.line || '?'}, col ${err.errors[0].location?.column || '?'})`
          : err.message;
      throw new Error(`Syntax validation failed for "${filePath}": ${detail}`, { cause: err });
    }
    return true;
  }

  // Non-code files (e.g. .md, .txt, .css, .html) pass without syntax check
  return true;
}

/**
 * Atomically writes content to destPath using a temporary sibling file.
 *
 * @param {string} destPath - Absolute target file path
 * @param {string|Buffer} content - Content to write
 */
export function atomicWriteFile(destPath, content) {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(destPath)}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  try {
    fs.writeFileSync(tmpPath, content);
    try {
      fs.renameSync(tmpPath, destPath);
    } catch {
      // Windows file-lock fallback: copy and unlink
      fs.copyFileSync(tmpPath, destPath);
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore lock release delay
      }
    }
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

/**
 * CodeSyncer class implementing the PROJECT.md interface contract.
 */
export class CodeSyncer {
  /**
   * @param {object} [options={}]
   * @param {string} [options.projectRoot] - Workspace root (defaults to GEMATRON_ROOT or the repo root)
   * @param {string} [options.backupDir] - Backups root (defaults to <projectRoot>/backups/kimi-history)
   */
  constructor(options = {}) {
    this.projectRoot = path.resolve(
      options.projectRoot ||
        process.env.GEMATRON_ROOT ||
        process.env.PROJECT_ROOT ||
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
    );
    this.backupDir = path.resolve(
      options.backupDir || path.join(this.projectRoot, 'backups', 'kimi-history'),
    );
  }

  /**
   * Parses markdown response text into file modifications.
   */
  parseCodeBlocks(responseText) {
    return parseCodeBlocks(responseText);
  }

  /**
   * Validates and resolves a path within this instance's projectRoot.
   */
  validatePath(relativePath) {
    return validateAndResolvePath(this.projectRoot, relativePath);
  }

  /**
   * Validates syntax for code files before writing.
   */
  validateSyntax(filePath, content) {
    return validateSyntax(filePath, content);
  }

  /**
   * Writes a file atomically to disk.
   */
  atomicWriteFile(destPath, content) {
    return atomicWriteFile(destPath, content);
  }

  /**
   * Synchronizes parsed code blocks with workspace:
   * 1. Validates all target paths (security guard)
   * 2. Pre-flight syntax validation on all blocks (transactional fail-fast)
   * 3. Creates timestamped backup of existing files + manifest.json
   * 4. Applies atomic writes and deletes
   *
   * @param {Array<{ relativePath: string, content: string, isDelete?: boolean }>} blocks
   * @param {object} [options={}]
   * @param {boolean} [options.dryRun=false] - If true, plan only without touching disk
   * @param {boolean} [options.ignoreSyntaxErrors=false] - Bypass syntax errors
   * @param {string} [options.timestamp] - Optional custom timestamp (e.g. for testing)
   * @returns {Promise<{
   *   backupTimestamp: string,
   *   backupDir: string,
   *   filesWritten: string[],
   *   filesDeleted: string[],
   *   manifest: object
   * }>}
   */
  async sync(blocks, options = {}) {
    const dryRun = Boolean(options.dryRun);
    const ignoreSyntaxErrors = Boolean(options.ignoreSyntaxErrors);

    if (!Array.isArray(blocks)) {
      throw new Error('blocks must be an array');
    }

    // Step 1: Validate all paths and pre-flight check syntax across ALL blocks
    const validatedBlocks = [];
    for (const block of blocks) {
      if (!block || typeof block.relativePath !== 'string') {
        throw new Error('Each block must contain a relativePath string');
      }

      const { resolved, relative } = this.validatePath(block.relativePath);
      const isDelete = Boolean(block.isDelete);
      const content =
        typeof block.content === 'string' || Buffer.isBuffer(block.content) ? block.content : '';

      // Pre-flight syntax validation for non-delete blocks
      if (!isDelete && !ignoreSyntaxErrors) {
        this.validateSyntax(relative, content);
      }

      validatedBlocks.push({
        resolved,
        relative,
        isDelete,
        content,
      });
    }

    // Step 2: Prepare backup information and directory
    const timestamp = options.timestamp || new Date().toISOString().replace(/[:.]/g, '-');
    const backupSessionDir = path.join(this.backupDir, timestamp);

    const filesBackedUp = [];
    const newFilesCreated = [];
    const deletedFiles = [];
    const filesWritten = [];
    const filesDeleted = [];

    for (const block of validatedBlocks) {
      const exists = fs.existsSync(block.resolved);

      if (block.isDelete) {
        if (exists) {
          const buffer = fs.readFileSync(block.resolved);
          const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          const size = buffer.length;

          filesBackedUp.push({ relative: block.relative, size, sha256 });
          deletedFiles.push({ relative: block.relative, size, sha256 });
          filesDeleted.push(block.relative);
        }
      } else {
        if (exists) {
          const buffer = fs.readFileSync(block.resolved);
          const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          const size = buffer.length;

          filesBackedUp.push({ relative: block.relative, size, sha256 });
        } else {
          newFilesCreated.push(block.relative);
        }
        filesWritten.push(block.relative);
      }
    }

    const manifest = {
      timestamp,
      createdAt: new Date().toISOString(),
      projectRoot: this.projectRoot,
      backupDir: backupSessionDir,
      dryRun,
      filesBackedUp,
      newFilesCreated,
      deletedFiles,
    };

    // If dryRun, return planning without touching disk
    if (dryRun) {
      return {
        backupTimestamp: timestamp,
        backupDir: backupSessionDir,
        filesWritten,
        filesDeleted,
        manifest,
      };
    }

    // Step 3: Perform backups and write manifest
    if (filesBackedUp.length > 0 || newFilesCreated.length > 0 || deletedFiles.length > 0) {
      fs.mkdirSync(backupSessionDir, { recursive: true });

      // Copy existing files to backup session dir
      for (const item of filesBackedUp) {
        const src = path.join(this.projectRoot, item.relative);
        const dest = path.join(backupSessionDir, item.relative);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }

      // Write manifest.json
      const manifestPath = path.join(backupSessionDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    }

    // Step 4: Apply writes and deletions
    for (const block of validatedBlocks) {
      if (block.isDelete) {
        if (fs.existsSync(block.resolved)) {
          fs.unlinkSync(block.resolved);
        }
      } else {
        this.atomicWriteFile(block.resolved, block.content);
      }
    }

    return {
      backupTimestamp: timestamp,
      backupDir: backupSessionDir,
      filesWritten,
      filesDeleted,
      manifest,
    };
  }

  /**
   * Rolls back workspace changes from a designated backup manifest.
   *
   * @param {string} backupTimestampOrManifest - Timestamp string or path to manifest.json
   * @returns {Promise<{ restored: string[], removed: string[] }>}
   */
  async rollback(backupTimestampOrManifest) {
    if (!backupTimestampOrManifest || typeof backupTimestampOrManifest !== 'string') {
      throw new Error('A valid backup timestamp or manifest path is required for rollback');
    }

    let manifestPath;
    if (backupTimestampOrManifest.endsWith('.json')) {
      manifestPath = path.isAbsolute(backupTimestampOrManifest)
        ? backupTimestampOrManifest
        : path.resolve(this.projectRoot, backupTimestampOrManifest);
    } else {
      const possibleDir = path.isAbsolute(backupTimestampOrManifest)
        ? backupTimestampOrManifest
        : path.join(this.backupDir, backupTimestampOrManifest);
      manifestPath = path.join(possibleDir, 'manifest.json');
    }

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Backup manifest not found: "${manifestPath}"`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const backupSessionDir = path.dirname(manifestPath);

    const restored = [];
    const removed = [];

    // Restore backed-up files and previously deleted files
    const toRestore = [...(manifest.filesBackedUp || []), ...(manifest.deletedFiles || [])];

    const seenRestore = new Set();
    for (const item of toRestore) {
      const rel = typeof item === 'string' ? item : item.relative;
      if (seenRestore.has(rel)) continue;
      seenRestore.add(rel);

      const backupFile = path.join(backupSessionDir, rel);
      const { resolved } = this.validatePath(rel);

      if (fs.existsSync(backupFile)) {
        const content = fs.readFileSync(backupFile);
        this.atomicWriteFile(resolved, content);
        restored.push(rel);
      }
    }

    // Unlink newly created files
    for (const item of manifest.newFilesCreated || []) {
      const rel = typeof item === 'string' ? item : item.relative;
      const { resolved } = this.validatePath(rel);

      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
        removed.push(rel);
      }
    }

    return { restored, removed };
  }
}

export default CodeSyncer;
