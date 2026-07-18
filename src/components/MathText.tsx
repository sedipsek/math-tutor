import type { ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

/** $...$ / $$...$$ / \(...\) / \[...\] / \begin{...}...\end{...} */
const PATTERN =
  /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\\begin\{([a-zA-Z*]+)\}[\s\S]*?\\end\{\2\})/g;

function extractLatex(token: string): { latex: string; display: boolean } {
  if (token.startsWith("$$")) {
    return { latex: token.slice(2, -2), display: true };
  }
  if (token.startsWith("\\[")) {
    return { latex: token.slice(2, -2), display: true };
  }
  if (token.startsWith("\\(")) {
    return { latex: token.slice(2, -2), display: false };
  }
  if (token.startsWith("\\begin{")) {
    return { latex: token, display: true };
  }
  // $...$
  return { latex: token.slice(1, -1), display: false };
}

/** 수식 조각을 KaTeX로 렌더. 구분자 없는 \\begin{...}도 지원 */
export default function MathText({ children }: { children: string }) {
  const parts: ReactNode[] = [];
  let last = 0;

  for (const match of children.matchAll(PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(children.slice(last, index));

    const token = match[0];
    const { latex, display } = extractLatex(token);

    parts.push(
      <span
        key={index}
        className={display ? "math-display" : "math-inline"}
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(latex, {
            displayMode: display,
            throwOnError: false,
            output: "html",
            // LLM이 넣는 \\text{㉠} 같은 유니코드 허용
            strict: "ignore",
          }),
        }}
      />,
    );
    last = index + token.length;
  }

  if (last < children.length) parts.push(children.slice(last));
  return <>{parts}</>;
}
