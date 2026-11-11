import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

describe('Desktop Shortcut Generator Script', () => {
  const repoRoot = 'E:\\Gematron';
  const scriptPath = join(repoRoot, 'scripts', 'create-desktop-shortcut.ps1');

  it('exists on E:\\Gematron\\scripts', () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('contains expected configuration for JARVIS AI Assistant with Ctrl+Alt+J', () => {
    const content = readFileSync(scriptPath, 'utf8');
    expect(content).toContain('JARVIS AI Assistant.lnk');
    expect(content).toContain('start-gemini-hud.bat');
    expect(content).toContain('Ctrl+Alt+J');
    expect(content).toContain('WScript.Shell');
    expect(content).toContain('IconLocation');
  });

  it('generates a valid .lnk file when executed on Windows', () => {
    if (process.platform !== 'win32') return;

    const testDir = join(repoRoot, 'notes', 'test_shortcut');
    const targetLnk = join(testDir, 'JARVIS AI Assistant.lnk');

    try {
      execSync(
        `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -Destination "${testDir}"`,
        { stdio: 'pipe' },
      );

      expect(existsSync(targetLnk)).toBe(true);
      expect(existsSync(join(repoRoot, 'assets', 'icons', 'jarvis.ico'))).toBe(true);

      // Deep inspection: verify shortcut properties via COM
      const inspectOutput = execSync(
        `powershell -NoProfile -Command "& { $w = New-Object -ComObject WScript.Shell; $s = $w.CreateShortcut('${targetLnk.replace(/'/g, "''")}'); [PSCustomObject]@{ Target = $s.TargetPath; Hotkey = $s.Hotkey; WorkingDir = $s.WorkingDirectory; Icon = $s.IconLocation } | ConvertTo-Json }"`,
        { encoding: 'utf8' },
      );
      const props = JSON.parse(inspectOutput);
      expect(props.Target).toContain('start-gemini-hud.bat');
      expect(props.Hotkey).toBe('Alt+Ctrl+J');
      expect(props.WorkingDir).toBe(repoRoot);
      expect(props.Icon).toContain('jarvis.ico');
    } finally {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});
