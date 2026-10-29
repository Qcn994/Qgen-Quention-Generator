import type {
  Attempt,
  Chunk,
  KnowledgePoint,
  Question,
  QuestionStatus,
} from '@qgen/domain';

/**
 * D2 的内容仓库端口。实现留给 infrastructure（D3 接入流水线时落地），
 * 用例层从现在起只依赖这些接口，不知道 SQLite 的存在。
 */

export interface ChunkRepository {
  saveMany(chunks: readonly Chunk[]): Promise<void>;
  listByMaterial(materialId: string): Promise<Chunk[]>;
}

export interface KnowledgePointRepository {
  saveMany(knowledgePoints: readonly KnowledgePoint[]): Promise<void>;
  listByMaterial(materialId: string): Promise<KnowledgePoint[]>;
}

export interface QuestionRepository {
  create(question: Question): Promise<void>;
  findById(id: string): Promise<Question | null>;
  listByMaterial(materialId: string): Promise<Question[]>;
  /** 状态流转与版本递增由领域状态机决定，仓库只负责持久化结果 */
  updateStatus(id: string, status: QuestionStatus, version: number): Promise<void>;
}

export interface AttemptRepository {
  create(attempt: Attempt): Promise<void>;
  listByQuestion(questionId: string): Promise<Attempt[]>;
}
