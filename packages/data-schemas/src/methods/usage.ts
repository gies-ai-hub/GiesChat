import type { FilterQuery, Model, PipelineStage } from 'mongoose';
import type { IConversation, IMessage } from '~/types';

/** Per-agent activity totals. Only agents with activity in the window are returned. */
export interface AgentUsageRow {
  agentId: string;
  conversationCount: number;
  userCount: number;
  messageCount: number;
  lastActivity: Date | null;
}

/** Per-student activity totals. Only students with activity in the window are returned. */
export interface StudentUsageRow {
  userId: string;
  conversationCount: number;
  messageCount: number;
  lastActivity: Date | null;
}

export interface AgentUsageScope {
  agentIds: string[];
  /** `null` means every user; `[]` means no user (an empty group). */
  userIds: string[] | null;
  since: Date;
}

export interface StudentUsageScope {
  agentId: string;
  /** `null` means every user; `[]` means no user (an empty group). */
  userIds: string[] | null;
  since: Date;
}

export interface AgentAnalyticsScope {
  agentIds: string[];
  /** `null` means every user; `[]` means no user (an empty group). */
  userIds: string[] | null;
  since: Date;
}

/**
 * Raw distributions, not presentation buckets. Bucket edges, medians, and day
 * zero-filling belong to the caller, where they can be read and tested without
 * a database.
 */
export interface AgentAnalyticsRaw {
  conversationCount: number;
  activeStudents: number;
  /** Students active on two or more distinct UTC days. */
  returningStudents: number;
  assistantMessageCount: number;
  erroredMessageCount: number;
  /** Conversations grouped by their student-turn count, ascending. */
  turnDistribution: { turns: number; conversations: number }[];
  /** Students grouped by how many conversations they held, ascending. */
  studentDistribution: { conversations: number; students: number }[];
  /** Conversations started per UTC day, ascending. Days with none are absent. */
  daily: { date: string; conversations: number }[];
}

export interface UsageMethods {
  aggregateAgentUsage(scope: AgentUsageScope): Promise<AgentUsageRow[]>;
  aggregateStudentUsage(scope: StudentUsageScope): Promise<StudentUsageRow[]>;
  aggregateAgentAnalytics(scope: AgentAnalyticsScope): Promise<AgentAnalyticsRaw>;
  /** Newest in-window student message texts across the scope. Text only — no ids. */
  sampleStudentMessages(scope: AgentAnalyticsScope, limit: number): Promise<string[]>;
}

const EMPTY_ANALYTICS: AgentAnalyticsRaw = {
  conversationCount: 0,
  activeStudents: 0,
  returningStudents: 0,
  assistantMessageCount: 0,
  erroredMessageCount: 0,
  turnDistribution: [],
  studentDistribution: [],
  daily: [],
};

/**
 * Messages authored by the student, not the assistant's replies: a reply is a
 * mechanical consequence of a prompt, so counting both only doubles the number
 * without adding signal about effort.
 */
const MESSAGE_COUNT = { $ifNull: [{ $arrayElemAt: ['$activity.count', 0] }, 0] };

/** Falls back to the conversation itself, which the `since` match already bounds. */
const LAST_ACTIVITY = { $ifNull: [{ $arrayElemAt: ['$activity.last', 0] }, '$updatedAt'] };

