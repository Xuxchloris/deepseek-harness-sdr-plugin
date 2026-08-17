"""MCP 插件系统：员工加"手脚" = 加一个 MCP server，不改主代码。

从环境变量 MCP_SERVERS 或本地 config/mcp.json 读取 server 列表并
包装成 pydantic-ai 的 MCPToolset，交给 Agent 的 toolsets 参数。

官方 MCP（2026 已验证存在，W3 联调时逐个启用）：
- Apollo.io  https://mcp.apollo.io/mcp        （找客户/人，OAuth）
- Clay       https://api.clay.com/v3/mcp      （数据丰富/GTM 表，OAuth）
- AdsPower   npx local-api-mcp-typescript     （浏览器/指纹，本地 stdio）
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from pydantic_ai.mcp import FastMCPClient, MCPToolset

log = logging.getLogger(__name__)

DEFAULT_SUPPORTED = {
    "apollo": "https://mcp.apollo.io/mcp",
    "clay": "https://api.clay.com/v3/mcp",
}


def _load_config() -> list[dict[str, Any]]:
    raw = os.getenv("MCP_SERVERS")
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            log.warning("MCP_SERVERS 不是合法 JSON，忽略")
    path = Path(__file__).resolve().parents[2] / "config" / "mcp.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return []


def build_mcp_toolsets(enabled: list[str] | None = None) -> list[MCPToolset]:
    """enabled=None 时按配置启用；空配置返回空列表（skeleton 不阻塞）。

    配置项支持三种：
    - url:     远程 HTTP MCP（Streamable HTTP，如 Apollo/Clay）
    - command: 本地 stdio MCP（如 AdsPower 的 npx local-api-mcp-typescript）
    - args:    配合 command 使用的参数列表（可选）
    - auth:    认证方式，缺省 "oauth"（仅 HTTP 生效）
    """
    toolsets: list[MCPToolset] = []
    cfg = _load_config()
    for entry in cfg:
        name = entry.get("name")
        if enabled is not None and name not in enabled:
            continue
        command = entry.get("command")
        if command:
            args = entry.get("args") or []
            transport = [command, *args] if args else command
        else:
            transport = entry.get("url") or DEFAULT_SUPPORTED.get(name)
        if not transport:
            continue
        try:
            client = FastMCPClient(transport, auth=entry.get("auth", "oauth"))
            toolsets.append(MCPToolset(client=client, id=name))
        except Exception as exc:  # server 未启用/不可达，骨架不阻塞
            log.warning("MCP server %s 加载失败: %s", name, exc)
    return toolsets