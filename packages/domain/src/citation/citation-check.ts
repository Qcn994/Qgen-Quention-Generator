import { normalizeForCompare, type TextLanguage } from '../text/normalize.ts';

export type CitationProblem = 'out_of_range' | 'empty_range' | 'mismatch';

export type CitationCheckResult =
  | {
      readonly ok: true;
      readonly actual: string;
      readonly expected: string;
    }
  | {
      readonly ok: false;
      readonly problem: CitationProblem;
      readonly actual: string;
      readonly expected: string;
    };

export interface CitationInput {
  /** documents.normalized_text */
  readonly text: string;
  readonly charStart: number;
  readonly charEnd: number;
  /** 引用原文 */
  readonly quote: string;
  readonly language: TextLanguage;
}

/**
 * 引用坐标以 [charStart, charEnd) 为准，且必须落在 normalized_text 内。
 * 偏移一个字符即判失败——这正是我们想要的严格程度。
 */
export function checkCitation(input: CitationInput): CitationCheckResult {
  const expected = normalizeForCompare(input.quote, input.language);

  if (
    !Number.isInteger(input.charStart) ||
    !Number.isInteger(input.charEnd) ||
    input.charStart < 0 ||
    input.charEnd > input.text.length ||
    input.charStart > input.charEnd
  ) {
    return { ok: false, problem: 'out_of_range', actual: '', expected };
  }

  if (input.charStart === input.charEnd) {
    return { ok: false, problem: 'empty_range', actual: '', expected };
  }

  const actual = normalizeForCompare(
    input.text.slice(input.charStart, input.charEnd),
    input.language,
  );

  return actual === expected
    ? { ok: true, actual, expected }
    : { ok: false, problem: 'mismatch', actual, expected };
}
