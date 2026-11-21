/**
 * SequenceMemoryDrill.tsx flashes six items in order, then asks for ordered recall.
 * Encoding uses brief serial presentation; recall uses a shuffled pool so the drill
 * trains working-memory order (Miller-style span) rather than free recognition alone.
 */

"use client";

import { useRef, useState } from "react";
import { shuffle } from "@/lib/random";
import { formatDurationMs } from "@/lib/schulte";
import type { DrillResult } from "@/lib/trainings";
import { DrillShell } from "./DrillShell";

type MemoryItem = {
  /** Stable id used for ordered recall matching. */
  id: string;
  /** Chinese label shown on cards. */
  label: string;
  /** Decorative glyph for quick visual encoding. */
  glyph: string;
};

/** Fixed six-item set matching the source demo sequence theme. */
const ITEMS: readonly MemoryItem[] = [
  { id: "umbrella", label: "雨伞", glyph: "☂" },
  { id: "key", label: "钥匙", glyph: "🔑" },
  { id: "orange", label: "橘子", glyph: "🍊" },
  { id: "bike", label: "自行车", glyph: "🚲" },
  { id: "lamp", label: "台灯", glyph: "💡" },
  { id: "watch", label: "手表", glyph: "⌚" },
] as const;

/** Milliseconds each item stays on screen during encoding. */
const SHOW_MS = 1100;
/** Brief blank between items so order boundaries stay perceptible. */
const GAP_MS = 280;

type Phase = "idle" | "encoding" | "recall" | "done";

type SequenceMemoryDrillProps = {
  /** Called once when ordered recall finishes (pass or fail). */
  onComplete: (result: DrillResult) => void;
};

/**
 * SequenceMemoryDrill runs encode → recall and reports whether order was perfect.
 * Timing includes encoding so suite durations reflect the whole memory episode.
 */
export function SequenceMemoryDrill({ onComplete }: SequenceMemoryDrillProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [order, setOrder] = useState<MemoryItem[]>([]);
  const [pool, setPool] = useState<MemoryItem[]>([]);
  const [showIndex, setShowIndex] = useState(-1);
  const [picked, setPicked] = useState<MemoryItem[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [feedback, setFeedback] = useState<"ok" | "bad" | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const encodeTimersRef = useRef<number[]>([]);

  function clearTimers() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    for (const handle of encodeTimersRef.current) {
      window.clearTimeout(handle);
    }
    encodeTimersRef.current = [];
  }

  /**
   * beginSession shuffles a fresh order and schedules serial encoding flash timers.
   * Recall unlocks only after the last item has been shown and cleared.
   */
  function beginSession() {
    clearTimers();
    const nextOrder = shuffle(ITEMS);
    setOrder(nextOrder);
    setPool(shuffle(ITEMS));
    setPicked([]);
    setFeedback(null);
    setShowIndex(-1);
    setElapsedMs(0);
    startedAtRef.current = performance.now();
    setPhase("encoding");
    timerRef.current = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedMs(performance.now() - startedAtRef.current);
      }
    }, 50);

    nextOrder.forEach((_, index) => {
      const showAt = index * (SHOW_MS + GAP_MS);
      const hideAt = showAt + SHOW_MS;
      encodeTimersRef.current.push(
        window.setTimeout(() => setShowIndex(index), showAt),
        window.setTimeout(() => {
          setShowIndex(-1);
          if (index === nextOrder.length - 1) {
            setPhase("recall");
          }
        }, hideAt),
      );
    });
  }

  /**
   * pickItem appends a pool choice into the recall sequence and finishes when full.
   * Mismatched final order still completes the drill so the suite can continue.
   */
  function pickItem(item: MemoryItem) {
    if (phase !== "recall" || picked.some((entry) => entry.id === item.id)) {
      return;
    }
    const nextPicked = [...picked, item];
    setPicked(nextPicked);
    if (nextPicked.length < order.length) {
      return;
    }

    clearTimers();
    const durationMs =
      startedAtRef.current === null
        ? elapsedMs
        : performance.now() - startedAtRef.current;
    setElapsedMs(durationMs);
    const perfect = nextPicked.every((entry, index) => entry.id === order[index]?.id);
    setFeedback(perfect ? "ok" : "bad");
    setPhase("done");
    startedAtRef.current = null;
    onComplete({
      trainingId: "sequence",
      durationMs,
      accuracy: perfect ? 1 : 0,
      detail: perfect
        ? `顺序全对 · ${formatDurationMs(durationMs)}`
        : `顺序有误 · ${formatDurationMs(durationMs)}`,
    });
  }

  const visible = showIndex >= 0 ? order[showIndex] : null;

  return (
    <DrillShell
      title="序列记忆"
      instruction="物品会依次出现。记住顺序，再按同样顺序点回来。"
      progress={
        phase === "encoding"
          ? `记忆中 ${Math.max(showIndex + 1, 0)} / ${ITEMS.length}`
          : phase === "recall"
            ? `复述 ${picked.length} / ${ITEMS.length}`
            : phase === "done"
              ? "完成"
              : `${ITEMS.length} 样物品`
      }
      meta={phase === "idle" ? undefined : formatDurationMs(elapsedMs)}
      actions={
        phase === "idle" ? (
          <button type="button" className="btn btn--primary" onClick={beginSession}>
            开始本轮
          </button>
        ) : phase === "done" ? (
          <p className="drill__done-line">
            {feedback === "ok" ? "顺序全对" : "顺序有误"} · {formatDurationMs(elapsedMs)}
          </p>
        ) : (
          <button type="button" className="btn btn--ghost" onClick={beginSession}>
            重新开始
          </button>
        )
      }
    >
      {phase === "idle" && (
        <p className="drill__placeholder">
          编个小故事把它们串起来——组块化比硬背 7±2 更稳。
        </p>
      )}
      {(phase === "encoding" || phase === "recall" || phase === "done") && (
        <div className="sequence">
          <div
            className={[
              "sequence__stage",
              feedback === "ok" ? "sequence__stage--ok" : "",
              feedback === "bad" ? "sequence__stage--bad" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-live="polite"
          >
            {phase === "encoding" && visible && (
              <>
                <span className="sequence__glyph" aria-hidden="true">
                  {visible.glyph}
                </span>
                <strong>{visible.label}</strong>
              </>
            )}
            {phase === "encoding" && !visible && (
              <span className="sequence__ellipsis">…</span>
            )}
            {phase === "recall" && (
              <div className="sequence__picked">
                {picked.length === 0 ? (
                  <span>按出现顺序点选</span>
                ) : (
                  picked.map((item, index) => (
                    <span key={`${item.id}-${index}`}>
                      {index + 1}. {item.label}
                    </span>
                  ))
                )}
              </div>
            )}
            {phase === "done" && (
              <div className="sequence__picked">
                {order.map((item, index) => (
                  <span key={item.id}>
                    {index + 1}. {item.label}
                    {picked[index]?.id === item.id ? " ✓" : " ✗"}
                  </span>
                ))}
              </div>
            )}
          </div>
          {phase === "recall" && (
            <div className="sequence__pool" role="group" aria-label="按顺序点选物品">
              {pool.map((item) => {
                const used = picked.some((entry) => entry.id === item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="sequence__card"
                    onClick={() => pickItem(item)}
                    disabled={used}
                  >
                    <span aria-hidden="true">{item.glyph}</span>
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </DrillShell>
  );
}
