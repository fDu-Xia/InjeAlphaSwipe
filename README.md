# AlphaSwipe

AlphaSwipe turns focused stock and crypto news into a swipeable decision feed.
Swipe left to go long, right to go short, or up to skip on Injective Mainnet.
Tap a card to inspect its thesis, or hold it to open a contextual Signal AI
discussion.

## First-version scope

- Mobile-first card stack adapted from PaperSwipe
- A fixed signal universe: META, NVDA, AAPL, TSLA, BTC, ETH, BNB, and INJ
- English-only Financial Modeling Prep news from the latest seven-day window
- Cached English AI research covering signal, macro, industry, fundamentals, and risk
- Earnings metrics and analysis for every stock signal
- Three-direction pointer, touch, and keyboard controls
- Discover, Position, and Settings navigation
- Live Injective Mainnet positions and unrealized PnL
- Local browser private-key signing with no wallet connection
- Injective Mainnet derivative-market discovery, live orderbook lookup, gas
  simulation, signing, and broadcast
- Direct broadcast on horizontal swipe, with no second confirmation
- Tap-only details and long-press contextual Signal AI

## Private-key safety

The private key is stored in the current browser's local storage so it can be
restored after refresh. It is not sent to the AlphaSwipe server. Direct signing
removes the protection of a wallet confirmation screen, and a locally stored
key can be read by anyone with access to this browser profile, so use a
dedicated low-balance Injective trading account rather than a primary wallet.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Validation

```bash
npm run build
npm test
npx tsc --noEmit
```

`scripts/sync-news.mjs` refreshes the approved stock and crypto symbols from
Financial Modeling Prep. `scripts/enrich-news.mjs` builds the English research
cache, while `app/api/signals/route.ts` falls back to the verified editorial
analysis in `app/news-data.ts` when the cache is unavailable.
