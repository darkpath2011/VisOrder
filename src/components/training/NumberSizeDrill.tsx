/**
 * NumberSizeDrill.tsx presents differently sized digits that must be ordered by value.
 * Font size fights numerical magnitude so the drill trains rule-following under visual
 * salience conflict; eight short rounds keep the suite moving without fatigue.
 */

"use client";

import { useRef, useState } from "react";
import { shuffle } from "@/lib/random";
import { formatDurationMs } from "@/lib/schulte";
import type { DrillResult } from "@/lib/trainings";
import { DrillShell } from "./DrillShell";

/** How many ascending-sort rounds complete one NumberSize session. */
const ROUND_COUNT = 8;
/** Digits shown per round; three keeps the choice set readable on mobile. */
const DIGITS_PER_ROUND = 3;

type DigitCard = {
  /** Numeric value used for ascending order checks. */
  value: number;
  /** Display font size in rem — intentionally uncorrelated with value. */
  sizeRem: number;
};

type Phase = "idle" | "running" | "done";

type NumberSizeDrillProps = {
  /** Called once when all rounds finish so the hub can advance. */
  onComplete: (result: DrillResult) => void;
};

/** Font sizes assigned randomly so big glyphs are not always big numbers. */
const SIZE_POOL = [1.1, 1.55, 2.15, 2.7] as const;

/**
 * buildRound creates DIGITS_PER_ROUND unique values with shuffled font sizes.
 * Unique values avoid ambiguous ties when the user taps ascending order.
 */
function buildRound(): DigitCard[] {
  const values = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, DIGITS_PER_ROUND);
  const sizes = shuffle([...SIZE_POOL]).slice(0, DIGITS_PER_ROUND);
  return values.map((value, index) => ({
    value,
    sizeRem: sizes[index] ?? 1.5,
  }));
}

/**
 * NumberSizeDrill runs ascending-click rounds and reports accuracy plus duration.
 * Wrong taps flash without advancing so the user must correct the order mid-round.
 */
export function NumberSizeDrill({ onComplete }: NumberSizeDrillProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [cards, setCards] = useState<DigitCard[]>([]);
  const [round, setRound] = useState(0);
  const [nextExpected, setNextExpected] = useState(0);
  const [correctRounds, setCorrectRounds] = useState(0);
  const [roundMistakes, setRoundMistakes] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [shakeValue, setShakeValue] = useState<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const sortedValuesRef = useRef<number[]>([]);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  /**
   * loadRound replaces the board with a fresh incongruent size layout.
   * Sorted targets are cached so click handlers stay O(1) for the next expected value.
   */
  function loadRound(roundIndex: number) {
    const next = buildRound();
    setCards(next);
    sortedValuesRef.current = [...next.map((card) => card.value)].sort((a, b) => a - b);
    setNextExpected(0);
    setRoundMistakes(0);
    setRound(roundIndex);
  }

  /**
   * beginSession resets counters and starts timing for a full ROUND_COUNT run.
   */
  function beginSession() {
    clearTimer();
    setCorrectRounds(0);
    setElapsedMs(0);
    setShakeValue(null);
    loadRound(0);
    startedAtRef.current = performance.now();
    setPhase("running");
    timerRef.current = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedMs(performance.now() - startedAtRef.current);
      }
    }, 50);
  }

  /**
   * handleDigitClick accepts the next ascending value or shakes on a wrong tap.
   * Completing a clean round increments correctRounds; finishing calls onComplete.
   */
  function handleDigitClick(value: number) {
    if (phase !== "running") {
      return;
    }
    const expected = sortedValuesRef.current[nextExpected];
    if (value !== expected) {
      setRoundMistakes((count) => count + 1);
      setShakeValue(value);
      window.setTimeout(() => setShakeValue(null), 280);
      return;
    }

    if (nextExpected + 1 >= DIGITS_PER_ROUND) {
      const clean = roundMistakes === 0;
      const nextCorrect = correctRounds + (clean ? 1 : 0);
      if (round + 1 >= ROUND_COUNT) {
        clearTimer();
        const durationMs =
          startedAtRef.current === null
            ? elapsedMs
            : performance.now() - startedAtRef.current;
        setElapsedMs(durationMs);
        setCorrectRounds(nextCorrect);
        setPhase("done");
        startedAtRef.current = null;
        onComplete({
          trainingId: "number-size",
          durationMs,
          accuracy: nextCorrect / ROUND_COUNT,
          detail: `${nextCorrect}/${ROUND_COUNT} 轮零失误 · ${formatDurationMs(durationMs)}`,
        });
        return;
      }
      setCorrectRounds(nextCorrect);
      loadRound(round + 1);
      return;
    }

    setNextExpected((current) => current + 1);
  }

  const foundSet = new Set(sortedValuesRef.current.slice(0, nextExpected));

  return (
    <DrillShell
      title="数值干扰"
      instruction="别管字号，按数值从小到大依次点选。"
      progress={
        phase === "idle"
          ? `${ROUND_COUNT} 轮`
          : phase === "done"
            ? "完成"
            : `第 ${round + 1} / ${ROUND_COUNT} 轮`
      }
      meta={phase === "idle" ? undefined : formatDurationMs(elapsedMs)}
      actions={
        phase === "idle" ? (
          <button type="button" className="btn btn--primary" onClick={beginSession}>
            开始本轮
          </button>
        ) : phase === "running" ? (
          <button type="button" className="btn btn--ghost" onClick={beginSession}>
            重新开始
          </button>
        ) : (
          <p className="drill__done-line">
            {correctRounds}/{ROUND_COUNT} 轮零失误 · {formatDurationMs(elapsedMs)}
          </p>
        )
      }
    >
      {phase === "idle" && (
        <p className="drill__placeholder">字号会骗你。听数值规则，别听眼睛的第一反应。</p>
      )}
      {phase === "running" && (
        <div className="number-size" role="group" aria-label="按数值从小到大点选">
          {cards.map((card) => {
            const found = foundSet.has(card.value);
            return (
              <button
                key={`${round}-${card.value}`}
                type="button"
                className={[
                  "number-size__digit",
                  found ? "number-size__digit--found" : "",
                  shakeValue === card.value ? "number-size__digit--shake" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ fontSize: `${card.sizeRem}rem` }}
                onClick={() => handleDigitClick(card.value)}
                disabled={found}
                aria-label={`数字 ${card.value}`}
              >
                {card.value}
              </button>
            );
          })}
        </div>
      )}
      {phase === "done" && (
        <p className="drill__placeholder">眼睛和规则打架时，你选了规则。</p>
      )}
    </DrillShell>
  );
}
