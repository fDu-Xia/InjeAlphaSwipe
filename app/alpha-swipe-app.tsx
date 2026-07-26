"use client";

import {
  Activity,
  BarChart3,
  Bot,
  Building2,
  Check,
  CircleUserRound,
  Compass,
  ExternalLink,
  Eye,
  EyeOff,
  Flame,
  KeyRound,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  NEWS_ITEMS,
  type NewsItem,
  type SignalResearch,
} from "./news-data";
import {
  closeDerivativePosition,
  deriveInjectiveAddress,
  fetchDerivativePositions,
  placeDerivativeMarketOrder,
  type DerivativePosition,
  type OrderSide,
} from "@/lib/injective-client";

type ActiveTab = "discover" | "position" | "settings";
type Decision = "skip" | OrderSide;

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

const LONG_PRESS_MS = 560;
const SWIPE_TRIGGER_PX = 88;
const FULL_SIZE_SWIPE_PX = 220;
const MIN_SWIPE_NOTIONAL = 1;
const POSITION_REFRESH_MS = 10_000;
const LOCAL_PRIVATE_KEY_STORAGE_KEY = "alphaswipe.injectivePrivateKey";

function getSwipeNotional(distance: number, maxNotional: number) {
  const safeMax = Math.max(MIN_SWIPE_NOTIONAL, maxNotional);
  const progress = Math.min(
    1,
    Math.max(
      0,
      (distance - SWIPE_TRIGGER_PX) /
        (FULL_SIZE_SWIPE_PX - SWIPE_TRIGGER_PX),
    ),
  );
  return (
    Math.round(
      (MIN_SWIPE_NOTIONAL + (safeMax - MIN_SWIPE_NOTIONAL) * progress) *
        100,
    ) / 100
  );
}

function formatNotional(value: number) {
  return value >= 100 ? value.toFixed(0) : value.toFixed(2);
}

function formatPositionPnl(value: number) {
  const absoluteValue = Math.abs(value);
  const decimals = absoluteValue > 0 && absoluteValue < 0.01 ? 6 : 2;
  return `${value >= 0 ? "+" : "-"}$${absoluteValue.toFixed(decimals)}`;
}

