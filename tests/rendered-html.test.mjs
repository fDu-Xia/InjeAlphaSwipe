import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { derivativeMarginFromChainMarginToFixed } from "@injectivelabs/sdk-ts/utils";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the AlphaSwipe product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AlphaSwipe — Swipe signals\. Trade the thesis\.<\/title>/i);
  assert.match(html, /AlphaSwipe/);
  assert.match(html, /class="deck-area"/);
  assert.match(html, /class="card-stack"/);
  assert.match(html, /Discover/);
  assert.match(html, /Position/);
  assert.match(html, /Settings/);
  assert.doesNotMatch(html, /Watchlist|Activity/);
  assert.match(html, /META, NVDA, AAPL, TSLA, BTC, ETH, BNB, and INJ/);
  assert.doesNotMatch(html, /MAINNET · REAL FUNDS/i);
  assert.doesNotMatch(html, /Focused signal feed/i);
  assert.doesNotMatch(html, /Tap details · Hold for AI · Swipe to trade/);
  assert.doesNotMatch(html, /Connect Keplr|Connect wallet/);
  assert.match(html, /\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("normalizes derivative minimum notional from quote-chain units", () => {
  assert.equal(
    derivativeMarginFromChainMarginToFixed({
      value: "1000000",
      quoteDecimals: 6,
    }),
    "1",
  );
});

test("starter preview is removed and product assets are wired", async () => {
  const [
    page,
    layout,
    packageJson,
    newsData,
    injectiveClient,
    swipeApp,
    aiRoute,
    signalsRoute,
    syncNews,
    enrichNews,
    newsCache,
    globalStyles,
    envExample,
  ] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("../app/news-data.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/injective-client.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/alpha-swipe-app.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/ai/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/signals/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../scripts/sync-news.mjs", import.meta.url), "utf8"),
      readFile(new URL("../scripts/enrich-news.mjs", import.meta.url), "utf8"),
      readFile(new URL("../data/news-cache.json", import.meta.url), "utf8"),
      readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
      readFile(new URL("../.env.example", import.meta.url), "utf8"),
    ]);

  assert.match(page, /<AlphaSwipeApp \/>/);
  assert.match(layout, /openGraph/);
  assert.match(layout, /summary_large_image/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(newsData, /category:\s*"crypto"/);
  assert.match(newsData, /category:\s*"stock"/);
  for (const symbol of ["META", "NVDA", "AAPL", "TSLA", "BTC", "ETH", "BNB", "INJ"]) {
    assert.match(newsData, new RegExp(`marketQuery:\\s*"${symbol}"`));
  }
  assert.equal((newsData.match(/earnings:\s*\{/g) ?? []).length, 4);
  assert.match(injectiveClient, /MsgCreateDerivativeMarketOrder/);
  assert.match(injectiveClient, /MsgBroadcasterWithPk/);
  assert.match(injectiveClient, /PrivateKey\.fromHex/);
  assert.match(injectiveClient, /DERIVATIVE_MARKET_ORDER_TYPE/);
  assert.match(injectiveClient, /BUY:\s*1/);
  assert.match(injectiveClient, /SELL:\s*2/);
  assert.doesNotMatch(injectiveClient, /modules\.OrderType/);
  assert.match(injectiveClient, /findMarketCandidates/);
  assert.match(injectiveClient, /findLiquidDerivativeMarket/);
  assert.match(injectiveClient, /normalizeInjectiveOrderError/);
  assert.match(injectiveClient, /Account not activated or insufficient balance/);
  assert.match(injectiveClient, /Insufficient balance/);
  assert.match(injectiveClient, /Checked:/);
  assert.match(injectiveClient, /fetchPositionsV2/);
  assert.match(injectiveClient, /derivativeMarginFromChainMarginToFixed/);
  assert.match(injectiveClient, /Network\.Mainnet/);
  assert.doesNotMatch(injectiveClient, /Network\.Testnet|ChainId\.Testnet/);
  assert.match(injectiveClient, /derivativePriceFromChainPriceToFixed/);
  assert.doesNotMatch(injectiveClient, /WalletStrategy|Wallet\.Keplr/);
  assert.match(swipeApp, /LONG_PRESS_MS\s*=\s*560/);
  assert.match(swipeApp, /LOCAL_PRIVATE_KEY_STORAGE_KEY/);
  assert.match(swipeApp, /localStorage\.getItem/);
  assert.match(swipeApp, /localStorage\.setItem/);
  assert.match(swipeApp, /localStorage\.removeItem/);
  assert.match(swipeApp, /privateKeyRef/);
  assert.match(
    swipeApp,
    /type="range"\s+min="1"\s+max="500"\s+step="1"\s+value=\{maxNotional\}/,
  );
  assert.match(swipeApp, /function getSwipeNotional/);
  assert.match(swipeApp, /FULL_SIZE_SWIPE_PX\s*=\s*220/);
  assert.match(swipeApp, /POSITION_REFRESH_MS\s*=\s*10_000/);
  assert.match(swipeApp, /window\.setInterval/);
  assert.match(swipeApp, /positionsRequestInFlightRef/);
  assert.match(swipeApp, /Auto 10s/);
  assert.match(swipeApp, /formatPositionUpdateTime/);
  assert.match(swipeApp, /className="swipe-amount"/);
  assert.match(swipeApp, /Max notional/);
  assert.match(swipeApp, /closeDerivativePosition/);
  assert.match(swipeApp, /Close position/);
  assert.match(swipeApp, /Confirm close/);
  assert.match(injectiveClient, /BigNumber\.ROUND_FLOOR/);
  assert.match(injectiveClient, /actualNotional\.gt\(cap\)/);
  assert.match(
    injectiveClient,
    /derivativeMarginFromChainMarginToFixed\(\{\s*value:\s*String\(market\.minNotional/,
  );
  assert.match(injectiveClient, /export async function closeDerivativePosition/);
  assert.match(
    injectiveClient,
    /margin:\s*modules\.derivativeMarginToChainMarginToFixed\(\{\s*value:\s*0,/,
  );
  assert.match(swipeApp, /openSignalChat/);
  assert.match(swipeApp, /fetch\("\/api\/ai"/);
  assert.match(swipeApp, /fetch\("\/api\/signals\?schema=research-v2"/);
  assert.match(swipeApp, /cache:\s*"no-store"/);
  assert.match(swipeApp, /schemaVersion === 2/);
  assert.match(swipeApp, /signalForQuestion/);
  assert.match(swipeApp, /ChatGPT API research only/);
  assert.match(swipeApp, /News signal/);
  assert.match(swipeApp, /Macro analysis/);
  assert.match(swipeApp, /Industry analysis/);
  assert.match(swipeApp, /Asset fundamentals/);
  assert.match(swipeApp, /Recent market/);
  assert.match(swipeApp, /Recent earnings/);
  assert.match(swipeApp, /Risk factors/);
  assert.doesNotMatch(swipeApp, /className="earnings-panel"|className="thesis-grid"|className="fact-row"/);
  assert.doesNotMatch(swipeApp, /className="back-header"/);
  assert.match(swipeApp, /className="back-close"/);
  assert.doesNotMatch(swipeApp, /buildAssistantAnswer/);
  assert.doesNotMatch(swipeApp, /className="app-topbar"|className="feed-meta"|className="mainnet-live"/);
  assert.doesNotMatch(swipeApp, /Connect Keplr|connectKeplr|order-sheet|quick-order/);
  assert.doesNotMatch(swipeApp, /className="swipe-actions"|className="gesture-hint"/);
  assert.match(aiRoute, /DEFAULT_OPENAI_BASE_URL\s*=\s*"https:\/\/api\.openai\.com\/v1"/);
  assert.match(aiRoute, /DEFAULT_OPENAI_MODEL\s*=\s*"gpt-5\.6-sol"/);
  assert.match(aiRoute, /OPENAI_API_KEY/);
  assert.match(aiRoute, /OPENAI_BASE_URL/);
  assert.match(aiRoute, /OPENAI_MODEL/);
  assert.match(aiRoute, /OPENAI_REASONING_EFFORT/);
  assert.match(aiRoute, /reasoning:\s*\{\s*effort:\s*reasoningEffort\s*\}/);
  assert.match(aiRoute, /store:\s*false/);
  assert.match(aiRoute, /ALLOWED_SYMBOLS/);
  assert.match(aiRoute, /responsesUrl/);
  assert.match(aiRoute, /analysis:\s*signal\.analysis/);
  assert.match(signalsRoute, /news-cache\.json/);
  assert.match(signalsRoute, /financialmodelingprep/);
  assert.match(signalsRoute, /schemaVersion:\s*2/);
  assert.match(signalsRoute, /"Cache-Control":\s*"no-store, max-age=0"/);
  assert.doesNotMatch(signalsRoute, /news\.google\.com/);
  assert.match(syncNews, /financialmodelingprep\.com\/stable\/news/);
  assert.match(syncNews, /STOCK_SYMBOLS\s*=\s*\["META", "NVDA", "AAPL", "TSLA"\]/);
  assert.match(syncNews, /CRYPTO_SYMBOLS\s*=\s*\["BTCUSD", "ETHUSD", "BNBUSD", "INJUSD"\]/);
  assert.match(syncNews, /WEEK_MS\s*=\s*7\s*\*/);
  assert.doesNotMatch(syncNews, /translate|translation|titleZh|textZh|chat\/completions/i);
  assert.match(enrichNews, /historical-price-eod\/full/);
  assert.match(enrichNews, /income-statement/);
  assert.match(enrichNews, /treasury-rates/);
  assert.match(enrichNews, /economic-calendar/);
  assert.match(enrichNews, /thinking:\s*\{\s*type:\s*"enabled"\s*\}/);
  assert.match(enrichNews, /All output must be in English/);
  assert.match(packageJson, /"predev":\s*"node scripts\/sync-news\.mjs --if-missing && node scripts\/enrich-news\.mjs --if-missing"/);
  assert.match(packageJson, /"news:refresh":\s*"node scripts\/sync-news\.mjs --refresh && node scripts\/enrich-news\.mjs --refresh"/);
  assert.match(newsCache, /"source":\s*"financialmodelingprep"/);
  assert.match(newsCache, /"language":\s*"en"/);
  assert.match(newsCache, /"direction":\s*"(?:long|short|neutral)"/);
  assert.match(newsCache, /"macroSnapshot"/);
  assert.match(newsCache, /"assetSnapshots"/);
  assert.doesNotMatch(newsCache, /"titleZh"|"textZh"|"translation"/);
  assert.doesNotMatch(
    [layout, injectiveClient, swipeApp, aiRoute, signalsRoute, syncNews, enrichNews, newsCache].join("\n"),
    /[\p{Script=Han}]/u,
  );
  assert.match(globalStyles, /\.signal-verdict/);
  assert.match(globalStyles, /\.research-section/);
  assert.match(globalStyles, /\.research-metrics/);
  assert.doesNotMatch(globalStyles, /\.earnings-panel|\.thesis-grid|\.fact-row/);
  assert.match(envExample, /OPENAI_API_KEY=/);
  assert.match(envExample, /OPENAI_BASE_URL=https:\/\/api\.openai\.com\/v1/);
  assert.match(envExample, /OPENAI_MODEL=gpt-5\.6-sol/);
  assert.match(envExample, /OPENAI_REASONING_EFFORT=low/);
  assert.match(envExample, /FMP_API_KEY=/);
  assert.match(envExample, /LLM_BASE_URL=https:\/\/open\.bigmodel\.cn\/api\/paas\/v4/);
  assert.match(envExample, /LLM_MODEL=glm-4\.5-air/);
  assert.match(envExample, /LLM_THINKING=enabled/);

  await assert.rejects(
    access(new URL("../app/_sites-preview", import.meta.url)),
  );
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../public/favicon.svg", import.meta.url));
  await access(new URL(".openai/hosting.json", templateRoot));
});
