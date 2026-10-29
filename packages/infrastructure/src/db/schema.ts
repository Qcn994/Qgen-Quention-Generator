import {
  MATERIAL_STATUSES,
  QUESTION_STATUSES,
  QUESTION_TYPES,
  type DocumentPage,
  type ExamFrequency,
  type GradedBy,
  type MisconceptionSeverity,
  type QuestionOption,
  type SourceRole,
} from '@qgen/domain';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/**
 * M0 的表结构。枚举一律从 domain 派生（K3 第四轮 Nit 1），不在 schema 里重写一份。
 * 表随交付物逐步加入：materials / processing_jobs / llm_cache 属 D1；
 * documents、题目、知识点、切块、作答、复习卡属 D2；paper / organization 等属 M2。
 */

export const materials = sqliteTable('materials', {
  id: text('id').primaryKey(),
  fileName: text('file_name').notNull(),
  sourceType: text('source_type').notNull(),
  contentHash: text('content_hash'),
  pageCount: integer('page_count'),
  charCount: integer('char_count'),
  status: text('status', { enum: MATERIAL_STATUSES }).notNull().default('uploaded'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const processingJobs = sqliteTable(
  'processing_jobs',
  {
    id: text('id').primaryKey(),
    materialId: text('material_id')
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
      .notNull()
      .default('pending'),
    progress: integer('progress').notNull().default(0),
    attempt: integer('attempt').notNull().default(0),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('idx_jobs_status_created').on(table.status, table.createdAt),
    uniqueIndex('uq_jobs_material_stage').on(table.materialId, table.stage),
  ],
);

/**
 * 引用坐标系（计划第三节）：chunks 的 [char_start, char_end) 切的就是这里存的 normalized_text。
 * 归一化版本变化时旧区间失效，所以版本号与文本一起持久化；
 * 同一材料的不同归一化版本可并存（只读保留），(materialId, version) 唯一。
 * 仓储实现留给 D3 的解析/归一化阶段。
 */
export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    materialId: text('material_id')
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    normalizedText: text('normalized_text').notNull(),
    normalizationVersion: text('normalization_version').notNull(),
    pages: text('pages', { mode: 'json' }).$type<readonly DocumentPage[]>().notNull().default([]),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('uq_documents_material_version').on(table.materialId, table.normalizationVersion)],
);

export const chunks = sqliteTable(
  'chunks',
  {
    id: text('id').primaryKey(),
    materialId: text('material_id')
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    headingPath: text('heading_path', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** 跨用户缓存键；M0 不做 embedding，只用 simhash 去重 */
    contentHash: text('content_hash'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_chunks_material_ordinal').on(table.materialId, table.ordinal),
    index('idx_chunks_content_hash').on(table.contentHash),
  ],
);

export const knowledgePoints = sqliteTable(
  'knowledge_points',
  {
    id: text('id').primaryKey(),
    materialId: text('material_id')
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => knowledgePoints.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    canonicalName: text('canonical_name').notNull(),
    summary: text('summary').notNull(),
    importance: integer('importance').notNull(),
    difficulty: integer('difficulty').notNull().default(3),
    examFrequency: text('exam_frequency', {
      enum: ['low', 'medium', 'high'],
    })
      .$type<ExamFrequency>()
      .notNull()
      .default('medium'),
    chunkIds: text('chunk_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    evidenceQuotes: text('evidence_quotes', { mode: 'json' }).$type<string[]>().notNull().default([]),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_kp_material').on(table.materialId, table.importance)],
);

export const misconceptions = sqliteTable(
  'misconceptions',
  {
    id: text('id').primaryKey(),
    kpId: text('kp_id')
      .notNull()
      .references(() => knowledgePoints.id, { onDelete: 'cascade' }),
    statement: text('statement').notNull(),
    whyTempting: text('why_tempting').notNull(),
    correctContrast: text('correct_contrast').notNull(),
    severity: text('severity', { enum: ['low', 'medium', 'high'] })
      .$type<MisconceptionSeverity>()
      .notNull()
      .default('medium'),
    evidence: text('evidence', { mode: 'json' }).$type<string[]>().notNull().default([]),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_misconception_kp').on(table.kpId)],
);

export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    materialId: text('material_id')
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    type: text('type', { enum: QUESTION_TYPES }).notNull(),
    stem: text('stem').notNull(),
    options: text('options', { mode: 'json' }).$type<QuestionOption[]>().notNull(),
    answer: text('answer', { mode: 'json' }).$type<string[]>().notNull(),
    explanation: text('explanation').notNull().default(''),
    difficultyEst: integer('difficulty_est').notNull().default(3),
    difficultyEmpirical: real('difficulty_empirical'),
    primaryKpId: text('primary_kp_id')
      .notNull()
      .references(() => knowledgePoints.id, { onDelete: 'cascade' }),
    kpIds: text('kp_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    status: text('status', { enum: QUESTION_STATUSES }).notNull().default('candidate'),
    version: integer('version').notNull().default(1),
    stemHash: text('stem_hash'),
    simhash: text('simhash'),
    duplicateOf: text('duplicate_of'),
    /** 生成时的 model / prompt_version / seed；发布后不可变 */
    generationMeta: text('generation_meta', { mode: 'json' })
      .$type<Record<string, string | number>>()
      .notNull()
      .default({}),
    /** sha256(idempotencyKeyMaterial)；seed 不在其中 */
    idempotencyKey: text('idempotency_key'),
    parentQuestionId: text('parent_question_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_questions_idempotency_key').on(table.idempotencyKey),
    index('idx_questions_material_status').on(table.materialId, table.status),
    index('idx_questions_primary_kp').on(table.primaryKpId),
    index('idx_questions_stem_hash').on(table.stemHash),
    index('idx_questions_simhash').on(table.simhash),
  ],
);

export const questionSourceRefs = sqliteTable(
  'question_source_refs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    chunkId: text('chunk_id')
      .notNull()
      .references(() => chunks.id, { onDelete: 'cascade' }),
    quote: text('quote').notNull(),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    pageNo: integer('page_no').notNull(),
    role: text('role', { enum: ['answer_basis', 'distractor_basis', 'context'] })
      .$type<SourceRole>()
      .notNull(),
  },
  (table) => [index('idx_source_refs_question').on(table.questionId)],
);

export const questionChecks = sqliteTable(
  'question_checks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    severity: text('severity', { enum: ['hard', 'soft'] }).notNull(),
    passed: integer('passed', { mode: 'boolean' }).notNull(),
    score: real('score'),
    model: text('model'),
    detail: text('detail'),
    details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
    checkedAt: integer('checked_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_checks_question').on(table.questionId, table.severity)],
);

export const attempts = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    /** M0 单用户为 null；M1 多用户后填 user_id */
    userId: text('user_id'),
    response: text('response', { mode: 'json' }).$type<string[]>().notNull(),
    correct: integer('correct', { mode: 'boolean' }).notNull(),
    score: real('score').notNull(),
    missing: text('missing', { mode: 'json' }).$type<string[]>().notNull().default([]),
    wrong: text('wrong', { mode: 'json' }).$type<string[]>().notNull().default([]),
    gradedBy: text('graded_by', { enum: ['rule', 'llm', 'self', 'teacher'] })
      .$type<GradedBy>()
      .notNull()
      .default('rule'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_attempts_question_created').on(table.questionId, table.createdAt)],
);

export const reviewCards = sqliteTable(
  'review_cards',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    /** M0 用 1/3/7/15 的固定档位索引 */
    intervalIndex: integer('interval_index').notNull().default(0),
    dueAt: integer('due_at', { mode: 'timestamp_ms' }).notNull(),
    consecutiveCorrect: integer('consecutive_correct').notNull().default(0),
    graduated: integer('graduated', { mode: 'boolean' }).notNull().default(false),
    /** FSRS 预留字段：M1 换算法时不改表结构 */
    stability: real('stability'),
    difficulty: real('difficulty'),
    lapses: integer('lapses').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_review_due').on(table.graduated, table.dueAt)],
);

export const llmCache = sqliteTable('llm_cache', {
  /** sha256(model|prompt_version|temp|messages) */
  key: text('key').primaryKey(),
  model: text('model').notNull(),
  response: text('response').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
