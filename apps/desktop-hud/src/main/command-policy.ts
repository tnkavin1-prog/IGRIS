/**
 * CommandPolicy — risk classification for shell commands issued by the agent.
 *
 * The previous implementation was a short blocklist of catastrophic
 * format/delete patterns. That is not a capability policy: it misses
 * persistence (`reg add ... Run`, `schtasks`), credential access
 * (`reg save HKLM\SAM`), defence tampering (`Set-MpPreference -Disable*`),
 * download-and-execute (`iwr ... | iex`) and arbitrary encoded payloads.
 *
 * This module classifies a command into four tiers and is intentionally
 * conservative: anything that is not clearly read-only lands in `caution`,
 * mutating or system-touching operations in `dangerous`, and operations that
 * can destroy data, disable security, establish persistence or exfiltrate
 * credentials in `blocked`.
 *
 * `blocked` commands are never executed. `dangerous` commands require an
 * explicit approval decision (see `RunCommandOptions.approved`). `safe` and
 * `caution` commands execute normally but are still logged.
 */

export type CommandRisk = 'safe' | 'caution' | 'dangerous' | 'blocked';

export interface CommandAssessment {
  /** Highest risk tier matched by the command. */
  risk: CommandRisk;
  /** True when the command must never run. */
  blocked: boolean;
  /** True when a human-approved decision is required before running. */
  requiresApproval: boolean;
  /** Human-readable explanations, one per matched rule. */
  reasons: string[];
  /** Stable rule identifiers, useful for audit records and tests. */
  matchedRules: string[];
}

interface PolicyRule {
  id: string;
  risk: Exclude<CommandRisk, 'safe'>;
  reason: string;
  pattern: RegExp;
}

const BLOCKED_RULES: PolicyRule[] = [
  {
    id: 'disk-format',
    risk: 'blocked',
    reason: 'Formatting a volume destroys all data on it.',
    pattern: /\bformat(?:\.com)?\s+(?:[a-z]:|\/fs:|\/q\b|\/p:)/i,
  },
  {
    id: 'diskpart',
    risk: 'blocked',
    reason: 'diskpart can erase partitions and disks.',
    pattern: /\bdiskpart(?:\.exe)?\b/i,
  },
  {
    id: 'boot-config',
    risk: 'blocked',
    reason: 'Modifying boot configuration can make Windows unbootable.',
    pattern: /\b(?:bcdedit|bootrec|bootsect)(?:\.exe)?\b/i,
  },
  {
    id: 'shadow-copy-delete',
    risk: 'blocked',
    reason: 'Deleting shadow copies destroys recovery points and backups.',
    pattern: /\bvssadmin\b.*\bdelete\b|\bwbadmin\b.*\bdelete\b/i,
  },
  {
    id: 'root-recursive-delete',
    risk: 'blocked',
    reason: 'Recursive deletion of a drive root or system directory.',
    pattern:
      /\b(?:del|erase|rmdir|rd|remove-item|rm)\b[^\n]*?(?:\b[a-z]:\\?\s*$|\b[a-z]:\\(?:windows|users|program files|programdata|system32)\b|\/(?:s|q|f)\b[^\n]*\b[a-z]:\\)/i,
  },
  {
    id: 'posix-root-delete',
    risk: 'blocked',
    reason: 'Recursive deletion of the filesystem root.',
    pattern: /\brm\s+-(?:rf|fr|r)\s+(?:\/|~|\$home)\s*$/i,
  },
  {
    id: 'fork-bomb',
    risk: 'blocked',
    reason: 'Fork bomb pattern would exhaust the machine.',
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
  },
  {
    id: 'power-state',
    risk: 'blocked',
    reason: 'Power-state changes interrupt the user and can lose work.',
    pattern: /\b(?:stop-computer|restart-computer|shutdown(?:\.exe)?\s+[/-][srt])\b/i,
  },
  {
    id: 'defender-tamper',
    risk: 'blocked',
    reason: 'Disabling or reconfiguring malware protection.',
    pattern:
      /\b(?:set-mppreference|add-mppreference|remove-mppreference)\b[^\n]*(?:-disable|exclusion)|\b(?:sc|net)\b[^\n]*\b(?:windefend|wscsvc|mpssvc)\b/i,
  },
  {
    id: 'firewall-disable',
    risk: 'blocked',
    reason: 'Disabling the firewall removes network protection.',
    pattern: /\bnetsh\b[^\n]*\b(?:firewall|advfirewall)\b[^\n]*\b(?:off|disable)\b/i,
  },
  {
    id: 'credential-dump',
    risk: 'blocked',
    reason: 'Reading the SAM/SECURITY hive or cached credentials.',
    pattern:
      /\breg(?:\.exe)?\s+(?:save|export)\b[^\n]*\b(?:hklm\\(?:sam|security|system)|hkey_local_machine\\(?:sam|security|system))\b|\b(?:mimikatz|procdump)\b[^\n]*\blsass\b|\bsekurlsa\b/i,
  },
  {
    id: 'security-log-clear',
    risk: 'blocked',
    reason: 'Clearing event logs destroys forensic evidence.',
    pattern: /\bwevtutil(?:\.exe)?\s+cl\b|\bclear-eventlog\b/i,
  },
  {
    id: 'shadow-account',
    risk: 'blocked',
    reason: 'Creating or elevating local accounts changes access control.',
    pattern:
      /\bnet\s+(?:user|localgroup)\b[^\n]*\/(?:add|delete)|\bnew-localuser\b|\badd-localgroupmember\b[^\n]*administrators/i,
  },
  {
    id: 'encoded-command',
    risk: 'blocked',
    reason: 'Encoded or obfuscated command payload cannot be reviewed.',
    pattern:
      /(?:^|\s)-e(?:nc(?:odedcommand)?)?\s+[A-Za-z0-9+/=]{24,}|frombase64string|-bxor\b|\bbypass\s+-executionpolicy/i,
  },
  {
    id: 'download-execute',
    risk: 'blocked',
    reason: 'Downloading and executing remote code in one step.',
    pattern:
      /\b(?:invoke-webrequest|invoke-restmethod|iwr|irm|curl|wget|start-bitstransfer)\b[^\n]*\|[^\n]*\b(?:iex|invoke-expression|powershell|cmd)\b|\b(?:iex|invoke-expression)\b[^\n]*\b(?:downloadstring|downloadfile|invoke-webrequest|iwr|irm)\b/i,
  },
  {
    id: 'lsass-kill',
    risk: 'blocked',
    reason: 'Terminating a security-critical process.',
    pattern: /\btaskkill\b[^\n]*\/im\s+(?:lsass|csrss|wininit|services|smss)\.exe/i,
  },
  {
    id: 'acl-everyone',
    risk: 'blocked',
    reason: 'Granting Everyone full control removes access boundaries.',
    pattern: /\bicacls\b[^\n]*\/(?:grant|setowner)\b[^\n]*\b(?:everyone|users)\b[^\n]*:(?:f|full)/i,
  },
];

