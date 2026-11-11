"""Gemini provider client.

Responsibilities, kept deliberately separate from the execution engine:

* connectivity verification against the user's real key
* live model discovery (never trust the local catalog alone)
* text + function-calling completion with structured tool declarations
* streaming
* strict-JSON structured output
* speech synthesis and transcription
* image understanding (used to *inspect* rendered frames)
* rate-limit aware retries with exponential backoff and Retry-After handling
* accurate error classification so the agent can decide retry vs replan vs stop

Gemini only ever *decides*. It returns structured actions; the local execution
engine performs and verifies them. Model output is never executed as a shell
command without passing ``CommandGuard``.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import random
import time
from dataclasses import asdict, dataclass, field
from typing import Any, AsyncIterator, Iterable, Sequence

from ...core.errors import (ErrorCode, ModelUnavailable, NetworkError, ProviderError,
                            ProviderUnauthorized, RateLimited, ValidationError)
from ...core.logging_setup import get_logger
from . import catalog

log = get_logger("integrations.gemini")


@dataclass(slots=True)
class FunctionCallSpec:
    id: str
    name: str
    args: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "args": self.args}


@dataclass(slots=True)
class Usage:
    prompt_tokens: int = 0
    output_tokens: int = 0
    thoughts_tokens: int = 0
    cached_tokens: int = 0
    total_tokens: int = 0
    requests: int = 0
    cost_usd: float | None = None

    def add(self, other: "Usage") -> None:
        self.prompt_tokens += other.prompt_tokens
        self.output_tokens += other.output_tokens
        self.thoughts_tokens += other.thoughts_tokens
        self.cached_tokens += other.cached_tokens
        self.total_tokens += other.total_tokens
        self.requests += other.requests
        if other.cost_usd is not None:
            self.cost_usd = round((self.cost_usd or 0.0) + other.cost_usd, 6)

    def to_dict(self) -> dict[str, Any]:
        return {"prompt_tokens": self.prompt_tokens, "output_tokens": self.output_tokens,
                "thoughts_tokens": self.thoughts_tokens, "cached_tokens": self.cached_tokens,
                "total_tokens": self.total_tokens, "requests": self.requests,
                "estimated_cost_usd": self.cost_usd}


@dataclass(slots=True)
class LLMResponse:
    text: str = ""
    thoughts: str = ""
    function_calls: list[FunctionCallSpec] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    model: str = ""
    finish_reason: str = ""
    safety_blocked: bool = False
    block_reason: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def has_tool_calls(self) -> bool:
        return bool(self.function_calls)

    def to_dict(self) -> dict[str, Any]:
        return {"text": self.text, "thoughts": self.thoughts[:2000],
                "function_calls": [f.to_dict() for f in self.function_calls],
                "usage": self.usage.to_dict(), "model": self.model,
                "finish_reason": self.finish_reason,
                "safety_blocked": self.safety_blocked, "block_reason": self.block_reason}


@dataclass(slots=True)
class ProviderStatus:
    configured: bool = False
    connected: bool = False
    key_fingerprint: str = ""
    model: str = ""
    models_available: int = 0
    requested_model_available: bool | None = None
    error: dict[str, Any] | None = None
    latency_ms: float = 0.0
    checked_at: float = 0.0
    api_version: str = catalog.DEFAULT_API_VERSION
    base_url: str = catalog.DEFAULT_BASE_URL
    tier_hint: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {**self.__dict__, "error": self.error}


class GeminiProvider:
    """Async wrapper over the official ``google-genai`` SDK."""

    def __init__(self, api_key: str | None = None, *, model: str = catalog.DEFAULT_AGENT_MODEL,
                 base_url: str | None = None, api_version: str = catalog.DEFAULT_API_VERSION,
                 timeout: float = 180.0, max_retries: int = 5,
                 user_agent: str = "IGRIS/1.0") -> None:
        self._api_key = api_key or None
        self.model = model
        self.base_url = base_url or catalog.DEFAULT_BASE_URL
        self.api_version = api_version
        self.timeout = timeout
        self.max_retries = max_retries
        self.user_agent = user_agent
        self._client: Any = None
        self._client_key: tuple | None = None
        self.cumulative_usage = Usage()
        self._models_cache: list[catalog.ModelInfo] = []
        self._models_cached_at: float = 0.0
        self.last_status: ProviderStatus = ProviderStatus()

    # ---------------------------------------------------------- key mgmt
    def set_api_key(self, key: str | None) -> None:
        """Rotate the key at runtime; forces a fresh SDK client."""
        self._api_key = key or None
        self._client = None
        self._client_key = None
        self._models_cache = []
        if key:
            from ...core.logging_setup import register_secret
            register_secret(key)

    @property
    def has_key(self) -> bool:
        return bool(self._api_key)

    @property
    def key_fingerprint(self) -> str:
        from ...security.secrets import mask
        return mask(self._api_key)

    def _ensure_client(self) -> Any:
        if not self._api_key:
            raise ProviderUnauthorized(
                "No Gemini API key configured. Add one in Settings to enable IGRIS.",
                details={"hint": "https://aistudio.google.com/api-keys"})
        from google import genai
        from google.genai import types

        key = (self._api_key, self.base_url, self.api_version, self.timeout)
        if self._client is None or self._client_key != key:
            self._client = genai.Client(
                api_key=self._api_key,
                http_options=types.HttpOptions(
                    base_url=self.base_url, api_version=self.api_version,
                    timeout=self.timeout,
                    headers={"User-Agent": self.user_agent}))
            self._client_key = key
            log.info("gemini client initialised (model=%s, api=%s)", self.model, self.api_version)
        return self._client

    # ------------------------------------------------------ error mapping
    @staticmethod
    def _classify(exc: BaseException) -> Exception:
        from google.genai import errors as gerrors
        import httpx

        from ...core.errors import IgrisError

        # Already classified — never re-wrap, or the numeric HTTP status would be
        # confused with an IgrisError string ``code``.
        if isinstance(exc, IgrisError):
            return exc

        status = getattr(exc, "code", None)
        if not isinstance(status, int):
            status = getattr(exc, "status_code", None)
        msg = str(getattr(exc, "message", "") or exc)

        if isinstance(exc, gerrors.APIError) or isinstance(status, int):
            try:
                code = int(status)
            except (TypeError, ValueError):
                code = 0
            if code == 401:
                return ProviderUnauthorized(
                    f"Gemini rejected the API key (401): {msg}",
                    details={"status": 401,
                             "hint": "Check the key at https://aistudio.google.com/api-keys"})
            if code in (400, 403):
                low = msg.lower()
                if any(k in low for k in ("api key", "apikey", "permission", "unauthor",
                                          "invalid", "credential", "access not enabled",
                                          "billing")):
                    return ProviderUnauthorized(
                        f"Gemini rejected the credentials ({code}): {msg}",
                        details={"status": code})
                return ValidationError(f"Gemini request rejected ({code}): {msg}",
                                         details={"status": code})
            if code == 404:
                return ModelUnavailable(f"Model or endpoint not found ({code}): {msg}",
                                        details={"status": code})
            if code == 429:
                return RateLimited(f"Gemini rate limit or quota exhausted (429): {msg}",
                                   details={"status": 429, "retry_after": _retry_after(exc)})
            if code == 408 or code == 504:
                return ProviderError(f"Gemini request timed out ({code}): {msg}",
                                     details={"status": code})
            if 500 <= code < 600:
                return ProviderError(f"Gemini server error ({code}): {msg}",
                                     details={"status": code})
            return ProviderError(f"Gemini API error ({code}): {msg}", details={"status": code},
                                 retryable=False)
        if isinstance(exc, (httpx.TimeoutException, asyncio.TimeoutError, TimeoutError)):
            return NetworkError(f"request timed out: {type(exc).__name__}", retryable=True)
        if isinstance(exc, (httpx.TransportError, httpx.HTTPError, OSError)):
            return NetworkError(f"network failure: {type(exc).__name__}: {exc}", retryable=True)
        if isinstance(exc, (ProviderError, RateLimited, NetworkError, ProviderUnauthorized,
                            ModelUnavailable, ValidationError)):
            return exc
        return ProviderError(f"unexpected provider failure: {type(exc).__name__}: {exc}",
                             retryable=False)

    async def _retry(self, label: str, fn, *args, **kwargs):
        attempt = 0
        while True:
            attempt += 1
            try:
                return await fn(*args, **kwargs)
            except Exception as exc:  # noqa: BLE001 — classified below
                mapped = self._classify(exc)
                retryable = getattr(mapped, "retryable", False)
                if not retryable or attempt > self.max_retries:
                    log.error("%s failed after %d attempt(s): %s", label, attempt, mapped)
                    raise mapped from exc
                base = (mapped.details or {}).get("retry_after")
                if isinstance(base, (int, float)) and base > 0:
                    delay = float(base)
                else:
                    delay = min(60.0, (2 ** (attempt - 1)) * 0.8) + random.uniform(0, 0.6)
                log.warning("%s attempt %d failed (%s); retrying in %.1fs",
                            label, attempt, mapped.__class__.__name__, delay)
                await asyncio.sleep(delay)

    # --------------------------------------------------------- discovery
    async def verify(self) -> ProviderStatus:
        """Real connectivity check: list models with the user's key."""
        st = ProviderStatus(configured=self.has_key, model=self.model,
                            base_url=self.base_url, api_version=self.api_version)
        st.key_fingerprint = self.key_fingerprint
        if not self.has_key:
            st.error = {"code": ErrorCode.PROVIDER_UNAUTHORIZED,
                        "message": "No API key configured",
                        "details": {"hint": "https://aistudio.google.com/api-keys"}}
            self.last_status = st
            return st
        t0 = time.time()
        try:
            from google.genai import types
            client = self._ensure_client()

            async def _list():
                import inspect as _inspect
                pager = client.aio.models.list(
                    config=types.ListModelsConfig(page_size=100))
                if _inspect.isawaitable(pager):
                    pager = await pager
                out = []
                async for m in pager:
                    out.append(m)
                return out

            models = await self._retry("models.list", _list)
            st.latency_ms = round((time.time() - t0) * 1000, 1)
            st.connected = True
            st.checked_at = time.time()
            st.models_available = len(models)
            ids = {_strip_prefix(getattr(m, "name", "") or "") for m in models}
            st.requested_model_available = self.model in ids
            self._models_cache = _merge_live(models)
            self._models_cached_at = time.time()
            st.tier_hint = ("paid-or-verified" if any(i.startswith("gemini-4") for i in ids)
                            else "free-or-limited")
            log.info("provider verified: %d models, %0.0f ms", len(models), st.latency_ms)
        except Exception as exc:  # noqa: BLE001
            mapped = self._classify(exc)
            st.latency_ms = round((time.time() - t0) * 1000, 1)
            st.checked_at = time.time()
            st.error = mapped.to_dict() if hasattr(mapped, "to_dict") else {
                "code": ErrorCode.PROVIDER_ERROR, "message": str(mapped), "details": {}}
            log.error("provider verification failed: %s", mapped)
        self.last_status = st
        return st

    async def list_models(self, *, force: bool = False) -> list[dict[str, Any]]:
        """Live catalog merged with local metadata; falls back to local on error."""
        if not force and self._models_cache and time.time() - self._models_cached_at < 900:
            return [m.to_dict() for m in self._models_cache]
        if self.has_key:
            try:
                await self.verify()
                if self._models_cache:
                    return [m.to_dict() for m in self._models_cache]
            except Exception as exc:  # noqa: BLE001
                log.warning("live model list unavailable, using local catalog: %s", exc)
        return [m.to_dict() for m in catalog.KNOWN_MODELS]

    def known_models(self) -> list[dict[str, Any]]:
        return [m.to_dict() for m in catalog.KNOWN_MODELS]

    # -------------------------------------------------------- completion
    def _build_tools(self, tools: Sequence[dict[str, Any]] | None,
                     google_search: bool = False) -> list[Any]:
        from google.genai import types
        out: list[Any] = []
        decls = []
        for t in tools or []:
            decls.append(types.FunctionDeclaration(
                name=t["name"], description=t.get("description", ""),
                parameters_json_schema=t.get("parameters") or {"type": "object", "properties": {}}))
        if decls:
            out.append(types.Tool(function_declarations=decls))
        if google_search:
            out.append(types.Tool(google_search=True))
        return out

    async def complete(self, messages: Sequence[dict[str, Any]], *,
                       tools: Sequence[dict[str, Any]] | None = None,
                       system: str | None = None, model: str | None = None,
                       json_schema: dict[str, Any] | None = None,
                       temperature: float = 0.4, max_output_tokens: int = 8192,
                       thinking_budget: int | None = None, google_search: bool = False,
                       allowed_function_names: list[str] | None = None,
                       force_tool_call: bool = False) -> LLMResponse:
        """One non-streaming completion, optionally requesting tool calls."""
        from google.genai import types
        client = self._ensure_client()
        model = model or self.model

        cfg_kwargs: dict[str, Any] = {"temperature": temperature,
                                      "max_output_tokens": max_output_tokens}
        if system:
            cfg_kwargs["system_instruction"] = system
        tool_objs = self._build_tools(tools, google_search=google_search)
        if tool_objs:
            cfg_kwargs["tools"] = tool_objs
            mode = "ANY" if force_tool_call else "AUTO"
            cfg_kwargs["tool_config"] = types.ToolConfig(
                function_calling_config=types.FunctionCallingConfig(
                    mode=mode, allowed_function_names=allowed_function_names))
        if json_schema:
            cfg_kwargs["response_mime_type"] = "application/json"
            cfg_kwargs["response_json_schema"] = json_schema
        if thinking_budget is not None:
            cfg_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=thinking_budget)

        contents = _to_contents(messages)

        async def _call():
            return await client.aio.models.generate_content(
                model=model, contents=contents, config=types.GenerateContentConfig(**cfg_kwargs))

        resp = await self._retry("generate_content", _call)
        out = _parse_response(resp, model)
        self.cumulative_usage.add(out.usage)
        return out

    async def stream(self, messages: Sequence[dict[str, Any]], *, system: str | None = None,
                     model: str | None = None, temperature: float = 0.6,
                     max_output_tokens: int = 4096,
                     thinking_budget: int | None = None) -> AsyncIterator[str]:
        """Token streaming for the conversational surface."""
        from google.genai import types
        client = self._ensure_client()
        model = model or self.model
        cfg: dict[str, Any] = {"temperature": temperature, "max_output_tokens": max_output_tokens}
        if system:
            cfg["system_instruction"] = system
        if thinking_budget is not None:
            cfg["thinking_config"] = types.ThinkingConfig(thinking_budget=thinking_budget)
        contents = _to_contents(messages)

        async def _open():
            return await client.aio.models.generate_content_stream(
                model=model, contents=contents, config=types.GenerateContentConfig(**cfg))

        stream = await self._retry("generate_content_stream", _open)
        usage = Usage()
        async for chunk in stream:
            parsed = _parse_response(chunk, model)
            usage.add(parsed.usage)
            if parsed.text:
                yield parsed.text
        self.cumulative_usage.add(usage)

    async def generate_json(self, prompt: str, schema: dict[str, Any], *,
                            system: str | None = None, model: str | None = None,
                            temperature: float = 0.2, max_output_tokens: int = 8192,
                            context: str | None = None) -> dict[str, Any]:
        """Strict structured output — used by the intent engine and the planner."""
        messages = []
        if context:
            messages.append({"role": "user", "content": context})
        messages.append({"role": "user", "content": prompt})
        resp = await self.complete(messages, system=system, model=model, json_schema=schema,
                                   temperature=temperature, max_output_tokens=max_output_tokens,
                                   thinking_budget=-1)
        text = (resp.text or "").strip()
        if not text:
            raise ProviderError("model returned no content for structured request",
                                details={"finish_reason": resp.finish_reason})
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start, end = text.find("{"), text.rfind("}")
            if start >= 0 and end > start:
                try:
                    return json.loads(text[start:end + 1])
                except json.JSONDecodeError:
                    pass
            raise ValidationError("model output was not valid JSON",
                                  details={"preview": text[:300]})

    # ------------------------------------------------------------- audio
    async def synthesize_speech(self, text: str, *, voice: str = "Kore",
                                model: str | None = None, style: str | None = None,
                                language_code: str | None = None) -> tuple[bytes, str]:
        """Text -> WAV bytes (16-bit PCM). Returns (wav_bytes, mime)."""
        from google.genai import types
        client = self._ensure_client()
        model = model or catalog.DEFAULT_TTS_MODEL
        if not text.strip():
            raise ValidationError("cannot synthesize empty text")

        speech_cfg = types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)),
            language_code=language_code)

        async def _call():
            return await client.aio.models.generate_content(
                model=model,
                contents=[types.Content(role="user", parts=[types.Part(text=text)])],
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"], speech_config=speech_cfg))

        resp = await self._retry("tts", _call)
        audio_b64, mime = _extract_audio(resp)
        if not audio_b64:
            raise ProviderError("TTS model returned no audio",
                                details={"model": model,
                                         "text_preview": (resp.text or "")[:200]})
        wav = _pcm_to_wav(base64.b64decode(audio_b64), mime)
        usage = _usage_from(resp, model)
        self.cumulative_usage.add(usage)
        log.info("tts: %d chars -> %d bytes wav (voice=%s)", len(text), len(wav), voice)
        return wav, mime

    async def transcribe(self, audio: bytes, *, mime: str = "audio/wav",
                         model: str | None = None, language: str | None = None,
                         prompt: str | None = None) -> str:
        """Audio -> text using a Gemini transcription-capable model."""
        from google.genai import types
        client = self._ensure_client()
        model = model or catalog.DEFAULT_STT_MODEL
        if not audio:
            raise ValidationError("no audio supplied for transcription")
        instruction = prompt or (
            "Transcribe this audio exactly. Output only the transcript text with no "
            "commentary, no quotes and no speaker labels."
            + (f" The language is {language}." if language else ""))

        async def _call():
            return await client.aio.models.generate_content(
                model=model,
                contents=[types.Content(role="user", parts=[
                    types.Part(inline_data=types.Blob(mime_type=mime,
                                                      data=base64.b64encode(audio).decode())),
                    types.Part(text=instruction)])],
                config=types.GenerateContentConfig(temperature=0.0,
                                                   response_modalities=["TEXT"]))

        resp = await self._retry("transcribe", _call)
        parsed = _parse_response(resp, model)
        self.cumulative_usage.add(parsed.usage)
        return (parsed.text or "").strip()

    async def describe_image(self, image: bytes, prompt: str, *, mime: str = "image/png",
                             model: str | None = None) -> str:
        """Vision inspection — how IGRIS *looks at* a rendered frame or screenshot."""
        from google.genai import types
        client = self._ensure_client()
        model = model or self.model

        async def _call():
            return await client.aio.models.generate_content(
                model=model,
                contents=[types.Content(role="user", parts=[
                    types.Part(inline_data=types.Blob(mime_type=mime,
                                                      data=base64.b64encode(image).decode())),
                    types.Part(text=prompt)])],
                config=types.GenerateContentConfig(temperature=0.2, max_output_tokens=2048))

        resp = await self._retry("describe_image", _call)
        parsed = _parse_response(resp, model)
        self.cumulative_usage.add(parsed.usage)
        return parsed.text

    async def count_tokens(self, messages: Sequence[dict[str, Any]], *,
                           model: str | None = None) -> int:
        from google.genai import types
        client = self._ensure_client()

        async def _call():
            return await client.aio.models.count_tokens(
                model=model or self.model, contents=_to_contents(messages))

        resp = await self._retry("count_tokens", _call)
        return int(getattr(resp, "total_tokens", 0) or 0)

    # ----------------------------------------------------------- status
    def usage_report(self) -> dict[str, Any]:
        return {"cumulative": self.cumulative_usage.to_dict(),
                "free_tier_disclosure": catalog.FREE_TIER_DISCLOSURE,
                "catalog_date": catalog.CATALOG_DATE}

    async def aclose(self) -> None:
        try:
            if self._client is not None:
                await self._client.aio.aclose()
        except Exception:
            pass
        finally:
            self._client = None
            self._client_key = None


# ------------------------------------------------------------------ helpers
def _strip_prefix(name: str) -> str:
    return name.split("/")[-1] if "/" in name else name


def _merge_live(models: Iterable[Any]) -> list[catalog.ModelInfo]:
    """Live list wins for availability; local catalog supplies labels/prices."""
    out: list[catalog.ModelInfo] = []
    seen: set[str] = set()
    for m in models:
        mid = _strip_prefix(getattr(m, "name", "") or "")
        if not mid or mid in seen:
            continue
        seen.add(mid)
        known = catalog.BY_ID.get(mid)
        actions = [str(a).split("/")[-1] for a in (getattr(m, "supported_actions", None) or [])]
        info = catalog.ModelInfo(
            id=mid,
            display_name=getattr(m, "display_name", None) or (known.display_name if known else mid),
            family=known.family if known else _guess_family(mid),
            description=(getattr(m, "description", None) or (known.description if known else "")),
            context_tokens=getattr(m, "input_token_limit", None)
                           or (known.context_tokens if known else None),
            max_output_tokens=getattr(m, "output_token_limit", None)
                              or (known.max_output_tokens if known else None),
            modalities=known.modalities if known else [],
            supports_function_calling=(not actions) or ("generateContent" in actions),
            supports_streaming=(not actions) or ("streamGenerateContent" in actions),
            supports_thinking=known.supports_thinking if known else True,
            free_tier=known.free_tier if known else True,
            price_input=known.price_input if known else None,
            price_output=known.price_output if known else None,
            price_note=known.price_note if known else "",
            deprecated=known.deprecated if known else False,
            live=known.live if known else False,
            available=True)
        out.append(info)
    for known in catalog.KNOWN_MODELS:
        if known.id not in seen:
            clone = catalog.ModelInfo(**{**asdict(known), "available": False})
            out.append(clone)
    order = {"agent": 0, "live": 1, "tts": 2, "stt": 3, "image": 4, "video": 5, "embedding": 6}
    out.sort(key=lambda i: (0 if i.available else 1, order.get(i.family, 9), i.id))
    return out


def _guess_family(mid: str) -> str:
    low = mid.lower()
    if "tts" in low:
        return "tts"
    if "transcribe" in low:
        return "stt"
    if "live" in low or "translate" in low:
        return "live"
    if "image" in low or "banana" in low:
        return "image"
    if "omni" in low or "video" in low or "veo" in low:
        return "video"
    if "embedding" in low:
        return "embedding"
    return "agent"


def _retry_after(exc: BaseException) -> float | None:
    resp = getattr(exc, "response", None)
    headers = getattr(resp, "headers", None)
    if not headers:
        return None
    for h in ("retry-after", "Retry-After", "x-ratelimit-reset"):
        try:
            v = headers.get(h)
        except Exception:
            v = None
        if v:
            try:
                return max(0.5, float(v))
            except (TypeError, ValueError):
                return None
    return None


def _to_contents(messages: Sequence[dict[str, Any]]) -> list[Any]:
    from google.genai import types
    out: list[Any] = []
    for m in messages:
        role = "model" if m.get("role") in ("model", "assistant") else m.get("role", "user")
        parts_in = m.get("parts")
        if parts_in is None:
            content = m.get("content", "")
            if isinstance(content, str):
                parts_in = [types.Part(text=content)] if content else []
            elif isinstance(content, list):
                parts_in = content
            else:
                parts_in = [types.Part(text=str(content))]
        parts: list[Any] = []
        for p in parts_in:
            if isinstance(p, types.Part):
                parts.append(p)
            elif isinstance(p, dict):
                if "function_call" in p:
                    fc = p["function_call"]
                    parts.append(types.Part(function_call=types.FunctionCall(
                        id=fc.get("id"), name=fc["name"], args=fc.get("args", {}))))
                elif "function_response" in p:
                    fr = p["function_response"]
                    parts.append(types.Part(function_response=types.FunctionResponse(
                        id=fr.get("id"), name=fr["name"], response=fr.get("response", {}))))
                elif "inline_data" in p:
                    d = p["inline_data"]
                    parts.append(types.Part(inline_data=types.Blob(
                        mime_type=d.get("mime_type", "application/octet-stream"),
                        data=d.get("data", ""))))
                elif "text" in p:
                    parts.append(types.Part(text=p["text"]))
                else:
                    parts.append(types.Part(text=json.dumps(p, default=str)))
            else:
                parts.append(types.Part(text=str(p)))
        if parts:
            out.append(types.Content(role=role, parts=parts))
    return out


def _usage_from(resp: Any, model: str) -> Usage:
    um = getattr(resp, "usage_metadata", None)
    if um is None:
        return Usage()
    g = lambda k: int(getattr(um, k, 0) or 0)  # noqa: E731
    prompt = g("prompt_token_count")
    outp = g("response_token_count") or g("candidates_token_count")
    u = Usage(prompt_tokens=prompt, output_tokens=outp, thoughts_tokens=g("thoughts_token_count"),
              cached_tokens=g("cached_content_token_count"),
              total_tokens=g("total_token_count") or (prompt + outp), requests=1)
    u.cost_usd = catalog.estimate_cost(model, prompt, outp + u.thoughts_tokens)
    return u


def _parse_response(resp: Any, model: str) -> LLMResponse:
    out = LLMResponse(model=getattr(resp, "model_version", None) or model)
    out.usage = _usage_from(resp, model)

    pf = getattr(resp, "prompt_feedback", None)
    if pf is not None:
        blocked = getattr(pf, "block_reason", None)
        if blocked:
            out.safety_blocked = True
            out.block_reason = str(blocked)

    candidates = getattr(resp, "candidates", None) or []
    if not candidates:
        return out
    cand = candidates[0]
    out.finish_reason = str(getattr(cand, "finish_reason", "") or "")
    content = getattr(cand, "content", None)
    parts = getattr(content, "parts", None) or []
    texts: list[str] = []
    thoughts: list[str] = []
    for p in parts:
        if getattr(p, "thought", False):
            t = getattr(p, "text", None)
            if t:
                thoughts.append(t)
            continue
        t = getattr(p, "text", None)
        if t:
            texts.append(t)
        fc = getattr(p, "function_call", None)
        if fc is not None:
            out.function_calls.append(FunctionCallSpec(
                id=str(getattr(fc, "id", "") or ""),
                name=str(getattr(fc, "name", "") or ""),
                args=dict(getattr(fc, "args", None) or {})))
    out.text = "".join(texts).strip()
    out.thoughts = "\n".join(thoughts).strip()
    return out


def _extract_audio(resp: Any) -> tuple[str | None, str]:
    for cand in getattr(resp, "candidates", None) or []:
        for p in getattr(getattr(cand, "content", None), "parts", None) or []:
            blob = getattr(p, "inline_data", None)
            if blob is not None and getattr(blob, "data", None):
                data = blob.data
                if isinstance(data, bytes):
                    data = base64.b64encode(data).decode()
                return str(data), str(getattr(blob, "mime_type", "") or "audio/L16;rate=24000")
    return None, ""


def _pcm_to_wav(pcm: bytes, mime: str) -> bytes:
    """Wrap raw PCM (Gemini TTS returns ``audio/L16;rate=24000``) in a WAV header."""
    import wave
    rate = 24000
    if "rate=" in mime:
        try:
            rate = int(mime.split("rate=")[1].split(";")[0])
        except (ValueError, IndexError):
            rate = 24000
    channels = 2 if ";channels=2" in mime.lower() else 1
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()
