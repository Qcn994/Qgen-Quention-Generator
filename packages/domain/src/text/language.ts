/**
 * 材料语言检测。决定题干模板与题型配比（计划第五节「语言与题型映射」）。
 * 中文材料出中文题、英文材料出英文题，不做翻译。
 */

export type MaterialLanguage = 'zh' | 'en';

/**
 * 汉字在「汉字 + 拉丁字母」中的占比阈值：>= 30% 判为中文。
 * 讲义里夹英文术语很常见，纯按「是否含汉字」判会误判；
 * 反过来英文教材里偶尔出现中文注释也不会翻转。
 */
export const HAN_RATIO_THRESHOLD = 0.3;

/**
 * 术语密集的中文材料（如全英术语授课的 PPT）汉字占比可能只剩几个百分点，
 * 单看比例会误判为英文。第二条件用「汉字绝对数 + 很低的占比」兜底：
 * 汉字 >= 300 且占比 >= 2% 仍判 zh。英文论文里零星的中文注释达不到 300 个。
 */
export const HAN_COUNT_THRESHOLD = 300;
export const HAN_RATIO_LOW_THRESHOLD = 0.02;

const HAN = /\p{Script=Han}/u;
const LETTER = /\p{Letter}/u;

export function detectLanguage(text: string): MaterialLanguage {
  let han = 0;
  let letters = 0;

  for (const char of text) {
    if (HAN.test(char)) {
      han += 1;
    } else if (LETTER.test(char)) {
      letters += 1;
    }
  }

  const total = han + letters;
  if (total === 0) {
    // 纯数字/符号材料没有语言信号；英文模板对这类内容更通用
    return 'en';
  }

  const ratio = han / total;
  if (ratio >= HAN_RATIO_THRESHOLD) {
    return 'zh';
  }
  if (han >= HAN_COUNT_THRESHOLD && ratio >= HAN_RATIO_LOW_THRESHOLD) {
    return 'zh';
  }
  return 'en';
}
