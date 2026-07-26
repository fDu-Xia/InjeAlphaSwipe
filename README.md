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
- Phantom wallet connection with linked Injective address discovery
- Injective Mainnet derivative-market discovery, live orderbook lookup, gas
  simulation, signing, and broadcast
- Phantom-confirmed EIP-712 signing for entries and position closes
- Tap-only details and long-press contextual Signal AI

## Wallet safety

AlphaSwipe never requests or stores a private key or seed phrase. Phantom
provides the selected public EVM address, which is mapped to its Injective
address. Every Mainnet entry and close request must be approved in Phantom
before it can be broadcast.

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
