"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type OrderSide = "long" | "short";

type PlaceOrderInput = {
  injectiveAddress: string;
  marketQuery: string;
  side: OrderSide;
  notional: number;
  maxNotional: number;
  leverage: number;
};

type PlaceOrderResult = {
  txHash: string;
  ticker: string;
  price: number;
  quantity: number;
  notional: number;
  injectiveAddress: string;
};

type ClosePositionInput = {
  injectiveAddress: string;
  marketId: string;
  subaccountId: string;
  positionSide: OrderSide;
  quantity: string;
};

export type PhantomWalletConnection = {
  ethereumAddress: string;
  injectiveAddress: string;
};

export type DerivativePosition = {
  marketId: string;
  subaccountId: string;
  ticker: string;
  side: OrderSide;
  quantity: number;
  quantityText: string;
  entryPrice: number;
  markPrice: number;
  margin: number;
  liquidationPrice: number;
  unrealizedPnl: number;
  leverage: number;
};

const DERIVATIVE_MARKET_ORDER_TYPE = {
  BUY: 1,
  SELL: 2,
} as const;

let injectiveModulesPromise: Promise<any> | undefined;
let phantomWalletStrategyPromise: Promise<any> | undefined;
let marketsCache: any[] | undefined;

function getDerivativeMarketOrderType(side: OrderSide) {
  return side === "long"
    ? DERIVATIVE_MARKET_ORDER_TYPE.BUY
    : DERIVATIVE_MARKET_ORDER_TYPE.SELL;
}

function getBestOrderbookLevel(orderbook: any, side: OrderSide) {
  const levels = side === "long" ? orderbook.sells : orderbook.buys;
  return Array.isArray(levels)
    ? levels.find(
        (level) => Number(level?.price) > 0 && Number(level?.quantity) > 0,
      )
    : undefined;
}

function getErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || "");
}

function normalizeInjectiveOrderError(error: unknown) {
  const message = getErrorText(error);
  if (/user rejected|user denied|request rejected|cancelled by user/i.test(message)) {
    return "Phantom signature was rejected. No order was submitted.";
  }
  if (/selected network is incorrect|chain switch/i.test(message)) {
    return "Switch Phantom to Ethereum Mainnet and try again.";
  }
  if (/account .* not found/i.test(message)) {
    return "Account not activated or insufficient balance. Fund this Injective address before trading.";
  }
  if (
    /insufficient funds|insufficient balance|spendable balance|insufficient fee/i.test(
      message,
    )
  ) {
    return "Insufficient balance to cover margin or gas.";
  }
  return message || "Injective rejected the order.";
}

async function loadInjectiveModules() {
  if (!injectiveModulesPromise) {
    injectiveModulesPromise = (async () => {
      const bufferModule = await import("buffer");
      if (!(globalThis as any).Buffer) {
        (globalThis as any).Buffer = bufferModule.Buffer;
      }

      const [
        networksModule,
        indexerModule,
        sdkModules,
        sdkTx,
        sdkAccounts,
        sdkUtils,
        baseUtils,
        tsTypes,
        walletBase,
        walletBroadcaster,
        walletCoreStrategy,
        walletEvm,
      ] = await Promise.all([
        import("@injectivelabs/networks"),
        import("@injectivelabs/sdk-ts/client/indexer"),
        import("@injectivelabs/sdk-ts/core/modules"),
        import("@injectivelabs/sdk-ts/core/tx"),
        import("@injectivelabs/sdk-ts/core/accounts"),
        import("@injectivelabs/sdk-ts/utils"),
        import("@injectivelabs/utils"),
        import("@injectivelabs/ts-types"),
        import("@injectivelabs/wallet-base"),
        import("@injectivelabs/wallet-core/broadcaster"),
        import("@injectivelabs/wallet-core/strategy"),
        import("@injectivelabs/wallet-evm"),
      ]);

      return {
        ...networksModule,
        ...indexerModule,
        ...sdkModules,
        ...sdkTx,
        ...sdkAccounts,
        ...sdkUtils,
        ...tsTypes,
        ...walletBase,
        ...walletBroadcaster,
        ...walletCoreStrategy,
        ...walletEvm,
        BigNumber: baseUtils.BigNumber,
      };
    })();
  }

  return injectiveModulesPromise;
}

