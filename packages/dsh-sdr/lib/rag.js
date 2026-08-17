import { createHash } from "node:crypto";

/**
 * Retrieval-Augmented Generation primitives.
 *
 * The default implementation is dependency-free so a fresh DSH install can
 * run offline. A production deployment can inject an embedder and a reranker
 * without changing the SDR state machine or tool contracts.
 */

export function tokenize(value) {
  const chunks = String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{Script=Han}]+|[a-z0-9]+/gu) || [];
  const tokens = [];
  for (const chunk of chunks) {
    if (/^[\p{Script=Han}]+$/u.test(chunk)) {
      const chars = [...chunk];
      for (const char of chars) tokens.push(char);
      for (let index = 0; index < chars.length - 1; index += 1) tokens.push(`${chars[index]}${chars[index + 1]}`);
    } else if (chunk.length >= 2) {
      tokens.push(chunk);
    }
  }
  return tokens;
}

function termFrequency(tokens) {
  const frequencies = new Map();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  return frequencies;
}

function documentText(record) {
  return `${record.title || ""} ${record.content || ""} ${(record.tags || []).join(" ")} ${record.source || ""}`;
}

function weightedDocumentTokens(record) {
  return [
    ...tokenize(record.title).flatMap((token) => [token, token, token]),
    ...tokenize(record.content),
    ...tokenize((record.tags || []).join(" ")).flatMap((token) => [token, token]),
    ...tokenize(record.source),
  ];
}

function buildLexicalStats(records) {
  const tokenized = records.map((record) => weightedDocumentTokens(record));
  const documentFrequency = new Map();
  for (const tokens of tokenized) {
    for (const token of new Set(tokens)) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  }
  const averageLength = tokenized.length ? tokenized.reduce((total, tokens) => total + tokens.length, 0) / tokenized.length : 0;
  return { tokenized, documentFrequency, averageLength };
}

