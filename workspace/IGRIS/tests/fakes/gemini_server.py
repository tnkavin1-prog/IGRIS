"""Protocol-accurate local Gemini API simulator.

Purpose: exercise IGRIS's real provider client (``GeminiProvider``) over real
HTTP against a server that speaks the documented Gemini Developer API wire
format. This validates request construction, response parsing, function-call
extraction, retry/backoff and error classification *without* consuming the
user's paid quota.

It is a TEST DOUBLE, not a replacement for the real service. Acceptance tests
that require the real provider are reported as BLOCKED when no key is present.

Supported endpoints (v1beta):
  GET  /v1beta/models                       -> paged model list
  POST /v1beta/models/{model}:generateContent
  POST /v1beta/models/{model}:streamGenerateContent?alt=sse
  POST /v1beta/models/{model}:countTokens
  POST /v1beta/interactions                 -> Interactions API (TTS path)
  POST /v1beta/files                        -> resumable upload (metadata only)

Behaviour is scripted through ``__control`` routes so tests can inject
function calls, audio, 401/404/429/500 responses and slow responses.
"""
from __future__ import annotations

import base64
import json
import struct
import threading
import time
from typing import Any

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

LIVE_MODELS = [
    ("gemini-3.8-flash", "Gemini 3.8 Flash", 1_000_000, 65_536,
     ["generateContent", "streamGenerateContent", "countTokens", "embedContent"]),
    ("gemini-4-argon", "Gemini 4 Argon", 1_000_000, 1_000_000,
     ["generateContent", "streamGenerateContent", "countTokens"]),
    ("gemini-3.8-flash-tts", "Gemini 3.8 Flash TTS", 32_768, 8_192, ["generateContent"]),
    ("gemini-3.5-transcribe", "Gemini 3.5 Transcribe", 1_000_000, 8_192, ["generateContent"]),
    ("gemini-3.8-live", "Gemini 3.8 Live", 1_000_000, 8_192, ["bidiGenerateContent"]),
    ("gemini-nano-banana-2.1", "Nano Banana 2.1", 32_768, 32_768, ["generateContent"]),
]