async function getPhantomWalletStrategy(modules: any) {
  if (!phantomWalletStrategyPromise) {
    phantomWalletStrategyPromise = (async () => {
      const strategyArgs = {
        chainId: modules.ChainId.Mainnet,
        evmOptions: {
          evmChainId: modules.EvmChainId.Mainnet,
          rpcUrl: "",
        },
        wallet: modules.Wallet.Phantom,
      };
      const phantomStrategy = new modules.EvmWalletStrategy({
        ...strategyArgs,
        wallet: modules.Wallet.Phantom,
      });
      const strategy = new modules.BaseWalletStrategy({
        ...strategyArgs,
        strategies: {
          [modules.Wallet.Phantom]: phantomStrategy,
        },
      });
      await strategy.setWallet(modules.Wallet.Phantom);
      return strategy;
    })().catch((error) => {
      phantomWalletStrategyPromise = undefined;
      throw error;
    });
  }

  return phantomWalletStrategyPromise;
}

function toPhantomWalletConnection(
  modules: any,
  ethereumAddress: string,
): PhantomWalletConnection {
  return {
    ethereumAddress,
    injectiveAddress: modules.getInjectiveAddress(ethereumAddress),
  };
}

async function getAuthorizedPhantomAddresses(
  modules: any,
): Promise<string[]> {
  const strategy = await getPhantomWalletStrategy(modules);
  const provider = await strategy.getEip1193Provider();
  const addresses = await provider.request({ method: "eth_accounts" });
  return Array.isArray(addresses)
    ? addresses.filter((address): address is string => typeof address === "string")
    : [];
}

async function ensurePhantomEthereumMainnet(modules: any) {
  const strategy = await getPhantomWalletStrategy(modules);
  const currentChainId = Number.parseInt(
    await strategy.getEthereumChainId(),
    16,
  );
  if (currentChainId === modules.EvmChainId.Mainnet) return;

  const concreteStrategy = strategy.getStrategy();
  if (typeof concreteStrategy.addEvmNetwork !== "function") {
    throw new Error(
      "Phantom cannot switch to Ethereum Mainnet. Update the extension and try again.",
    );
  }
  await concreteStrategy.addEvmNetwork(modules.EvmChainId.Mainnet);
}

async function assertConnectedPhantomAddress(
  modules: any,
  injectiveAddress: string,
) {
  const addresses = await getAuthorizedPhantomAddresses(modules);
  const activeAddress = addresses[0];
  if (!activeAddress) {
    throw new Error("Phantom is disconnected. Connect it again in Settings.");
  }
  const connection = toPhantomWalletConnection(modules, activeAddress);
  if (
    connection.injectiveAddress.toLowerCase() !==
    injectiveAddress.toLowerCase()
  ) {
    throw new Error(
      "The active Phantom account changed. Reconnect it before trading.",
    );
  }
  await ensurePhantomEthereumMainnet(modules);
  return connection;
}

export async function connectPhantomWallet(): Promise<PhantomWalletConnection> {
  const modules = await loadInjectiveModules();
  const strategy = await getPhantomWalletStrategy(modules);
  const addresses = await strategy.getAddresses();
  const activeAddress = addresses[0];
  if (!activeAddress) {
    throw new Error("Phantom did not return an Ethereum address.");
  }
  await ensurePhantomEthereumMainnet(modules);
  return toPhantomWalletConnection(modules, activeAddress);
}

