import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const NEWS_CACHE_PATH = process.env.NEWS_CACHE_PATH
  ? resolve(process.env.NEWS_CACHE_PATH)
  : resolve(PROJECT_ROOT, "data/news-cache.json");
const ANALYSIS_CACHE_PATH = process.env.NEWS_ANALYSIS_CACHE_PATH
  ? resolve(process.env.NEWS_ANALYSIS_CACHE_PATH)
  : resolve(PROJECT_ROOT, "data/.news-analysis-cache.json");
const LOCAL_ENV_FILES = [".env.local", ".dev.vars"].map((name) =>
  resolve(PROJECT_ROOT, name),
);

const FMP_API_BASE =
  process.env.FMP_API_BASE || "https://financialmodelingprep.com/stable";
const DEFAULT_LLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_LLM_MODEL = "glm-4.5-air";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";
const ANALYSIS_BATCH_SIZE = 4;
const ANALYSIS_CONCURRENCY = 2;

const CRYPTO_INDUSTRIES = {
  BTCUSD: "Digital assets · Store of value and macro liquidity",
  ETHUSD: "Smart-contract platforms · L1 and onchain applications",
  BNBUSD: "Exchange ecosystem · L1 and application infrastructure",
  INJUSD: "Decentralized finance · Trading infrastructure and L1",
};

