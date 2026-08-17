import { logger } from '@librechat/data-schemas';
import type { DiagnosticLogEntry } from '@librechat/data-schemas';

export type GithubIssueReport = {
  reportId: string;
  userId: string;
  description: string;
  route?: string;
  userAgent?: string;
  occurredAt: Date;
  diagnosis: string;
  confidence: 'low' | 'medium' | 'high';
  evidence: DiagnosticLogEntry[];
};

export type FiledIssue = {
  number: number;
  url: string;
};

type IssueTarget = {
  repo: string;
  token: string;
};

const API_ROOT = 'https://api.github.com';
const ISSUE_LABEL = 'user-report';
const TITLE_LIMIT = 70;

/** Both vars unset means the feature is off, which is how local dev and tests stay quiet. */
function readTarget(): IssueTarget | null {
  const repo = process.env.GITHUB_ISSUES_REPO?.trim() ?? '';
  const token = process.env.GITHUB_ISSUES_TOKEN?.trim() ?? '';
  if (!repo || !token) {
    return null;
  }
  return { repo, token };
}

function headers(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'GiesChat',
  };
}

export function buildIssueTitle(description: string): string {
  return `[Report] ${description.replace(/\s+/g, ' ').trim().slice(0, TITLE_LIMIT)}`;
}

/** Untrusted text: quoted so a stray fence or heading cannot restructure the issue. */
function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function evidenceBlock(evidence: DiagnosticLogEntry[]): string[] {
  if (evidence.length === 0) {
    return ['### Server log lines', '', '_No matching lines in the diagnostic window._'];
  }
  const lines = evidence.map(({ timestamp, level, message, requestId }) => {
    const suffix = requestId != null && requestId !== '' ? ` (request ${requestId})` : '';
    return `${timestamp} ${level.toUpperCase()} ${message.replace(/```/g, "'''")}${suffix}`;
  });
  return [
    '<details>',
    `<summary>Server log lines (${evidence.length})</summary>`,
    '',
    '```text',
    ...lines,
    '```',
    '',
    '</details>',
  ];
}

/**
 * `includeEvidence: false` is the public-repository body: the report id and the user's
 * own words, and nothing that would leak a route, a user agent, an internal id, or a
 * server log line into a page that is indexed within minutes of being filed.
 */
export function buildIssueBody(report: GithubIssueReport, includeEvidence: boolean): string {
  const header = [`**Report:** \`${report.reportId}\``];
  const description = ['### What the user reported', '', quote(report.description)];

  if (!includeEvidence) {
    return [
      ...header,
      '',
      '_Evidence withheld: the target repository is public. Look the report up in the `issuereports` collection by the id above._',
      '',
      ...description,
    ].join('\n');
  }

  return [
    ...header,
    `**Occurred:** ${report.occurredAt.toISOString()}`,
    `**Route:** ${report.route ?? '_not reported_'}`,
    `**User agent:** ${report.userAgent ?? '_not reported_'}`,
    `**User:** \`${report.userId}\``,
    `**Diagnosis (${report.confidence} confidence):** ${report.diagnosis}`,
    '',
    ...description,
    '',
    ...evidenceBlock(report.evidence),
  ].join('\n');
}

let visibilityLookup: Promise<boolean> | null = null;

async function lookupPrivate(target: IssueTarget): Promise<boolean> {
  try {
    const response = await fetch(`${API_ROOT}/repos/${target.repo}`, {
      headers: headers(target.token),
    });
    if (!response.ok) {
      logger.warn(
        `[issues] Could not read the visibility of ${target.repo} (${response.status}); treating it as public`,
      );
      return false;
    }
    const body = (await response.json()) as { private?: boolean };
    return body.private === true;
  } catch (error) {
    logger.warn(
      `[issues] Visibility lookup for ${target.repo} failed; treating it as public`,
      error,
    );
    return false;
  }
}

/**
 * Whether the target repository is private, cached for the process lifetime. Any failure
 * answers `false` — the guard fails closed, because a public issue carrying a student's
 * words and server logs is indexed long before anyone can delete it.
 */
export async function isTargetPrivate(): Promise<boolean> {
  const target = readTarget();
  if (!target) {
    return false;
  }
  visibilityLookup ??= lookupPrivate(target);
  return visibilityLookup;
}

/** Test seam: the visibility answer is cached for the process lifetime by design. */
export function resetIssueTargetCache(): void {
  visibilityLookup = null;
}

/** Never throws and never rethrows: a GitHub failure must not change what the user sees. */
export async function fileIssue(report: GithubIssueReport): Promise<FiledIssue | null> {
  const target = readTarget();
  if (!target) {
    return null;
  }

  const includeEvidence = await isTargetPrivate();
  if (!includeEvidence) {
    logger.warn(
      `[issues] ${target.repo} reads public — filing ${report.reportId} with evidence redacted`,
    );
  }

  try {
    const response = await fetch(`${API_ROOT}/repos/${target.repo}/issues`, {
      method: 'POST',
      headers: { ...headers(target.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: buildIssueTitle(report.description),
        body: buildIssueBody(report, includeEvidence),
        labels: [ISSUE_LABEL],
      }),
    });

    if (!response.ok) {
      logger.error(
        `[issues] GitHub rejected the issue for ${report.reportId} (${response.status} ${response.statusText})`,
      );
      return null;
    }

    const created = (await response.json()) as { number?: number; html_url?: string };
    if (typeof created.number !== 'number' || typeof created.html_url !== 'string') {
      logger.error(`[issues] GitHub accepted ${report.reportId} but returned no issue number`);
      return null;
    }

    return { number: created.number, url: created.html_url };
  } catch (error) {
    logger.error(`[issues] Failed to file ${report.reportId} on GitHub`, error);
    return null;
  }
}
