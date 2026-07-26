import {
  ALLOWED_SYMBOLS,
  NEWS_ITEMS,
  type EarningsAnalysis,
  type NewsItem,
  type ResearchMetric,
  type SignalResearch,
  type SignalSymbol,
} from "../../news-data";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";
const DEFAULT_REASONING_EFFORT = "low";
const MAX_QUESTION_LENGTH = 1_200;
const MAX_FIELD_LENGTH = 1_000;

type RuntimeEnv = {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_REASONING_EFFORT?: string;
};

type AiRequestBody = {
  question?: unknown;
  signal?: unknown;
  marketQuery?: unknown;
};

type OpenAiResponsePayload = {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      text?: unknown;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

async function readRuntimeEnv(key: keyof RuntimeEnv) {
  let cloudflareEnv: RuntimeEnv = {};
  try {
    cloudflareEnv = ((await import("cloudflare:workers")) as { env?: RuntimeEnv })
      .env ?? {};
  } catch {
    cloudflareEnv = {};
  }

  const nodeEnv =
    typeof process === "undefined"
      ? undefined
      : (process.env as RuntimeEnv | undefined);

  return (cloudflareEnv[key] || nodeEnv?.[key] || "").trim();
}

function clampText(value: unknown, fallback = "", maxLength = MAX_FIELD_LENGTH) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

function isAllowedSymbol(value: unknown): value is SignalSymbol {
  return typeof value === "string" && ALLOWED_SYMBOLS.includes(value as SignalSymbol);
}

function normalizeReasoningEffort(value: string) {
  return ["none", "low", "medium", "high", "xhigh", "max"].includes(value)
    ? value
    : DEFAULT_REASONING_EFFORT;
}

function postedSignalObject(signal: unknown) {
  return signal && typeof signal === "object"
    ? (signal as Partial<NewsItem>)
    : {};
}

function sanitizeEarnings(value: unknown): EarningsAnalysis | undefined {
  if (!value || typeof value !== "object") return undefined;
  const earnings = value as Partial<EarningsAnalysis>;
  const metrics = Array.isArray(earnings.metrics)
    ? earnings.metrics.slice(0, 8).map((metric) => ({
        label: clampText(metric?.label, "", 80),
        value: clampText(metric?.value, "", 80),
        change: clampText(metric?.change, "", 80),
      }))
    : [];

  return {
    period: clampText(earnings.period, "", 120),
    headline: clampText(earnings.headline, "", 240),
    metrics,
    analysis: clampText(earnings.analysis),
    nextWatch: clampText(earnings.nextWatch),
  };
}

function sanitizeMetric(value: unknown): ResearchMetric | null {
  if (!value || typeof value !== "object") return null;
  const metric = value as Partial<ResearchMetric>;
  const label = clampText(metric.label, "", 80);
  const metricValue = clampText(metric.value, "", 120);
  if (!label || !metricValue) return null;
  return {
    label,
    value: metricValue,
    change: clampText(metric.change, "", 120) || undefined,
    tone:
      metric.tone === "positive" ||
      metric.tone === "negative" ||
      metric.tone === "neutral"
        ? metric.tone
        : "neutral",
  };
}

function sanitizeResearch(value: unknown): SignalResearch | undefined {
  if (!value || typeof value !== "object") return undefined;
  const research = value as Partial<SignalResearch>;
  const signal = research.signal;
  const fundamentals = research.fundamentals;
  const industry = research.industry;
  if (!signal || !fundamentals || !industry) return undefined;

  const direction =
    signal.direction === "long" ||
    signal.direction === "short" ||
    signal.direction === "neutral"
      ? signal.direction
      : "neutral";
  const degree =
    signal.degree === "strong" ||
    signal.degree === "moderate" ||
    signal.degree === "weak"
      ? signal.degree
      : "weak";
  const metrics = Array.isArray(fundamentals.metrics)
    ? fundamentals.metrics
        .slice(0, 10)
        .map(sanitizeMetric)
        .filter((metric): metric is ResearchMetric => Boolean(metric))
    : [];
  const risks = Array.isArray(research.risks)
    ? research.risks
        .slice(0, 6)
        .map((risk) => clampText(risk, "", 500))
        .filter(Boolean)
    : [];

  return {
    signal: {
      direction,
      degree,
      label: clampText(signal.label, "Neutral", 80),
      confidence:
        typeof signal.confidence === "number" &&
        Number.isFinite(signal.confidence)
          ? Math.min(99, Math.max(1, Math.round(signal.confidence)))
          : 55,
      description: clampText(signal.description),
    },
    macro: clampText(research.macro),
    industry: {
      name: clampText(industry.name, "Industry", 120),
      summary: clampText(industry.summary),
    },
    fundamentals: {
      overview: clampText(fundamentals.overview),
      recentMarket: clampText(fundamentals.recentMarket),
      recentEarnings: clampText(fundamentals.recentEarnings),
      metrics,
    },
    risks,
    dataAsOf: clampText(research.dataAsOf, "", 120),
  };
}

function resolveSignal(body: AiRequestBody) {
  const postedSignal = postedSignalObject(body.signal);
  const marketQuery = isAllowedSymbol(postedSignal.marketQuery)
    ? postedSignal.marketQuery
    : isAllowedSymbol(body.marketQuery)
      ? body.marketQuery
      : null;

  if (!marketQuery) return null;

  const base = NEWS_ITEMS.find((item) => item.marketQuery === marketQuery);
  if (!base) return null;

  const tags = Array.isArray(postedSignal.tags)
    ? postedSignal.tags.slice(0, 8).map((tag) => clampText(tag, "", 60)).filter(Boolean)
    : base.tags;

  return {
    ...base,
    id: clampText(postedSignal.id, base.id, 140),
    title: clampText(postedSignal.title, base.title),
    hook: clampText(postedSignal.hook, base.hook),
    summary: clampText(postedSignal.summary, base.summary, 1_400),
    source: clampText(postedSignal.source, base.source, 160),
    published: clampText(postedSignal.published, base.published, 120),
    sourceUrl: clampText(postedSignal.sourceUrl, base.sourceUrl, 1_000),
    marketLabel: clampText(postedSignal.marketLabel, base.marketLabel, 120),
    tags,
    impact: postedSignal.impact === "Medium" ? "Medium" : base.impact,
    confidence:
      typeof postedSignal.confidence === "number" &&
      Number.isFinite(postedSignal.confidence)
        ? Math.min(99, Math.max(1, Math.round(postedSignal.confidence)))
        : base.confidence,
    horizon: clampText(postedSignal.horizon, base.horizon, 120),
    bullCase: clampText(postedSignal.bullCase, base.bullCase),
    bearCase: clampText(postedSignal.bearCase, base.bearCase),
    catalyst: clampText(postedSignal.catalyst, base.catalyst),
    risk: clampText(postedSignal.risk, base.risk),
    earnings: sanitizeEarnings(postedSignal.earnings) || base.earnings,
    analysis: sanitizeResearch(postedSignal.analysis) || base.analysis,
  } satisfies NewsItem;
}

function buildSignalContext(signal: NewsItem) {
  return {
    app: "AlphaSwipe",
    symbol: signal.marketQuery,
    marketLabel: signal.marketLabel,
    category: signal.category,
    title: signal.title,
    hook: signal.hook,
    summary: signal.summary,
    source: signal.source,
    published: signal.published,
    tags: signal.tags,
    analysis: signal.analysis,
  };
}

function responsesUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/responses")
    ? normalized
    : `${normalized}/responses`;
}

