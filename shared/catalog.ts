// The resource catalog. One list drives everything: the paid /v1 routes, the
// Tools page, the docs, and the tools the agent in Ask can call.
// Prices are in USD and settle 1:1 in USDG (Robinhood Chain) or USDC (Base).

export type Category = "llm" | "image" | "video" | "audio" | "vision" | "web" | "onchain" | "stocks" | "prediction" | "content";

export type Field = {
  name: string;
  type: "string" | "number" | "enum" | "address" | "url" | "network";
  required?: boolean;
  description: string;
  options?: string[];
  max?: number;
  example?: string | number;
};

export type Resource = {
  id: string;
  name: string;
  category: Category;
  /** Price per call in USD, as a decimal string so it never drifts through floats. */
  price: string;
  summary: string;
  provider: string;
  /** What comes back. */
  returns: string;
  fields: Field[];
  /** Paid upstream that runs it. Absent = Workers AI or Siro's own code. */
  via?: "replicate";
  /** Fixed request fields sent upstream (resolution, duration, quality), so the price stays fixed. */
  params?: Record<string, unknown>;
  /** How the upstream takes a shape: an aspect_ratio string, a "WxH" size, or width + height. */
  shape?: "ratio" | "size" | "wh";
  /** LLMs only: the input names for the system prompt and the output cap on this model. */
  keys?: LlmKeys;
  /** Takes minutes, not seconds: the payment window is longer and the call waits on a queue. */
  slow?: boolean;
  /** Model behind it: a Workers AI id or a Replicate model (owner/name). */
  model?: string;
  /** Short words that help the agent pick the right tool. */
  tags?: string[];
};

export const CATEGORIES: Record<Category, string> = {
  llm: "LLM",
  image: "Image generation",
  video: "Video generation",
  audio: "Audio",
  vision: "Vision",
  web: "Web",
  onchain: "On-chain data",
  stocks: "Tokenized stocks",
  prediction: "Prediction markets",
  content: "Content",
};