function bm25(queryTokens, documentTokens, stats) {
  if (!queryTokens.length || !documentTokens.length) return 0;
  const frequencies = termFrequency(documentTokens);
  const uniqueQuery = new Set(queryTokens);
  const k1 = 1.2;
  const b = 0.75;
  let score = 0;
  for (const token of uniqueQuery) {
    const tf = frequencies.get(token) || 0;
    if (!tf) continue;
    const df = stats.documentFrequency.get(token) || 0;
    const idf = Math.log(1 + (stats.count - df + 0.5) / (df + 0.5));
    const lengthFactor = 1 - b + b * (documentTokens.length / (stats.averageLength || 1));
    score += idf * ((tf * (k1 + 1)) / (tf + k1 * lengthFactor));
  }
  return score;
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

function normalizeScores(candidates, field) {
  const max = Math.max(0, ...candidates.map((candidate) => candidate[field] || 0));
  const normalizedField = `${field.replace(/_score$/, "")}_normalized`;
  if (!max) return candidates.map((candidate) => ({ ...candidate, [normalizedField]: 0 }));
  return candidates.map((candidate) => ({ ...candidate, [normalizedField]: (candidate[field] || 0) / max }));
}

function exactMatchBonus(queryTokens, record) {
  if (!queryTokens.length) return 0;
  const title = new Set(tokenize(record.title));
  const tags = new Set(tokenize((record.tags || []).join(" ")));
  const titleMatches = queryTokens.filter((token) => title.has(token)).length;
  const tagMatches = queryTokens.filter((token) => tags.has(token)).length;
  return Math.min(1, (titleMatches * 0.12 + tagMatches * 0.06) / Math.max(1, queryTokens.length));
}

/** Deterministic local reranker. Replace with a cross-encoder in production. */
export async function defaultReranker({ queryTokens, candidates }) {
  return candidates
    .map((candidate) => ({
      ...candidate,
      rerank_score: Math.min(1, candidate.combined_score * 0.86 + exactMatchBonus(queryTokens, candidate.record) * 0.14),
    }))
    .sort((left, right) => right.rerank_score - left.rerank_score || String(right.record.updated_at).localeCompare(String(left.record.updated_at)));
}

function safeLimit(value, fallback = 5, max = 20) {
  const number = Number(value);
  return Math.max(1, Math.min(max, Number.isFinite(number) ? Math.trunc(number) : fallback));
}

function publicResult(record, candidate) {
  return {
    knowledge_id: record.knowledge_id,
    type: record.type,
    title: record.title,
    content: record.content,
    tags: record.tags,
    source: record.source,
    version: record.version,
    status: record.status,
    updated_at: record.updated_at,
    updated_by: record.updated_by,
    relevance: Number(Math.max(0, Math.min(1, candidate.rerank_score)).toFixed(3)),
    retrieval: {
      lexical: Number(candidate.lexical_normalized.toFixed(3)),
      semantic: Number(candidate.semantic_normalized.toFixed(3)),
      reranked: Number(candidate.rerank_score.toFixed(3)),
      matched_chunks: candidate.matched_chunks,
    },
    citation: `${record.knowledge_id}@v${record.version} (${record.source})`,
  };
}

export class HybridRagRetriever {
  constructor({ embedder = null, reranker = defaultReranker, lexicalWeight = 0.55, semanticWeight = 0.45 } = {}) {
    if (typeof reranker !== "function") throw new TypeError("reranker 必须是函数");
    const total = Number(lexicalWeight) + Number(semanticWeight);
    if (!(total > 0)) throw new Error("RAG 权重之和必须大于 0");
    this.embedder = embedder;
    this.reranker = reranker;
    this.lexicalWeight = Number(lexicalWeight) / total;
    this.semanticWeight = Number(semanticWeight) / total;
  }

  async retrieve(records, query, { types = [], limit = 5, candidateLimit = 20 } = {}) {
    const selectedTypes = new Set((Array.isArray(types) ? types : []).filter(Boolean));
    const filtered = records.filter((record) => record.status === "approved" && (!selectedTypes.size || selectedTypes.has(record.type)));
    const queryTokens = tokenize(query);
    const lexicalStats = buildLexicalStats(filtered);
    lexicalStats.count = filtered.length;
    let queryEmbedding = null;
    if (this.embedder?.embed) queryEmbedding = await this.embedder.embed(String(query || ""));
    const candidates = filtered.map((record, index) => ({
      record,
      lexical_score: bm25(queryTokens, lexicalStats.tokenized[index], lexicalStats),
      semantic_score: cosineSimilarity(queryEmbedding, record.embedding),
      matched_chunks: this.#matchedChunks(record, queryTokens),
    }));
    const lexical = normalizeScores(candidates, "lexical_score");
    const semantic = normalizeScores(lexical, "semantic_score");
    const hasSemanticSignal = semantic.some((candidate) => candidate.semantic_score > 0);
    const lexicalWeight = hasSemanticSignal ? this.lexicalWeight : 1;
    const semanticWeight = hasSemanticSignal ? this.semanticWeight : 0;
    const combined = semantic
      .map((candidate) => ({ ...candidate, combined_score: candidate.lexical_normalized * lexicalWeight + candidate.semantic_normalized * semanticWeight }))
      .filter((candidate) => candidate.combined_score > 0)
      .sort((left, right) => right.combined_score - left.combined_score)
      .slice(0, safeLimit(candidateLimit, 20, 100));
    const reranked = await this.reranker({ query, queryTokens, candidates: combined });
    return reranked.slice(0, safeLimit(limit)).map((candidate) => publicResult(candidate.record, candidate));
  }

  #matchedChunks(record, queryTokens) {
    if (!queryTokens.length || !Array.isArray(record.chunks)) return [];
    return record.chunks
      .map((chunk) => ({ chunk, score: queryTokens.filter((token) => tokenize(chunk.content).includes(token)).length / queryTokens.length }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map(({ chunk, score }) => ({ chunk_id: chunk.chunk_id, score: Number(score.toFixed(3)), excerpt: chunk.content.slice(0, 320) }));
  }
}

export function splitIntoChunks(content, { maxChars = 1200, overlap = 120 } = {}) {
  const text = String(content || "").trim();
  if (!text) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > start + Math.floor(maxChars * 0.55)) end = boundary;
    }
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push({ chunk_id: `chunk_${createHash("sha256").update(`${start}|${piece}`).digest("hex").slice(0, 12)}`, content: piece, ordinal: chunks.length });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - Math.min(overlap, Math.floor(maxChars / 3)));
  }
  return chunks;
}

export async function evaluateRetrieval({ retriever, records, queries, k = 5 }) {
  if (!retriever || typeof retriever.retrieve !== "function") throw new TypeError("retriever 必须实现 retrieve()");
  const topK = safeLimit(k, 5, 100);
  const perQuery = [];
  for (const query of queries || []) {
    const hits = await retriever.retrieve(records, query.text, { types: query.types, limit: topK });
    const relevant = new Set(query.relevant_knowledge_ids || []);
    const hitIds = hits.map((hit) => hit.knowledge_id);
    const relevantHits = hitIds.filter((id) => relevant.has(id));
    const firstRank = hitIds.findIndex((id) => relevant.has(id));
    perQuery.push({ query: query.text, expected: [...relevant], hits: hitIds, recall_at_k: relevant.size ? relevantHits.length / relevant.size : 0, reciprocal_rank: firstRank >= 0 ? 1 / (firstRank + 1) : 0 });
  }
  const count = perQuery.length || 1;
  return { k: topK, queries: perQuery.length, recall_at_k: Number((perQuery.reduce((sum, row) => sum + row.recall_at_k, 0) / count).toFixed(3)), mrr: Number((perQuery.reduce((sum, row) => sum + row.reciprocal_rank, 0) / count).toFixed(3)), per_query: perQuery };
}