const DANGEROUS_RULES: PolicyRule[] = [
  {
    id: 'delete',
    risk: 'dangerous',
    reason: 'Deletes files or directories.',
    pattern: /\b(?:del|erase|rmdir|rd|remove-item|rm|ri)\b/i,
  },
  {
    id: 'move-overwrite',
    risk: 'dangerous',
    reason: 'Moves or overwrites files outside a scratch area.',
    pattern: /\b(?:move|move-item|mv|copy|copy-item|cp|robocopy|replace)\b/i,
  },
  {
    id: 'registry-write',
    risk: 'dangerous',
    reason: 'Writes to the Windows registry.',
    pattern: /\breg(?:\.exe)?\s+(?:add|delete|import|restore)\b|\b(?:set-itemproperty|new-itemproperty|remove-itemproperty)\b[^\n]*\bhk(?:lm|cu|cr|u|cc)\b/i,
  },
  {
    id: 'persistence',
    risk: 'dangerous',
    reason: 'Creates scheduled tasks or startup entries (persistence).',
    pattern:
      /\b(?:schtasks|register-scheduledtask|new-scheduledtask)\b|\bstartup\b[^\n]*\.lnk\b/i,
  },
  {
    id: 'service-change',
    risk: 'dangerous',
    reason: 'Creates, stops or deletes a Windows service.',
    pattern: /\b(?:sc|sc\.exe)\s+(?:create|delete|config|stop|start)\b|\b(?:new-service|set-service|stop-service|remove-service)\b/i,
  },
  {
    id: 'process-control',
    risk: 'dangerous',
    reason: 'Starts or terminates processes.',
    pattern: /\b(?:start-process|stop-process|taskkill)\b|\bkill\b/i,
  },
  {
    id: 'script-execution',
    risk: 'dangerous',
    reason: 'Executes a script or dynamic expression.',
    pattern: /\b(?:invoke-expression|iex|invoke-command|start-job)\b|\.ps1\b|\b(?:powershell|pwsh|cmd|wscript|cscript)\b[^\n]*\s-(?:command|c|file)\b/i,
  },
  {
    id: 'execution-policy',
    risk: 'dangerous',
    reason: 'Changes PowerShell execution policy.',
    pattern: /\bset-executionpolicy\b/i,
  },
  {
    id: 'system-path-write',
    risk: 'dangerous',
    reason: 'Writes inside a Windows or Program Files directory.',
    pattern: /(?:>|>>|\bout-file\b|\bset-content\b)[^\n]*\b[a-z]:\\(?:windows|program files|program files \(x86\)|programdata)\b/i,
  },
  {
    id: 'driver-install',
    risk: 'dangerous',
    reason: 'Installs or modifies drivers.',
    pattern: /\bpnputil\b|\bdevcon\b|\badd-windowsdriver\b/i,
  },
  {
    id: 'network-config',
    risk: 'dangerous',
    reason: 'Changes network or proxy configuration.',
    pattern: /\bnetsh\b|\bipconfig\s+\/(?:release|renew|flushdns)\b|\broute\s+(?:add|delete)\b|\bnetsh\b/i,
  },
  {
    id: 'package-publish',
    risk: 'dangerous',
    reason: 'Publishes or deploys artifacts to a remote registry.',
    pattern: /\b(?:npm|pnpm|yarn)\s+publish\b|\b(?:twine|npm)\s+upload\b|\bgit\s+push\b[^\n]*--force/i,
  },
  {
    id: 'external-network-write',
    risk: 'dangerous',
    reason: 'Uploads local data over the network.',
    pattern: /\b(?:invoke-webrequest|invoke-restmethod|iwr|irm|curl|wget)\b[^\n]*(?:-method\s+post|-body\s+|-infile\b|--data\b|-d\s+@)/i,
  },
];

