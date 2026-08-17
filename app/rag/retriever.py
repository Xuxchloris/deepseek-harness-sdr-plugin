"""RAG 检索器:将知识库文档编码进 FAISS 索引,查询返回 top-k 带分数。

设计要点:
- 索引使用 faiss.IndexFlatIP(内积),向量做 L2 归一化,等价于余弦相似度。
- 默认嵌入模型为 bge-m3,惰性加载:仅在真正需要编码文本时才
  import sentence-transformers,模块导入阶段不加载模型、不联网下载。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

import faiss
import numpy as np

# data/knowledge 目录(本文件位于 app/rag/retriever.py,上溯两级到项目根)
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "knowledge"

_bge_model: Any = None  # bge-m3 模型缓存,惰性初始化


def _get_bge_model() -> Any:
    """返回 bge-m3 编码模型,首次调用才 import 并加载。"""
    global _bge_model
    if _bge_model is None:
        from sentence_transformers import SentenceTransformer  # 延迟导入
        _bge_model = SentenceTransformer("BAAI/bge-m3")
    return _bge_model


def _lazy_bge_m3_embed(text: str) -> np.ndarray:
    """用 bge-m3 把单段文本编码为 float32 向量。"""
    vec = _get_bge_model().encode([text], normalize_embeddings=True)[0]
    return np.asarray(vec, dtype="float32")


def _normalize(vectors: np.ndarray) -> np.ndarray:
    """按最后一维做 L2 归一化,使内积等价于余弦相似度。"""
    vectors = np.asarray(vectors, dtype="float32")
    norms = np.linalg.norm(vectors, axis=-1, keepdims=True)
    norms[norms == 0] = 1.0  # 避免零向量除零
    return vectors / norms


def _flatten_item(item: dict) -> str:
    """把一条知识库记录的各字段拼接成一段可检索文本。"""
    parts: list[str] = []
    for key, value in item.items():
        if value is None:
            continue
        if isinstance(value, str):
            parts.append(f"{key}: {value}")
        elif isinstance(value, list):
            subs = [str(v) for v in value]
            if subs:
                parts.append(f"{key}: " + " ".join(subs))
        elif isinstance(value, dict):
            parts.append(f"{key}: {_flatten_item(value)}")
        else:
            parts.append(f"{key}: {value}")
    return "\n".join(parts)


def load_knowledge_docs(root: Path | None = None) -> list[dict]:
    """读取 data/knowledge 下所有 *.json 文件并返回文档列表。

    每个文档 dict 保留原始字段(prospect/product/title/detail 等),
    并新增 "text" 字段(各字段拼接后的可检索文本)与 "_source"(来源文件名)。
    """
    root = Path(root) if root is not None else DEFAULT_DATA_DIR
    docs: list[dict] = []
    if not root.is_dir():
        return docs
    for fp in sorted(root.glob("*.json")):
        with open(fp, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            continue
        for item in data:
            if not isinstance(item, dict):
                continue
            doc = dict(item)
            doc["text"] = _flatten_item(item)
            doc["_source"] = fp.name
            docs.append(doc)
    return docs


class KnowledgeIndex:
    """基于 FAISS 内积(余弦相似度)的知识库向量检索器。"""

    def __init__(self) -> None:
        self.index: faiss.IndexFlatIP | None = None
        self.docs: list[dict] = []
        self.vectors: np.ndarray | None = None  # 归一化后的向量,供测试访问
        self._embed_fn: Callable[[str], np.ndarray] | None = None

    def build_from_documents(
        self,
        docs: list[dict],
        embed_fn: Callable[[str], np.ndarray] | None = None,
    ) -> "KnowledgeIndex":
        """用文档文本构建索引;embed_fn 传入则用它,否则惰性使用 bge-m3。"""
        self.docs = list(docs)
        self._embed_fn = embed_fn or _lazy_bge_m3_embed
        vectors = np.asarray(
            [self._embed_fn(d["text"]) for d in self.docs], dtype="float32"
        )
        return self._build(vectors)

    def build_from_vectors(
        self, vectors: list[np.ndarray], docs: list[dict]
    ) -> "KnowledgeIndex":
        """直接以向量构建索引(离线/测试路径,不触发任何模型加载)。"""
        self.docs = list(docs)
        vectors = np.asarray(
            [np.asarray(v, dtype="float32") for v in vectors], dtype="float32"
        )
        return self._build(vectors)

    def _build(self, vectors: np.ndarray) -> "KnowledgeIndex":
        vectors = _normalize(vectors)
        self.vectors = vectors
        self.index = faiss.IndexFlatIP(vectors.shape[1])
        self.index.add(vectors)
        return self

    def query(
        self,
        text: str,
        top_k: int = 3,
        score_threshold: float | None = None,
    ) -> list[dict]:
        """文本查询:先用嵌入函数编码文本,再做向量检索。"""
        if self._embed_fn is None:
            self._embed_fn = _lazy_bge_m3_embed
        vec = np.asarray(self._embed_fn(text), dtype="float32")
        return self.query_by_vector(vec, top_k=top_k, score_threshold=score_threshold)

    def query_by_vector(
        self,
        vec: np.ndarray,
        top_k: int = 3,
        score_threshold: float | None = None,
    ) -> list[dict]:
        """向量查询:返回 [{"doc": 原 dict, "score": float}, ...],按分数降序。"""
        if self.index is None or self.index.ntotal == 0:
            return []
        vec = _normalize(np.asarray([vec], dtype="float32"))
        k = min(top_k, self.index.ntotal)
        scores, idxs = self.index.search(vec, k)
        results: list[dict] = []
        for score, i in zip(scores[0], idxs[0]):
            if i < 0:
                continue
            if score_threshold is not None and float(score) < score_threshold:
                continue
            results.append({"doc": self.docs[i], "score": float(score)})
        return results
