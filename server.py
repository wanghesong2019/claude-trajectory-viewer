"""Claude Code trajectory viewer — 后端（agent 事件服务器）。

职责：spawn `claude -p`（headless），把 stream-json 事件流过滤掉 99% 的
thinking_tokens 噪音，只把 init/assistant/user/result 这几类有意义的事件
通过 SSE 推给浏览器。也支持 replay 模式（回放已保存的 events.jsonl，免费开发）。

事件 schema 是真正的契约（纯 JSON），客户端是浏览器还是将来的安卓 app 都不关心
后端用什么语言、走 SSE 还是 WebSocket。
"""
import asyncio
import json
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


def _base_dir() -> Path:
    """资源根目录：PyInstaller 打包后资源在 sys._MEIPASS，否则用源码目录。"""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


BASE = _base_dir()

app = FastAPI(title="claude-trajectory-viewer")


# ---------------------------------------------------------------------------
# 事件过滤。实测原始流约 99% 是 `system/thinking_tokens`（模型每思考一个 token
# 吐一条进度事件），必须在这里丢掉，否则前端会被瞬间冲垮。
# ---------------------------------------------------------------------------
def keep(event: dict) -> bool:
    t = event.get("type")
    if t == "system":
        return event.get("subtype") == "init"
    return t in {"assistant", "user", "result"}


# ---------------------------------------------------------------------------
# 进程内事件总线：每个连接的 SSE 客户端持有一个 asyncio.Queue。
# ---------------------------------------------------------------------------
subscribers: list[asyncio.Queue] = []

current_proc: Optional[asyncio.subprocess.Process] = None
_stop_requested = False


def broadcast(event: dict) -> None:
    for q in list(subscribers):
        q.put_nowait(event)


# ---------------------------------------------------------------------------
# 请求模型
# ---------------------------------------------------------------------------
class RunRequest(BaseModel):
    prompt: str
    cwd: str
    mode: str = "live"                      # "live" | "replay"
    replay_file: Optional[str] = None
    resume_session_id: Optional[str] = None
    skip_permissions: bool = False          # 为 True 时用 --dangerously-skip-permissions


@app.post("/api/run")
async def run(req: RunRequest) -> dict:
    asyncio.create_task(_run(req))
    return {"status": "started"}


async def _run(req: RunRequest) -> None:
    if req.mode == "replay" and req.replay_file:
        await _replay(req.replay_file)
    else:
        await _live(req)


async def _live(req: RunRequest) -> None:
    global current_proc, _stop_requested
    _stop_requested = False
    cmd = ["claude", "-p", req.prompt, "--output-format", "stream-json", "--verbose"]
    if req.resume_session_id:
        cmd += ["--resume", req.resume_session_id]
    if req.skip_permissions:
        cmd += ["--dangerously-skip-permissions"]
    else:
        cmd += ["--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Bash"]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=req.cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except Exception as e:
        broadcast({"type": "run_error", "message": f"无法启动 claude：{e}"})
        return

    current_proc = proc
    try:
        async for raw in proc.stdout:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if keep(ev):
                broadcast(ev)

        rc = await proc.wait()
        if rc != 0 and not _stop_requested:
            err = (await proc.stderr.read()).decode("utf-8", "replace").strip()
            broadcast({"type": "run_error", "message": err[:500] or f"claude exited with code {rc}"})
    finally:
        if current_proc is proc:
            current_proc = None


async def _replay(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if keep(ev):
                broadcast(ev)
                await asyncio.sleep(0.02)   # 小延时模拟实时流


@app.get("/api/events")
async def events(request: Request):
    q: asyncio.Queue = asyncio.Queue()
    subscribers.append(q)

    async def gen():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            subscribers.remove(q)

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/api/stop")
async def stop() -> dict:
    global _stop_requested
    _stop_requested = True
    if current_proc is not None and current_proc.returncode is None:
        current_proc.terminate()
    broadcast({"type": "run_stopped"})
    return {"status": "stopped"}


@app.get("/api/samples")
async def samples() -> dict:
    replay_dir = BASE / "replay"
    files = sorted(replay_dir.glob("*.jsonl")) if replay_dir.exists() else []
    return {"samples": [str(f) for f in files]}


app.mount("/", StaticFiles(directory=str(BASE / "static"), html=True), name="static")


if __name__ == "__main__":
    import os
    import uvicorn
    uvicorn.run(
        app,
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
    )