export async function restorePhantomWallet(): Promise<PhantomWalletConnection | null> {
  const modules = await loadInjectiveModules();
  try {
    const addresses = await getAuthorizedPhantomAddresses(modules);
    return addresses[0]
      ? toPhantomWalletConnection(modules, addresses[0])
      : null;
  } catch {
    return null;
  }
}

export async function watchPhantomWallet(
  onChange: (connection: PhantomWalletConnection | null) => void,
) {
  const modules = await loadInjectiveModules();
  const strategy = await getPhantomWalletStrategy(modules);
  const provider = await strategy.getEip1193Provider();
  const handleAccountsChanged = (accounts: unknown) => {
    const activeAddress =
      Array.isArray(accounts) && typeof accounts[0] === "string"
        ? accounts[0]
        : "";
    onChange(
      activeAddress
        ? toPhantomWalletConnection(modules, activeAddress)
        : null,
    );
  };
  provider.on?.("accountsChanged", handleAccountsChanged);

  return () => {
    provider.removeListener?.("accountsChanged", handleAccountsChanged);
  };
}

export async function disconnectPhantomWallet() {
  const modules = await loadInjectiveModules();
  try {
    const strategy = await getPhantomWalletStrategy(modules);
    const provider = await strategy.getEip1193Provider();
    await provider
      .request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      })
      .catch(() => undefined);
    await strategy.disconnect();
  } finally {
    phantomWalletStrategyPromise = undefined;
  }
}

export async function fetchDerivativePositions(
  injectiveAddress: string,
): Promise<DerivativePosition[]> {
  const modules = await loadInjectiveModules();
  const endpoints = modules.getNetworkEndpoints(modules.Network.Mainnet);
  const api = new modules.IndexerGrpcDerivativesApi(endpoints.indexer);
  const [response, markets] = await Promise.all([
    api.fetchPositionsV2({ address: injectiveAddress }),
    fetchMarkets(modules),
  ]);
  const marketsById = new Map<string, any>(
    markets.map((market: any) => [String(market.marketId), market]),
  );

  return response.positions
    .map((position: any) => {
      const market = marketsById.get(String(position.marketId || ""));
      const quoteDecimals = Number(market?.quoteToken?.decimals ?? 6);
      const fromChainPrice = (value: unknown) =>
        Number(
          modules.derivativePriceFromChainPriceToFixed({
            value: String(value || "0"),
            quoteDecimals,
          }),
        );
      const fromChainQuoteAmount = (value: unknown) =>
        Number(
          modules.derivativeMarginFromChainMarginToFixed({
            value: String(value || "0"),
            quoteDecimals,
          }),
        );
      const direction = String(position.direction || "").toLowerCase();
      const side: OrderSide =
        direction === "buy" || direction === "long" ? "long" : "short";
      const quantityText = new modules.BigNumber(
        String(position.quantity || "0"),
      )
        .absoluteValue()
        .toFixed();
      const quantity = Math.abs(Number(quantityText));
      const entryPrice = fromChainPrice(position.entryPrice);
      const markPrice = fromChainPrice(position.markPrice);
      const margin = fromChainQuoteAmount(position.margin);
      const reportedPnl =
        position.upnl === undefined ||
        position.upnl === null ||
        position.upnl === ""
          ? Number.NaN
          : fromChainQuoteAmount(position.upnl);
      const calculatedPnl =
        (side === "long" ? markPrice - entryPrice : entryPrice - markPrice) *
        quantity;
      const unrealizedPnl =
        Number.isFinite(reportedPnl) &&
        (reportedPnl !== 0 || calculatedPnl === 0)
          ? reportedPnl
          : calculatedPnl;

      return {
        marketId: String(position.marketId || ""),
        subaccountId: String(
          position.subaccountId || modules.getDefaultSubaccountId(injectiveAddress),
        ),
        ticker: String(position.ticker || "Unknown market"),
        side,
        quantity,
        quantityText,
        entryPrice,
        markPrice,
        margin,
        liquidationPrice: fromChainPrice(position.liquidationPrice),
        unrealizedPnl,
        leverage:
          margin > 0 ? Math.max(1, (entryPrice * quantity) / margin) : 1,
      };
    })
    .filter((position: DerivativePosition) => position.quantity > 0);
}