const PROMPT: Field = { name: "prompt", type: "string", required: true, description: "What you want, in plain words.", max: 24000, example: "Explain x402 in two sentences." };
const SYSTEM: Field = { name: "system", type: "string", description: "Optional instructions that shape every answer.", max: 8000 };
const MAX_TOKENS: Field = { name: "max_tokens", type: "number", description: "Output cap. 2048 at most, 1024 by default.", max: 2048, example: 1024 };
const NETWORK: Field = { name: "network", type: "network", description: "robinhood (default) or base.", options: ["robinhood", "base"], example: "robinhood" };
const TOKEN: Field = { name: "address", type: "address", required: true, description: "Token contract address (0x…).", example: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" };
const IMAGE_PROMPT: Field = { name: "prompt", type: "string", required: true, description: "Describe the image.", max: 2000, example: "A chrome ball on brushed aluminium, studio light" };
const SIZE: Field = { name: "size", type: "enum", description: "Square, wide or tall.", options: ["1024x1024", "1280x768", "768x1280"], example: "1024x1024" };

const llm = (id: string, name: string, model: string, price: string, summary: string, tags: string[] = []): Resource => ({
  id,
  name,
  category: "llm",
  price,
  summary,
  provider: "Workers AI",
  returns: "{ text, model, usage }",
  model,
  fields: [PROMPT, SYSTEM, MAX_TOKENS],
  tags: ["chat", "write", "answer", ...tags],
});

const image = (id: string, name: string, model: string, price: string, summary: string): Resource => ({
  id,
  name,
  category: "image",
  price,
  summary,
  provider: "Workers AI",
  returns: "{ image: data:image/png;base64,… }",
  model,
  fields: [IMAGE_PROMPT, SIZE],
  tags: ["image", "picture", "logo", "art", "generate"],
});


// ---- Premium models on Replicate (LLMs, image, video, audio) ----
// One upstream, one key. Prices are fixed per call and sit above Replicate's published rate for the
// exact settings sent (checked on each model's page, 10 Nov 2026); requests are capped so a call
// cannot cost more than its price.

const PROMPT_P: Field = { ...PROMPT, max: 16000 };
const SYSTEM_P: Field = { ...SYSTEM, max: 4000 };

/** Worst case for one call: 6,000 input tokens (the prompt and system caps) and 2,048 output tokens, plus 20%. */
function perCall(inPerM: number, outPerM: number): string {
  const usd = ((6000 * inPerM + 2048 * outPerM) / 1e6) * 1.2;
  return Math.max(0.005, Math.ceil(usd / 0.005) * 0.005)
    .toFixed(3)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

/** Replicate LLMs name their inputs differently: where the system prompt and the output cap go. */
export type LlmKeys = { system?: string; max: string };

const frontier = (id: string, name: string, model: string, inPerM: number, outPerM: number, provider: string, keys: LlmKeys, params: Record<string, unknown>, summary: string, tags: string[] = []): Resource => ({
  id,
  name,
  category: "llm",
  price: perCall(inPerM, outPerM),
  summary,
  provider,
  returns: "{ text, model }",
  via: "replicate",
  model,
  keys,
  params,
  fields: [PROMPT_P, SYSTEM_P, MAX_TOKENS],
  tags: ["chat", "write", "answer", ...tags],
});

const ASPECT: Field = { name: "aspect", type: "enum", description: "Shape of the image.", options: ["1:1", "16:9", "9:16", "4:3", "3:4"], example: "1:1" };
const IMAGE_PROMPT_P: Field = { ...IMAGE_PROMPT, max: 4000, example: "A steel ball rolling along a black S-shaped track, studio light" };

const replicateImage = (id: string, name: string, model: string, price: string, provider: string, shape: Resource["shape"], summary: string, params: Record<string, unknown> = {}): Resource => ({
  id,
  name,
  category: "image",
  price,
  summary,
  provider,
  returns: "{ image: https://…, model, expiresAt }",
  via: "replicate",
  model,
  shape,
  params,
  fields: [IMAGE_PROMPT_P, ASPECT],
  tags: ["image", "picture", "logo", "art", "generate", "banner"],
});

const replicateVideo = (id: string, name: string, model: string, price: string, provider: string, aspects: string[], summary: string, params: Record<string, unknown>): Resource => ({
  id,
  name,
  category: "video",
  price,
  summary,
  provider,
  returns: "{ video: https://….mp4, model, expiresAt }",
  via: "replicate",
  model,
  shape: "ratio",
  slow: true,
  params,
  fields: [
    { name: "prompt", type: "string", required: true, description: "Describe the shot: subject, motion, camera.", max: 2500, example: "A steel ball rolls along a black S-shaped track, slow dolly in" },
    { name: "aspect", type: "enum", description: "Frame shape.", options: aspects, example: aspects[0] },
  ],
  tags: ["video", "clip", "animation", "generate"],
});

const ANTHROPIC: LlmKeys = { system: "system_prompt", max: "max_tokens" };
const OPENAI: LlmKeys = { system: "system_prompt", max: "max_completion_tokens" };
const GOOGLE: LlmKeys = { system: "system_instruction", max: "max_output_tokens" };

const PREMIUM: Resource[] = [
  // Frontier LLMs
  frontier("claude-opus-5-5", "Claude Opus 5.5", "anthropic/claude-opus-5.5", 4, 20, "Anthropic", ANTHROPIC, { effort: "low" }, "Anthropic's most capable model for deep reasoning, code and long tasks.", ["reasoning", "code"]),
  frontier("claude-sonnet-5", "Claude Sonnet 5", "anthropic/claude-sonnet-5", 2, 10, "Anthropic", ANTHROPIC, { effort: "low" }, "Anthropic's fast frontier model. Strong writing, code and analysis.", ["code", "writing"]),
  frontier("claude-haiku-4-5", "Claude Haiku 4.5", "anthropic/claude-4.5-haiku", 1, 5, "Anthropic", ANTHROPIC, {}, "Anthropic's quickest model. Summaries, extraction and replies.", ["fast", "cheap"]),
  frontier("gpt-5-6-sol", "GPT-5.6 Sol", "openai/gpt-5.6-sol", 2, 10, "OpenAI", OPENAI, { reasoning_effort: "low" }, "OpenAI's flagship GPT-5.6 for hard problems and careful answers.", ["reasoning"]),
  frontier("gpt-5-6-terra", "GPT-5.6 Terra", "openai/gpt-5.6-terra", 2.5, 15, "OpenAI", OPENAI, { reasoning_effort: "low" }, "GPT-5.6 tuned for long, structured work.", ["general"]),
  frontier("gpt-5-6-luna", "GPT-5.6 Luna", "openai/gpt-5.6-luna", 1, 6, "OpenAI", OPENAI, { reasoning_effort: "none" }, "OpenAI's small GPT-5.6. Fast and cheap for everyday calls.", ["fast", "cheap"]),
  frontier("gemini-3-1-pro", "Gemini 3.1 Pro", "google/gemini-3.1-pro", 2, 12, "Google", GOOGLE, { thinking_level: "low" }, "Google's top Gemini for careful reasoning.", ["reasoning", "long context"]),
  frontier("gemini-3-5-flash", "Gemini 3.5 Flash", "google/gemini-3.5-flash", 1.5, 9, "Google", GOOGLE, { thinking_level: "none" }, "The quick Gemini, for short answers at a low price.", ["fast"]),

  // Image
  replicateImage("nano-banana-pro", "Nano Banana Pro", "google/nano-banana-pro", "0.18", "Google", "ratio", "Google's top Nano Banana. Realism and legible text.", { resolution: "1K", output_format: "jpg" }),
  replicateImage("nano-banana-2-1", "Nano Banana 2.1", "google/nano-banana-2.1", "0.045", "Google", "ratio", "Google's newest Nano Banana. Fast, faithful, good typography.", { resolution: "1K", output_format: "jpg" }),
  replicateImage("nano-banana-2", "Nano Banana 2", "google/nano-banana-2", "0.085", "Google", "ratio", "Nano Banana 2 at 1K. A reliable all-rounder.", { resolution: "1K", output_format: "jpg" }),
  replicateImage("gpt-image-2", "GPT Image 2", "openai/gpt-image-2", "0.06", "OpenAI", "ratio", "OpenAI's image model. Follows long prompts closely.", { quality: "medium", output_format: "webp" }),
  replicateImage("seedream-5-pro", "Seedream 5.0 Pro", "bytedance/seedream-5-pro", "0.06", "ByteDance", "ratio", "ByteDance's flagship image model. Rich detail and posters.", { size: "1K", output_format: "jpeg" }),
  replicateImage("seedream-5-lite", "Seedream 5.0 Lite", "bytedance/seedream-5-lite", "0.045", "ByteDance", "ratio", "Fast Seedream for drafts and variations.", { size: "2K", output_format: "jpeg" }),
  replicateImage("grok-imagine-image-2", "Grok Imagine Image 2", "xai/grok-imagine-image-2", "0.05", "xAI", "ratio", "xAI's image model. Bold, playful compositions.", { resolution: "1k", quality: "low" }),
  replicateImage("flux-3", "FLUX 3", "black-forest-labs/flux-3-image", "0.06", "Black Forest Labs", "ratio", "Black Forest Labs' newest FLUX at one megapixel.", { resolution: "1k", output_format: "webp" }),
  replicateImage("flux-2-pro", "FLUX.2 Pro", "black-forest-labs/flux-2-pro", "0.04", "Black Forest Labs", "ratio", "FLUX.2 Pro. Photoreal product and brand shots.", { resolution: "1 MP", output_format: "webp" }),
  replicateImage("krea-3", "Krea 3", "krea/krea-3", "0.04", "Krea", "ratio", "Krea's aesthetic model. Natural light and texture.", { resolution: "1k", thinking_mode: "fast" }),
  replicateImage("ideogram-4-5", "Ideogram 4.5", "ideogram-ai/ideogram-4-5", "0.075", "Ideogram", "size", "The model for words in images: logos, posters, covers.", { quality: "medium" }),
  replicateImage("qwen-image-3", "Qwen Image 3", "alibaba/qwen-image-3", "0.04", "Alibaba", "ratio", "Alibaba's image model. Strong multilingual text rendering."),
  replicateImage("z-image-turbo", "Z-Image Turbo", "prunaai/z-image-turbo", "0.01", "Tongyi", "wh", "Eight-step turbo model. A cent per image.", { output_format: "jpg" }),
  replicateImage("recraft-vector", "Recraft V4.1 SVG", "recraft-ai/recraft-v4.1-svg", "0.05", "Recraft", "ratio", "Returns an SVG: icons, logos and flat illustrations you can edit."),

  // Video. Length and resolution are fixed, so the price is fixed.
  replicateVideo("seedance-2-5", "Seedance 2.5", "bytedance/seedance-2.5", "0.65", "ByteDance", ["16:9", "9:16", "1:1"], "ByteDance's top video model. 5 s at 480p with sound.", { resolution: "480p", duration: 5, generate_audio: true }),
  replicateVideo("seedance-2-mini", "Seedance 2.0 Mini", "bytedance/seedance-2.0-mini", "0.25", "ByteDance", ["16:9", "9:16", "1:1"], "Light Seedance. 5 s at 480p with sound.", { resolution: "480p", duration: 5, generate_audio: true }),
  replicateVideo("grok-imagine-video", "Grok Imagine Video", "xai/grok-imagine-video", "0.5", "xAI", ["16:9", "9:16", "1:1"], "xAI's video model. 5 s at 720p.", { resolution: "720p", duration: 5 }),
  replicateVideo("kling-4", "Kling 4.0", "kwaivgi/kling-v4.0", "0.95", "Kling", ["16:9", "9:16", "1:1"], "Kling's latest. Cinematic motion, 5 s at 720p.", { resolution: "720p", duration: 5 }),
  replicateVideo("veo-3-1-fast", "Veo 3.1 Fast", "google/veo-3.1-fast", "0.75", "Google", ["16:9", "9:16"], "Google Veo with native sound. 4 s at 720p.", { resolution: "720p", duration: 4, generate_audio: true }),
  replicateVideo("ltx-2-5-fast", "LTX 2.5 Fast", "lightricks/ltx-2.5-fast", "0.25", "Lightricks", ["16:9", "9:16"], "Lightricks LTX with native audio. 6 s at 720p.", { resolution: "720p", duration: 6, generate_audio: true }),

  // Audio
  {
    id: "eleven-v3",
    name: "ElevenLabs v3 Voice",
    category: "audio",
    price: "0.12",
    summary: "ElevenLabs' most expressive speech model. Up to 1,000 characters.",
    provider: "ElevenLabs",
    returns: "{ audio: https://….mp3, model, expiresAt }",
    via: "replicate",
    model: "elevenlabs/v3",
    fields: [
      { name: "text", type: "string", required: true, description: "Text to speak.", max: 1000, example: "Your agent just paid for this sentence." },
      { name: "voice", type: "enum", description: "Voice.", options: ["Rachel", "Aria", "Roger", "Sarah", "Drew", "Paul", "James", "Jane"], example: "Rachel" },
    ],
    tags: ["speech", "voice", "tts", "audio", "narration"],
  },
  {
    id: "eleven-music",
    name: "ElevenLabs Music",
    category: "audio",
    price: "0.6",
    summary: "An instrumental or vocal track from a description, up to 60 seconds.",
    provider: "ElevenLabs",
    returns: "{ audio: https://….mp3, model, expiresAt }",
    via: "replicate",
    model: "elevenlabs/music",
    slow: true,
    fields: [
      { name: "prompt", type: "string", required: true, description: "Genre, mood, instruments, tempo.", max: 2000, example: "Minimal techno, 120 bpm, warm bass" },
      { name: "seconds", type: "number", description: "Length, 10 to 60 seconds.", max: 60, example: 30 },
      { name: "instrumental", type: "enum", description: "No vocals.", options: ["yes", "no"], example: "yes" },
    ],
    tags: ["music", "song", "audio", "soundtrack"],
  },
  {
    id: "minimax-music",
    name: "MiniMax Music 2.6",
    category: "audio",
    price: "0.18",
    summary: "A full song with your lyrics, or an instrumental from a style prompt.",
    provider: "MiniMax",
    returns: "{ audio: https://….mp3, model, expiresAt }",
    via: "replicate",
    model: "minimax/music-2.6",
    slow: true,
    fields: [
      { name: "prompt", type: "string", required: true, description: "Style, mood and instruments.", max: 2000, example: "Upbeat synth-pop, female vocals" },
      { name: "lyrics", type: "string", description: "Lyrics to sing. Leave empty for an instrumental.", max: 3000, example: "Little steel ball, rolling down the line" },
    ],
    tags: ["music", "song", "lyrics", "audio"],
  },
  {
    id: "lyria-3",
    name: "Lyria 3",
    category: "audio",
    price: "0.05",
    summary: "Google's music model. A short instrumental clip from a description.",
    provider: "Google",
    returns: "{ audio: https://…, model, expiresAt }",
    via: "replicate",
    model: "google/lyria-3",
    fields: [{ name: "prompt", type: "string", required: true, description: "Genre, mood, instruments.", max: 2000, example: "Calm piano with soft rain" }],
    tags: ["music", "audio", "soundtrack"],
  },
];

export const RESOURCES: Resource[] = [
  ...PREMIUM,

  // LLM
  llm("kimi-k2-6", "Kimi K2.6", "@cf/moonshotai/kimi-k2.6", "0.02", "Moonshot's agentic flagship. Long reasoning, strong tool use.", ["reasoning", "agent"]),
  llm("deepseek-v4-pro", "DeepSeek V4 Pro", "@cf/deepseek-ai/deepseek-v4-pro-0813", "0.025", "DeepSeek's top model for hard reasoning, math and code.", ["reasoning", "code", "math"]),
  llm("glm-5-3", "GLM 5.3", "@cf/zai-org/glm-5.3", "0.025", "Z.ai's frontier model. Careful writing and multi-step planning.", ["reasoning", "writing"]),
  llm("qwen-3-8", "Qwen 3.8 27B", "@cf/qwen/qwen3.8-27b", "0.015", "Alibaba's dense 27B. Fast, multilingual, solid at code.", ["multilingual", "code"]),
  llm("nemotron-3", "Nemotron 3 120B", "@cf/nvidia/nemotron-3-120b-a12b", "0.01", "NVIDIA's open MoE model tuned for agent workflows.", ["agent"]),
  llm("gpt-oss-120b", "GPT-OSS 120B", "@cf/openai/gpt-oss-120b", "0.006", "OpenAI's open-weight 120B. Reasoning at a low price.", ["reasoning"]),
  llm("deepseek-v4-1-flash", "DeepSeek V4.1 Flash", "@cf/deepseek-ai/deepseek-v4.1-flash-1017", "0.007", "Quick DeepSeek for everyday questions and drafts.", ["fast"]),
  llm("llama-4-scout", "Llama 4 Scout", "@cf/meta/llama-4-scout-17b-16e-instruct", "0.006", "Meta's multimodal MoE. Good general assistant.", ["general"]),
  llm("gemma-4", "Gemma 4 26B", "@cf/google/gemma-4-26b-a4b-it", "0.002", "Google's open model. The cheapest LLM in this catalog.", ["cheap", "fast"]),

  // Image
  image("flux-2-dev", "FLUX.2 dev", "@cf/black-forest-labs/flux-2-dev", "0.04", "Black Forest Labs' FLUX.2. High fidelity, accurate text in images."),
  image("flux-2-klein-4b", "FLUX.2 klein 4B", "@cf/black-forest-labs/flux-2-klein-4b", "0.01", "Smallest FLUX.2. Fast drafts and variations."),
  image("lucid-origin", "Lucid Origin", "@cf/leonardo/lucid-origin", "0.04", "Leonardo's prompt-faithful model. Strong on design and typography."),
  image("phoenix-1", "Phoenix 1.0", "@cf/leonardo/phoenix-1.0", "0.035", "Leonardo Phoenix. Polished, coherent compositions."),
  image("flux-1-schnell", "FLUX.1 schnell", "@cf/black-forest-labs/flux-1-schnell", "0.005", "The quick classic. Four steps, half a cent."),

  // Audio
  {
    id: "tts-aura-2",
    name: "Aura 2 Voice",
    category: "audio",
    price: "0.04",
    summary: "Deepgram Aura 2. Natural English speech from text, up to 1,000 characters.",
    provider: "Workers AI",
    returns: "{ audio: data:audio/mpeg;base64,… }",
    model: "@cf/deepgram/aura-2-en",
    fields: [{ name: "text", type: "string", required: true, description: "Text to speak.", max: 1000, example: "Your agent just paid for this sentence." }],
    tags: ["speech", "voice", "tts", "audio"],
  },
  {
    id: "tts-melo",
    name: "MeloTTS",
    category: "audio",
    price: "0.002",
    summary: "Light multilingual text-to-speech. Cheap narration for drafts.",
    provider: "Workers AI",
    returns: "{ audio: data:audio/mpeg;base64,… }",
    model: "@cf/myshell-ai/melotts",
    fields: [
      { name: "text", type: "string", required: true, description: "Text to speak.", max: 1000, example: "Hello from Siro." },
      { name: "lang", type: "enum", description: "Language.", options: ["en", "es", "fr", "zh", "ja", "ko"], example: "en" },
    ],
    tags: ["speech", "voice", "tts", "audio"],
  },
  {
    id: "stt-whisper",
    name: "Whisper v3 Turbo",
    category: "audio",
    price: "0.01",
    summary: "Transcribe audio from an HTTPS link. Files up to 10 MB.",
    provider: "Workers AI",
    returns: "{ text, language }",
    model: "@cf/openai/whisper-large-v3-turbo",
    fields: [{ name: "url", type: "url", required: true, description: "HTTPS link to an audio file (mp3, wav, m4a, ogg).", example: "https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac" }],
    tags: ["transcribe", "speech to text", "audio"],
  },

  // Vision + language
  {
    id: "vision-describe",
    name: "Image Describe",
    category: "vision",
    price: "0.006",
    summary: "Ask a question about an image at an HTTPS link. Llama 4 Scout reads it.",
    provider: "Workers AI",
    returns: "{ text }",
    model: "@cf/meta/llama-4-scout-17b-16e-instruct",
    fields: [
      { name: "url", type: "url", required: true, description: "HTTPS link to a PNG, JPEG or WebP image.", example: "https://siroagent.com/og.jpg" },
      { name: "question", type: "string", description: "What to look for. Defaults to a plain description.", max: 1000, example: "What does this image show?" },
    ],
    tags: ["image", "caption", "ocr", "see"],
  },
  {
    id: "translate",
    name: "Translate",
    category: "web",
    price: "0.002",
    summary: "Translate text between 100 languages with M2M100.",
    provider: "Workers AI",
    returns: "{ text }",
    model: "@cf/meta/m2m100-1.2b",
    fields: [
      { name: "text", type: "string", required: true, description: "Text to translate.", max: 4000, example: "Agents pay per call." },
      { name: "target", type: "string", required: true, description: "Target language code (e.g. id, es, zh).", example: "id" },
      { name: "source", type: "string", description: "Source language code. Defaults to en.", example: "en" },
    ],
    tags: ["translate", "language"],
  },
  {
    id: "web-read",
    name: "Web Reader",
    category: "web",
    price: "0.003",
    summary: "Fetch a public web page and return clean Markdown an agent can read.",
    provider: "Siro",
    returns: "{ title, markdown }",
    fields: [{ name: "url", type: "url", required: true, description: "HTTPS link to read.", example: "https://www.x402.org" }],
    tags: ["web", "read", "scrape", "page", "article"],
  },

  // On-chain
  {
    id: "token-snapshot",
    name: "Token Snapshot",
    category: "onchain",
    price: "0.005",
    summary: "Name, supply and decimals read from the chain, plus price, liquidity and volume from the top pool.",
    provider: "Siro · GeckoTerminal",
    returns: "{ token, market, pools }",
    fields: [TOKEN, NETWORK],
    tags: ["token", "price", "market cap", "liquidity", "contract"],
  },
  {
    id: "token-signal",
    name: "Token Signal",
    category: "onchain",
    price: "0.02",
    summary: "Snapshot plus a short AI read: momentum, liquidity depth and the risks worth checking.",
    provider: "Siro · Workers AI",
    returns: "{ snapshot, signal: { stance, summary, risks[] } }",
    fields: [TOKEN, NETWORK],
    tags: ["token", "analysis", "sentiment", "risk", "signal"],
  },
  {
    id: "contract-check",
    name: "Contract Check",
    category: "onchain",
    price: "0.005",
    summary: "Who owns it, is it a proxy, can supply still change. Read straight from bytecode and storage.",
    provider: "Siro",
    returns: "{ isContract, owner, proxy, implementation, notes[] }",
    fields: [TOKEN, NETWORK],
    tags: ["contract", "owner", "proxy", "safety"],
  },
  {
    id: "trending-pools",
    name: "Trending Pools",
    category: "onchain",
    price: "0.01",
    summary: "The pools traders are hitting right now, with price change, volume and liquidity.",
    provider: "Siro · GeckoTerminal",
    returns: "{ network, pools[] }",
    fields: [NETWORK],
    tags: ["trending", "hot", "movers", "pools"],
  },
  {
    id: "new-pools",
    name: "New Pools",
    category: "onchain",
    price: "0.005",
    summary: "Freshly created pools, newest first, with age, liquidity and early volume.",
    provider: "Siro · GeckoTerminal",
    returns: "{ network, pools[] }",
    fields: [NETWORK],
    tags: ["new", "launch", "fresh", "pools"],
  },
  {
    id: "market-brief",
    name: "Market Brief",
    category: "onchain",
    price: "0.03",
    summary: "Trending and new pools in one call, written up as a short brief by an LLM.",
    provider: "Siro · Workers AI",
    returns: "{ network, brief, pools[] }",
    fields: [NETWORK],
    tags: ["market", "brief", "summary", "today"],
  },
  {
    id: "wallet-balances",
    name: "Wallet Balances",
    category: "onchain",
    price: "0.002",
    summary: "ETH and stablecoin balances for any address, plus any tokens you list.",
    provider: "Siro",
    returns: "{ address, network, balances[] }",
    fields: [
      { name: "address", type: "address", required: true, description: "Wallet address (0x…).", example: "0x0000000000000000000000000000000000000000" },
      NETWORK,
      { name: "tokens", type: "string", description: "Extra token addresses, comma-separated (up to 10)." },
    ],
    tags: ["wallet", "balance", "portfolio"],
  },
  {
    id: "gas-now",
    name: "Gas Now",
    category: "onchain",
    price: "0.001",
    summary: "Current gas price and latest block on Robinhood Chain or Base.",
    provider: "Siro",
    returns: "{ network, block, gasPriceGwei }",
    fields: [NETWORK],
    tags: ["gas", "fee", "block"],
  },

  // Tokenized stocks (Robinhood Chain)
  {
    id: "stock-tokens",
    name: "Stock Tokens",
    category: "stocks",
    price: "0.002",
    summary: "Every active stock token on Robinhood Chain: ticker, name, contract and whether a Chainlink feed prices it.",
    provider: "Siro · Robinhood registry",
    returns: "{ total, stocks[] }",
    fields: [{ name: "query", type: "string", description: "Filter by ticker or company name.", max: 60, example: "tesla" }],
    tags: ["stocks", "equities", "xstocks", "tokenized", "list"],
  },
  {
    id: "stock-signal",
    name: "Stock Token Signal",
    category: "stocks",
    price: "0.02",
    summary: "One stock token: Chainlink reference price, on-chain DEX price, the premium between them and a short AI read.",
    provider: "Siro · Chainlink · Workers AI",
    returns: "{ stock, reference, dex, premiumPct, signal: { stance, summary, risks[] } }",
    fields: [{ name: "symbol", type: "string", required: true, description: "Ticker (TSLA) or token address.", max: 64, example: "TSLA" }],
    tags: ["stocks", "signal", "tsla", "nvda", "premium", "tokenized", "trading"],
  },

  // Prediction markets (Polymarket)
  {
    id: "prediction-markets",
    name: "Prediction Markets",
    category: "prediction",
    price: "0.003",
    summary: "Live Polymarket markets with outcome odds, volume, liquidity and end date. Search by topic or browse the busiest.",
    provider: "Siro · Polymarket",
    returns: "{ markets[]: { question, outcomes[{ name, probability }], volume24hUsd, liquidityUsd, endDate, url } }",
    fields: [
      { name: "query", type: "string", description: "Topic to search, e.g. fed rates, bitcoin, election.", max: 120, example: "bitcoin" },
      { name: "sort", type: "enum", description: "Without a query: busiest, ending soon or newest.", options: ["volume", "ending", "new"], example: "volume" },
      { name: "limit", type: "number", description: "How many markets, 20 at most.", max: 20, example: 10 },
    ],
    tags: ["polymarket", "prediction", "odds", "bets", "forecast", "election"],
  },
  {
    id: "prediction-read",
    name: "Prediction Read",
    category: "prediction",
    price: "0.02",
    summary: "One Polymarket market, read by an LLM: what the odds price in, the week's move, catalysts and risks.",
    provider: "Siro · Polymarket · Workers AI",
    returns: "{ market, history[], read: { summary, pricedIn, lean, confidence, catalysts[], risks[] } }",
    fields: [{ name: "market", type: "string", required: true, description: "Polymarket link, slug, market id, or a few words to find the busiest matching market.", max: 300, example: "fed interest rates" }],
    tags: ["polymarket", "prediction", "analysis", "odds", "forecast"],
  },

  // Content
  {
    id: "token-starter-kit",
    name: "Token Starter Kit",
    category: "content",
    price: "0.08",
    summary: "From one idea: three name and ticker options, a tagline, a short lore and a logo.",
    provider: "Siro · Workers AI",
    returns: "{ names[], tagline, lore, logo: data:image/png;base64,… }",
    fields: [{ name: "idea", type: "string", required: true, description: "The idea, in a sentence.", max: 500, example: "A cat that only trades on weekends" }],
    tags: ["token", "launch", "logo", "name", "meme"],
  },
  {
    id: "x-post-writer",
    name: "X Post Writer",
    category: "content",
    price: "0.01",
    summary: "Three ready-to-post X drafts under 280 characters, in the tone you ask for.",
    provider: "Siro · Workers AI",
    returns: "{ posts[] }",
    fields: [
      { name: "topic", type: "string", required: true, description: "What the posts are about.", max: 1500, example: "Our agent now pays for its own tools" },
      { name: "tone", type: "enum", description: "Voice.", options: ["confident", "playful", "technical", "minimal"], example: "confident" },
    ],
    tags: ["twitter", "x", "post", "tweet", "copy"],
  },
  {
    id: "prompt-refine",
    name: "Prompt Refiner",
    category: "content",
    price: "0.004",
    summary: "Turn a rough idea into a precise prompt for an image or text model.",
    provider: "Siro · Workers AI",
    returns: "{ prompt, negative }",
    fields: [
      { name: "idea", type: "string", required: true, description: "Your rough idea.", max: 1500, example: "logo for a robot bank" },
      { name: "target", type: "enum", description: "What the prompt is for.", options: ["image", "text"], example: "image" },
    ],
    tags: ["prompt", "creative", "director"],
  },
];

export const byId = (id: string) => RESOURCES.find((r) => r.id === id);

/** Official mark of the model maker or data source behind each resource (files in /logos).
 *  Tools Siro composes itself carry the Siro mark. */
const MAKER: Record<string, string> = {
  "claude-opus-5-5": "claude",
  "claude-sonnet-5": "claude",
  "claude-haiku-4-5": "claude",
  "gpt-5-6-sol": "openai",
  "gpt-5-6-terra": "openai",
  "gpt-5-6-luna": "openai",
  "gpt-image-2": "openai",
  "gemini-3-1-pro": "gemini",
  "gemini-3-5-flash": "gemini",
  "nano-banana-pro": "gemini",
  "nano-banana-2-1": "gemini",
  "nano-banana-2": "gemini",
  "veo-3-1-fast": "gemini",
  "lyria-3": "gemini",
  "grok-imagine-image-2": "grok",
  "grok-imagine-video": "grok",
  "seedream-5-pro": "bytedance",
  "seedream-5-lite": "bytedance",
  "seedance-2-5": "bytedance",
  "seedance-2-mini": "bytedance",
  "flux-3": "bfl",
  "flux-2-pro": "bfl",
  "krea-3": "krea",
  "ideogram-4-5": "ideogram",
  "qwen-image-3": "qwen",
  "z-image-turbo": "qwen",
  "recraft-vector": "recraft",
  "kling-4": "kling",
  "ltx-2-5-fast": "lightricks",
  "eleven-v3": "elevenlabs",
  "eleven-music": "elevenlabs",
  "minimax-music": "minimax",
  "kimi-k2-6": "kimi",
  "deepseek-v4-pro": "deepseek",
  "deepseek-v4-1-flash": "deepseek",
  "glm-5-3": "zai",
  "qwen-3-8": "qwen",
  "nemotron-3": "nvidia",
  "gpt-oss-120b": "openai",
  "stt-whisper": "openai",
  "llama-4-scout": "meta",
  "vision-describe": "meta",
  translate: "meta",
  "gemma-4": "gemma",
  "flux-2-dev": "bfl",
  "flux-2-klein-4b": "bfl",
  "flux-1-schnell": "bfl",
  "lucid-origin": "leonardo",
  "phoenix-1": "leonardo",
  "tts-aura-2": "deepgram",
  "tts-melo": "myshell",
  "stock-tokens": "robinhood",
  "stock-signal": "chainlink",
  "prediction-markets": "polymarket",
  "prediction-read": "polymarket",
};
const PNG = new Set(["leonardo", "polymarket"]);
export const logoOf = (id: string) => `/logos/${MAKER[id] ?? "siro"}.${PNG.has(MAKER[id]) ? "png" : "svg"}`;

/** USD decimal string -> 6-decimal base units (USDG and USDC both use 6). */
export function toUnits(price: string): bigint {
  const [w, f = ""] = price.split(".");
  return BigInt(w) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
}

/** "$0.60", "$0.045", "$0.0001": at least two decimals, never trailing zeros past them. */
export function formatPrice(price: string): string {
  const n = Number(price);
  if (n < 0.01) return `$${price}`;
  const [w, f = ""] = n.toFixed(n < 0.1 ? 3 : 2).split(".");
  return `$${w}.${f.replace(/0+$/, "").padEnd(2, "0")}`;
}

export const NETWORKS = {
  robinhood: { id: 4663, caip: "eip155:4663", name: "Robinhood Chain", asset: "USDG", gecko: "robinhood", explorer: "https://robinhoodchain.blockscout.com" },
  base: { id: 8453, caip: "eip155:8453", name: "Base", asset: "USDC", gecko: "base", explorer: "https://basescan.org" },
} as const;
export type NetworkKey = keyof typeof NETWORKS;

/** Where a payment can be made. Wider than NETWORKS, which are the chains the data resources read.
 *  Every one of these is USD-pegged at 6 decimals, so a price is the same number of base units everywhere. */
export const PAY_NETWORKS = {
  robinhood: { ...NETWORKS.robinhood, vm: "evm" },
  solana: { id: 0, caip: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", name: "Solana", asset: "USDC", explorer: "https://solscan.io", vm: "svm" },
  base: { ...NETWORKS.base, vm: "evm" },
  arbitrum: { id: 42161, caip: "eip155:42161", name: "Arbitrum", asset: "USDC", explorer: "https://arbiscan.io", vm: "evm" },
  polygon: { id: 137, caip: "eip155:137", name: "Polygon", asset: "USDC", explorer: "https://polygonscan.com", vm: "evm" },
} as const;
export type PayNetworkKey = keyof typeof PAY_NETWORKS;
/** The EVM payment networks, which the Siro wallet (web and CLI) can sign for. */
export const EVM_PAY = ["robinhood", "base", "arbitrum", "polygon"] as const;
export type EvmPayKey = (typeof EVM_PAY)[number];
export const isEvmPay = (v: unknown): v is EvmPayKey => EVM_PAY.includes(v as EvmPayKey);
/** Every network the Siro agent wallet pays on, in the order the UI lists them. */
export const PAY_KEYS = ["robinhood", "base", "solana", "arbitrum", "polygon"] as const satisfies readonly PayNetworkKey[];
export const isPayKey = (v: unknown): v is PayNetworkKey => PAY_KEYS.includes(v as PayNetworkKey);
/** "eip155:42161", "arbitrum" or "42161" → "arbitrum". */
export function payNetworkOf(v: string): PayNetworkKey | null {
  const s = String(v ?? "").toLowerCase();
  for (const [k, n] of Object.entries(PAY_NETWORKS)) if (s === k || s === n.caip.toLowerCase() || (n.id && s === String(n.id))) return k as PayNetworkKey;
  return null;
}
