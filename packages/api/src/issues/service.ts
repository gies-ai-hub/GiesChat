import mongoose from 'mongoose';
import { nanoid } from 'nanoid';
import {
  createModels,
  getRecentDiagnosticLogs,
  logger,
  type DiagnosticLogEntry,
} from '@librechat/data-schemas';
import { fileIssue } from './github';

export type SubmitIssueInput = {
  userId: string;
  tenantId?: string;
  description: string;
  route?: string;
  userAgent?: string;
  occurredAt?: Date;
};

const submissions = new Map<string, number[]>();

export function canSubmitIssue(userId: string, now: number = Date.now()): boolean {
  const recent = (submissions.get(userId) ?? []).filter((time) => time > now - 30 * 60 * 1000);
  if (recent.length >= 5) {
    submissions.set(userId, recent);
    return false;
  }
  recent.push(now);
  submissions.set(userId, recent);
  return true;
}

export function diagnoseIssue(logs: DiagnosticLogEntry[]): {
  diagnosis: string;
  confidence: 'low' | 'medium' | 'high';
} {
  if (logs.length === 0) {
    return {
      diagnosis:
        'No matching server warning or error was recorded in the recent diagnostic window. The report was saved for review.',
      confidence: 'low',
    };
  }
  const errors = logs.filter((entry) => entry.level === 'error');
  const latest = errors[errors.length - 1] ?? logs[logs.length - 1];
  const message = latest?.message.replace(/\s+/g, ' ').trim() ?? 'Unknown server error';
  return {
    diagnosis: `Recent server activity indicates: ${message.slice(0, 300)}`,
    confidence: errors.length > 0 ? 'high' : 'medium',
  };
}

export async function submitIssue(input: SubmitIssueInput): Promise<{
  reportId: string;
  diagnosis: string;
  confidence: 'low' | 'medium' | 'high';
  evidenceCount: number;
}> {
  const occurredAt = input.occurredAt ?? new Date();
  const logs = getRecentDiagnosticLogs({
    userId: input.userId,
    tenantId: input.tenantId,
    since: new Date(occurredAt.getTime() - 10 * 60 * 1000),
    limit: 20,
  });
  const { diagnosis, confidence } = diagnoseIssue(logs);
  const reportId = `ISS-${nanoid(10).toUpperCase()}`;
  const { IssueReport } = createModels(mongoose);
  const evidence = logs.map(({ timestamp, level, message, requestId }) => ({
    timestamp,
    level,
    message,
    requestId,
  }));
  const report = await IssueReport.create({
    reportId,
    userId: input.userId,
    tenantId: input.tenantId,
    description: input.description,
    route: input.route,
    userAgent: input.userAgent,
    occurredAt,
    evidence,
    diagnosis,
    confidence,
  });

  /** Mongo stays the source of truth; GitHub is a mirror that happens to have a UI. */
  const filed = await fileIssue({
    reportId,
    userId: input.userId,
    description: input.description,
    route: input.route,
    userAgent: input.userAgent,
    occurredAt,
    diagnosis,
    confidence,
    evidence: logs,
  });
  if (filed) {
    try {
      await IssueReport.updateOne(
        { _id: report._id },
        { githubIssueNumber: filed.number, githubIssueUrl: filed.url },
      );
    } catch (error) {
      logger.error(`[issues] Filed ${reportId} as ${filed.url} but could not record it`, error);
    }
  }

  return { reportId, diagnosis, confidence, evidenceCount: logs.length };
}