async function fetchMarkets(modules: any) {
  if (marketsCache) return marketsCache;

  const endpoints = modules.getNetworkEndpoints(modules.Network.Mainnet);
  const api = new modules.IndexerGrpcDerivativesApi(endpoints.indexer);
  const markets = await api.fetchMarkets({ marketStatuses: ["active"] });
  marketsCache = markets;
  return markets;
}

function quotePriority(market: any) {
  const ticker = String(market.ticker || "").toUpperCase();
  if (ticker.includes("USDC")) return 0;
  if (ticker.includes("USDT")) return 1;
  return 2;
}

function sortMarketCandidates(markets: any[]) {
  return [...markets].sort((left, right) => {
    const quoteDiff = quotePriority(left) - quotePriority(right);
    if (quoteDiff !== 0) return quoteDiff;
    return String(left.ticker || "").localeCompare(String(right.ticker || ""));
  });
}

function findMarketCandidates(markets: any[], marketQuery: string) {
  const query = marketQuery.trim().toUpperCase();
  const perpetuals = markets.filter(
    (market) => market.isPerpetual !== false,
  );
  const exactCandidates = perpetuals.filter((market) => {
    const ticker = String(market.ticker || "").toUpperCase();
    const base = ticker.split("/")[0]?.trim();
    return base === query;
  });
  const candidates = exactCandidates.length
    ? exactCandidates
    : perpetuals.filter((market) =>
        String(market.ticker || "").toUpperCase().includes(query),
      );

  return sortMarketCandidates(candidates);
}

async function findLiquidDerivativeMarket(
  derivativesApi: any,
  markets: any[],
  marketQuery: string,
  side: OrderSide,
) {
  const candidates = findMarketCandidates(markets, marketQuery);
  if (!candidates.length) {
    throw new Error(
      `No tradable ${marketQuery} perpetual market was found on Injective Mainnet.`,
    );
  }

  const checkedTickers: string[] = [];
  for (const market of candidates) {
    checkedTickers.push(String(market.ticker || "Unknown market"));
    const orderbook = await derivativesApi.fetchOrderbookV2(market.marketId);
    const bestLevel = getBestOrderbookLevel(orderbook, side);
    if (bestLevel) return { bestLevel, market };
  }

  throw new Error(
    `${marketQuery} does not currently have enough Mainnet order-book liquidity. Checked: ${checkedTickers.join(
      ", ",
    )}`,
  );
}

function getMarketOrderPricing(
  modules: any,
  market: any,
  bestLevel: any,
  side: OrderSide,
) {
  const quoteDecimals = Number(market.quoteToken?.decimals ?? 6);
  const multipliers = modules.getDerivativeMarketTensMultiplier({
    quoteDecimals,
    minPriceTickSize: market.minPriceTickSize,
    minQuantityTickSize: market.minQuantityTickSize,
  });
  const referencePrice = Number(
    modules.derivativePriceFromChainPriceToFixed({
      value: bestLevel.price,
      tensMultiplier: multipliers.priceTensMultiplier,
      quoteDecimals,
    }),
  );

  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    throw new Error(`${market.ticker} has an invalid order-book price. Try again shortly.`);
  }

  const protectedPrice =
    side === "long" ? referencePrice * 1.005 : referencePrice * 0.995;
  const allowedPrice = modules.formatPriceToAllowablePrice(
    protectedPrice,
    multipliers.priceTensMultiplier,
  );

  return {
    allowedPrice,
    multipliers,
    quoteDecimals,
  };
}

