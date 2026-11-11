"""Gemini model catalog.

Data transcribed from the official Gemini API documentation
(https://aistudio.google.com/docs/models, /docs/pricing, /docs/rate-limits)
as of 2026-11-11. Prices and availability change; the catalog is only used for
*labelling and defaults*. The authoritative list always comes from a live
``models.list()`` call against the user's own key — see
:meth:`GeminiProvider.list_models`.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

CATALOG_DATE = "2026-11-11"
DEFAULT_API_VERSION = "v1beta"
DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"

#: Default model for the autonomous agent loop: strongest Flash tier, explicitly
#: engineered by Google for long-horizon agentic work, and free-tier eligible.
DEFAULT_AGENT_MODEL = "gemini-3.8-flash"
DEFAULT_LIVE_MODEL = "gemini-3.8-live"
DEFAULT_TTS_MODEL = "gemini-3.8-flash-tts"
DEFAULT_STT_MODEL = "gemini-3.5-transcribe"
DEFAULT_IMAGE_MODEL = "gemini-nano-banana-2.1"

#: Prebuilt TTS voices offered by the Gemini speech API.
PREBUILT_VOICES = [
    "Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr",
    "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algenib",
    "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux",
    "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia",
    "Sadaltager", "Sulafat",
]


@dataclass(slots=True)
class ModelInfo:
    id: str
    display_name: str
    family: str                       # agent | live | tts | stt | image | video | embedding
    description: str = ""
    context_tokens: int | None = None
    max_output_tokens: int | None = None
    modalities: list[str] = field(default_factory=list)
    supports_function_calling: bool = True
    supports_streaming: bool = True
    supports_thinking: bool = True
    free_tier: bool = True
    #: USD per 1M tokens, paid tier, as documented on CATALOG_DATE.
    price_input: float | None = None
    price_output: float | None = None
    price_note: str = ""
    deprecated: bool = False
    live: bool = False
    available: bool | None = None     # filled in by a real models.list() call

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _m(id: str, display: str, family: str, desc: str = "", **kw: Any) -> ModelInfo:
    return ModelInfo(id=id, display_name=display, family=family, description=desc, **kw)


KNOWN_MODELS: list[ModelInfo] = [
    # ---- Gemini 4 (frontier reasoning; paid tier only) -------------------
    _m("gemini-4-carbon", "Gemini 4 Carbon", "agent",
       "Strongest reasoning model: complex software engineering, multimodal knowledge work, "
       "scientific reasoning, autonomous multi-step agents, long decode up to 1M tokens.",
       context_tokens=1_000_000, max_output_tokens=1_000_000,
       modalities=["text", "image", "audio", "video", "pdf"],
       free_tier=False, price_input=2.00, price_output=10.00,
       price_note="$2.00/$10.00 per 1M tokens through 2026-11-30; $4.00/$20.00 from 2026-12-01. "
                  "Not available on the Free tier. Thinking tokens are billed."),
    _m("gemini-4-argon", "Gemini 4 Argon", "agent",
       "Efficient Gemini 4 frontier reasoning: faster responses and lower token spend per turn "
       "than Carbon across agentic, coding, math and science tasks.",
       context_tokens=1_000_000, max_output_tokens=1_000_000,
       modalities=["text", "image", "audio", "video", "pdf"],
       free_tier=False, price_input=2.00, price_output=10.00,
       price_note="Same schedule as Gemini 4 Carbon. Not available on the Free tier."),

    # ---- Gemini 3.x agents ----------------------------------------------
    _m("gemini-3.8-flash", "Gemini 3.8 Flash", "agent",
       "Most intelligent Flash model; engineered for long-horizon software engineering, "
       "autonomous agents and complex enterprise workflows. IGRIS default reasoning model.",
       context_tokens=1_000_000, modalities=["text", "image", "audio", "video", "pdf"],
       free_tier=True, price_input=0.75, price_output=3.75,
       price_note="$0.75/$3.75 per 1M tokens through 2026-12-31; $1.50/$7.50 from 2027-01-01. "
                  "Free tier: free of charge but rate limited (see AI Studio rate-limit page)."),
    _m("gemini-3.6-flash", "Gemini 3.6 Flash", "agent",
       "Previous-generation Flash; balances speed and multimodal capability for agentic tasks.",
       context_tokens=1_000_000, modalities=["text", "image", "audio", "video", "pdf"],
       free_tier=True, price_input=0.75, price_output=3.75,
       price_note="$0.75/$3.75 per 1M through 2026-12-31; $1.50/$7.50 from 2027-01-01."),
    _m("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", "agent",
       "Fastest, most cost-effective 3.5 model for high-throughput execution. "
       "gemini-2.5-flash requests route here from 2026-12-01.",
       context_tokens=1_000_000, modalities=["text", "image", "audio", "video"],
       free_tier=True, price_input=0.30, price_output=2.50,
       price_note="Cheap default for high-volume tool loops."),
    _m("gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite", "agent",
       "Frontier-class performance rivaling larger models at a fraction of the cost.",
       free_tier=True, price_input=0.10, price_output=0.40,
       price_note="$0.10 in / $0.40 out per 1M tokens (text/image/video)."),
    _m("gemini-3.1-pro-preview", "Gemini 3.1 Pro (preview)", "agent",
       "High-capability Pro preview model.",
       free_tier=True, price_input=2.00, price_output=12.00,
       price_note="$2.00 in for prompts <= 200k tokens; $12.00/$15.00 out. Preview model."),
    _m("gemini-3-flash-preview", "Gemini 3 Flash (preview)", "agent",
       "Frontier-class performance at a fraction of larger-model cost.",
       free_tier=True, price_input=0.50, price_output=3.00, price_note="Preview model."),

    # ---- Live API (bidirectional speech-to-speech) -----------------------
    _m("gemini-3.8-live", "Gemini 3.8 Live", "live",
       "Default Live API model for low-latency voice agents without reasoning delays.",
       modalities=["audio", "text", "image", "video"], live=True, free_tier=True,
       supports_thinking=False,
       price_note="Live API: audio in/out billed per minute-token; free tier available."),
    _m("gemini-3.8-live-extended-thinking", "Gemini 3.8 Live Extended Thinking", "live",
       "High-reasoning Live API model; use when deeper background reasoning is required.",
       modalities=["audio", "text", "image", "video"], live=True, free_tier=True,
       price_note="Live API with extended thinking; higher latency and cost."),
    _m("gemini-3.1-flash-live-preview", "Gemini 3.1 Flash Live (preview)", "live",
       "Legacy Live API preview. Google recommends Gemini 3.8 Live.",
       live=True, free_tier=True, deprecated=True),
    _m("gemini-2.5-flash-native-audio-preview-12-2025",
       "Gemini 2.5 Flash Native Audio (Live)", "live",
       "Native-audio Live model optimised for pacing, naturalness and mood.",
       live=True, free_tier=True, price_input=0.50, price_output=2.00,
       price_note="$0.50 text in / $3.00 audio+video in; $2.00 text out / $12.00 audio out per 1M."),

    # ---- TTS -------------------------------------------------------------
    _m("gemini-3.8-flash-tts", "Gemini 3.8 Flash TTS", "tts",
       "Flagship creative TTS: studio-grade fidelity, expressive acting, voice design and "
       "voice replication. Accepts text only, outputs audio only.",
       modalities=["audio"], supports_function_calling=False, supports_thinking=False,
       free_tier=True, price_input=0.50, price_output=10.00,
       price_note="$0.50 per 1M text tokens in; $10.00 per 1M audio tokens out."),
    _m("gemini-3.8-flash-lite-tts", "Gemini 3.8 Flash-Lite TTS", "tts",
       "Fast, cost-efficient TTS for high-volume production and real-time cascades.",
       modalities=["audio"], supports_function_calling=False, supports_thinking=False,
       free_tier=True, price_note="Cheaper than Flash TTS; same voice set."),
    _m("gemini-3.1-flash-tts-preview", "Gemini 3.1 Flash TTS (preview)", "tts",
       "Legacy TTS preview; Google recommends the 3.8 TTS models.",
       modalities=["audio"], supports_function_calling=False, deprecated=True, free_tier=True),
    _m("gemini-2.5-flash-preview-tts", "Gemini 2.5 Flash Preview TTS", "tts",
       "Legacy price-performant low-latency TTS.",
       modalities=["audio"], supports_function_calling=False, deprecated=True,
       free_tier=True, price_input=0.50, price_output=10.00),

    # ---- STT -------------------------------------------------------------
    _m("gemini-3.5-transcribe", "Gemini 3.5 Transcribe", "stt",
       "Low-latency speech-to-text with utterance-based language detection, speaker "
       "diarization and word timestamps.",
       modalities=["audio", "text"], supports_function_calling=False,
       supports_thinking=False, free_tier=True),
    _m("gemini-3.5-transcribe-live", "Gemini 3.5 Transcribe Live", "stt",
       "Streaming speech-to-text endpoint.",
       modalities=["audio", "text"], supports_function_calling=False,
       supports_thinking=False, free_tier=True, live=True),

    # ---- Image / video generation ---------------------------------------
    _m("gemini-nano-banana-2.1", "Nano Banana 2.1", "image",
       "High-efficiency image generation/editing with improved quality, typography and "
       "multi-turn consistency.",
       modalities=["text", "image"], supports_function_calling=False, free_tier=False,
       price_note="Image output billed per image (≈$0.039 for a 1024x1024 image at $30/1M tokens)."),
    _m("gemini-3.1-flash-image", "Nano Banana 2", "image",
       "Powerful, high-efficiency image generation and editing.",
       modalities=["text", "image"], supports_function_calling=False, free_tier=False),
    _m("gemini-3-pro-image", "Nano Banana Pro", "image",
       "State-of-the-art contextual native image creation.",
       modalities=["text", "image"], supports_function_calling=False, free_tier=False),
    _m("gemini-omni-1.2-flash", "Gemini Omni Flash", "video",
       "Generate/edit up to 15 s of video with native audio, keyframe interpolation, "
       "video extension and character consistency.",
       modalities=["text", "image", "video", "audio"], supports_function_calling=False,
       free_tier=False,
       price_note="Free tier not supported. Tier 1: 8 RPM / 40 RPD."),

    # ---- Utilities -------------------------------------------------------
    _m("gemini-embedding-2", "Gemini Embedding 2", "embedding",
       "Multimodal embedding model mapping text, image, audio, video and PDF into one space.",
       supports_function_calling=False, supports_thinking=False, free_tier=True),
    _m("gemini-3.5-live-translate-preview", "Gemini 3.5 Live Translate", "live",
       "Real-time speech-to-speech translation across 70+ languages.",
       live=True, supports_function_calling=False, free_tier=True),

    # ---- Deprecated ------------------------------------------------------
    _m("gemini-2.5-flash", "Gemini 2.5 Flash", "agent",
       "Deprecated. No longer selectable in AI Studio; from 2026-12-01 API requests route "
       "automatically to gemini-3.5-flash-lite.",
       context_tokens=1_000_000, deprecated=True, free_tier=True,
       price_input=0.30, price_output=2.50),
    _m("gemini-2.5-pro", "Gemini 2.5 Pro", "agent",
       "Deprecated. From 2026-12-01 API requests route automatically to gemini-3.8-flash.",
       deprecated=True, free_tier=True),
]

BY_ID: dict[str, ModelInfo] = {m.id: m for m in KNOWN_MODELS}


def family_models(family: str) -> list[ModelInfo]:
    return [m for m in KNOWN_MODELS if m.family == family]


def pick(family: str, preferred: str | None = None) -> ModelInfo:
    """Best available model for a role, honouring a user preference."""
    if preferred and preferred in BY_ID and BY_ID[preferred].family == family:
        return BY_ID[preferred]
    if preferred:
        # user picked something we do not know about — trust them, label it
        return ModelInfo(id=preferred, display_name=preferred, family=family,
                         description="user-specified model (not in local catalog)")
    defaults = {"agent": DEFAULT_AGENT_MODEL, "live": DEFAULT_LIVE_MODEL,
                "tts": DEFAULT_TTS_MODEL, "stt": DEFAULT_STT_MODEL,
                "image": DEFAULT_IMAGE_MODEL}
    return BY_ID[defaults.get(family, DEFAULT_AGENT_MODEL)]


def estimate_cost(model_id: str, prompt_tokens: int, output_tokens: int) -> float | None:
    info = BY_ID.get(model_id)
    if not info or info.price_input is None or info.price_output is None:
        return None
    return round((prompt_tokens / 1e6) * info.price_input
                 + (output_tokens / 1e6) * info.price_output, 6)


FREE_TIER_DISCLOSURE = (
    "The Gemini API Free tier is rate limited, not unlimited. Limits are enforced per Cloud "
    "project (not per key) across requests-per-minute, tokens-per-minute and requests-per-day, "
    "and RPD quotas reset at midnight Pacific time. Exact numbers depend on your tier and are "
    "shown at https://aistudio.google.com/rate-limit. Frontier models (Gemini 4 Carbon/Argon) "
    "are NOT available on the Free tier. On the Free tier your content may be used by Google to "
    "improve their products; on a paid tier it is not. Grounding with Google Search is capped "
    "at 1,500 requests/day, with 5,000 free search requests per month shared across Gemini 3+ "
    "models and $14 per 1,000 thereafter. IGRIS retries with exponential backoff on HTTP 429 "
    "and surfaces the real provider error instead of hiding it."
)
