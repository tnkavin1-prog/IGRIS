/**
 * Context Packer Engine for Autonomous Kimi K3 Arena Bridge
 * E:\Gematron\scripts\lib\context-packer.mjs
 *
 * Core Capabilities:
 * 1. Recursive file scanner respecting .gitignore, ignoring binaries via null-byte sniffing & extension filters, 150KB/file limit.
 * 2. Visual ASCII directory tree formatter for source directories.
 * 3. Coding contract prompt assembler framing task objective, directory tree, file contents, and Kimi K3 execution contract.
 * 4. Exported packContext() interface conforming to PROJECT.md interface contract.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Directories excluded by default from scanning and directory trees.
 */
export const DEFAULT_EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.agents',
  'dist',
  'build',
  'release',
  '.npm-cache',
  '.pnpm-store',
  '.electron-cache',
  'test-results',
  'playwright-report',
  'coverage',
  'logs',
  'backups',
  'temp',
  '.vscode',
  '.idea',
  '.artifacts',
]);

/**
 * Binary file extensions excluded from context packing.
 */
export const BINARY_EXTENSIONS = new Set([
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
  '.iso',
  '.7z',
]);

/**
 * System / editor files excluded by default.
 */
export const DEFAULT_EXCLUDED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/**
 * Maximum single file size allowed for inclusion in context (150 KB).
 */
export const MAX_FILE_SIZE_BYTES = 150 * 1024; // 153,600 bytes

/**
 * Default total context character budget (~25,000 tokens).
 */
export const DEFAULT_MAX_CHARS = 100_000;

/**
 * Determines whether a file is binary based on extension or null-byte sniffing.
 * Reads first 512 bytes: if any byte is 0x00, treated as binary.
 *
 * @param {string} filePath - Path to the file.
 * @param {Buffer|Uint8Array|null} [buffer=null] - Optional buffer content for fast in-memory checks.
 * @returns {boolean} True if binary, false if text.
 */
export function isBinaryFile(filePath, buffer = null) {
  if (typeof filePath === 'string') {
    const ext = path.extname(filePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return true;
    }
  }

  try {
    let bytes;
    if (buffer && (Buffer.isBuffer(buffer) || buffer instanceof Uint8Array)) {
      bytes = buffer.subarray(0, 512);
    } else if (typeof filePath === 'string') {
      if (!fs.existsSync(filePath)) {
        return false;
      }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return false;
      }
      const fd = fs.openSync(filePath, 'r');
      try {
        const buf = Buffer.alloc(512);
        const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
        bytes = buf.subarray(0, bytesRead);
      } finally {
        fs.closeSync(fd);
      }
    } else {
      return false;
    }

    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x00) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Converts a gitignore glob pattern into a regular expression.
 *
 * @param {string} pattern
 * @param {boolean} anchored
 * @returns {RegExp}
 */
function globToRegex(pattern, anchored) {
  let regexStr = '';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        regexStr += '(?:.+/)?';
        i += 3;
      } else {
        regexStr += '.*';
        i += 2;
      }
    } else if (char === '*') {
      regexStr += '[^/]*';
      i++;
    } else if (char === '?') {
      regexStr += '[^/]';
      i++;
    } else if ('./+^$()[]{}|\\'.includes(char)) {
      regexStr += '\\' + char;
      i++;
    } else {
      regexStr += char;
      i++;
    }
  }

  if (anchored) {
    return new RegExp(`^${regexStr}(?:/.*)?$`, 'i');
  } else {
    return new RegExp(`(?:^|/)${regexStr}(?:/.*)?$`, 'i');
  }
}

/**
 * Parses .gitignore file contents into a matcher function.
 * Supports comments (#), negations (!), trailing slashes (directories), and wildcards (*, **).
 *
 * @param {string} content - Raw content of .gitignore.
 * @returns {(relativePath: string, isDirectory?: boolean) => boolean} Matcher function.
 */
export function parseGitignore(content) {
  if (!content || typeof content !== 'string') {
    return () => false;
  }

  const lines = content.split(/\r?\n/);
  const rules = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    let pattern = line;
    let negated = false;

    if (pattern.startsWith('!')) {
      negated = true;
      pattern = pattern.slice(1).trim();
    }

    if (!pattern) continue;

    const dirOnly = pattern.endsWith('/');
    if (dirOnly) {
      pattern = pattern.slice(0, -1);
    }

    const anchored = pattern.startsWith('/') || pattern.includes('/');
    if (pattern.startsWith('/')) {
      pattern = pattern.slice(1);
    }

    const regex = globToRegex(pattern, anchored);
    rules.push({ regex, negated, dirOnly, pattern });
  }

  return function isIgnored(relativePath, isDirectory = false) {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    let ignored = false;

    for (const rule of rules) {
      if (rule.dirOnly && !isDirectory) {
        continue;
      }

      if (rule.regex.test(normalized)) {
        ignored = !rule.negated;
      }
    }

    return ignored;
  };
}

