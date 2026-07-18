import type { ProblemSummary } from "../types";
import MathText from "./MathText";

type Props = {
  problem: ProblemSummary;
  unitLabel: string;
  onOpen: (id: string) => void;
};

export default function ProblemCard({ problem, unitLabel, onOpen }: Props) {
  return (
    <button className="problem-card" onClick={() => onOpen(problem.id)}>
      <div className="pc-body">
        <div className="pc-tags">
          <span className={`tag diff-${problem.difficulty}`}>
            {problem.difficulty}
          </span>
          <span className="tag dim">
            {problem.school.replace("학교", "")} {problem.grade}
          </span>
          <span className="tag">{unitLabel}</span>
          <span className="tag dim">{problem.semester}</span>
          <span className="tag dim">{problem.questionType}</span>
        </div>
        <p className="pc-preview">
          {problem.preview ? (
            <MathText>{problem.preview}</MathText>
          ) : (
            <span className="dim-text">이미지로 제시되는 문제</span>
          )}
        </p>
      </div>
      {problem.thumbnail && (
        <span className="pc-thumb">
          <img src={problem.thumbnail} alt="" loading="lazy" />
        </span>
      )}
    </button>
  );
}
