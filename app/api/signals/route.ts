import newsCache from "../../../data/news-cache.json";
import {
  NEWS_ITEMS,
  type NewsItem,
  type SignalResearch,
  type SignalSymbol,
} from "../../news-data";

type CachedArticle = {
  id: string;
  category: "stock" | "crypto";
  symbol: string;
  publishedDate: string;
  publisher: string;
  title: string;
  image: string;
  site: string;
  text: string;
  url: string;
  analysis?: SignalResearch;
};

const SYMBOL_MAP: Record<string, SignalSymbol> = {
  META: "META",
  NVDA: "NVDA",
  AAPL: "AAPL",
  TSLA: "TSLA",
  BTCUSD: "BTC",
  ETHUSD: "ETH",
  BNBUSD: "BNB",
  INJUSD: "INJ",
};

function formatPublishedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fallbackAnalysis(
  article: CachedArticle,
  marketQuery: SignalSymbol,
): SignalResearch {
  return {
    signal: {
      direction: "neutral",
      degree: "weak",
      label: "Neutral",
      confidence: 55,
      description:
        article.text ||
        "The available article context is too limited for a directional view.",
    },
    macro: "No verifiable macro snapshot is available in the current cache.",
    industry: {
      name: article.category === "stock" ? "Company industry" : "Digital assets",
      summary: "No verifiable industry analysis is available in the current cache.",
    },
    fundamentals: {
      overview: `Fundamental analysis for ${marketQuery} has not been generated yet.`,
      recentMarket: "No recent market snapshot is available in the current cache.",
      recentEarnings:
        article.category === "stock"
          ? "No recent earnings snapshot is available in the current cache."
          : "Not applicable. Crypto fundamentals should focus on network activity, fees, supply, and ecosystem adoption.",
      metrics: [],
    },
    risks: [
      "A single article may not create a durable trading signal. Verify the source and current market data before trading.",
    ],
    dataAsOf: formatPublishedDate(article.publishedDate),
  };
}

function articleToSignal(article: CachedArticle): NewsItem | null {
  const marketQuery = SYMBOL_MAP[article.symbol];
  const base = NEWS_ITEMS.find((item) => item.marketQuery === marketQuery);
  if (!base) return null;

  const publisher = article.publisher || article.site || "Financial Modeling Prep";
  const articleText = article.text;
  const analysis = article.analysis ?? fallbackAnalysis(article, marketQuery);
  const highImpact =
    analysis.signal.direction !== "neutral" &&
    analysis.signal.degree === "strong";

  return {
    ...base,
    id: article.id,
    category: article.category,
    title: article.title,
    hook: articleText || "Open the card to view the original article.",
    summary:
      articleText ||
      "FMP supplied the headline and source link but no article summary.",
    source: publisher,
    published: formatPublishedDate(article.publishedDate),
    sourceUrl: article.url,
    tags: [
      marketQuery,
      article.category === "stock" ? "Stock news" : "Crypto news",
      publisher,
    ].slice(0, 3),
    impact: highImpact ? "High" : "Medium",
    confidence: analysis.signal.confidence,
    horizon: "News-driven",
    bullCase:
      "If subsequent data confirms the development, expectations for the asset may improve.",
    bearCase:
      "A single article may not translate into a durable price or fundamental impact.",
    catalyst: "Follow-up disclosures, volume, and price response",
    risk: "Headline context is limited; verify the source before trading",
    earnings: undefined,
    analysis,
  };
}

export async function GET() {
  const cachedArticles = (newsCache.articles as CachedArticle[]) ?? [];
  const signals = cachedArticles
    .map(articleToSignal)
    .filter((item): item is NewsItem => Boolean(item));
  const usingLocalCache = signals.length > 0;

  return Response.json(
    {
      schemaVersion: 2,
      symbols: usingLocalCache
        ? [...new Set(signals.map((item) => item.marketQuery))]
        : NEWS_ITEMS.map((item) => item.marketQuery),
      signals: usingLocalCache ? signals : NEWS_ITEMS,
      source: usingLocalCache ? "financialmodelingprep" : "bundled-fallback",
      refreshedAt: usingLocalCache ? newsCache.syncedAt : null,
      windowStart: usingLocalCache ? newsCache.windowStart : null,
      language: "en",
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
