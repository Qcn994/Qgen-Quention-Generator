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
 * 汉字 >= 300 且占比 >= 2% 才算候选。
 */
export const HAN_COUNT_THRESHOLD = 300;
export const HAN_RATIO_LOW_THRESHOLD = 0.02;

/**
 * 第三条件（K3 D3 复审 Major 5）：第二条件单用会误判「正文英文、夹中文批注」的材料——
 * 1013 是英文期刊，汉字 979 个 / 占比 2.31% 却命中 300 + 2%，出了 18 道中文题。
 * 区分信号是开篇：中文授课 PPT 开篇就是中文（实测前 2000 字内 127 个汉字），
 * 英文论文正文开篇几乎无汉字（同窗口 4 个）。故第三条件只看开头这段窗口。
 *
 * 已知失效场景（启发式不完备，靠 --lang / 上传 languageOverride 兜底）：
 * 英文论文前面贴中文封面或中文摘要页时会被判 zh。
 */
export const HAN_HEAD_WINDOW = 2000;
export const HAN_HEAD_MIN = 50;

const HAN = /\p{Script=Han}/u;
const LETTER = /\p{Letter}/u;

function countHan(text: string): number {
  let han = 0;
  for (const char of text) {
    if (HAN.test(char)) {
      han += 1;
    }
  }
  return han;
}

/** 前 2000 字符内的汉字数，用于第三条件与报告展示 */
export function countHanInHead(text: string, window = HAN_HEAD_WINDOW): number {
  return countHan(text.slice(0, window));
}

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
    // 只在第二条件成立时看开篇：PPT 形态开篇即中文，英文论文夹中文批注则不是
    return countHanInHead(text) >= HAN_HEAD_MIN ? 'zh' : 'en';
  }
  return 'en';
}