/**
 * Creates a gitignore matcher function for a given project root.
 *
 * @param {string} projectRoot
 * @returns {(relativePath: string, isDirectory?: boolean) => boolean}
 */
export function createGitignoreFilter(projectRoot) {
  try {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      return parseGitignore(content);
    }
  } catch {
    // Ignore and fallback to no-op filter
  }
  return () => false;
}

/**
 * Checks if a directory name matches default excluded patterns.
 *
 * @param {string} dirName
 * @returns {boolean}
 */
export function shouldExcludeDir(dirName) {
  if (DEFAULT_EXCLUDED_DIRS.has(dirName)) return true;
  if (dirName.startsWith('.chrome-debug-')) return true;
  if (dirName.startsWith('.tmp')) return true;
  return false;
}

/**
 * Checks whether a relative path should be excluded based on default exclusions and gitignore.
 *
 * @param {string} relativePath
 * @param {boolean} isDirectory
 * @param {Function|null} [gitignoreFilter=null]
 * @returns {boolean}
 */
export function shouldExcludePath(relativePath, isDirectory, gitignoreFilter = null) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/');

  for (const seg of segments) {
    if (shouldExcludeDir(seg)) {
      return true;
    }
  }

  const baseName = segments[segments.length - 1];
  if (!isDirectory) {
    if (DEFAULT_EXCLUDED_FILES.has(baseName)) {
      return true;
    }
    // Block secret env files except .env.example
    if (baseName === '.env' || (baseName.startsWith('.env.') && baseName !== '.env.example')) {
      return true;
    }
    if (
      baseName.endsWith('.tsbuildinfo') ||
      (baseName.endsWith('.log') && !normalized.startsWith('docs/evidence/'))
    ) {
      return true;
    }
  }

  if (gitignoreFilter && typeof gitignoreFilter === 'function') {
    if (gitignoreFilter(normalized, isDirectory)) {
      return true;
    }
  }

  return false;
}

/**
 * Maps a file path or extension to a Markdown code fence language identifier.
 *
 * @param {string} filePath
 * @returns {string} Language identifier (e.g. 'typescript', 'javascript', 'json')
 */
export function getLanguageForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.jsx':
      return 'jsx';
    case '.json':
      return 'json';
    case '.html':
    case '.htm':
      return 'html';
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return 'css';
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.sh':
    case '.bash':
    case '.zsh':
      return 'bash';
    case '.ps1':
    case '.psm1':
    case '.psd1':
      return 'powershell';
    case '.py':
      return 'python';
    case '.rs':
      return 'rust';
    case '.go':
      return 'go';
    case '.sql':
      return 'sql';
    case '.xml':
    case '.svg':
      return 'xml';
    case '.toml':
    case '.ini':
      return 'ini';
    case '.c':
    case '.h':
      return 'c';
    case '.cpp':
    case '.hpp':
    case '.cc':
      return 'cpp';
    case '.cs':
      return 'csharp';
    default:
      return '';
  }
}

/**
 * Generates an ASCII directory tree representing the workspace source layout.
 *
 * @param {string} projectRoot - Absolute path to workspace root.
 * @param {object} [options={}]
 * @param {number} [options.maxDepth=5] - Maximum recursion depth.
 * @param {Function} [options.gitignoreFilter] - Optional pre-compiled gitignore filter.
 * @returns {string} Clean ASCII tree formatted with standard tree box characters.
 */
export function generateDirectoryTree(projectRoot, options = {}) {
  const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 5;
  const rootName = path.basename(projectRoot) || 'root';
  const gitignoreFilter = options.gitignoreFilter || createGitignoreFilter(projectRoot);

  const lines = [rootName + '/'];

  function walk(currentDir, currentDepth, prefix) {
    if (currentDepth > maxDepth) return;

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    const validEntries = [];
    for (const entry of entries) {
      const relPath = path.relative(projectRoot, path.join(currentDir, entry.name));
      const isDir = entry.isDirectory();

      if (shouldExcludePath(relPath, isDir, gitignoreFilter)) {
        continue;
      }
      if (!isDir && isBinaryFile(path.join(currentDir, entry.name))) {
        continue;
      }
      validEntries.push(entry);
    }

    // Sort: directories first (alphabetical), then files (alphabetical)
    validEntries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    for (let i = 0; i < validEntries.length; i++) {
      const entry = validEntries[i];
      const isLast = i === validEntries.length - 1;
      const isDir = entry.isDirectory();
      const symbol = isLast ? '└── ' : '├── ';
      const childPrefix = prefix + (isLast ? '    ' : '│   ');

      if (isDir) {
        lines.push(`${prefix}${symbol}${entry.name}/`);
        walk(path.join(currentDir, entry.name), currentDepth + 1, childPrefix);
      } else {
        lines.push(`${prefix}${symbol}${entry.name}`);
      }
    }
  }

  walk(projectRoot, 1, '');
  return lines.join('\n');
}

