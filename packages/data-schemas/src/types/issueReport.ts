import type { Document, Types } from 'mongoose';

export type IssueEvidence = {
  timestamp: string;
  level: string;
  message: string;
  requestId?: string;
};

export type IssueReport = {
  reportId: string;
  userId: Types.ObjectId;
  tenantId?: string;
  description: string;
  route?: string;
  userAgent?: string;
  occurredAt: Date;
  evidence: IssueEvidence[];
  diagnosis: string;
  confidence: 'low' | 'medium' | 'high';
  githubIssueNumber?: number;
  githubIssueUrl?: string;
};

export type IIssueReport = IssueReport &
  Document & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date };
