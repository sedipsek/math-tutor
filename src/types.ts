export type Counted<T extends string = string> = { value: T; count: number };

export type Meta = {
  total: number;
  schools: Array<Counted<"중학교" | "고등학교">>;
  grades: Array<{ school: string; value: string; count: number }>;
  subjects: Array<Counted>;
  units: Array<{
    code: string;
    label: string;
    school: string;
    grade: string;
    count: number;
  }>;
  topics: Array<{ code: string; label: string; unitCode: string; count: number }>;
  difficulties: Array<Counted<"하" | "중" | "상">>;
  semesters: Array<Counted<"1학기" | "2학기" | "공통">>;
  questionTypes: Array<Counted<"객관식" | "주관식">>;
};

export type Filters = {
  schools: string[];
  grades: string[];
  subjects: string[];
  units: string[];
  topics: string[];
  difficulties: string[];
  semesters: string[];
  questionTypes: string[];
  hasImage: boolean;
  q: string;
};

export const EMPTY_FILTERS: Filters = {
  schools: [],
  grades: [],
  subjects: [],
  units: [],
  topics: [],
  difficulties: [],
  semesters: [],
  questionTypes: [],
  hasImage: false,
  q: "",
};

/** 문제 풀 모드 */
export type Pool = "all" | "textbook" | "ai" | "mine";

export type AuthUser = {
  id: number;
  username: string;
  role: "student" | "admin";
};

export type ProblemSummary = {
  id: string;
  school: string;
  grade: string;
  subject: string;
  questionType: string;
  semester: string;
  difficulty: string;
  unitCode: string;
  topicCodes: string[];
  preview: string | null;
  thumbnail: string | null;
  publisher: string;
  generated?: boolean;
  origin?: "admin" | "user" | null;
};

export type ProblemList = {
  total: number;
  limit: number;
  offset: number;
  items: ProblemSummary[];
};

export type Choice = { marker: string; text: string; isAnswer: boolean };

export type ProblemContent = {
  stem: { texts: string[]; images: string[] };
  choices: Choice[] | null;
  answer: { texts: string[] };
  explanation: { texts: string[] };
};

export type ProblemDetail = {
  id: string;
  school: string;
  grade: string;
  subject: string;
  questionType: string;
  semester: string;
  difficulty: string;
  unitCode: string;
  unitLabel: string;
  topics: Array<{ code: string; label: string }>;
  publisher: string;
  sourcedAt: string;
  publicationYear: string;
  revisionYear: string;
  content: ProblemContent;
  /** LLM 생성 문제일 때 true */
  generated?: boolean;
  origin?: "admin" | "user" | null;
  sourceProblemId?: string;
  model?: string;
  createdAt?: string;
};

export type GeneratedSummary = {
  id: string;
  preview: string;
  difficulty: string;
  questionType: string;
  model: string;
  createdAt: string;
  school?: string;
  grade?: string;
  unitCode?: string;
  unitLabel?: string;
  origin?: "admin" | "user";
  generated?: boolean;
};

export type GeneratedList = {
  total: number;
  items: GeneratedSummary[];
  limit?: number;
  offset?: number;
};

export type AlternateExplanation = {
  id: string;
  problemId: string;
  slot: number;
  methodLabel: string;
  body: string;
  model: string;
  createdAt: string;
};
