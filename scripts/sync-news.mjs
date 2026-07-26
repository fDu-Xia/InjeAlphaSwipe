import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const CACHE_PATH = process.env.NEWS_CACHE_PATH
  ? resolve(process.env.NEWS_CACHE_PATH)
  : resolve(PROJECT_ROOT, "data/news-cache.json");
const LOCAL_ENV_FILES = [".env.local", ".dev.vars"].map((name) =>
  resolve(PROJECT_ROOT, name),
);

const STOCK_SYMBOLS = ["META", "NVDA", "AAPL", "TSLA"];
const CRYPTO_SYMBOLS = ["BTCUSD", "ETHUSD", "BNBUSD", "INJUSD"];
const ALLOWED_SYMBOLS = new Set([...STOCK_SYMBOLS, ...CRYPTO_SYMBOLS]);
const FMP_BASE_URL =
  process.env.FMP_BASE_URL ||
  "https://financialmodelingprep.com/stable/news";
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

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

async function readCache() {
  try {
    return JSON.parse(await readFile(CACHE_PATH, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function parseFmpDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.includes("T")
    ? value
    : `${value.trim().replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanText(value, maxLength = 8_000) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function normalizeArticle(raw, category, windowStart) {
  const symbol = cleanText(raw?.symbol, 20).toUpperCase();
  const publishedAt = parseFmpDate(raw?.publishedDate);
  const url = cleanText(raw?.url, 2_000);
  const title = cleanText(raw?.title, 1_000);

  if (
    !ALLOWED_SYMBOLS.has(symbol) ||
    !publishedAt ||
    publishedAt < windowStart ||
    !url ||
    !title
  ) {
    return null;
  }

  const idSource = `${symbol}:${publishedAt.toISOString()}:${url}`;
  const id = Buffer.from(idSource).toString("base64url").slice(0, 96);

  return {
    id,
    category,
    symbol,
    publishedDate: publishedAt.toISOString(),
    publisher: cleanText(raw?.publisher, 200),
    title,
    image: cleanText(raw?.image, 2_000),
    site: cleanText(raw?.site, 300),
    text: cleanText(raw?.text),
    url,
  };
}

async function fetchFmpNews(category, symbols, apiKey, windowStart) {
  const url = new URL(`${FMP_BASE_URL}/${category}`);
  url.searchParams.set("symbols", symbols.join(","));
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `FMP ${category} news failed (${response.status}): ${body.slice(0, 240)}`,
    );
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`FMP ${category} news did not return valid JSON`);
  }
  if (!Array.isArray(payload)) {
    throw new Error(`FMP ${category} news returned an unexpected payload`);
  }

  return payload
    .map((article) => normalizeArticle(article, category, windowStart))
    .filter(Boolean);
}

async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function writeCache(cache) {
  await writeJsonAtomically(CACHE_PATH, cache);
}

async function syncNews() {
  await loadLocalEnv();

  const refresh = process.argv.includes("--refresh");
  const existingCache = await readCache();

  if (!refresh && existingCache?.articles?.length) {
    console.log(
      `News cache ready: ${existingCache.articles.length} articles from ${existingCache.syncedAt}`,
    );
    return;
  }

  const fmpApiKey = cleanText(process.env.FMP_API_KEY, 500);
  if (!fmpApiKey) throw new Error("FMP_API_KEY is required to sync news");

  const now = new Date();
  const windowStart = new Date(now.getTime() - WEEK_MS);
  const [stockNews, cryptoNews] = await Promise.all([
    fetchFmpNews("stock", STOCK_SYMBOLS, fmpApiKey, windowStart),
    fetchFmpNews("crypto", CRYPTO_SYMBOLS, fmpApiKey, windowStart),
  ]);

  const uniqueArticles = [
    ...new Map(
      [...stockNews, ...cryptoNews].map((article) => [article.url, article]),
    ).values(),
  ].sort(
    (left, right) =>
      new Date(right.publishedDate).getTime() -
      new Date(left.publishedDate).getTime(),
  );

  if (!uniqueArticles.length) {
    throw new Error(
      "FMP returned no matching articles from the configured symbols in the last 7 days",
    );
  }
  console.log(
    `FMP fetched ${stockNews.length} stock and ${cryptoNews.length} crypto articles from the last 7 days`,
  );

  await writeCache({
    version: 3,
    syncedAt: now.toISOString(),
    windowStart: windowStart.toISOString(),
    source: "financialmodelingprep",
    language: "en",
    symbols: {
      stock: STOCK_SYMBOLS,
      crypto: CRYPTO_SYMBOLS,
    },
    articles: uniqueArticles,
  });

  console.log(`News cache updated: ${uniqueArticles.length} English articles`);
}

try {
  await syncNews();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (process.argv.includes("--if-missing")) {
    console.warn(`News sync skipped: ${message}`);
    process.exitCode = 0;
  } else {
    console.error(`News sync failed: ${message}`);
    process.exitCode = 1;
  }
}