class Script:
    """Mutable server-side script controlling the next responses."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.mode: str = "echo"          # echo | function_call | json | audio | text | error
        self.text: str = "fake gemini response"
        self.function_calls: list[dict[str, Any]] = []
        self.json_payload: dict[str, Any] = {}
        self.status: int = 200
        self.error_body: dict[str, Any] | None = None
        self.delay: float = 0.0
        self.fail_times: int = 0         # return `status` this many times, then succeed
        self.requests: list[dict[str, Any]] = []
        self.block_reason: str | None = None
        self.thoughts: str | None = None
        self.audio_seconds: float = 0.4
        self.usage: dict[str, int] = {"promptTokenCount": 128, "candidatesTokenCount": 64,
                                      "thoughtsTokenCount": 0, "totalTokenCount": 192}


SCRIPT = Script()
app = FastAPI(title="IGRIS Gemini Simulator")


def _record(request: Request, body: Any) -> dict[str, Any]:
    key = request.headers.get("x-goog-api-key") or request.query_params.get("key")
    rec = {"ts": time.time(), "path": request.url.path, "query": dict(request.query_params),
           "method": request.method, "api_key_seen": bool(key),
           "api_key_prefix": (key[:4] if key else ""), "body": body}
    SCRIPT.requests.append(rec)
    return rec


def _wav_pcm(seconds: float = 0.4, rate: int = 24000) -> bytes:
    """Deterministic non-silent PCM so tests can assert on real bytes."""
    n = int(rate * seconds)
    out = bytearray()
    for i in range(n):
        v = int(6000 * ((i % 200) / 100.0 - 1.0))
        out += struct.pack("<h", v)
    return bytes(out)


def _usage(prompt_extra: int = 0) -> dict[str, int]:
    u = dict(SCRIPT.usage)
    u["promptTokenCount"] = u.get("promptTokenCount", 0) + prompt_extra
    u["totalTokenCount"] = (u.get("promptTokenCount", 0) + u.get("candidatesTokenCount", 0)
                            + u.get("thoughtsTokenCount", 0))
    return u


def _parts_for_mode(model: str, body: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    parts: list[dict[str, Any]] = []
    finish = "STOP"
    if SCRIPT.mode == "function_call" and SCRIPT.function_calls:
        for fc in SCRIPT.function_calls:
            parts.append({"functionCall": {"id": fc.get("id", f"fc-{len(parts)}"),
                                           "name": fc["name"], "args": fc.get("args", {})}})
    elif SCRIPT.mode == "json":
        parts.append({"text": json.dumps(SCRIPT.json_payload)})
    elif SCRIPT.mode == "audio":
        mime = body.get("generationConfig", {}).get("responseModalities")
        pcm = _wav_pcm(SCRIPT.audio_seconds)
        parts.append({"inlineData": {"mimeType": "audio/L16;rate=24000",
                                     "data": base64.b64encode(pcm).decode()}})
        del mime
    elif SCRIPT.mode == "error":
        finish = "OTHER"
    else:
        txt = SCRIPT.text
        if txt == "__ECHO_PROMPT__":
            msgs = body.get("contents") or []
            last = msgs[-1]["parts"][0].get("text", "") if msgs else ""
            txt = f"echo:{last}"
        parts.append({"text": txt})
    if SCRIPT.thoughts:
        parts.insert(0, {"text": SCRIPT.thoughts, "thought": True})
    return parts, finish


def _generate_response(model: str, body: dict[str, Any]) -> dict[str, Any]:
    parts, finish = _parts_for_mode(model, body)
    resp: dict[str, Any] = {
        "candidates": [{"content": {"role": "model", "parts": parts},
                        "finishReason": finish, "index": 0}],
        "usageMetadata": _usage(),
        "modelVersion": model,
        "responseId": f"fake-{int(time.time()*1000)}",
    }
    if SCRIPT.block_reason:
        resp["promptFeedback"] = {"blockReason": SCRIPT.block_reason}
    return resp


@app.api_route("/__control", methods=["POST"])
async def control(request: Request) -> JSONResponse:
    payload = await request.json()
    if payload.get("reset"):
        SCRIPT.reset()
    for k, v in payload.items():
        if k in {"reset"}:
            continue
        if hasattr(SCRIPT, k):
            setattr(SCRIPT, k, v)
    return JSONResponse({"ok": True, "mode": SCRIPT.mode, "status": SCRIPT.status,
                          "fail_times": SCRIPT.fail_times})


@app.get("/__requests")
async def requests_log() -> JSONResponse:
    return JSONResponse({"count": len(SCRIPT.requests), "requests": SCRIPT.requests[-40:]})


@app.api_route("/{path:path}", methods=["GET", "POST"])
async def catch_all(path: str, request: Request) -> Response:
    body: Any = None
    if request.method == "POST":
        raw = await request.body()
        try:
            body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            body = {"_raw_len": len(raw)}
    _record(request, body)

    # Scripted failures: fail_times == -1 fails forever; N fails exactly N times
    # and then serves normally, which is what the retry/backoff tests rely on.
    if SCRIPT.status != 200 and SCRIPT.fail_times != 0:
        if SCRIPT.fail_times > 0:
            SCRIPT.fail_times -= 1
        return JSONResponse(
            status_code=SCRIPT.status,
            content=SCRIPT.error_body or {"error": {
                "code": SCRIPT.status,
                "message": f"simulated {SCRIPT.status} failure",
                "status": {400: "INVALID_ARGUMENT", 401: "UNAUTHENTICATED",
                           403: "PERMISSION_DENIED", 404: "NOT_FOUND",
                           429: "RESOURCE_EXHAUSTED", 500: "INTERNAL",
                           503: "UNAVAILABLE"}.get(SCRIPT.status, "ERROR")}})

    if SCRIPT.delay:
        time.sleep(SCRIPT.delay)

    full = "/" + path
    if full.endswith("/models") and request.method == "GET":
        models = [{"name": f"models/{m[0]}", "displayName": m[1],
                   "description": f"Simulated {m[1]}", "version": "1.0",
                   "inputTokenLimit": m[2], "outputTokenLimit": m[3],
                   "supportedActions": m[4]} for m in LIVE_MODELS]
        return JSONResponse({"models": models})

    if ":generateContent" in full or ":streamGenerateContent" in full:
        model = full.split("/models/")[-1].split(":")[0]
        payload = _generate_response(model, body or {})
        if ":streamGenerateContent" in full:
            chunks = payload["candidates"][0]["content"]["parts"]
            async def gen():
                for i, part in enumerate(chunks):
                    one = dict(payload)
                    one["candidates"] = [{"content": {"role": "model", "parts": [part]},
                                          "finishReason": "STOP" if i == len(chunks) - 1 else "",
                                          "index": 0}]
                    yield f"data: {json.dumps(one)}\n\n"
            return StreamingResponse(gen(), media_type="text/event-stream")
        return JSONResponse(payload)

    if ":countTokens" in full:
        total = sum(len(json.dumps(c)) // 4 for c in (body or {}).get("contents", [])) or 42
        return JSONResponse({"totalTokens": total, "totalTokenCount": total})

    if full.endswith("/interactions"):
        return JSONResponse({"id": "fake-interaction", "status": "completed",
                             "steps": [{"type": "output_audio", "content": [
                                 {"type": "audio", "data": base64.b64encode(_wav_pcm(0.3)).decode()}]}]})

    if full.endswith("/files") or ":upload" in full:
        return JSONResponse({"name": "files/fake", "uri": "https://fake/files/fake",
                             "mimeType": "application/octet-stream", "sizeBytes": "1"})

    return JSONResponse(status_code=404,
                        content={"error": {"code": 404, "message": f"simulator has no route {full}",
                                           "status": "NOT_FOUND"}})


class FakeGeminiServer:
    """Runs the simulator on a real localhost port."""

    def __init__(self, host: str = "127.0.0.1", port: int = 0) -> None:
        self.host = host
        self.port = port
        self._server: uvicorn.Server | None = None
        self._thread: threading.Thread | None = None

    def start(self, timeout: float = 20.0) -> str:
        cfg = uvicorn.Config(app, host=self.host, port=self.port, log_level="error",
                             lifespan="off", access_log=False)
        self._server = uvicorn.Server(cfg)
        self._thread = threading.Thread(target=self._server.run, daemon=True)
        self._thread.start()
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._server.started and self._server.servers:
                self.port = self._server.servers[0].sockets[0].getsockname()[1]
                SCRIPT.reset()
                return self.base_url
            time.sleep(0.05)
        raise RuntimeError("fake gemini server did not start")

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def control(self, **kwargs: Any) -> None:
        import httpx
        httpx.post(f"{self.base_url}/__control", json=kwargs, timeout=10)

    def requests(self) -> list[dict[str, Any]]:
        import httpx
        return httpx.get(f"{self.base_url}/__requests", timeout=10).json()["requests"]

    def stop(self) -> None:
        if self._server:
            self._server.should_exit = True
            if self._thread:
                self._thread.join(timeout=5)
            self._server = None
            self._thread = None


if __name__ == "__main__":  # pragma: no cover
    srv = FakeGeminiServer(port=8931)
    print("fake gemini on", srv.start())
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        srv.stop()