function extractAnswer(payload: OpenAiResponsePayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  return (
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim() || ""
  );
}

export async function POST(request: Request) {
  const [apiKey, configuredBaseUrl, configuredModel, configuredReasoningEffort] =
    await Promise.all([
      readRuntimeEnv("OPENAI_API_KEY"),
      readRuntimeEnv("OPENAI_BASE_URL"),
      readRuntimeEnv("OPENAI_MODEL"),
      readRuntimeEnv("OPENAI_REASONING_EFFORT"),
    ]);
  const endpoint = responsesUrl(configuredBaseUrl || DEFAULT_OPENAI_BASE_URL);
  const model = configuredModel || DEFAULT_OPENAI_MODEL;
  const reasoningEffort = normalizeReasoningEffort(
    configuredReasoningEffort || DEFAULT_REASONING_EFFORT,
  );

  if (!apiKey) {
    return Response.json(
      {
        error:
          "Signal AI is not configured. Add OPENAI_API_KEY locally or to the hosted runtime environment.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: AiRequestBody;
  try {
    body = (await request.json()) as AiRequestBody;
  } catch {
    return Response.json(
      { error: "Invalid request. Please send the question again." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const question = clampText(body.question, "", MAX_QUESTION_LENGTH);
  const signal = resolveSignal(body);

  if (!question) {
    return Response.json(
      { error: "The question cannot be empty." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!signal) {
    return Response.json(
      { error: "This signal is not in AlphaSwipe's supported market list." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const inputText = JSON.stringify(
    {
      signal: buildSignalContext(signal),
      userQuestion: question,
    },
    null,
    2,
  );

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: [
          "You are AlphaSwipe Signal AI, a concise market research copilot for crypto and tokenized/RWA-related perpetual signals.",
          "Always answer in English, even when the user writes in another language.",
          "Use only the supplied signal context plus clearly labeled general market reasoning. Do not invent live prices, order-book depth, account balances, or unprovided facts.",
          "Use the supplied signal evaluation, macro view, industry view, fundamentals, market metrics, earnings analysis and risks. Clearly separate source facts from analysis.",
          "Call out uncertainty and what data would confirm or invalidate the signal.",
          "This chat cannot place trades. Do not give personalized financial advice; frame trade-related answers as risk, scenario, sizing, and execution considerations.",
          "Keep the answer compact: usually 2-5 short paragraphs or bullets.",
        ].join("\n"),
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: inputText }],
          },
        ],
        max_output_tokens: 650,
        reasoning: { effort: reasoningEffort },
        text: { format: { type: "text" }, verbosity: "medium" },
        store: false,
      }),
        signal: AbortSignal.timeout(45_000),
    });

    const payload = (await response.json().catch(() => ({}))) as OpenAiResponsePayload;
    if (!response.ok) {
      return Response.json(
        {
          error:
            payload.error?.message ||
            `OpenAI API request failed (HTTP ${response.status}).`,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const answer = extractAnswer(payload);
    if (!answer) {
      return Response.json(
        { error: "The OpenAI API returned no displayable text." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      { answer, model, reasoningEffort },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? "The OpenAI API timed out. Please try again."
            : "Signal AI is temporarily unavailable. Please try again.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