function getEntryOrderSize(
  modules: any,
  market: any,
  allowedPrice: string,
  requestedNotional: number,
  maxNotional: number,
  quoteDecimals: number,
  quantityTensMultiplier: number,
) {
  const BigNumber = modules.BigNumber;
  const price = new BigNumber(allowedPrice);
  const tick = new BigNumber(market.minQuantityTickSize || 0);
  const requested = new BigNumber(Math.max(1, requestedNotional));
  const cap = new BigNumber(Math.max(1, maxNotional));
  const marketMinimum = new BigNumber(
    modules.derivativeMarginFromChainMarginToFixed({
      value: String(market.minNotional || "0"),
      quoteDecimals,
    }),
  );

  if (!price.isFinite() || price.lte(0) || !tick.isFinite() || tick.lte(0)) {
    throw new Error(`${market.ticker} has an invalid trading increment. Try again shortly.`);
  }

  const requestedSteps = requested
    .dividedBy(price)
    .dividedBy(tick)
    .integerValue(BigNumber.ROUND_FLOOR);
  let quantity = requestedSteps.multipliedBy(tick);
  let actualNotional = quantity.multipliedBy(price);

  if (quantity.lte(0) || actualNotional.lt(marketMinimum)) {
    const minimumSteps = marketMinimum
      .dividedBy(price)
      .dividedBy(tick)
      .integerValue(BigNumber.ROUND_CEIL);
    quantity = BigNumber.maximum(1, minimumSteps).multipliedBy(tick);
    actualNotional = quantity.multipliedBy(price);
  }

  if (actualNotional.gt(cap)) {
    throw new Error(
      `${market.ticker} currently requires at least $${actualNotional.toFixed(
        2,
      )}, which exceeds your $${cap.toFixed(2)} per-trade cap.`,
    );
  }

  const allowedQuantity = modules.formatAmountToAllowableAmount(
    quantity.toFixed(),
    quantityTensMultiplier,
  );

  return {
    allowedQuantity,
    actualNotional: Number(actualNotional.toFixed()),
  };
}

async function broadcastDerivativeOrder(
  modules: any,
  injectiveAddress: string,
  endpoints: any,
  msg: any,
) {
  await assertConnectedPhantomAddress(modules, injectiveAddress);
  const walletStrategy = await getPhantomWalletStrategy(modules);
  const broadcaster = new modules.MsgBroadcaster({
    walletStrategy,
    network: modules.Network.Mainnet,
    endpoints,
    evmChainId: modules.EvmChainId.Mainnet,
    simulateTx: true,
    gasBufferCoefficient: 1.1,
  });
  let response;
  try {
    response = await broadcaster.broadcast({
      msgs: msg,
      injectiveAddress,
    });
  } catch (error) {
    throw new Error(normalizeInjectiveOrderError(error));
  }

  if (response.code !== 0) {
    throw new Error(normalizeInjectiveOrderError(response.rawLog));
  }

  return response;
}

