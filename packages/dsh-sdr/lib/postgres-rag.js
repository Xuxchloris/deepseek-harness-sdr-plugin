import { createHash } from "node:crypto";
import { defaultReranker, HybridRagRetriever, splitIntoChunks } from "./rag.js";

export const POSTGRES_RAG_SCHEMA = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS sdr_knowledge (
  knowledge_id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('product', 'brand', 'policy', 'case', 'market', 'company')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'pending', 'archived')),
  embedding vector,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sdr_knowledge_chunk (
  chunk_id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES sdr_knowledge(knowledge_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  content TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sdr_knowledge_fts_idx
  ON sdr_knowledge USING gin (to_tsvector('simple', title || ' ' || content || ' ' || array_to_string(tags, ' ') || ' ' || source));
CREATE INDEX IF NOT EXISTS sdr_knowledge_title_trgm_idx
  ON sdr_knowledge USING gin (title gin_trgm_ops);
-- Create a pgvector HNSW/IVFFlat index after choosing the deployed embedding dimension.
`;

function normalizeIdPart(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function stableKnowledgeId(type, title, source) {
  return `know_${createHash("sha256").update(`${type}|${normalizeIdPart(title)}|${normalizeIdPart(source)}`).digest("hex").slice(0, 16)}`;
}

function vectorLiteral(vector) {
  if (!Array.isArray(vector) || !vector.length) return null;
  if (vector.some((value) => !Number.isFinite(Number(value)))) throw new Error("embedding 必须是数字向量");
  return `[${vector.map(Number).join(",")}]`;
}

function parseVector(value) {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number) : undefined;
  } catch {
    return undefined;
  }
}

function publicRecord(row) {
  return {
    knowledge_id: row.knowledge_id,
    type: row.type,
    title: row.title,
    content: row.content,
    tags: row.tags || [],
    source: row.source,
    version: Number(row.version),
    status: row.status,
    chunk_count: Number(row.chunk_count || 0),
    updated_at: new Date(row.updated_at).toISOString(),
    updated_by: row.updated_by,
  };
}

/**
 * PostgreSQL/pgvector adapter. `pg` is deliberately not a package dependency;
 * callers inject a compatible pool, keeping the DSH demo zero-credential.
 */
export class PostgresKnowledgeRepository {
  constructor({ pool, embedder = null, reranker = defaultReranker, clock = () => new Date().toISOString() } = {}) {
    if (!pool || typeof pool.query !== "function") throw new TypeError("PostgresKnowledgeRepository 需要兼容 pg 的 pool");
    this.pool = pool;
    this.clock = clock;
    this.retriever = new HybridRagRetriever({ embedder, reranker });
  }

  async ensureSchema() {
    await this.pool.query(POSTGRES_RAG_SCHEMA);
    return { ready: true, backend: "postgresql", vector: "pgvector", fulltext: "tsvector", vector_index: "configure after choosing embedding dimension" };
  }

  async upsert({ type, title, content, tags = [], source, actor = "dsh-user", embedding } = {}) {
    if (!type || !title || !content || !source) throw new Error("knowledge type/title/content/source 不能为空");
    const generatedEmbedding = embedding || (this.retriever.embedder?.embed ? await this.retriever.embedder.embed(`${title}\n${content}`) : undefined);
    const id = stableKnowledgeId(type, title, source);
    const vector = vectorLiteral(generatedEmbedding);
    const existing = await this.pool.query("SELECT version FROM sdr_knowledge WHERE knowledge_id = $1", [id]);
    const version = Number(existing.rows[0]?.version || 0) + 1;
    const updatedAt = this.clock();
    const result = await this.pool.query(
      `INSERT INTO sdr_knowledge (knowledge_id, type, title, content, tags, source, version, status, embedding, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', $8::vector, $9, $10)
       ON CONFLICT (knowledge_id) DO UPDATE SET type = EXCLUDED.type, title = EXCLUDED.title, content = EXCLUDED.content,
         tags = EXCLUDED.tags, source = EXCLUDED.source, version = EXCLUDED.version, status = 'approved',
         embedding = EXCLUDED.embedding, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
       RETURNING knowledge_id, type, title, content, tags, source, version, status, updated_at, updated_by`,
      [id, type, title, content, tags, source, version, vector, updatedAt, actor],
    );
    await this.pool.query("DELETE FROM sdr_knowledge_chunk WHERE knowledge_id = $1", [id]);
    for (const chunk of splitIntoChunks(content)) {
      await this.pool.query("INSERT INTO sdr_knowledge_chunk (chunk_id, knowledge_id, ordinal, content) VALUES ($1, $2, $3, $4)", [chunk.chunk_id, id, chunk.ordinal, chunk.content]);
    }
    return { ...publicRecord({ ...result.rows[0], chunk_count: splitIntoChunks(content).length }) };
  }

  async search(query, { types = [], limit = 5, candidateLimit = 40 } = {}) {
    const queryEmbedding = this.retriever.embedder?.embed ? await this.retriever.embedder.embed(String(query || "")) : undefined;
    const vector = vectorLiteral(queryEmbedding);
    const typeFilter = Array.isArray(types) && types.length ? types : null;
    const rows = await this.pool.query(
      `WITH ranked AS (
        SELECT k.knowledge_id, k.type, k.title, k.content, k.tags, k.source, k.version, k.status,
          k.updated_at, k.updated_by, k.embedding::text AS embedding,
          COALESCE(ts_rank_cd(to_tsvector('simple', k.title || ' ' || k.content || ' ' || array_to_string(k.tags, ' ') || ' ' || k.source), plainto_tsquery('simple', $1)), 0) AS lexical_score,
          CASE WHEN $2::vector IS NULL OR k.embedding IS NULL THEN 0 ELSE GREATEST(0, 1 - (k.embedding <=> $2::vector)) END AS semantic_score,
          (SELECT count(*) FROM sdr_knowledge_chunk c WHERE c.knowledge_id = k.knowledge_id) AS chunk_count
        FROM sdr_knowledge k
        WHERE k.status = 'approved' AND ($3::text[] IS NULL OR k.type = ANY($3::text[]))
      )
      SELECT * FROM ranked
      ORDER BY (lexical_score + semantic_score) DESC, updated_at DESC
      LIMIT $4`,
      [String(query || ""), vector, typeFilter, Math.max(1, Math.min(100, Number(candidateLimit) || 40))],
    );
    const records = rows.rows.map((row) => ({ ...publicRecord(row), embedding: parseVector(row.embedding), chunks: [] }));
    return this.retriever.retrieve(records, query, { types, limit, candidateLimit: records.length });
  }

  async list({ type } = {}) {
    const result = await this.pool.query(
      `SELECT k.knowledge_id, k.type, k.title, k.content, k.tags, k.source, k.version, k.status,
          k.updated_at, k.updated_by, count(c.chunk_id)::int AS chunk_count
       FROM sdr_knowledge k LEFT JOIN sdr_knowledge_chunk c ON c.knowledge_id = k.knowledge_id
       WHERE ($1::text IS NULL OR k.type = $1) GROUP BY k.knowledge_id ORDER BY k.updated_at DESC`,
      [type || null],
    );
    return result.rows.map(publicRecord);
  }

  async evaluate({ queries, k = 5 } = {}) {
    const perQuery = [];
    for (const query of queries || []) {
      const hits = await this.search(query.text, { types: query.types, limit: k });
      const expected = new Set(query.relevant_knowledge_ids || []);
      const ids = hits.map((hit) => hit.knowledge_id);
      const first = ids.findIndex((id) => expected.has(id));
      const found = ids.filter((id) => expected.has(id));
      perQuery.push({ query: query.text, expected: [...expected], hits: ids, recall_at_k: expected.size ? found.length / expected.size : 0, reciprocal_rank: first >= 0 ? 1 / (first + 1) : 0 });
    }
    const count = perQuery.length || 1;
    return { k, queries: perQuery.length, recall_at_k: Number((perQuery.reduce((sum, row) => sum + row.recall_at_k, 0) / count).toFixed(3)), mrr: Number((perQuery.reduce((sum, row) => sum + row.reciprocal_rank, 0) / count).toFixed(3)), per_query: perQuery };
  }
}
