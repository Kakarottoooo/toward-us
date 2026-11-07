export type GraphRecord = {
  id: string; relationshipId: string | null; createdByUserId: string; ownerUserId: string; visibility: string; status: string;
  version: number; createdAt: string; updatedAt: string; title?: string; [key: string]: unknown;
};

export type RelationshipGraph = {
  privateAgentThreads: GraphRecord[]; memories: GraphRecord[]; checkins: GraphRecord[];
  milestones: GraphRecord[]; reminders: GraphRecord[]; lists: GraphRecord[]; listItems: GraphRecord[]; issues: GraphRecord[];
  perspectives: GraphRecord[]; summaries: GraphRecord[]; proposals: GraphRecord[]; evaluations: GraphRecord[]; agreements: GraphRecord[];
  approvals: GraphRecord[]; commitments: GraphRecord[]; outcomes: GraphRecord[]; outcomeResponses: GraphRecord[]; notifications: GraphRecord[];
  consentEvents: GraphRecord[]; productEvents: GraphRecord[];
};

/** 连续一起来: days in a row both came by, and who has come by today (server/streak.mjs). */
export type CoupleStreak = { days: number; me: boolean; partner: boolean };

export type RelationshipHomePayload = {
  relationship: { id: string; members: Array<{ id: string; name: string; role: "A" | "B" }> };
  home: { pending: Array<{ type: string; id: string; title: string }>; upcoming: Array<{ type: string; id: string; title: string; at: string }>; plans: Array<{ type: string; id: string; title: string; status: string; dueAt?: string }>; recentMoment: null; notifications: GraphRecord[] };
  graph: RelationshipGraph;
  capabilities: Record<string, boolean>;
  streak?: CoupleStreak | null;
};

export type IssueDetail = { issue: GraphRecord; perspectives: GraphRecord[]; summaries: GraphRecord[]; proposals: GraphRecord[]; evaluations: GraphRecord[]; evaluationCounts: Record<string, number>; agreements: GraphRecord[] };
