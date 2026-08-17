import { Schema } from 'mongoose';
import type { IIssueReport } from '~/types';

const issueEvidenceSchema = new Schema(
  {
    timestamp: { type: String, required: true },
    level: { type: String, required: true },
    message: { type: String, required: true },
    requestId: String,
  },
  { _id: false },
);

const issueReportSchema: Schema<IIssueReport> = new Schema<IIssueReport>(
  {
    reportId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId: { type: String, index: true },
    description: { type: String, required: true },
    route: String,
    userAgent: String,
    occurredAt: { type: Date, required: true },
    evidence: { type: [issueEvidenceSchema], default: [] },
    diagnosis: { type: String, required: true },
    confidence: { type: String, enum: ['low', 'medium', 'high'], required: true },
    githubIssueNumber: Number,
    githubIssueUrl: String,
  },
  { timestamps: true },
);

issueReportSchema.index({ userId: 1, createdAt: -1 });

export default issueReportSchema;
