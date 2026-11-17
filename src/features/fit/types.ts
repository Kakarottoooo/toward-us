export type FitQuestion = { id: string; text: string; options: Array<{ id: string; text: string }> };
export type FitModule = { id: string; title: string; description: string; questions: FitQuestion[] };
export type FitSection = {
  id: string; title: string; summary: string; suggestion: string; answered: number; total: number;
  evidence: Array<{ questionId: string; question: string; answer: string; meaning: string }>;
};
export type FitPairSection = {
  id: string; title: string; status: "same" | "mixed" | "different" | "unknown"; summary: string; suggestion: string;
  evidence: Array<{ questionId: string; question: string; mine: string; partner: string }>;
};
export type FitState = {
  modules: FitModule[];
  profile: {
    version: number; answers: Record<string, string>; mbti: string | null; zodiac: string | null;
    sharing: boolean; answeredCount: number; totalQuestions: number;
  };
  personal: { title: string; summary: string; sections: FitSection[]; coverage: string } | null;
  couple: {
    status: "unpaired" | "need-your-share" | "waiting" | "ready"; partnerName: string;
    summary: string; sections: FitPairSection[];
    mbti?: { title: string; summary: string }; zodiac?: { title: string; summary: string };
  };
};
