export type FitQuestion = { id: string; text: string; options: Array<{ id: string; text: string }> };
export type FitModule = { id: string; title: string; description: string; questions: FitQuestion[] };
export type SupportReview = { kind: "fits" | "sometimes" | "edit"; text: string };
export type FitSection = {
  id: string; title: string; summary: string; suggestion: string; answered: number; total: number; reviewable?: boolean;
  evidence: Array<{ questionId: string; question: string; answer: string; topic: string }>;
};
export type FitPairSection = {
  id: string; title: string; status: "same" | "mixed" | "different" | "unknown"; summary: string; suggestion: string;
  evidence: Array<{ questionId: string; question: string; mine: string; partner: string }>;
};
export type PersonalFitReport = { title: string; summary: string; introduction?: string; sections: FitSection[]; markers?: string[]; typeCode?: string | null; legend?: string[]; chapters?: Array<{ title: string; body: string }>; coverage: string };
export type FitState = {
  inventory: { submitted: boolean; previousLocked: boolean; questions: FitQuestion[]; previousPortrait?: PersonalFitReport | null; report: PersonalFitReport | null; preview: string[]; relationshipId: string | null; revisitIds: string[] };
  previousAnswers: Array<{ question: string; answer: string }>;
  modules: FitModule[];
  supportSharePreview: string[];
  profile: {
    version: number; answers: Record<string, string>; mbti: string | null; zodiac: string | null;
    sharing: boolean; canShare: boolean; shareMode: "four-v5" | "portrait-v3" | "pattern-v2" | "inventory" | "support" | "legacy" | "none"; supportReview: SupportReview | null; answeredCount: number; totalQuestions: number;
  };
  personal: PersonalFitReport | null;
  couple: {
    status: "unpaired" | "need-your-share" | "waiting" | "different-guides" | "ready"; partnerName: string; title?: string;
    summary: string; nextStep?: string; introduction?: string; sections: FitPairSection[];
    mbti?: { title: string; summary: string }; zodiac?: { title: string; summary: string };
  };
};
