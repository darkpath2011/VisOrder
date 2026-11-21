/**
 * StroopDrill.tsx runs a 20-trial Chinese Stroop task: answer ink color, ignore the glyph.
 * Trials force color≠meaning so inhibition control is required; finishing reports accuracy
 * and duration so the suite summary can show whether the user beat the word cue.
 */

"use client";

import { useMemo, useRef, useState } from "react";
import { pickRandom, shuffle } from "@/lib/random";
import { formatDurationMs } from "@/lib/schulte";
import type { DrillResult } from "@/lib/trainings";
import { DrillShell } from "./DrillShell";

/** Number of Stroop trials per completed drill session. */
const TRIAL_COUNT = 20;

type ColorKey = "红" | "绿" | "蓝" | "黄";

type ColorOption = {
  key: ColorKey;
  /** CSS color used for the ink and the answer chip. */
  hex: string;
};

/** Palette used for both glyph meanings and ink colors in every trial. */
const COLORS: readonly ColorOption[] = [
  { key: "红", hex: "#c62828" },
  { key: "绿", hex: "#2e7d32" },
  { key: "蓝", hex: "#1565c0" },
  { key: "黄", hex: "#f9a825" },
] as const;

type Trial = {
  /** Character meaning the participant must ignore. */
  word: ColorKey;
  /** True ink color the participant must report. */
  ink: ColorKey;
};

type Phase = "idle" | "running" | "done";

type StroopDrillProps = {
  /** Called once when all trials finish so the hub can advance the suite. */
  onComplete: (result: DrillResult) => void;
};

/**
 * buildTrials creates TRIAL_COUNT incongruent Stroop items with word ≠ ink.
 * Congruent items are excluded so every answer requires suppressing the written meaning.
 */
function buildTrials(): Trial[] {
  return Array.from({ length: TRIAL_COUNT }, () => {
    const word = pickRandom(COLORS).key;
    const inkOptions = COLORS.filter((color) => color.key !== word);
    const ink = pickRandom(inkOptions).key;
    return { word, ink };
  });
}

/**
 * StroopDrill mounts idle → running → done Stroop flow and reports a DrillResult.
 * Wrong taps count against accuracy but still advance so session length stays fixed.
 */
export function StroopDrill({ onComplete }: StroopDrillProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [trials, setTrials] = useState<Trial[]>([]);
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [feedback, setFeedback] = useState<"ok" | "bad" | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const answerOrder = useMemo(() => shuffle(COLORS), [index, phase]);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  /**
   * beginSession rebuilds trials and starts the stopwatch for a fresh 20-item run.
   * Previous correctness counters reset so restarts never inherit prior accuracy.
   */
  function beginSession() {
    clearTimer();
    setTrials(buildTrials());
    setIndex(0);
    setCorrect(0);
    setElapsedMs(0);
    setFeedback(null);
    startedAtRef.current = performance.now();
    setPhase("running");
    timerRef.current = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedMs(performance.now() - startedAtRef.current);
      }
    }, 50);
  }

  /**
   * answerTrial scores the chosen ink color and advances or finishes the session.
   * Finishing clears the interval before calling onComplete with suite-ready metrics.
   */
  function answerTrial(choice: ColorKey) {
    if (phase !== "running" || feedback !== null) {
      return;
    }
    const trial = trials[index];
    if (!trial) {
      return;
    }
    const isCorrect = choice === trial.ink;
    const nextCorrect = correct + (isCorrect ? 1 : 0);
    setFeedback(isCorrect ? "ok" : "bad");
    window.setTimeout(() => {
      setFeedback(null);
      if (index + 1 >= TRIAL_COUNT) {
        clearTimer();
        const durationMs =
          startedAtRef.current === null
            ? elapsedMs
            : performance.now() - startedAtRef.current;
        setElapsedMs(durationMs);
        setCorrect(nextCorrect);
        setPhase("done");
        startedAtRef.current = null;
        onComplete({
          trainingId: "stroop",
          durationMs,
          accuracy: nextCorrect / TRIAL_COUNT,
          detail: `${nextCorrect}/${TRIAL_COUNT} 正确 · ${formatDurationMs(durationMs)}`,
        });
        return;
      }
      setCorrect(nextCorrect);
      setIndex((current) => current + 1);
    }, 220);
  }

  const trial = trials[index];
  const inkHex = COLORS.find((color) => color.key === trial?.ink)?.hex ?? "#10233a";

  return (
    <DrillShell
      title="字色干扰"
      instruction="只答字体颜色，别念字。红色的「绿」要选「红」。"
      progress={
        phase === "idle"
          ? `共 ${TRIAL_COUNT} 题`
          : phase === "done"
            ? "完成"
            : `${index + 1} / ${TRIAL_COUNT}`
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
            {correct}/{TRIAL_COUNT} 正确 · {formatDurationMs(elapsedMs)}
          </p>
        )
      }
    >
      {phase === "idle" && (
        <p className="drill__placeholder">准备好后开始。建议连续练，别犹豫太久。</p>
      )}
      {phase === "running" && trial && (
        <div className="stroop">
          <div
            className={[
              "stroop__glyph",
              feedback === "ok" ? "stroop__glyph--ok" : "",
              feedback === "bad" ? "stroop__glyph--bad" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ color: inkHex }}
            aria-live="polite"
          >
            {trial.word}
          </div>
          <div className="stroop__choices" role="group" aria-label="选择字体颜色">
            {answerOrder.map((color) => (
              <button
                key={color.key}
                type="button"
                className="stroop__choice"
                style={{ ["--chip" as string]: color.hex }}
                onClick={() => answerTrial(color.key)}
                disabled={feedback !== null}
              >
                {color.key}
              </button>
            ))}
          </div>
        </div>
      )}
      {phase === "done" && (
        <p className="drill__placeholder">抑制控制练完。停练太久，优势会慢慢消退。</p>
      )}
    </DrillShell>
  );
}