function formatPositionQuantity(value: number) {
  return value
    .toFixed(8)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

function formatPositionPrice(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPositionUpdateTime(timestamp: number) {
  if (!timestamp) return "updating…";
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function getPositionKey(position: DerivativePosition) {
  return `${position.subaccountId}-${position.marketId}-${position.side}`;
}

function shortAddress(address: string) {
  return `${address.slice(0, 7)}…${address.slice(-5)}`;
}

function readStoredPrivateKey() {
  try {
    return window.localStorage.getItem(LOCAL_PRIVATE_KEY_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

function storePrivateKey(privateKey: string) {
  try {
    window.localStorage.setItem(LOCAL_PRIVATE_KEY_STORAGE_KEY, privateKey);
    return true;
  } catch {
    return false;
  }
}

function clearStoredPrivateKey() {
  try {
    window.localStorage.removeItem(LOCAL_PRIVATE_KEY_STORAGE_KEY);
  } catch {
    // Local storage can be unavailable in restricted browser modes.
  }
}

type AiChatResponse = {
  answer?: string;
  error?: string;
};

function formatChatError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Signal AI is temporarily unavailable";
  return `Signal AI is temporarily unavailable: ${message}`;
}

function fallbackResearch(signal: NewsItem): SignalResearch {
  return {
    signal: {
      direction: "neutral",
      degree: "weak",
      label: "Neutral",
      confidence: signal.confidence,
      description: signal.summary,
    },
    macro:
      "The macro snapshot is loading. No additional inference is made about rates, the dollar, or risk appetite.",
    industry: {
      name: signal.category === "stock" ? "Company industry" : "Digital assets",
      summary:
        "Industry data is loading. Use the source article to judge the likely scope of the impact.",
    },
    fundamentals: {
      overview: "The asset fundamentals snapshot is loading.",
      recentMarket: "Recent market data is loading.",
      recentEarnings:
        signal.category === "stock"
          ? "Recent earnings data is loading."
          : "Not applicable. Crypto fundamentals should focus on network usage, fees, supply, and ecosystem activity.",
      metrics: [],
    },
    risks: [signal.risk || "A single article may not create a durable trading signal."],
    dataAsOf: signal.published,
  };
}

function SignalBack({
  signal,
  onClose,
  onAskAi,
}: {
  signal: NewsItem;
  onClose: () => void;
  onAskAi: () => void;
}) {
  const research = signal.analysis ?? fallbackResearch(signal);
  const SignalIcon =
    research.signal.direction === "long"
      ? TrendingUp
      : research.signal.direction === "short"
        ? TrendingDown
        : Activity;

  return (
    <div className="card-face card-back">
      <div className="back-scroll">
        <section
          className={`signal-verdict direction-${research.signal.direction}`}
        >
          <div className="verdict-icon">
            <SignalIcon />
          </div>
          <div className="verdict-copy">
            <span>News signal</span>
            <strong>{research.signal.label}</strong>
            <small>
              {research.signal.degree === "strong"
                ? "Strong"
                : research.signal.degree === "moderate"
                  ? "Moderate"
                  : "Weak"}
              {" · "}
              {research.signal.confidence}% confidence
            </small>
          </div>
          <button
            className="back-close"
            type="button"
            onClick={onClose}
            aria-label="Close signal details"
          >
            <X />
          </button>
          <p>{research.signal.description}</p>
        </section>

        <section className="research-section">
          <div className="research-heading">
            <Landmark />
            <span>Macro analysis</span>
          </div>
          <p>{research.macro}</p>
        </section>

        <section className="research-section">
          <div className="research-heading">
            <Building2 />
            <span>Industry analysis · {research.industry.name}</span>
          </div>
          <p>{research.industry.summary}</p>
        </section>

        <section className="research-section fundamentals-section">
          <div className="research-heading">
            <BarChart3 />
            <span>Asset fundamentals</span>
          </div>
          <div className="fundamental-copy">
            <div>
              <small>Fundamental view</small>
              <p>{research.fundamentals.overview}</p>
            </div>
            <div>
              <small>Recent market</small>
              <p>{research.fundamentals.recentMarket}</p>
            </div>
            <div>
              <small>Recent earnings</small>
              <p>{research.fundamentals.recentEarnings}</p>
            </div>
          </div>
          {research.fundamentals.metrics.length > 0 && (
            <div className="research-metrics">
              {research.fundamentals.metrics.map((metric) => (
                <div key={`${metric.label}-${metric.value}`}>
                  <small>{metric.label}</small>
                  <strong>{metric.value}</strong>
                  {metric.change && (
                    <span className={`metric-${metric.tone ?? "neutral"}`}>
                      {metric.change}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="research-section risk-section">
          <div className="research-heading">
            <TriangleAlert />
            <span>Risk factors</span>
          </div>
          <ul>
            {research.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </section>

        <div className="analysis-as-of">Data as of {research.dataAsOf}</div>
        <a
          className="source-link"
          href={signal.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          View original article <ExternalLink />
        </a>
        <button className="ask-ai-button" type="button" onClick={onAskAi}>
          <MessageCircle /> Discuss with Signal AI
        </button>
      </div>
    </div>
  );
}

export function AlphaSwipeApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("discover");
  const [signals, setSignals] = useState<NewsItem[]>(NEWS_ITEMS);
  const [index, setIndex] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [exitAction, setExitAction] = useState<Decision | null>(null);
  const [positions, setPositions] = useState<DerivativePosition[]>([]);
  const [positionsBusy, setPositionsBusy] = useState(false);
  const [positionsError, setPositionsError] = useState("");
  const [positionsUpdatedAt, setPositionsUpdatedAt] = useState(0);
  const [maxNotional, setMaxNotional] = useState(100);
  const [leverage, setLeverage] = useState(3);
  const [privateKeyDraft, setPrivateKeyDraft] = useState("");
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [signerAddress, setSignerAddress] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [tradeBusy, setTradeBusy] = useState(false);
  const [activeTradeNotional, setActiveTradeNotional] = useState(0);
  const [closeConfirmKey, setCloseConfirmKey] = useState("");
  const [closingPositionKey, setClosingPositionKey] = useState("");
  const [toast, setToast] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const privateKeyRef = useRef("");
  const positionsRequestInFlightRef = useRef(false);
  const chatMessageId = useRef(0);
  const pointer = useRef({
    active: false,
    x: 0,
    y: 0,
    startedAt: 0,
    longPressTimer: 0,
    longPressed: false,
  });

  const current = signals[index] ?? null;
  const swipeNotional = getSwipeNotional(Math.abs(drag.x), maxNotional);
  const totalUnrealizedPnl = positions.reduce(
    (sum, position) => sum + position.unrealizedPnl,
    0,
  );
  const totalMargin = positions.reduce(
    (sum, position) => sum + position.margin,
    0,
  );
  const totalPositionValue = positions.reduce(
    (sum, position) => sum + position.quantity * position.markPrice,
    0,
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  useEffect(() => {
    const storedPrivateKey = readStoredPrivateKey();
    if (!storedPrivateKey) return;

    let cancelled = false;
    setKeyBusy(true);
    void deriveInjectiveAddress(storedPrivateKey)
      .then((address) => {
        if (cancelled) return;
        privateKeyRef.current = storedPrivateKey;
        setSignerAddress(address);
        setPrivateKeyDraft("");
        setPositionsError("");
      })
      .catch(() => {
        if (cancelled) return;
        clearStoredPrivateKey();
        privateKeyRef.current = "";
      })
      .finally(() => {
        if (!cancelled) setKeyBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/signals?schema=research-v2", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Signal refresh failed");
        return response.json() as Promise<{
          schemaVersion?: number;
          signals?: NewsItem[];
        }>;
      })
      .then((payload) => {
        const hasCompleteResearch = payload.signals?.every(
          (signal) =>
            Boolean(signal.analysis?.macro) &&
            Boolean(signal.analysis?.industry?.summary) &&
            Boolean(signal.analysis?.fundamentals?.overview) &&
            Boolean(signal.analysis?.fundamentals?.recentMarket) &&
            Boolean(signal.analysis?.fundamentals?.recentEarnings),
        );
        if (
          payload.schemaVersion === 2 &&
          payload.signals?.length &&
          hasCompleteResearch
        ) {
          setSignals(payload.signals);
          setIndex(0);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const refreshPositions = useCallback(
    async (address = signerAddress) => {
      if (!address || positionsRequestInFlightRef.current) return;
      positionsRequestInFlightRef.current = true;
      setPositionsBusy(true);
      setPositionsError("");
      try {
        const nextPositions = await fetchDerivativePositions(address);
        setPositions(nextPositions);
        setPositionsUpdatedAt(Date.now());
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load positions";
        setPositionsError(message);
        showToast(message);
      } finally {
        positionsRequestInFlightRef.current = false;
        setPositionsBusy(false);
      }
    },
    [showToast, signerAddress],
  );

  useEffect(() => {
    if (activeTab !== "position" || !signerAddress) return;

    void refreshPositions(signerAddress);
    const intervalId = window.setInterval(() => {
      void refreshPositions(signerAddress);
    }, POSITION_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [activeTab, refreshPositions, signerAddress]);

  const advance = useCallback(
    (action: Decision, message?: string) => {
      if (!current || exitAction) return;
      setExitAction(action);
      showToast(message || (action === "skip" ? "Skipped" : "Order broadcast"));
      window.setTimeout(() => {
        setIndex((value) => value + 1);
        setDetailsOpen(false);
        setDrag({ x: 0, y: 0 });
        setExitAction(null);
      }, 330);
    },
    [current, exitAction, showToast],
  );

  const executeSwipeOrder = useCallback(
    async (side: OrderSide, orderNotional: number) => {
      if (!current || tradeBusy || exitAction) return;
      if (!signerAddress || !privateKeyRef.current) {
        showToast("Add a private key in Settings first");
        setActiveTab("settings");
        return;
      }

      setTradeBusy(true);
      setActiveTradeNotional(orderNotional);
      showToast(
        `Signing ${side} · $${formatNotional(orderNotional)} · Mainnet`,
      );
      try {
        const result = await placeDerivativeMarketOrder({
          privateKey: privateKeyRef.current,
          marketQuery: current.marketQuery,
          side,
          notional: orderNotional,
          maxNotional,
          leverage,
        });
        advance(
          side,
          `Broadcast $${formatNotional(result.notional)} · ${result.txHash.slice(
            0,
            10,
          )}…`,
        );
        void refreshPositions(result.injectiveAddress);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Order submission failed");
      } finally {
        setTradeBusy(false);
        setActiveTradeNotional(0);
      }
    },
    [
      advance,
      current,
      exitAction,
      leverage,
      maxNotional,
      refreshPositions,
      showToast,
      signerAddress,
      tradeBusy,
    ],
  );

  const decide = useCallback(
    async (action: Decision, orderNotional = MIN_SWIPE_NOTIONAL) => {
      if (!current || exitAction || chatOpen) return;
      if (action === "skip") {
        advance("skip");
        return;
      }
      await executeSwipeOrder(action, orderNotional);
    },
    [advance, chatOpen, current, executeSwipeOrder, exitAction],
  );

  const closePosition = useCallback(
    async (position: DerivativePosition) => {
      if (!signerAddress || !privateKeyRef.current || closingPositionKey) return;
      const positionKey = getPositionKey(position);
      setClosingPositionKey(positionKey);
      showToast(`Closing ${position.ticker} · reduce-only`);
      try {
        const result = await closeDerivativePosition({
          privateKey: privateKeyRef.current,
          marketId: position.marketId,
          subaccountId: position.subaccountId,
          positionSide: position.side,
          quantity: position.quantityText,
        });
        setCloseConfirmKey("");
        showToast(`Close broadcast · ${result.txHash.slice(0, 10)}…`);
        await refreshPositions(result.injectiveAddress);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Close order failed");
      } finally {
        setClosingPositionKey("");
      }
    },
    [closingPositionKey, refreshPositions, showToast, signerAddress],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        activeTab !== "discover" ||
        chatOpen ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (event.target as HTMLElement)?.tagName,
        )
      ) {
        return;
      }
      const keyMap: Record<string, Decision> = {
        ArrowLeft: "long",
        ArrowRight: "short",
        ArrowUp: "skip",
      };
      if (keyMap[event.key]) {
        event.preventDefault();
        void decide(keyMap[event.key], MIN_SWIPE_NOTIONAL);
      }
      if (event.key === " ") {
        event.preventDefault();
        setDetailsOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, chatOpen, decide]);

  const openSignalChat = useCallback(() => {
    if (!current) return;
    setChatOpen(true);
    setChatMessages([
      {
        id: `intro-${current.id}`,
        role: "assistant",
        text: `Discussing ${current.marketQuery}: ${current.title}. Ask about earnings, the bull and bear cases, catalysts, risks, or what could invalidate this signal.`,
      },
    ]);
    setChatInput("");
  }, [current]);

  const clearLongPress = () => {
    if (pointer.current.longPressTimer) {
      window.clearTimeout(pointer.current.longPressTimer);
      pointer.current.longPressTimer = 0;
    }
  };

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (tradeBusy || exitAction) return;
    if ((event.target as HTMLElement).closest("button, a, input, textarea")) {
      return;
    }
    clearLongPress();
    pointer.current = {
      active: true,
      x: event.clientX,
      y: event.clientY,
      startedAt: Date.now(),
      longPressTimer: window.setTimeout(() => {
        if (!pointer.current.active) return;
        pointer.current.active = false;
        pointer.current.longPressed = true;
        setDrag({ x: 0, y: 0 });
        navigator.vibrate?.(28);
        openSignalChat();
      }, LONG_PRESS_MS),
      longPressed: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!pointer.current.active) return;
    const nextDrag = {
      x: event.clientX - pointer.current.x,
      y: event.clientY - pointer.current.y,
    };
    if (Math.hypot(nextDrag.x, nextDrag.y) > 10) clearLongPress();
    if (!detailsOpen) setDrag(nextDrag);
  };

  const releasePointer = (event: React.PointerEvent<HTMLElement>) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // A long press can release capture before pointerup.
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    clearLongPress();
    if (pointer.current.longPressed) {
      pointer.current.longPressed = false;
      releasePointer(event);
      return;
    }
    if (!pointer.current.active) return;

    pointer.current.active = false;
    const elapsed = Date.now() - pointer.current.startedAt;
    const distance = Math.hypot(drag.x, drag.y);

    if (distance < 9 && elapsed < 360) {
      setDetailsOpen((value) => !value);
      setDrag({ x: 0, y: 0 });
      releasePointer(event);
      return;
    }
    if (!detailsOpen) {
      if (
        Math.abs(drag.x) > SWIPE_TRIGGER_PX &&
        Math.abs(drag.x) > Math.abs(drag.y)
      ) {
        void decide(drag.x < 0 ? "long" : "short", swipeNotional);
      } else if (
        drag.y < -76 &&
        Math.abs(drag.y) > Math.abs(drag.x) * 0.75
      ) {
        void decide("skip");
      }
    }
    setDrag({ x: 0, y: 0 });
    releasePointer(event);
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLElement>) => {
    clearLongPress();
    pointer.current.active = false;
    pointer.current.longPressed = false;
    setDrag({ x: 0, y: 0 });
    releasePointer(event);
  };

  const saveSessionKey = async () => {
    const trimmedPrivateKey = privateKeyDraft.trim();
    if (!trimmedPrivateKey) return;
    setKeyBusy(true);
    try {
      const address = await deriveInjectiveAddress(trimmedPrivateKey);
      const stored = storePrivateKey(trimmedPrivateKey);
      privateKeyRef.current = trimmedPrivateKey;
      setSignerAddress(address);
      setPrivateKeyDraft("");
      setShowPrivateKey(false);
      setPositions([]);
      setPositionsError("");
      setPositionsUpdatedAt(0);
      showToast(
        stored
          ? `Local key saved · ${shortAddress(address)}`
          : `Session key ready · storage blocked`,
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Invalid private key");
    } finally {
      setKeyBusy(false);
    }
  };

  const removeSessionKey = () => {
    privateKeyRef.current = "";
    clearStoredPrivateKey();
    setPrivateKeyDraft("");
    setSignerAddress("");
    setPositions([]);
    setPositionsError("");
    setPositionsUpdatedAt(0);
    setCloseConfirmKey("");
    setClosingPositionKey("");
    showToast("Local key cleared");
  };

  const sendChatMessage = async (question = chatInput) => {
    const value = question.trim();
    if (!value || !current || chatBusy) return;
    const signalForQuestion = current;
    chatMessageId.current += 1;
    const userMessage: ChatMessage = {
      id: `user-${chatMessageId.current}`,
      role: "user",
      text: value,
    };
    setChatMessages((messages) => [...messages, userMessage]);
    setChatInput("");
    setChatBusy(true);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: value,
          signal: signalForQuestion,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as AiChatResponse;
      if (!response.ok || !payload.answer) {
        throw new Error(payload.error || "The OpenAI API returned no content");
      }
      const answer = payload.answer;

      chatMessageId.current += 1;
      setChatMessages((messages) => [
        ...messages,
        {
          id: `assistant-${chatMessageId.current}`,
          role: "assistant",
          text: answer,
        },
      ]);
    } catch (error) {
      chatMessageId.current += 1;
      setChatMessages((messages) => [
        ...messages,
        {
          id: `assistant-${chatMessageId.current}`,
          role: "assistant",
          text: formatChatError(error),
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  const cardStyle = {
    "--drag-x": `${drag.x}px`,
    "--drag-y": `${drag.y}px`,
    "--drag-rotate": `${drag.x / 18}deg`,
  } as React.CSSProperties;

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="app-content">
        {activeTab === "discover" && (
          <section className="discover-view" aria-label="News signal feed">
            <div className="deck-area">
              <div className="card-stack">
                <div className="stack-card stack-card-two" />
                <div className="stack-card stack-card-one" />
                {current ? (
                  <article
                    className={`news-card theme-${current.theme} ${
                      detailsOpen ? "is-flipped" : ""
                    } ${exitAction ? `exit-${exitAction}` : ""}`}
                    style={cardStyle}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                    onContextMenu={(event) => event.preventDefault()}
                  >
                    <div
                      className="swipe-stamp stamp-long"
                      style={{ opacity: Math.max(0, -drag.x / 90) }}
                    >
                      <span>LONG</span>
                      <strong className="swipe-amount">
                        ${formatNotional(swipeNotional)}
                      </strong>
                    </div>
                    <div
                      className="swipe-stamp stamp-short"
                      style={{ opacity: Math.max(0, drag.x / 90) }}
                    >
                      <span>SHORT</span>
                      <strong className="swipe-amount">
                        ${formatNotional(swipeNotional)}
                      </strong>
                    </div>
                    <div
                      className="swipe-stamp stamp-skip"
                      style={{ opacity: Math.max(0, -drag.y / 80) }}
                    >
                      SKIP
                    </div>
                    {tradeBusy && (
                      <div className="trade-lock">
                        <LoaderCircle className="spin" />
                        <strong>Signing Mainnet order</strong>
                        <small>
                          ${formatNotional(activeTradeNotional)} · {leverage}×
                          leverage
                        </small>
                      </div>
                    )}
                    <div className="card-inner">
                      <div className="card-face card-front">
                        <div className="card-orbit orbit-one" />
                        <div className="card-orbit orbit-two" />
                        <div className="card-topline">
                          <span className="source-badge">{current.source}</span>
                          <span className="impact-badge">
                            <Flame />
                            {current.impact} impact
                          </span>
                        </div>
                        <div className="tag-line">
                          {current.tags.map((tag) => (
                            <span key={tag}>#{tag}</span>
                          ))}
                        </div>
                        <div className="card-copy">
                          <p>{current.hook}</p>
                          <h1>{current.title}</h1>
                        </div>
                        <div className="signal-strip">
                          <div>
                            <span className="market-symbol">
                              {current.marketQuery.slice(0, 2)}
                            </span>
                            <span>
                              <strong>{current.marketLabel}</strong>
                              <small>{current.published}</small>
                            </span>
                          </div>
                          <span className="confidence">
                            {current.confidence}%
                            <small>signal</small>
                          </span>
                        </div>
                        <div className="flip-hint">
                          <Sparkles />
                          Tap for details · Hold to ask AI
                        </div>
                      </div>

                      <SignalBack
                        signal={current}
                        onClose={() => setDetailsOpen(false)}
                        onAskAi={openSignalChat}
                      />
                    </div>
                  </article>
                ) : (
                  <article className="deck-complete">
                    <span><Check /></span>
                    <h1>Signal deck cleared</h1>
                    <p>
                      You reviewed every focused signal. Restart the deck for
                      another pass.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setIndex(0);
                      }}
                    >
                      Restart signals
                    </button>
                  </article>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === "position" && (
          <section className="page-view position-view">
            <header className="page-heading">
              <div>
                <span>INJECTIVE MAINNET</span>
                <h1>Positions</h1>
              </div>
              {signerAddress ? (
                <button
                  className="refresh-positions"
                  type="button"
                  onClick={() => void refreshPositions()}
                  disabled={positionsBusy}
                >
                  <RefreshCw className={positionsBusy ? "spin" : ""} />
                  Refresh
                </button>
              ) : (
                <span className="network-chip"><i /> Add key</span>
              )}
            </header>

            {signerAddress ? (
              <>
                <div className="position-summary-card">
                  <div className="position-account">
                    <span>
                      <i />
                      {shortAddress(signerAddress)}
                    </span>
                    <small>Session signer · live indexer</small>
                  </div>
                  <div className="pnl-hero">
                    <small>Total unrealized PnL</small>
                    <strong
                      className={
                        totalUnrealizedPnl >= 0 ? "is-profit" : "is-loss"
                      }
                    >
                      {formatPositionPnl(totalUnrealizedPnl)}
                    </strong>
                  </div>
                  <div className="position-summary-stats">
                    <span>
                      <small>Open positions</small>
                      <strong>{positions.length}</strong>
                    </span>
                    <span>
                      <small>Position value</small>
                      <strong>${totalPositionValue.toFixed(2)}</strong>
                    </span>
                    <span>
                      <small>Margin</small>
                      <strong>${totalMargin.toFixed(2)}</strong>
                    </span>
                  </div>
                </div>
                <div className="section-title">
                  <span>Open positions</span>
                  <small>
                    Auto 10s · {formatPositionUpdateTime(positionsUpdatedAt)}
                  </small>
                </div>
                <div className="positions-scroll">
                  {positionsBusy && positions.length === 0 ? (
                    <div className="empty-state compact">
                      <LoaderCircle className="spin" />
                      <h2>Loading positions</h2>
                      <p>Reading your Injective Mainnet subaccounts.</p>
                    </div>
                  ) : positionsError ? (
                    <div className="empty-state compact">
                      <ShieldCheck />
                      <h2>Couldn’t load positions</h2>
                      <p>{positionsError}</p>
                      <button
                        type="button"
                        onClick={() => void refreshPositions()}
                      >
                        Try again
                      </button>
                    </div>
                  ) : positions.length ? (
                    positions.map((position) => {
                      const positionKey = getPositionKey(position);
                      const isConfirming = closeConfirmKey === positionKey;
                      const isClosing = closingPositionKey === positionKey;

                      return (
                        <article
                          className="position-item"
                          key={positionKey}
                        >
                        <div className="position-item-heading">
                          <span className={position.side}>
                            {position.side === "long" ? (
                              <TrendingUp />
                            ) : (
                              <TrendingDown />
                            )}
                          </span>
                          <div>
                            <strong>{position.ticker}</strong>
                            <small>
                              {position.side} · {position.leverage.toFixed(1)}×
                            </small>
                          </div>
                          <div className="position-pnl">
                            <small>Unrealized PnL</small>
                            <strong
                              className={
                                position.unrealizedPnl >= 0
                                  ? "is-profit"
                                  : "is-loss"
                              }
                            >
                              {formatPositionPnl(position.unrealizedPnl)}
                            </strong>
                          </div>
                        </div>
                        <div className="position-details">
                          <span>
                            <small>Quantity</small>
                            <strong>
                              {formatPositionQuantity(position.quantity)}
                            </strong>
                          </span>
                          <span>
                            <small>Entry</small>
                            <strong>
                              ${formatPositionPrice(position.entryPrice)}
                            </strong>
                          </span>
                          <span>
                            <small>Mark</small>
                            <strong>
                              ${formatPositionPrice(position.markPrice)}
                            </strong>
                          </span>
                          <span>
                            <small>Liquidation</small>
                            <strong>
                              {position.liquidationPrice
                                ? `$${formatPositionPrice(
                                    position.liquidationPrice,
                                  )}`
                                : "—"}
                            </strong>
                          </span>
                        </div>
                        <div
                          className={`position-close-row${isConfirming ? " is-confirming" : ""}`}
                        >
                          {isConfirming ? (
                            <>
                              <div>
                                <strong>Close entire position?</strong>
                                <small>
                                  Market reduce-only · {position.quantityText}
                                </small>
                              </div>
                              <button
                                type="button"
                                className="close-cancel"
                                disabled={isClosing}
                                onClick={() => setCloseConfirmKey("")}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="close-confirm"
                                disabled={isClosing}
                                onClick={() => void closePosition(position)}
                              >
                                {isClosing ? (
                                  <LoaderCircle className="spin" />
                                ) : (
                                  <X />
                                )}
                                {isClosing ? "Closing" : "Confirm close"}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="close-position-button"
                              disabled={Boolean(closingPositionKey)}
                              onClick={() => setCloseConfirmKey(positionKey)}
                            >
                              <X />
                              Close position
                            </button>
                          )}
                        </div>
                      </article>
                      );
                    })
                  ) : (
                    <div className="empty-state compact">
                      <BarChart3 />
                      <h2>No open positions</h2>
                      <p>
                        Swipe left or right on a signal to place a direct
                        Mainnet order.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab("discover")}
                      >
                        Discover signals
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="position-connect-state">
                <span><KeyRound /></span>
                <h2>Add a session trading key</h2>
                <p>
                  Positions are read from the Injective address derived inside
                  this browser. The private key is stored locally on this
                  device and is never uploaded.
                </p>
                <button type="button" onClick={() => setActiveTab("settings")}>
                  <LockKeyhole />
                  Open key settings
                </button>
                <small>Mainnet orders use real funds.</small>
              </div>
            )}
          </section>
        )}

        {activeTab === "settings" && (
          <section className="page-view settings-view">
            <header className="page-heading">
              <div>
                <span>LOCAL SESSION</span>
                <h1>Settings</h1>
              </div>
              <CircleUserRound />
            </header>
            <div className="settings-scroll">
              <section className="settings-profile">
                <span>{signerAddress ? <LockKeyhole /> : <KeyRound />}</span>
                <div>
                  <strong>
                    {signerAddress
                      ? shortAddress(signerAddress)
                      : "No session signer"}
                  </strong>
                  <small>
                    {signerAddress
                      ? "Private key saved on this device"
                      : "Add a key to enable direct trading"}
                  </small>
                </div>
              </section>

              <section className="settings-card private-key-card">
                <div className="settings-title">
                  <div>
                    <h2>Session private key</h2>
                    <p>Used locally for direct Mainnet signing.</p>
                  </div>
                  <LockKeyhole />
                </div>
                {signerAddress ? (
                  <div className="key-ready-state">
                    <span><i /> Ready for direct signing</span>
                    <strong>{signerAddress}</strong>
                    <button type="button" onClick={removeSessionKey}>
                      Clear saved key
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="private-key-input">
                      <span>Private key</span>
                      <div>
                        <input
                          type={showPrivateKey ? "text" : "password"}
                          value={privateKeyDraft}
                          onChange={(event) =>
                            setPrivateKeyDraft(event.target.value)
                          }
                          placeholder="64-character hex key"
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPrivateKey((value) => !value)}
                          aria-label={
                            showPrivateKey
                              ? "Hide private key"
                              : "Show private key"
                          }
                        >
                          {showPrivateKey ? <EyeOff /> : <Eye />}
                        </button>
                      </div>
                    </label>
                    <button
                      className="save-key-button"
                      type="button"
                      onClick={() => void saveSessionKey()}
                      disabled={keyBusy || !privateKeyDraft.trim()}
                    >
                      {keyBusy ? <LoaderCircle className="spin" /> : <KeyRound />}
                      Save local key
                    </button>
                  </>
                )}
                <p className="key-security-note">
                  Never paste a seed phrase. This version accepts a raw private
                  key, stores it in this browser’s local storage for refreshes,
                  and never sends it to the AlphaSwipe server. Use a dedicated
                  low-balance trading key.
                </p>
              </section>

              <section className="settings-card">
                <div className="settings-title">
                  <div>
                    <h2>Execution network</h2>
                    <p>Orders use Injective’s native exchange module.</p>
                  </div>
                  <ShieldCheck />
                </div>
                <div className="network-setting">
                  <span><i /> Injective Mainnet</span>
                  <small>injective-1</small>
                </div>
                <p className="settings-note danger-copy">
                  Swiping left or right signs and broadcasts immediately with
                  real funds. There is no wallet popup and no second
                  confirmation.
                </p>
              </section>

              <section className="settings-card">
                <div className="settings-title">
                  <div>
                    <h2>Swipe trade setup</h2>
                    <p>Leverage stays fixed. Swipe farther to size up.</p>
                  </div>
                  <Settings />
                </div>
                <label className="setting-range">
                  <span>
                    Max notional <strong>${maxNotional}</strong>
                  </span>
                  <input
                    type="range"
                    min="1"
                    max="500"
                    step="1"
                    value={maxNotional}
                    onChange={(event) =>
                      setMaxNotional(Number(event.target.value))
                    }
                  />
                  <small className="setting-range-hint">
                    $1 at the trigger · full swipe uses this cap
                  </small>
                </label>
                <label className="setting-range">
                  <span>Leverage <strong>{leverage}×</strong></span>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={leverage}
                    onChange={(event) => setLeverage(Number(event.target.value))}
                  />
                </label>
              </section>

              <section className="risk-note">
                <ShieldCheck />
                <p>
                  Direct private-key trading removes the wallet confirmation
                  boundary. Use a dedicated low-balance trading account, not a
                  primary wallet. News and AI responses are research prompts,
                  not financial advice.
                </p>
              </section>
            </div>
          </section>
        )}
      </section>

      <nav className="bottom-nav" aria-label="Primary navigation">
        <button
          className={activeTab === "discover" ? "is-active" : ""}
          type="button"
          onClick={() => setActiveTab("discover")}
        >
          <Compass /><span>Discover</span>
        </button>
        <button
          className={activeTab === "position" ? "is-active" : ""}
          type="button"
          onClick={() => setActiveTab("position")}
        >
          <BarChart3 /><span>Position</span>
        </button>
        <button
          className={activeTab === "settings" ? "is-active" : ""}
          type="button"
          onClick={() => setActiveTab("settings")}
        >
          <Settings /><span>Settings</span>
        </button>
      </nav>

      {chatOpen && current && (
        <div className="sheet-backdrop chat-backdrop" role="presentation">
          <section
            className="ai-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`${current.marketQuery} signal AI discussion`}
          >
            <header className="ai-sheet-heading">
              <span><Bot /></span>
              <div>
                <small>SIGNAL AI · {current.marketQuery}</small>
                <h2>Discuss the thesis</h2>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                aria-label="Close AI discussion"
              >
                <X />
              </button>
            </header>
            <div className="ai-messages">
              {chatMessages.map((message) => (
                <p className={message.role} key={message.id}>
                  {message.text}
                </p>
              ))}
              {chatBusy && (
                <p className="assistant thinking">
                  <LoaderCircle className="spin" /> Reviewing the signal…
                </p>
              )}
            </div>
            <div className="ai-prompts">
              {(current.earnings
                ? [
                    "Interpret the latest earnings",
                    "What is the biggest risk?",
                    "What would invalidate the bull case?",
                  ]
                : [
                    "What is the key catalyst?",
                    "What is the biggest risk?",
                    "What would invalidate the bull case?",
                  ]
              ).map((prompt) => (
                <button
                  type="button"
                  key={prompt}
                  onClick={() => void sendChatMessage(prompt)}
                  disabled={chatBusy}
                >
                  {prompt}
                </button>
              ))}
            </div>
            <form
              className="ai-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendChatMessage();
              }}
            >
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder={`Ask about ${current.marketQuery}…`}
                aria-label="Ask Signal AI"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || chatBusy}
                aria-label="Send message"
              >
                <Send />
              </button>
            </form>
            <small className="ai-disclaimer">
              ChatGPT API research only · this chat cannot place trades
            </small>
          </section>
        </div>
      )}

      <div className={`toast ${toast ? "is-visible" : ""}`} role="status">
        {toast}
      </div>
    </main>
  );
}