const SAFE_RULES: RegExp[] = [
  /^\s*(?:get-[a-z]+|dir|ls|gci|get-childitem|pwd|whoami|hostname|ver|echo|write-output|type|cat|get-content|select-string|measure-object|test-path|where-object|sort-object|select-object|format-table|out-string|get-process|get-service|get-date|get-location|resolve-path|get-item)\b/i,
];

/**
 * Split a compound command into its individual statements for analysis.
 * Pipes are deliberately *not* split: a pipeline like
 * `iwr ... | iex` is far more meaningful as a single unit, and the
 * download-execute rule depends on seeing both sides together.
 */
function splitStatements(command: string): string[] {
  return command
    .split(/\r?\n|;(?!\s*$)|&&|\|\|/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Classify a shell command. The result is the highest-risk tier across the
 * whole command, so a single dangerous statement taints a piped chain.
 */
export function assessCommand(command: string): CommandAssessment {
  const text = command.trim();
  const matchedRules: string[] = [];
  const reasons: string[] = [];

  if (!text) {
    return {
      risk: 'safe',
      blocked: false,
      requiresApproval: false,
      reasons: [],
      matchedRules: [],
    };
  }

  const state: { risk: CommandRisk } = { risk: 'safe' };

  const raise = (next: CommandRisk, id: string, reason: string) => {
    if (!matchedRules.includes(id)) {
      matchedRules.push(id);
      reasons.push(reason);
    }
    const order: Record<CommandRisk, number> = { safe: 0, caution: 1, dangerous: 2, blocked: 3 };
    if (order[next] > order[state.risk]) state.risk = next;
  };

  for (const statement of splitStatements(text)) {
    for (const rule of BLOCKED_RULES) {
      if (rule.pattern.test(statement)) raise('blocked', rule.id, rule.reason);
    }
    for (const rule of DANGEROUS_RULES) {
      if (rule.pattern.test(statement)) raise('dangerous', rule.id, rule.reason);
    }
  }

  if (state.risk === 'safe') {
    const allSafe = splitStatements(text).every((statement) =>
      SAFE_RULES.some((pattern) => pattern.test(statement)),
    );
    if (!allSafe) {
      raise('caution', 'unrecognised-command', 'Command is not a known read-only operation.');
    }
  }

  const risk = state.risk;
  return {
    risk,
    blocked: risk === 'blocked',
    requiresApproval: risk === 'dangerous' || risk === 'blocked',
    reasons,
    matchedRules,
  };
}

/** True when the command is safe to execute without human review. */
export function isCommandSafe(command: string): boolean {
  const assessment = assessCommand(command);
  return assessment.risk === 'safe' || assessment.risk === 'caution';
}
