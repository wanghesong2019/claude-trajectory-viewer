"""后端核心逻辑的测试。

重点覆盖 keep()——它决定事件流里哪些事件保留、哪些丢弃，是整工具最关键的一环
（FR8：过滤掉 99% 的 thinking_tokens 噪音）。
"""
from fastapi.testclient import TestClient

from server import app, keep

client = TestClient(app)


# ---- keep()：事件过滤 ----

def test_keep_keeps_init():
    assert keep({"type": "system", "subtype": "init"}) is True


def test_keep_drops_thinking_tokens():
    assert keep({"type": "system", "subtype": "thinking_tokens"}) is False


def test_keep_drops_hook_events():
    assert keep({"type": "system", "subtype": "hook_started"}) is False
    assert keep({"type": "system", "subtype": "hook_response"}) is False


def test_keep_drops_task_events():
    assert keep({"type": "system", "subtype": "task_started"}) is False
    assert keep({"type": "system", "subtype": "task_notification"}) is False


def test_keep_keeps_meaningful_events():
    assert keep({"type": "assistant"}) is True
    assert keep({"type": "user"}) is True
    assert keep({"type": "result"}) is True


# ---- /api/samples ----

def test_samples_lists_replay_files():
    r = client.get("/api/samples")
    assert r.status_code == 200
    samples = r.json()["samples"]
    assert any("sample_real.jsonl" in s for s in samples)
    assert any("sample_subagent.jsonl" in s for s in samples)


# ---- /api/stop ----

def test_stop_returns_stopped():
    r = client.post("/api/stop")
    assert r.status_code == 200
    assert r.json()["status"] == "stopped"
