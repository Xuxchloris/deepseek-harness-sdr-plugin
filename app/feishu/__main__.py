"""飞书机器人独立进程入口：python -m app.feishu

长连接 SDK 的 ws.start() 使用模块级事件循环，必须在独立进程里跑
（不能在 FastAPI 主循环的线程里），故单独启动一个容器/进程。
"""

import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

from app.feishu.bot import start  # noqa: E402

if __name__ == "__main__":
    start()