/**
 * Recursively scans the workspace for candidate source files, respecting exclusions,
 * binary detection, and per-file size limits.
 *
 * @param {string} projectRoot
 * @param {object} [options={}]
 * @param {string[]} [options.targetFiles] - Optional list of explicit target files.
 * @param {number} [options.maxFileSize=MAX_FILE_SIZE_BYTES] - Maximum allowed single file size.
 * @param {Function} [options.gitignoreFilter] - Gitignore filter function.
 * @returns {Array<{ relativePath: string, absolutePath: string, size: number }>}
 */
export function scanWorkspace(projectRoot, options = {}) {
  const maxFileSize =
    typeof options.maxFileSize === 'number' ? options.maxFileSize : MAX_FILE_SIZE_BYTES;
  const gitignoreFilter = options.gitignoreFilter || createGitignoreFilter(projectRoot);
  const targetFiles =
    Array.isArray(options.targetFiles) && options.targetFiles.length > 0
      ? options.targetFiles
      : null;

  if (targetFiles) {
    const results = [];
    for (const target of targetFiles) {
      if (!target || typeof target !== 'string') continue;
      const resolved = path.isAbsolute(target)
        ? path.resolve(target)
        : path.resolve(projectRoot, target);
      const relative = path.relative(projectRoot, resolved).replace(/\\/g, '/');

      try {
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) continue;
        if (isBinaryFile(resolved)) continue;

        results.push({
          relativePath: relative,
          absolutePath: resolved,
          size: stat.size,
        });
      } catch {
        // Target file not found or inaccessible; skip gracefully
      }
    }
    return results;
  }

  const results = [];
  function crawl(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
      const isDir = entry.isDirectory();

      if (shouldExcludePath(relPath, isDir, gitignoreFilter)) {
        continue;
      }

      if (isDir) {
        crawl(fullPath);
      } else {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > maxFileSize) {
            continue; // Skip files exceeding 150 KB
          }
          if (isBinaryFile(fullPath)) {
            continue; // Skip binary files
          }
          results.push({
            relativePath: relPath,
            absolutePath: fullPath,
            size: stat.size,
          });
        } catch {
          // Inaccessible file
        }
      }
    }
  }

  crawl(projectRoot);
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

/**
 * Assembles the full prompt incorporating task objective, directory tree,
 * file contents, and Kimi K3 coding execution contract.
 *
 * @param {object} options
 * @param {string} [options.userPrompt]
 * @param {string} [options.projectRoot]
 * @param {string} [options.tree]
 * @param {Array<{ relativePath: string, content: string, language?: string }>} [options.files]
 * @returns {string} Formatted markdown prompt.
 */
export function assemblePrompt(options = {}) {
  const {
    userPrompt = 'Please review and update the codebase as required.',
    projectRoot = process.cwd(),
    tree = '',
    files = [],
  } = options;

  const projectRootName = path.basename(projectRoot) || 'workspace';

  let prompt = '';

  prompt += '# TASK OBJECTIVE\n';
  prompt += userPrompt.trim() + '\n\n';

  prompt += `# WORKSPACE DIRECTORY STRUCTURE (${projectRoot})\n`;
  prompt += '```\n';
  prompt += tree.trim() + '\n';
  prompt += '```\n\n';

  prompt += '# WORKSPACE CONTEXT FILES\n';
  for (const file of files) {
    const lang = file.language || getLanguageForFile(file.relativePath);
    const normalizedContent = file.content.replace(/\r\n/g, '\n');
    prompt += `--- FILE: ${file.relativePath} ---\n`;
    prompt += `\`\`\`${lang}\n`;
    prompt += normalizedContent;
    if (!normalizedContent.endsWith('\n')) {
      prompt += '\n';
    }
    prompt += '```\n\n';
  }

  prompt += '# AUTONOMOUS EXECUTION CONTRACT\n';
  prompt += `You are an expert autonomous software engineer directly authoring changes for the project workspace at ${projectRoot}.\n`;
  prompt +=
    'All code must be production-ready, strictly adhering to TypeScript / Node 20+ ES Modules ("type": "module").\n\n';
  prompt += 'CRITICAL FORMATTING INSTRUCTIONS FOR CODE SYNCER:\n';
  prompt +=
    '1. Every file you create or modify MUST be enclosed in a separate standard Markdown code block (```lang ... ```).\n';
  prompt +=
    '2. The VERY FIRST line inside each code block MUST be the relative file path header:\n';
  prompt += '   // FILE: relative/path/to/file.ext\n';
  prompt +=
    '   (For Python, Shell, or YAML files, you may also use `# FILE: relative/path/to/file.ext`).\n';
  prompt +=
    '3. Provide the COMPLETE, functional file content. Do NOT truncate with "// ... rest of code unchanged" or placeholders.\n';
  prompt += '4. To delete a file, output a code block containing:\n';
  prompt += '   // DELETE_FILE: relative/path/to/file.ext\n';
  prompt += `5. All file paths must be relative to ${projectRootName}. Do not use absolute drive paths.\n`;

  return prompt;
}

