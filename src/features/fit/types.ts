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
export type FitState = {
  previousAnswers: Array<{ question: string; answer: string }>;
  modules: FitModule[];
  supportSharePreview: string[];
  profile: {
    version: number; answers: Record<string, string>; mbti: string | null; zodiac: string | null;
    sharing: boolean; canShare: boolean; shareMode: "support" | "legacy" | "none"; supportReview: SupportReview | null; answeredCount: number; totalQuestions: number;
  };
  personal: { title: string; summary: string; sections: FitSection[]; coverage: string } | null;
  couple: {
    status: "unpaired" | "need-your-share" | "waiting" | "different-guides" | "ready"; partnerName: string;
    summary: string; sections: FitPairSection[];
    mbti?: { title: string; summary: string }; zodiac?: { title: string; summary: string };
  };
};