export async function placeDerivativeMarketOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  const modules = await loadInjectiveModules();
  const injectiveAddress = input.injectiveAddress;
  const markets = await fetchMarkets(modules);
  const endpoints = modules.getNetworkEndpoints(modules.Network.Mainnet);
  const derivativesApi = new modules.IndexerGrpcDerivativesApi(
    endpoints.indexer,
  );
  const { bestLevel, market } = await findLiquidDerivativeMarket(
    derivativesApi,
    markets,
    input.marketQuery,
    input.side,
  );

  const { allowedPrice, multipliers, quoteDecimals } = getMarketOrderPricing(
    modules,
    market,
    bestLevel,
    input.side,
  );
  const { actualNotional, allowedQuantity } = getEntryOrderSize(
    modules,
    market,
    allowedPrice,
    input.notional,
    input.maxNotional,
    quoteDecimals,
    multipliers.quantityTensMultiplier,
  );
  const rawMargin = actualNotional / input.leverage;
  const subaccountId = modules.getDefaultSubaccountId(injectiveAddress);

  const msg = modules.MsgCreateDerivativeMarketOrder.fromJSON({
    marketId: market.marketId,
    subaccountId,
    injectiveAddress,
    orderType: getDerivativeMarketOrderType(input.side),
    triggerPrice: "0",
    feeRecipient: injectiveAddress,
    price: modules.derivativePriceToChainPriceToFixed({
      value: allowedPrice,
      tensMultiplier: multipliers.priceTensMultiplier,
      quoteDecimals,
    }),
    quantity: modules.derivativeQuantityToChainQuantityToFixed({
      value: allowedQuantity,
      tensMultiplier: multipliers.quantityTensMultiplier,
    }),
    margin: modules.derivativeMarginToChainMarginToFixed({
      value: rawMargin,
      quoteDecimals,
      tensMultiplier: multipliers.priceTensMultiplier,
    }),
  });

  const response = await broadcastDerivativeOrder(
    modules,
    injectiveAddress,
    endpoints,
    msg,
  );

  return {
    txHash: response.txHash,
    ticker: market.ticker,
    price: Number(allowedPrice),
    quantity: Number(allowedQuantity),
    notional: actualNotional,
    injectiveAddress,
  };
}

export async function closeDerivativePosition(
  input: ClosePositionInput,
): Promise<PlaceOrderResult> {
  const modules = await loadInjectiveModules();
  const injectiveAddress = input.injectiveAddress;
  const markets = await fetchMarkets(modules);
  const market = markets.find(
    (candidate: any) => String(candidate.marketId) === input.marketId,
  );

  if (!market) {
    throw new Error("The market for this position was not found on Injective Mainnet.");
  }

  const endpoints = modules.getNetworkEndpoints(modules.Network.Mainnet);
  const derivativesApi = new modules.IndexerGrpcDerivativesApi(
    endpoints.indexer,
  );
  const closeSide: OrderSide =
    input.positionSide === "long" ? "short" : "long";
  const orderbook = await derivativesApi.fetchOrderbookV2(market.marketId);
  const bestLevel = getBestOrderbookLevel(orderbook, closeSide);

  if (!bestLevel) {
    throw new Error(`${market.ticker} does not have enough order-book liquidity to close the position.`);
  }

  const { allowedPrice, multipliers, quoteDecimals } = getMarketOrderPricing(
    modules,
    market,
    bestLevel,
    closeSide,
  );
  const allowedQuantity = modules.formatAmountToAllowableAmount(
    input.quantity,
    multipliers.quantityTensMultiplier,
  );

  if (Number(allowedQuantity) <= 0) {
    throw new Error(`${market.ticker} has an invalid position quantity and cannot be closed.`);
  }

  const msg = modules.MsgCreateDerivativeMarketOrder.fromJSON({
    marketId: market.marketId,
    subaccountId: input.subaccountId,
    injectiveAddress,
    orderType: getDerivativeMarketOrderType(closeSide),
    triggerPrice: "0",
    feeRecipient: injectiveAddress,
    price: modules.derivativePriceToChainPriceToFixed({
      value: allowedPrice,
      tensMultiplier: multipliers.priceTensMultiplier,
      quoteDecimals,
    }),
    quantity: modules.derivativeQuantityToChainQuantityToFixed({
      value: allowedQuantity,
      tensMultiplier: multipliers.quantityTensMultiplier,
    }),
    margin: modules.derivativeMarginToChainMarginToFixed({
      value: 0,
      quoteDecimals,
      tensMultiplier: multipliers.priceTensMultiplier,
    }),
  });
  const response = await broadcastDerivativeOrder(
    modules,
    injectiveAddress,
    endpoints,
    msg,
  );
  const orderNotional = Number(allowedPrice) * Number(allowedQuantity);

  return {
    txHash: response.txHash,
    ticker: market.ticker,
    price: Number(allowedPrice),
    quantity: Number(allowedQuantity),
    notional: orderNotional,
    injectiveAddress,
  };
}