function parseEnvFile(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function loadLocalEnv() {
  for (const file of LOCAL_ENV_FILES) {
    try {
      const values = parseEnvFile(await readFile(file, "utf8"));
      for (const [key, value] of Object.entries(values)) {
        if (!process.env[key] && value) process.env[key] = value;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function cleanText(value, maxLength = 4_000) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function percentageChange(current, previous) {
  const currentValue = finiteNumber(current);
  const previousValue = finiteNumber(previous);
  if (currentValue === null || previousValue === null || previousValue === 0) {
    return null;
  }
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

function toneForChange(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}

function formatPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPrice(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const digits = value >= 100 ? 2 : value >= 1 ? 3 : 5;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatCompactUsd(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

async function fetchFmp(path, params, apiKey, attempt = 0) {
  const url = new URL(`${FMP_API_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("apikey", apiKey);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
    });
    const text = await response.text();
    if (!response.ok) {
      if (
        attempt < 2 &&
        (response.status === 429 || response.status >= 500)
      ) {
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, 500 * 2 ** attempt),
        );
        return fetchFmp(path, params, apiKey, attempt + 1);
      }
      throw new Error(
        `FMP ${path} failed (${response.status}): ${text.slice(0, 220)}`,
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`FMP ${path} did not return valid JSON`);
    }
  } catch (error) {
    if (attempt < 2) {
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, 500 * 2 ** attempt),
      );
      return fetchFmp(path, params, apiKey, attempt + 1);
    }
    throw error;
  }
}

async function fetchMacroSnapshot(apiKey, now) {
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const to = new Date(now.getTime() + 7 * 86_400_000);
  const proxySymbols = ["SPY", "QQQ", "TLT", "GLD"];
  const [proxyRows, treasuryRows, calendarRows] = await Promise.all([
    Promise.all(
      proxySymbols.map((symbol) =>
        fetchFmp("quote", { symbol }, apiKey).then((rows) => rows?.[0] ?? null),
      ),
    ),
    fetchFmp(
      "treasury-rates",
      { from: isoDate(from), to: isoDate(now) },
      apiKey,
    ),
    fetchFmp(
      "economic-calendar",
      { from: isoDate(from), to: isoDate(to) },
      apiKey,
    ),
  ]);

  const proxies = Object.fromEntries(
    proxyRows
      .filter(Boolean)
      .map((row) => [
        row.symbol,
        {
          price: finiteNumber(row.price),
          dayChangePercentage: finiteNumber(row.changePercentage),
          priceAvg50: finiteNumber(row.priceAvg50),
          priceAvg200: finiteNumber(row.priceAvg200),
        },
      ]),
  );
  const treasury = Array.isArray(treasuryRows) ? treasuryRows[0] : null;
  const events = (Array.isArray(calendarRows) ? calendarRows : [])
    .filter(
      (event) =>
        (event.country === "US" || event.currency === "USD") &&
        event.impact === "High",
    )
    .sort(
      (left, right) =>
        Math.abs(new Date(left.date).getTime() - now.getTime()) -
        Math.abs(new Date(right.date).getTime() - now.getTime()),
    )
    .slice(0, 8)
    .map((event) => ({
      date: event.date,
      event: cleanText(event.event, 160),
      previous: event.previous,
      estimate: event.estimate,
      actual: event.actual,
      unit: event.unit,
    }));

  return {
    asOf: now.toISOString(),
    proxies,
    treasury: treasury
      ? {
          date: treasury.date,
          year2: finiteNumber(treasury.year2),
          year10: finiteNumber(treasury.year10),
          year30: finiteNumber(treasury.year30),
        }
      : null,
    nearbyHighImpactUsEvents: events,
  };
}

function findYearAgoQuarter(statements, latest) {
  return statements.find(
    (statement) =>
      statement !== latest &&
      statement.period === latest?.period &&
      Number(statement.fiscalYear) === Number(latest?.fiscalYear) - 1,
  );
}

function buildDisplayMetrics(category, market, earnings, ratios) {
  const metrics = [
    {
      label: "Spot price",
      value: formatPrice(market.price),
      change: `1d ${formatPercent(market.dayChangePercentage)}`,
      tone: toneForChange(market.dayChangePercentage),
    },
    {
      label: "7-day move",
      value: formatPercent(market.weekChangePercentage),
      change: `Range ${formatPrice(market.weekLow)}–${formatPrice(market.weekHigh)}`,
      tone: toneForChange(market.weekChangePercentage),
    },
    {
      label: "Market cap",
      value: formatCompactUsd(market.marketCap),
      change: "FMP quote",
      tone: "neutral",
    },
    {
      label: category === "stock" ? "Daily volume" : "24h volume",
      value: formatNumber(market.volume),
      change: "FMP quote",
      tone: "neutral",
    },
  ];

  if (category === "stock" && earnings?.latest) {
    metrics.push(
      {
        label: "Quarterly revenue",
        value: formatCompactUsd(earnings.latest.revenue),
        change: `YoY ${formatPercent(earnings.revenueYoY)}`,
        tone: toneForChange(earnings.revenueYoY),
      },
      {
        label: "Quarterly net income",
        value: formatCompactUsd(earnings.latest.netIncome),
        change: `YoY ${formatPercent(earnings.netIncomeYoY)}`,
        tone: toneForChange(earnings.netIncomeYoY),
      },
      {
        label: "Diluted EPS",
        value:
          typeof earnings.latest.epsDiluted === "number"
            ? `$${earnings.latest.epsDiluted.toFixed(2)}`
            : "—",
        change: `${earnings.latest.fiscalYear} ${earnings.latest.period}`,
        tone: "neutral",
      },
      {
        label: "P/E ratio",
        value:
          typeof ratios?.priceToEarningsRatio === "number"
            ? `${ratios.priceToEarningsRatio.toFixed(1)}×`
            : "—",
        change: "Latest annual period",
        tone: "neutral",
      },
    );
  } else {
    metrics.push(
      {
        label: "50-day average",
        value: formatPrice(market.priceAvg50),
        change: `Deviation ${formatPercent(percentageChange(market.price, market.priceAvg50))}`,
        tone: toneForChange(percentageChange(market.price, market.priceAvg50)),
      },
      {
        label: "200-day average",
        value: formatPrice(market.priceAvg200),
        change: `Deviation ${formatPercent(percentageChange(market.price, market.priceAvg200))}`,
        tone: toneForChange(percentageChange(market.price, market.priceAvg200)),
      },
      {
        label: "52-week high",
        value: formatPrice(market.yearHigh),
        change: `From high ${formatPercent(percentageChange(market.price, market.yearHigh))}`,
        tone: "neutral",
      },
      {
        label: "52-week low",
        value: formatPrice(market.yearLow),
        change: `From low ${formatPercent(percentageChange(market.price, market.yearLow))}`,
        tone: "neutral",
      },
    );
  }

  return metrics;
}

async function fetchAssetSnapshot(symbol, category, apiKey, now) {
  const from = new Date(now.getTime() - 10 * 86_400_000);
  const commonRequests = [
    fetchFmp("quote", { symbol }, apiKey),
    fetchFmp(
      "historical-price-eod/full",
      { symbol, from: isoDate(from), to: isoDate(now) },
      apiKey,
    ),
  ];
  const stockRequests =
    category === "stock"
      ? [
          fetchFmp("profile", { symbol }, apiKey),
          fetchFmp(
            "income-statement",
            { symbol, period: "quarter", limit: 6 },
            apiKey,
          ),
          fetchFmp("ratios", { symbol, period: "annual", limit: 1 }, apiKey),
        ]
      : [Promise.resolve([]), Promise.resolve([]), Promise.resolve([])];

  const [quoteRows, historyRows, profileRows, statementRows, ratioRows] =
    await Promise.all([...commonRequests, ...stockRequests]);
  const quote = quoteRows?.[0];
  if (!quote) throw new Error(`FMP returned no quote for ${symbol}`);

  const history = (Array.isArray(historyRows) ? historyRows : [])
    .filter((row) => finiteNumber(row.close) !== null)
    .sort((left, right) => new Date(left.date) - new Date(right.date));
  const oldest = history[0];
  const latest = history.at(-1);
  const weekChangePercentage = percentageChange(latest?.close, oldest?.close);
  const weekHigh = history.length
    ? Math.max(...history.map((row) => finiteNumber(row.high) ?? -Infinity))
    : null;
  const weekLow = history.length
    ? Math.min(...history.map((row) => finiteNumber(row.low) ?? Infinity))
    : null;

  const statements = Array.isArray(statementRows) ? statementRows : [];
  const latestStatement = statements[0] ?? null;
  const yearAgoStatement = latestStatement
    ? findYearAgoQuarter(statements, latestStatement)
    : null;
  const earnings = latestStatement
    ? {
        latest: {
          date: latestStatement.date,
          fiscalYear: latestStatement.fiscalYear,
          period: latestStatement.period,
          revenue: finiteNumber(latestStatement.revenue),
          grossProfit: finiteNumber(latestStatement.grossProfit),
          operatingIncome: finiteNumber(latestStatement.operatingIncome),
          netIncome: finiteNumber(latestStatement.netIncome),
          epsDiluted: finiteNumber(latestStatement.epsDiluted),
        },
        revenueYoY: percentageChange(
          latestStatement.revenue,
          yearAgoStatement?.revenue,
        ),
        netIncomeYoY: percentageChange(
          latestStatement.netIncome,
          yearAgoStatement?.netIncome,
        ),
        operatingIncomeYoY: percentageChange(
          latestStatement.operatingIncome,
          yearAgoStatement?.operatingIncome,
        ),
      }
    : null;
  const ratios = ratioRows?.[0]
    ? {
        date: ratioRows[0].date,
        priceToEarningsRatio: finiteNumber(ratioRows[0].priceToEarningsRatio),
        priceToBookRatio: finiteNumber(ratioRows[0].priceToBookRatio),
        debtToEquityRatio: finiteNumber(ratioRows[0].debtToEquityRatio),
        returnOnEquity: finiteNumber(ratioRows[0].returnOnEquity),
      }
    : null;
  const profile = profileRows?.[0]
    ? {
        sector: cleanText(profileRows[0].sector, 120),
        industry: cleanText(profileRows[0].industry, 160),
        description: cleanText(profileRows[0].description, 1_200),
      }
    : null;
  const timestamp = finiteNumber(quote.timestamp);
  const market = {
    asOf: timestamp
      ? new Date(timestamp * 1_000).toISOString()
      : now.toISOString(),
    price: finiteNumber(quote.price),
    dayChangePercentage: finiteNumber(quote.changePercentage),
    weekChangePercentage,
    weekHigh: Number.isFinite(weekHigh) ? weekHigh : null,
    weekLow: Number.isFinite(weekLow) ? weekLow : null,
    volume: finiteNumber(quote.volume),
    marketCap: finiteNumber(quote.marketCap),
    dayLow: finiteNumber(quote.dayLow),
    dayHigh: finiteNumber(quote.dayHigh),
    yearLow: finiteNumber(quote.yearLow),
    yearHigh: finiteNumber(quote.yearHigh),
    priceAvg50: finiteNumber(quote.priceAvg50),
    priceAvg200: finiteNumber(quote.priceAvg200),
  };

  return {
    symbol,
    category,
    industryName:
      profile?.industry ||
      CRYPTO_INDUSTRIES[symbol] ||
      (category === "stock" ? "Public company" : "Digital asset"),
    profile,
    market,
    earnings,
    ratios,
    displayMetrics: buildDisplayMetrics(category, market, earnings, ratios),
  };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function extractJsonObject(value) {
  const trimmed = cleanText(value, 300_000);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return JSON.parse(fenced || trimmed);
}

function responsesUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/responses")
    ? normalized
    : `${normalized}/responses`;
}

function extractResponsesText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  return (
    payload?.output
      ?.flatMap((item) => item.content ?? [])
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim() || ""
  );
}

function normalizeDirection(value) {
  return value === "long" || value === "short" || value === "neutral"
    ? value
    : "neutral";
}

function normalizeDegree(value, direction) {
  if (direction === "neutral") return value === "moderate" ? "moderate" : "weak";
  return value === "strong" || value === "moderate" || value === "weak"
    ? value
    : "weak";
}

function signalLabel(direction, degree) {
  if (direction === "long") {
    return degree === "strong"
      ? "Strong bullish"
      : degree === "moderate"
        ? "Bullish"
        : "Slightly bullish";
  }
  if (direction === "short") {
    return degree === "strong"
      ? "Strong bearish"
      : degree === "moderate"
        ? "Bearish"
        : "Slightly bearish";
  }
  return degree === "moderate" ? "Neutral watch" : "Neutral";
}

function normalizeAnalysis(raw, article, snapshot) {
  if (!raw || typeof raw !== "object") return null;
  const direction = normalizeDirection(raw.signal?.direction);
  const degree = normalizeDegree(raw.signal?.degree, direction);
  const confidence = Math.min(
    95,
    Math.max(45, Math.round(finiteNumber(raw.signal?.confidence) ?? 55)),
  );
  const description = cleanText(raw.signal?.description, 700);
  const macro = cleanText(raw.macro, 1_000);
  const industrySummary = cleanText(raw.industry?.summary, 1_000);
  const overview = cleanText(raw.fundamentals?.overview, 900);
  const recentMarket = cleanText(raw.fundamentals?.recentMarket, 900);
  const recentEarnings = cleanText(raw.fundamentals?.recentEarnings, 900);
  const risks = Array.isArray(raw.risks)
    ? raw.risks.map((risk) => cleanText(risk, 500)).filter(Boolean).slice(0, 5)
    : [];

  if (
    cleanText(raw.id, 120) !== article.id ||
    !description ||
    !macro ||
    !industrySummary ||
    !overview ||
    !recentMarket ||
    !recentEarnings ||
    risks.length < 2
  ) {
    return null;
  }

  return {
    signal: {
      direction,
      degree,
      label: signalLabel(direction, degree),
      confidence,
      description,
    },
    macro,
    industry: {
      name: snapshot.industryName,
      summary: industrySummary,
    },
    fundamentals: {
      overview,
      recentMarket,
      recentEarnings,
      metrics: snapshot.displayMetrics,
    },
    risks,
    dataAsOf: snapshot.market.asOf,
  };
}

function unavailableAnalysis(article, snapshot, macroSnapshot, reason) {
  const spy = macroSnapshot.proxies?.SPY;
  const qqq = macroSnapshot.proxies?.QQQ;
  const treasury = macroSnapshot.treasury;
  const latestEarnings = snapshot.earnings?.latest;
  const macroParts = [
    typeof spy?.dayChangePercentage === "number"
      ? `SPY 1d ${formatPercent(spy.dayChangePercentage)}`
      : "",
    typeof qqq?.dayChangePercentage === "number"
      ? `QQQ 1d ${formatPercent(qqq.dayChangePercentage)}`
      : "",
    typeof treasury?.year10 === "number"
      ? `U.S. 10-year Treasury yield ${treasury.year10.toFixed(2)}%`
      : "",
  ].filter(Boolean);

  return {
    signal: {
      direction: "neutral",
      degree: "weak",
      label: "Neutral",
      confidence: 45,
      description: `${reason}. No directional inference is made; only verifiable market data is retained.`,
    },
    macro:
      macroParts.length > 0
        ? `${macroParts.join(", ")}. Without complete context, the macro snapshot is not treated as a standalone directional signal.`
        : "The available macro snapshot is limited, so no directional inference is made.",
    industry: {
      name: snapshot.industryName,
      summary:
        "Industry impact must be confirmed against the source article and subsequent data. This fallback does not extend content the model could not process.",
    },
    fundamentals: {
      overview:
        "The fundamentals section only presents verifiable FMP market and financial data; it does not add conclusions from an incomplete model analysis.",
      recentMarket: `${snapshot.symbol} trades at ${formatPrice(snapshot.market.price)}, with a 1-day move of ${formatPercent(snapshot.market.dayChangePercentage)} and a 7-day move of ${formatPercent(snapshot.market.weekChangePercentage)}.`,
      recentEarnings:
        snapshot.category === "stock" && latestEarnings
          ? `The latest report is ${latestEarnings.fiscalYear} ${latestEarnings.period}: revenue ${formatCompactUsd(latestEarnings.revenue)}, net income ${formatCompactUsd(latestEarnings.netIncome)}, and diluted EPS ${typeof latestEarnings.epsDiluted === "number" ? `$${latestEarnings.epsDiluted.toFixed(2)}` : "—"}.`
          : "Not applicable. Crypto assets do not publish corporate earnings; network activity, fees, supply changes, and ecosystem adoption are more relevant, but those onchain inputs were not provided.",
      metrics: snapshot.displayMetrics,
    },
    risks: [
      "The article did not receive a complete model analysis, so the signal remains neutral.",
      "Market snapshots may lag during fast-moving conditions.",
      "A single article cannot replace position, liquidity, and stop-loss assessment.",
    ],
    dataAsOf: snapshot.market.asOf,
  };
}

async function analyzeBatch(
  articles,
  snapshot,
  macroSnapshot,
  config,
  attempt = 0,
) {
  const instructions = [
    "You are a cautious, data-constrained financial researcher writing in English.",
    "Use only the supplied article, macro snapshot, market data, company profile, earnings, and valuation data. Never invent live data, onchain metrics, policies, or events.",
    "The signal evaluation measures the article's marginal impact on the asset; it is not an unconditional trading recommendation.",
    "Return neutral when evidence is mixed or the article conflicts with market data. Analyze macro, industry, market action, earnings, and risks separately.",
    "Crypto assets do not publish corporate earnings. recentEarnings must say not applicable and identify the alternative fundamentals that should be tracked.",
    "All output must be in English. Return valid JSON without Markdown.",
  ].join("\n");
  const inputText = JSON.stringify({
    task:
      'For every article, return {"analyses":[{"id":"original id","signal":{"direction":"long|short|neutral","degree":"strong|moderate|weak","confidence":"integer from 45 to 95","description":"signal rationale"},"macro":"current macro analysis","industry":{"summary":"industry analysis"},"fundamentals":{"overview":"fundamental assessment","recentMarket":"recent market analysis grounded in the supplied numbers","recentEarnings":"recent earnings analysis or an explicit not-applicable explanation for crypto"},"risks":["risk 1","risk 2","risk 3"]}]}. Keep every section concise, specific, evidence-based, and in English.',
    macroSnapshot,
    assetSnapshot: snapshot,
    articles: articles.map((article) => ({
      id: article.id,
      publishedDate: article.publishedDate,
      title: article.title,
      summary: article.text,
      publisher: article.publisher,
    })),
  });
  const maxOutputTokens = Math.min(
    8_192,
    Math.max(2_200, articles.length * 1_250),
  );
  const endpoint =
    config.apiStyle === "responses"
      ? responsesUrl(config.baseUrl)
      : `${config.baseUrl}/chat/completions`;
  const body =
    config.apiStyle === "responses"
      ? {
          model: config.model,
          instructions,
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: inputText }],
            },
          ],
          max_output_tokens: maxOutputTokens,
          reasoning: { effort: config.reasoningEffort },
          text: { format: { type: "text" }, verbosity: "medium" },
          store: false,
        }
      : {
          model: config.model,
          messages: [
            { role: "system", content: instructions },
            { role: "user", content: inputText },
          ],
          thinking: { type: "enabled" },
          response_format: { type: "json_object" },
          temperature: 0.15,
          max_tokens: maxOutputTokens,
        };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const filtered =
      response.status === 400 &&
      (payload?.error?.code === "1301" || Array.isArray(payload?.contentFilter));
    if (filtered) {
      if (articles.length > 1) {
        const byId = new Map();
        for (const group of chunks(articles, Math.ceil(articles.length / 2))) {
          const analyzed = await analyzeBatch(
            group,
            snapshot,
            macroSnapshot,
            config,
            attempt + 1,
          );
          for (const [id, analysis] of analyzed) byId.set(id, analysis);
        }
        return byId;
      }
      return new Map([
        [
          articles[0].id,
          unavailableAnalysis(
            articles[0],
            snapshot,
            macroSnapshot,
            "The article was blocked by the automated research model's content-safety filter",
          ),
        ],
      ]);
    }
    throw new Error(
      `${config.provider} analysis failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`,
    );
  }
  const content =
    config.apiStyle === "responses"
      ? extractResponsesText(payload)
      : payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    if (articles.length > 1) {
      const byId = new Map();
      for (const group of chunks(articles, Math.ceil(articles.length / 2))) {
        const analyzed = await analyzeBatch(
          group,
          snapshot,
          macroSnapshot,
          config,
          attempt + 1,
        );
        for (const [id, analysis] of analyzed) byId.set(id, analysis);
      }
      return byId;
    }
    return new Map([
      [
        articles[0].id,
        unavailableAnalysis(
          articles[0],
          snapshot,
          macroSnapshot,
          "The automated research model returned no usable content",
        ),
      ],
    ]);
  }

  let parsed;
  try {
    parsed = extractJsonObject(content);
  } catch {
    if (articles.length > 1) {
      const byId = new Map();
      for (const group of chunks(articles, Math.ceil(articles.length / 2))) {
        const analyzed = await analyzeBatch(
          group,
          snapshot,
          macroSnapshot,
          config,
          attempt + 1,
        );
        for (const [id, analysis] of analyzed) byId.set(id, analysis);
      }
      return byId;
    }
    if (attempt < 2) {
      return analyzeBatch(articles, snapshot, macroSnapshot, config, attempt + 1);
    }
    return new Map([
      [
        articles[0].id,
        unavailableAnalysis(
          articles[0],
          snapshot,
          macroSnapshot,
          "The automated research model returned malformed structured output",
        ),
      ],
    ]);
  }
  const rawAnalyses = Array.isArray(parsed?.analyses) ? parsed.analyses : [];
  const byId = new Map(
    rawAnalyses
      .map((raw) => {
        const article = articles.find(
          (candidate) => candidate.id === cleanText(raw?.id, 120),
        );
        if (!article) return null;
        const analysis = normalizeAnalysis(raw, article, snapshot);
        return analysis ? [article.id, analysis] : null;
      })
      .filter(Boolean),
  );
  const missing = articles.filter((article) => !byId.has(article.id));

  if (missing.length) {
    if (attempt >= 3) {
      throw new Error(`GLM analysis omitted article ${missing[0].id}`);
    }
    const retryGroups =
      missing.length === articles.length && missing.length > 1
        ? chunks(missing, Math.ceil(missing.length / 2))
        : [missing];
    for (const retryGroup of retryGroups) {
      const retried = await analyzeBatch(
        retryGroup,
        snapshot,
        macroSnapshot,
        config,
        attempt + 1,
      );
      for (const [id, analysis] of retried) byId.set(id, analysis);
    }
  }

  return byId;
}

async function enrichNews() {
  await loadLocalEnv();
  const newsCache = await readJson(NEWS_CACHE_PATH, null);
  if (!newsCache?.articles?.length) {
    throw new Error("News cache is empty; run the news sync first");
  }

  const ifMissing = process.argv.includes("--if-missing");
  const refresh = process.argv.includes("--refresh");
  if (
    ifMissing &&
    !refresh &&
    newsCache.language === "en" &&
    newsCache.analysis?.language === "en" &&
    newsCache.articles.every((article) => article.analysis)
  ) {
    console.log(
      `News analysis ready: ${newsCache.articles.length} cached articles`,
    );
    return;
  }

  const fmpApiKey = cleanText(process.env.FMP_API_KEY, 500);
  const glmApiKey = cleanText(
    process.env.LLM_API_KEY || process.env.ZHIPU_API_KEY,
    1_000,
  );
  const openAiApiKey = cleanText(process.env.OPENAI_API_KEY, 1_000);
  if (!fmpApiKey) throw new Error("FMP_API_KEY is required to enrich news");
  if (!glmApiKey && !openAiApiKey) {
    throw new Error(
      "LLM_API_KEY, ZHIPU_API_KEY, or OPENAI_API_KEY is required to analyze news",
    );
  }

  const llmConfig = glmApiKey
    ? {
        apiKey: glmApiKey,
        baseUrl:
          cleanText(process.env.LLM_BASE_URL, 1_000).replace(/\/+$/, "") ||
          DEFAULT_LLM_BASE_URL,
        model: cleanText(process.env.LLM_MODEL, 200) || DEFAULT_LLM_MODEL,
        provider: "bigmodel",
        apiStyle: "chat-completions",
        reasoningEffort: "low",
      }
    : {
        apiKey: openAiApiKey,
        baseUrl:
          cleanText(process.env.OPENAI_BASE_URL, 1_000).replace(/\/+$/, "") ||
          DEFAULT_OPENAI_BASE_URL,
        model: cleanText(process.env.OPENAI_MODEL, 200) || DEFAULT_OPENAI_MODEL,
        provider: "openai-compatible",
        apiStyle: "responses",
        reasoningEffort:
          cleanText(process.env.OPENAI_REASONING_EFFORT, 40) || "low",
      };
  const now = new Date();
  const categoriesBySymbol = new Map(
    newsCache.articles.map((article) => [article.symbol, article.category]),
  );
  const symbols = [...categoriesBySymbol.keys()];
  const [macroSnapshot, snapshotEntries] = await Promise.all([
    fetchMacroSnapshot(fmpApiKey, now),
    Promise.all(
      symbols.map(async (symbol) => [
        symbol,
        await fetchAssetSnapshot(
          symbol,
          categoriesBySymbol.get(symbol),
          fmpApiKey,
          now,
        ),
      ]),
    ),
  ]);
  const assetSnapshots = Object.fromEntries(snapshotEntries);
  console.log(
    `FMP fundamentals ready for ${symbols.length} symbols; analyzing ${newsCache.articles.length} articles`,
  );

  const saved = await readJson(ANALYSIS_CACHE_PATH, {
    version: 1,
    analyses: {},
  });
  const analysisById = new Map();
  for (const article of newsCache.articles) {
    const cached = saved.analyses?.[article.id];
    const snapshot = assetSnapshots[article.symbol];
    if (
      !refresh &&
      cached?.originalTitle === article.title &&
      cached?.snapshotAsOf === snapshot?.market?.asOf &&
      cached?.analysis
    ) {
      analysisById.set(article.id, cached.analysis);
    }
  }

  const tasks = [];
  for (const symbol of symbols) {
    const pending = newsCache.articles.filter(
      (article) =>
        article.symbol === symbol && !analysisById.has(article.id),
    );
    for (const batch of chunks(pending, ANALYSIS_BATCH_SIZE)) {
      tasks.push({ symbol, articles: batch });
    }
  }

  let nextTaskIndex = 0;
  let persistChain = Promise.resolve();
  const persistProgress = () => {
    const analyses = Object.fromEntries(
      newsCache.articles
        .filter((article) => analysisById.has(article.id))
        .map((article) => [
          article.id,
          {
            originalTitle: article.title,
            snapshotAsOf: assetSnapshots[article.symbol].market.asOf,
            analysis: analysisById.get(article.id),
          },
        ]),
    );
    persistChain = persistChain.then(() =>
      writeJsonAtomically(ANALYSIS_CACHE_PATH, {
        version: 1,
        model: llmConfig.model,
        analyses,
      }),
    );
    return persistChain;
  };

  async function worker() {
    while (nextTaskIndex < tasks.length) {
      const taskIndex = nextTaskIndex;
      nextTaskIndex += 1;
      const task = tasks[taskIndex];
      const analyses = await analyzeBatch(
        task.articles,
        assetSnapshots[task.symbol],
        macroSnapshot,
        llmConfig,
      );
      for (const [id, analysis] of analyses) analysisById.set(id, analysis);
      await persistProgress();
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(ANALYSIS_CONCURRENCY, tasks.length) },
      () => worker(),
    ),
  );
  await persistChain;

  const articles = newsCache.articles.map((article) => {
    const analysis = analysisById.get(article.id);
    if (!analysis) {
      throw new Error(`No cached analysis for article ${article.id}`);
    }
    return { ...article, analysis };
  });
  await writeJsonAtomically(NEWS_CACHE_PATH, {
    ...newsCache,
    version: 3,
    language: "en",
    enrichedAt: now.toISOString(),
    analysis: {
      provider: llmConfig.provider,
      model: llmConfig.model,
      reasoning:
        llmConfig.apiStyle === "responses"
          ? llmConfig.reasoningEffort
          : "thinking-enabled",
      language: "en",
    },
    macroSnapshot,
    assetSnapshots,
    articles,
  });
  console.log(`News analysis updated: ${articles.length} articles`);
}

try {
  await enrichNews();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (process.argv.includes("--if-missing")) {
    console.warn(`News analysis skipped: ${message}`);
    process.exitCode = 0;
  } else {
    console.error(`News analysis failed: ${message}`);
    process.exitCode = 1;
  }
}
