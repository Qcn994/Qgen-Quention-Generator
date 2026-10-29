import type { Question } from '../question/question.ts';

export interface GradeResult {
  /** 多选在 M0 固定"全对才得分" */
  readonly correct: boolean;
  readonly score: number;
  readonly missing: readonly string[];
  readonly wrong: readonly string[];
}

/**
 * 判分是纯函数：同样的题面与作答永远得到同样的结果。
 * 部分给分属于考试画像配置，M0 不存在，因此这里硬编码全对全错。
 */
export function gradeObjective(
  question: Pick<Question, 'answer'>,
  response: readonly string[],
): GradeResult {
  const correctSet = new Set(question.answer);
  const responseSet = new Set(response);

  const missing = [...correctSet].filter((id) => !responseSet.has(id));
  const wrong = [...responseSet].filter((id) => !correctSet.has(id));
  const correct = missing.length === 0 && wrong.length === 0;

  return {
    correct,
    score: correct ? 1 : 0,
    missing,
    wrong,
  };
}
