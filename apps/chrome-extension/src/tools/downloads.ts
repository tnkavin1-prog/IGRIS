/**
 * Download policy.
 *
 * A URL that looks safe when the download starts can redirect to an
 * executable, or a server can send an executable under a `.pdf` URL via
 * Content-Disposition. Chrome exposes the resolved URL and the on-disk
 * filename after the transfer starts, so policy is re-checked there and a
 * blocked file is cancelled and removed.
 */

export const DANGEROUS_DOWNLOAD =
  /\.(exe|msi|bat|cmd|ps1|scr|jar|apk|dmg|pkg|vbs|wsf|hta)(?:$|[?#])/i;

/** Chrome danger verdicts that must never be left on disk. */
const BLOCKED_DANGER = new Set([
  'dangerous',
  'file',
  'url',
  'content',
  'unwanted',
  'safe_browsing_violation',
  'blocked_by_policy',
]);

export interface DownloadAssessmentInput {
  requestedUrl: string;
  finalUrl?: string | undefined;
  filename?: string | undefined;
  danger?: string | undefined;
  state?: string | undefined;
}

export interface DownloadAssessment {
  blocked: boolean;
  reason?: string;
  /** True when the server resolved the request somewhere else. */
  redirect: boolean;
  /** URL policy actually evaluated (resolved URL when Chrome reported one). */
  resolvedUrl: string;
}

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

export function assessDownload(input: DownloadAssessmentInput): DownloadAssessment {
  const resolvedUrl = input.finalUrl || input.requestedUrl;
  const requested = parseHttpUrl(input.requestedUrl);
  const resolved = parseHttpUrl(resolvedUrl);

  if (!resolved) {
    return {
      blocked: true,
      reason: 'The download resolved to a non-web URL.',
      redirect: true,
      resolvedUrl,
    };
  }

  const redirect = !requested || requested.toString() !== resolved.toString();

  if (DANGEROUS_DOWNLOAD.test(resolved.pathname + resolved.search)) {
    return {
      blocked: true,
      reason: 'The download URL resolves to an executable or script file.',
      redirect,
      resolvedUrl,
    };
  }

  if (input.filename && DANGEROUS_DOWNLOAD.test(input.filename)) {
    return {
      blocked: true,
      reason: 'The server sent an executable or script file under a different name.',
      redirect,
      resolvedUrl,
    };
  }

  if (input.danger && BLOCKED_DANGER.has(input.danger)) {
    return {
      blocked: true,
      reason: `Chrome classified this download as "${input.danger}".`,
      redirect,
      resolvedUrl,
    };
  }

  return { blocked: false, redirect, resolvedUrl };
}
