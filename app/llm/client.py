"""OpenAI 兼容端点的模型工厂。"""

import os

from pydantic_ai.models import Model, infer_model
from pydantic_ai.providers.openai import OpenAIProvider

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


def get_settings() -> dict:
    """返回模型连接配置。"""
    return {
        "base_url": os.getenv("LLM_BASE_URL", "http://localhost:8000/v1"),
        "api_key": os.getenv("LLM_API_KEY", "sk-local"),
        "model": os.getenv("LLM_MODEL", "Qwen2.5-7B-Instruct"),
    }


def get_model() -> Model:
    """构造 OpenAI 兼容端点的模型实例,不发起网络请求。"""
    settings = get_settings()
    provider = OpenAIProvider(base_url=settings["base_url"], api_key=settings["api_key"])
    return infer_model(f"openai-chat:{settings['model']}", lambda _: provider)