export function createUsageMethods(mongoose: typeof import('mongoose')): UsageMethods {
  /**
   * Matched conversations joined to their in-window student messages. One
   * round trip: the join runs inside the server, never per agent or per student.
   */
  function scopedActivityStages(
    agentFilter: FilterQuery<IConversation>,
    userIds: string[] | null,
    since: Date,
  ): PipelineStage[] {
    const match: FilterQuery<IConversation> = {
      ...agentFilter,
      isTemporary: { $ne: true },
      updatedAt: { $gte: since },
    };
    if (userIds !== null) {
      match.user = { $in: userIds };
    }

    /**
     * `$lookup` joins on a physical collection name, so the raw name is the only
     * thing that can be passed here. Reading it off the model keeps a renamed
     * collection from silently breaking the join. The join itself is outside
     * Mongoose middleware by construction, so it carries its own tenant
     * predicate: `conversationId` + `user` is unique only *per tenant*, which
     * makes the join key alone a UUID-collision bet rather than a boundary.
     * `tenantId` is optional on both schemas, so a message written before
     * tenancy inherits its conversation's tenant instead of being dropped.
     */
    // eslint-disable-next-line no-restricted-syntax
    const messageCollection = (mongoose.models.Message as Model<IMessage>).collection.name;

    return [
      { $match: match },
      {
        $lookup: {
          from: messageCollection,
          let: {
            conversationId: '$conversationId',
            user: '$user',
            tenantId: '$tenantId',
          },
          pipeline: [
            {
              $match: {
                isCreatedByUser: true,
                createdAt: { $gte: since },
                $expr: {
                  $and: [
                    { $eq: ['$conversationId', '$$conversationId'] },
                    { $eq: ['$user', '$$user'] },
                    { $eq: [{ $ifNull: ['$tenantId', '$$tenantId'] }, '$$tenantId'] },
                  ],
                },
              },
            },
            { $group: { _id: null, count: { $sum: 1 }, last: { $max: '$createdAt' } } },
          ],
          as: 'activity',
        },
      },
    ];
  }

  async function aggregateAgentUsage({
    agentIds,
    userIds,
    since,
  }: AgentUsageScope): Promise<AgentUsageRow[]> {
    if (agentIds.length === 0 || userIds?.length === 0) {
      return [];
    }

    const Conversation = mongoose.models.Conversation as Model<IConversation>;
    return Conversation.aggregate<AgentUsageRow>([
      ...scopedActivityStages({ agent_id: { $in: agentIds } }, userIds, since),
      {
        $group: {
          _id: '$agent_id',
          conversationCount: { $sum: 1 },
          users: { $addToSet: '$user' },
          messageCount: { $sum: MESSAGE_COUNT },
          lastActivity: { $max: LAST_ACTIVITY },
        },
      },
      {
        $project: {
          _id: 0,
          agentId: '$_id',
          conversationCount: 1,
          userCount: { $size: '$users' },
          messageCount: 1,
          lastActivity: 1,
        },
      },
    ]);
  }

  async function aggregateStudentUsage({
    agentId,
    userIds,
    since,
  }: StudentUsageScope): Promise<StudentUsageRow[]> {
    if (userIds?.length === 0) {
      return [];
    }

    const Conversation = mongoose.models.Conversation as Model<IConversation>;
    return Conversation.aggregate<StudentUsageRow>([
      ...scopedActivityStages({ agent_id: agentId }, userIds, since),
      {
        $group: {
          _id: '$user',
          conversationCount: { $sum: 1 },
          messageCount: { $sum: MESSAGE_COUNT },
          lastActivity: { $max: LAST_ACTIVITY },
        },
      },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          conversationCount: 1,
          messageCount: 1,
          lastActivity: 1,
        },
      },
    ]);
  }

  /**
   * Every dashboard panel comes from one traversal. The reply `$lookup` lands
   * before `$facet` so each branch reads already-joined counts instead of
   * re-joining messages per branch.
   */
  async function aggregateAgentAnalytics({
    agentIds,
    userIds,
    since,
  }: AgentAnalyticsScope): Promise<AgentAnalyticsRaw> {
    if (agentIds.length === 0 || userIds?.length === 0) {
      return EMPTY_ANALYTICS;
    }

    // eslint-disable-next-line no-restricted-syntax
    const messageCollection = (mongoose.models.Message as Model<IMessage>).collection.name;
    const Conversation = mongoose.models.Conversation as Model<IConversation>;

    const [result] = await Conversation.aggregate<AgentAnalyticsRaw>([
      ...scopedActivityStages({ agent_id: { $in: agentIds } }, userIds, since),
      {
        $lookup: {
          from: messageCollection,
          let: {
            conversationId: '$conversationId',
            user: '$user',
            tenantId: '$tenantId',
          },
          pipeline: [
            {
              $match: {
                isCreatedByUser: false,
                createdAt: { $gte: since },
                $expr: {
                  $and: [
                    { $eq: ['$conversationId', '$$conversationId'] },
                    { $eq: ['$user', '$$user'] },
                    { $eq: [{ $ifNull: ['$tenantId', '$$tenantId'] }, '$$tenantId'] },
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                errors: { $sum: { $cond: [{ $eq: ['$error', true] }, 1, 0] } },
              },
            },
          ],
          as: 'replies',
        },
      },
      {
        $addFields: {
          turns: MESSAGE_COUNT,
          replyCount: { $ifNull: [{ $arrayElemAt: ['$replies.count', 0] }, 0] },
          errorCount: { $ifNull: [{ $arrayElemAt: ['$replies.errors', 0] }, 0] },
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
        },
      },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                conversationCount: { $sum: 1 },
                users: { $addToSet: '$user' },
                assistantMessageCount: { $sum: '$replyCount' },
                erroredMessageCount: { $sum: '$errorCount' },
              },
            },
          ],
          turnDistribution: [
            { $group: { _id: '$turns', conversations: { $sum: 1 } } },
            { $project: { _id: 0, turns: '$_id', conversations: 1 } },
            { $sort: { turns: 1 } },
          ],
          studentDistribution: [
            { $group: { _id: '$user', conversations: { $sum: 1 } } },
            { $group: { _id: '$conversations', students: { $sum: 1 } } },
            { $project: { _id: 0, conversations: '$_id', students: 1 } },
            { $sort: { conversations: 1 } },
          ],
          daily: [
            { $group: { _id: '$day', conversations: { $sum: 1 } } },
            { $project: { _id: 0, date: '$_id', conversations: 1 } },
            { $sort: { date: 1 } },
          ],
          returning: [
            { $group: { _id: { user: '$user', day: '$day' } } },
            { $group: { _id: '$_id.user', days: { $sum: 1 } } },
            { $match: { days: { $gte: 2 } } },
            { $count: 'students' },
          ],
        },
      },
      {
        $project: {
          conversationCount: {
            $ifNull: [{ $arrayElemAt: ['$totals.conversationCount', 0] }, 0],
          },
          activeStudents: {
            $size: { $ifNull: [{ $arrayElemAt: ['$totals.users', 0] }, []] },
          },
          returningStudents: { $ifNull: [{ $arrayElemAt: ['$returning.students', 0] }, 0] },
          assistantMessageCount: {
            $ifNull: [{ $arrayElemAt: ['$totals.assistantMessageCount', 0] }, 0],
          },
          erroredMessageCount: {
            $ifNull: [{ $arrayElemAt: ['$totals.erroredMessageCount', 0] }, 0],
          },
          turnDistribution: 1,
          studentDistribution: 1,
          daily: 1,
        },
      },
    ]);

    return result ?? EMPTY_ANALYTICS;
  }

  async function sampleStudentMessages(
    { agentIds, userIds, since }: AgentAnalyticsScope,
    limit: number,
  ): Promise<string[]> {
    if (agentIds.length === 0 || userIds?.length === 0) {
      return [];
    }

    // eslint-disable-next-line no-restricted-syntax
    const messageCollection = (mongoose.models.Message as Model<IMessage>).collection.name;
    const Conversation = mongoose.models.Conversation as Model<IConversation>;

    const rows = await Conversation.aggregate<{ text: string }>([
      ...scopedActivityStages({ agent_id: { $in: agentIds } }, userIds, since),
      { $match: { 'activity.0': { $exists: true } } },
      {
        $lookup: {
          from: messageCollection,
          let: { conversationId: '$conversationId', user: '$user', tenantId: '$tenantId' },
          pipeline: [
            {
              $match: {
                isCreatedByUser: true,
                createdAt: { $gte: since },
                text: { $type: 'string', $ne: '' },
                $expr: {
                  $and: [
                    { $eq: ['$conversationId', '$$conversationId'] },
                    { $eq: ['$user', '$$user'] },
                    { $eq: [{ $ifNull: ['$tenantId', '$$tenantId'] }, '$$tenantId'] },
                  ],
                },
              },
            },
            { $project: { _id: 0, text: 1, createdAt: 1 } },
          ],
          as: 'studentMessages',
        },
      },
      { $unwind: '$studentMessages' },
      { $sort: { 'studentMessages.createdAt': -1 } },
      { $limit: limit },
      { $project: { _id: 0, text: '$studentMessages.text' } },
    ]);

    return rows.map((row) => row.text);
  }

  return {
    aggregateAgentUsage,
    aggregateStudentUsage,
    aggregateAgentAnalytics,
    sampleStudentMessages,
  };
}
