/**
 * 合并人工复核表（K3 D3 复审 Q5）。
 *
 *   pnpm review-sheet [--from <data/evals>] [--out <dir>]
 *
 * 扫描 `data/evals/` 下每个材料目录（同名材料取 mtime 最新的一份），把题目按发布结论
 * 分成两组，各出一份可打印的 Markdown：
 *   auto-published.md   自动发布题——第十一节门槛 10/11 的人审输入
 *   needs-review.md     待复核题——复核界面未上线前的预读清单
 *
 * 只读产物、不调模型。产物落在 `data/`（已 gitignore），不把题目正文提交进仓库。
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { REPO_ROOT } from '@qgen/config';

import type { QuestionRecord, SpikeStats } from './pipeline/spike.ts';

const TYPE_LABEL: Record<string, string> = {
  single_choice: '单选',
  multiple_choice: '多选',
  true_false: '判断',
};

interface DocumentMeta {
  readonly material: string;
  readonly pageCount: number;
  readonly charCount: number;
  readonly language: string;
  readonly detectedLanguage?: string;
  readonly strippedEdgeLines?: readonly string[];
}

interface MaterialBundle {
  readonly dir: string;
  readonly name: string;
  readonly meta: DocumentMeta;
  readonly stats: SpikeStats;
  readonly questions: readonly QuestionRecord[];
}

function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cell(value: string): string {
  return flatten(value).replace(/\|/g, '\\|');
}

function truncate(value: string, max: number): string {
  const flat = flatten(value);
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

async function loadBundle(dir: string): Promise<MaterialBundle | null> {
  try {
    const [metaRaw, statsRaw, questionsRaw] = await Promise.all([
      readFile(resolve(dir, 'document.json'), 'utf8'),
      readFile(resolve(dir, 'stats.json'), 'utf8'),
      readFile(resolve(dir, 'questions.json'), 'utf8'),
    ]);
    return {
      dir,
      name: basename(dir),
      meta: JSON.parse(metaRaw) as DocumentMeta,
      stats: JSON.parse(statsRaw) as SpikeStats,
      questions: JSON.parse(questionsRaw) as QuestionRecord[],
    };
  } catch {
    return null;
  }
}

async function collect(fromDir: string): Promise<{ bundles: MaterialBundle[]; stale: string[] }> {
  const entries = await readdir(fromDir, { withFileTypes: true });
  const latest = new Map<string, { dir: string; mtime: number }>();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    // 合成样本（sample-* / d3-*）不是人审对象，别混进复核表
    if (/^(sample-|d3-)/.test(entry.name)) {
      continue;
    }
    const dir = resolve(fromDir, entry.name);
    try {
      const info = await stat(resolve(dir, 'stats.json'));
      // 同名材料可能有多个目录（归一化版本不同），只取最新的一份
      const key = basename(entry.name).replace(/-[0-9a-f]{8}$/, '');
      const current = latest.get(key);
      if (!current || info.mtimeMs > current.mtime) {
        latest.set(key, { dir, mtime: info.mtimeMs });
      }
    } catch {
      // 没有 stats.json 的目录（parse-only / 中断）跳过
    }
  }

  const bundles: MaterialBundle[] = [];
  const stale: string[] = [];
  for (const { dir } of [...latest.values()].sort((a, b) => a.dir.localeCompare(b.dir))) {
    // 解析产物（document.json）比 stats.json 新 = 上次运行跑到一半被中断，
    // 目录里是"新文档 + 旧题目"的混合体，不能拿去人审
    const [docStat, statsStat] = await Promise.all([
      stat(resolve(dir, 'document.json')),
      stat(resolve(dir, 'stats.json')),
    ]);
    if (docStat.mtimeMs - statsStat.mtimeMs > 1000) {
      stale.push(basename(dir));
      continue;
    }
    const bundle = await loadBundle(dir);
    if (bundle) {
      bundles.push(bundle);
    }
  }
  return { bundles, stale };
}

interface Row {
  readonly material: string;
  readonly record: QuestionRecord;
  readonly index: number;
}

function questionRow(row: Row): string {
  const { record, material } = row;
  const question = record.question;
  const options = question.options
    .map((option) => `${option.id}.${question.answer.includes(option.id) ? '✅' : ''}${truncate(option.text, 60)}`)
    .join('；');
  const ref = question.sourceRefs[0];
  const citation = ref
    ? `「${truncate(ref.quote, 50)}」p.${ref.pageNo} [${ref.charStart},${ref.charEnd})`
    : '（无）';
  const hardFailures = record.checks
    .filter((check) => check.severity === 'hard' && !check.passed)
    .map((check) => check.type);
  const softLow = record.checks
    .filter((check) => check.severity === 'soft' && (check.score ?? 0) < 0.75)
    .map((check) => `${check.type}=${(check.score ?? 0).toFixed(2)}`);
  const checks =
    [...hardFailures.map((type) => `硬失败:${type}`), ...softLow].join('；') || '全部通过';

  const cells = [
    cell(material),
    String(row.index + 1),
    TYPE_LABEL[question.type] ?? question.type,
    String(question.difficultyEst),
    cell(record.kpName),
    cell(truncate(question.stem, 70)),
    cell(options),
    question.answer.join(''),
    cell(truncate(question.explanation, 90)),
    cell(citation),
    cell(checks),
    '',
    '',
    '',
  ];
  return `| ${cells.join(' | ')} |`;
}

function materialHeader(bundle: MaterialBundle): string {
  const { meta, stats } = bundle;
  const stripped = meta.strippedEdgeLines ?? [];
  return [
    `### ${bundle.name}`,
    '',
    `- 材料：\`${meta.material}\``,
    `- 语言：${meta.language}${
      meta.detectedLanguage && meta.detectedLanguage !== meta.language
        ? `（人工覆盖，启发式判定 ${meta.detectedLanguage}）`
        : `（启发式判定）`
    }；页数 ${meta.pageCount}；字符 ${meta.charCount}`,
    `- 生成 ${stats.generated} · 自动发布 ${stats.autoPassed} · 待复核 ${stats.needsReview} · 失败 ${stats.failed}`,
    `- 已剥离的跨页重复首尾行：${stripped.length === 0 ? '（无）' : stripped.map((line) => `\`${line}\``).join('、')}`,
    '',
    '材料级复核（填在下面两行）：',
    '',
    '| 检查项 | 门槛 | 实测 | 结论（Y/N） | 备注 |',
    '|---|---|---|---|---|',
    '| 文字层字符提取准确率 | ≥98% | 待人工逐字对照 `normalized.txt` |  |  |',
    '| 切块边界合理（不切句/表） | ≥95% | 见 `review.md` |  |  |',
    '',
  ].join('\n');
}

function buildSheet(bundles: readonly MaterialBundle[], autoPublished: boolean): string {
  const rows: Row[] = [];
  for (const bundle of bundles) {
    bundle.questions
      .map((record, index) => ({ material: bundle.name, record, index }))
      .filter((row) => row.record.decision.canPublish === autoPublished)
      .forEach((row) => rows.push(row));
  }

  const title = autoPublished
    ? '# 自动发布题人工复核表（门槛 10/11 的人审输入）'
    : '# 待复核题预读清单（复核界面未上线前）';

  const intro = autoPublished
    ? [
        `> 共 **${rows.length}** 道自动发布的题。逐题判断：**可以直接给学生做吗？**`,
        '> 判定列：`可直接使用` 填 Y/N；`硬错误分类` 用 `wrong_key / ambiguous / multiple_defensible / unsupported_explanation / bad_distractor / trivial / formatting`。',
        '> 门槛：可直接使用率 ≥70%，硬错误率 ≤5%。未达标 → 不铺开 M0-2 业务页面（K3 D3 复审 Q3）。',
      ]
    : [
        `> 共 **${rows.length}** 道待复核题。M0-2 复核界面做好后逐题处理；本表用于提前预读与挑出明显问题。`,
        '> 判定列同样可用：`可直接使用` 填 Y/N；`硬错误分类` 同上。',
      ];

  const header =
    '| 材料 | # | 题型 | 难度 | 知识点 | 题干 | 选项（✅=答案） | 答案 | 解析（截断） | 引用 + 页码 + 偏移 | 校验摘要 | 可直接使用 | 硬错误分类 | 备注 |';
  const divider = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';

  return [
    title,
    '',
    ...intro,
    '',
    `本文件共 ${rows.length} 道（${autoPublished ? '自动发布' : '待复核'}）。`,
    '',
    '---',
    '',
    ...bundles.flatMap((bundle) => [materialHeader(bundle), '']),
    '---',
    '',
    header,
    divider,
    ...rows.map(questionRow),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === '--') {
    argv.shift();
  }
  const { values } = parseArgs({
    args: argv,
    options: { from: { type: 'string' }, out: { type: 'string' } },
  });

  const fromDir = resolve(values.from ?? resolve(REPO_ROOT, 'data', 'evals'));
  const outDir = resolve(values.out ?? resolve(fromDir, 'manual-review'));
  const { bundles, stale } = await collect(fromDir);

  if (bundles.length === 0) {
    throw new Error(`${fromDir} 下没有可用的评测产物（缺 document.json / stats.json / questions.json）`);
  }

  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const auto = buildSheet(bundles, true);
  const review = buildSheet(bundles, false);

  await Promise.all([
    writeFile(resolve(outDir, `${stamp}-auto-published.md`), auto, 'utf8'),
    writeFile(resolve(outDir, `${stamp}-needs-review.md`), review, 'utf8'),
  ]);

  if (stale.length > 0) {
    console.warn(`[review-sheet] 跳过 ${stale.length} 份被中断的运行（document.json 比 stats.json 新）：${stale.join('、')}`);
  }

  const total = bundles.reduce((sum, bundle) => sum + bundle.questions.length, 0);
  const autoCount = bundles.reduce((sum, bundle) => sum + bundle.questions.filter((q) => q.decision.canPublish).length, 0);
  console.log(`[review-sheet] 材料 ${bundles.length} 份 / 题 ${total} 道 → 自动发布 ${autoCount} · 待复核 ${total - autoCount}`);
  console.log(`[review-sheet] 产物：${outDir}`);
}

main().catch((error: unknown) => {
  console.error(`[review-sheet] 失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