/**
 * Main entrypoint for Context Packer Engine.
 * Conforms to interface contract in PROJECT.md:
 * packContext(options) -> { prompt, fileCount, totalChars, tree, filesIncluded }
 *
 * @param {object} [options={}]
 * @param {string} [options.projectRoot] - Workspace root directory (defaults to process.cwd()).
 * @param {string[]} [options.targetFiles] - Optional explicit files to pack.
 * @param {number} [options.maxChars=100000] - Total context character budget.
 * @param {number} [options.maxFileSize=153600] - Max single file size in bytes (150 KB).
 * @param {string} [options.userPrompt] - Task description or prompt for Kimi K3.
 * @param {number} [options.treeMaxDepth=5] - Maximum directory tree recursion depth.
 * @returns {Promise<{ prompt: string, fileCount: number, totalChars: number, tree: string, filesIncluded: string[] }>}
 */
export async function packContext(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const maxChars =
    typeof options.maxChars === 'number' && options.maxChars >= 0
      ? options.maxChars
      : DEFAULT_MAX_CHARS;
  const userPrompt =
    (options.userPrompt || '').trim() || 'Please review and update the codebase as required.';
  const targetFiles =
    Array.isArray(options.targetFiles) && options.targetFiles.length > 0
      ? options.targetFiles
      : null;

  const gitignoreFilter = createGitignoreFilter(projectRoot);

  // 1. Generate visual directory tree
  const tree = generateDirectoryTree(projectRoot, {
    maxDepth: options.treeMaxDepth ?? 5,
    gitignoreFilter,
  });

  // 2. Scan candidate files
  const candidateFiles = scanWorkspace(projectRoot, {
    targetFiles,
    maxFileSize: options.maxFileSize ?? MAX_FILE_SIZE_BYTES,
    gitignoreFilter,
  });

  // 3. Measure base template size without files
  const basePromptWithoutFiles = assemblePrompt({
    userPrompt,
    projectRoot,
    tree,
    files: [],
  });

  // If the base prompt already exceeds or reaches maxChars
  if (basePromptWithoutFiles.length >= maxChars) {
    const truncatedPrompt = basePromptWithoutFiles.slice(0, Math.max(0, maxChars));
    return {
      prompt: truncatedPrompt,
      fileCount: 0,
      totalChars: truncatedPrompt.length,
      tree,
      filesIncluded: [],
    };
  }

  // 4. Budget candidate files into character limit
  const includedFiles = [];
  let currentPromptLength = basePromptWithoutFiles.length;

  for (const candidate of candidateFiles) {
    let content;
    try {
      content = fs.readFileSync(candidate.absolutePath, 'utf8');
    } catch {
      continue;
    }

    const lang = getLanguageForFile(candidate.relativePath);
    const normalizedContent = content.replace(/\r\n/g, '\n');
    const blockText = `--- FILE: ${candidate.relativePath} ---\n\`\`\`${lang}\n${normalizedContent}${normalizedContent.endsWith('\n') ? '' : '\n'}\`\`\`\n\n`;

    if (currentPromptLength + blockText.length <= maxChars) {
      includedFiles.push({
        relativePath: candidate.relativePath,
        content,
        language: lang,
      });
      currentPromptLength += blockText.length;
    }
  }

  // 5. Assemble final prompt
  const fullPrompt = assemblePrompt({
    userPrompt,
    projectRoot,
    tree,
    files: includedFiles,
  });

  const finalPrompt = fullPrompt.length > maxChars ? fullPrompt.slice(0, maxChars) : fullPrompt;

  return {
    prompt: finalPrompt,
    fileCount: includedFiles.length,
    totalChars: finalPrompt.length,
    tree,
    filesIncluded: includedFiles.map((f) => f.relativePath),
  };
}

export default packContext;
