/**
 * ReverseCueDrill.tsx shows a written action cue that often mismatches the real motion.
 * The participant must report what the shape actually did (grow / shrink / still / spin),
 * training visual evidence over linguistic suggestion across a fixed trial count.
 */

"use client";

import { useMemo, useRef, useState } from "react";
import { pickRandom, shuffle } from "@/lib/random";
import { formatDurationMs } from "@/lib/schulte";
import type { DrillResult } from "@/lib/trainings";
import { DrillShell } from "./DrillShell";

/** Trials per Reverse Cue session. */
const TRIAL_COUNT = 12;

type ActionKey = "grow" | "shrink" | "still" | "spin";

type ActionOption = {
  key: ActionKey;
  /** Chinese label used both as misleading text and as answer chips. */
  label: string;
};

const ACTIONS: readonly ActionOption[] = [
  { key: "grow", label: "变大" },
  { key: "shrink", label: "变小" },
  { key: "still", label: "不动" },
  { key: "spin", label: "转圈" },
] as const;

type Trial = {
  /** Written cue shown above the shape — often wrong on purpose. */
  cue: ActionKey;
  /** True motion the participant must report. */
  actual: ActionKey;
};

type Phase = "idle" | "running" | "done";

type ReverseCueDrillProps = {
  /** Called once when all trials finish. */
  onComplete: (result: DrillResult) => void;
};

/**
 * buildTrials creates incongruent-heavy cue/motion pairs for TRIAL_COUNT items.
 * About one quarter stay congruent so “always opposite” cannot become a cheat heuristic.
 */
function buildTrials(): Trial[] {
  return Array.from({ length: TRIAL_COUNT }, () => {
    const actual = pickRandom(ACTIONS).key;
    const congruent = Math.random() < 0.25;
    const cue = congruent
      ? actual
      : pickRandom(ACTIONS.filter((action) => action.key !== actual)).key;
    return { cue, actual };
  });
}

/**
 * ReverseCueDrill plays each motion briefly, then unlocks answer chips for what was seen.
 * Accuracy counts only the true motion key; the written cue is never the scoring source.
 */
export function ReverseCueDrill({ onComplete }: ReverseCueDrillProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [trials, setTrials] = useState<Trial[]>([]);
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [awaitingAnswer, setAwaitingAnswer] = useState(false);
  const [feedback, setFeedback] = useState<"ok" | "bad" | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const playTimerRef = useRef<number | null>(null);

  function clearTimers() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (playTimerRef.current !== null) {
      window.clearTimeout(playTimerRef.current);
      playTimerRef.current = null;
    }
  }

  /**
   * playTrial runs the actual motion CSS class for ~1.1s then unlocks answering.
   * Answers stay locked during animation so users cannot skip watching the eyes win.
   */
  function playTrial(trialIndex: number, trialList: Trial[]) {
    const trial = trialList[trialIndex];
    if (!trial) {
      return;
    }
    setIndex(trialIndex);
    setFeedback(null);
    setAwaitingAnswer(false);
    setAnimating(true);
    if (playTimerRef.current !== null) {
      window.clearTimeout(playTimerRef.current);
    }
    // Motion clip length matches the CSS keyframe durations below.
    playTimerRef.current = window.setTimeout(() => {
      setAnimating(false);
      setAwaitingAnswer(true);
    }, 1100);
  }

  /**
   * beginSession rebuilds trials and starts the first motion clip under a stopwatch.
   */
  function beginSession() {
    clearTimers();
    const nextTrials = buildTrials();
    setTrials(nextTrials);
    setCorrect(0);
    setElapsedMs(0);
    startedAtRef.current = performance.now();
    setPhase("running");
    timerRef.current = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedMs(performance.now() - startedAtRef.current);
      }
    }, 50);
    playTrial(0, nextTrials);
  }

  /**
   * answerAction scores the reported motion and either advances or finishes the session.
   */
  function answerAction(choice: ActionKey) {
    if (phase !== "running" || !awaitingAnswer || feedback !== null) {
      return;
    }
    const trial = trials[index];
    if (!trial) {
      return;
    }
    const isCorrect = choice === trial.actual;
    const nextCorrect = correct + (isCorrect ? 1 : 0);
    setFeedback(isCorrect ? "ok" : "bad");
    setAwaitingAnswer(false);
    window.setTimeout(() => {
      if (index + 1 >= TRIAL_COUNT) {
        clearTimers();
        const durationMs =
          startedAtRef.current === null
            ? elapsedMs
            : performance.now() - startedAtRef.current;
        setElapsedMs(durationMs);
        setCorrect(nextCorrect);
        setPhase("done");
        startedAtRef.current = null;
        onComplete({
          trainingId: "reverse-cue",
          durationMs,
          accuracy: nextCorrect / TRIAL_COUNT,
          detail: `${nextCorrect}/${TRIAL_COUNT} 正确 · ${formatDurationMs(durationMs)}`,
        });
        return;
      }
      setCorrect(nextCorrect);
      playTrial(index + 1, trials);
    }, 280);
  }

  const trial = trials[index];
  const cueLabel = ACTIONS.find((action) => action.key === trial?.cue)?.label ?? "";
  // Reshuffle only when the trial index changes so re-renders do not scramble chips mid-answer.
  const choices = useMemo(() => shuffle(ACTIONS), [index, phase]);

  return (
    <DrillShell
      title="反向线索"
      instruction="看实际动作答题。字可能在撒谎——让眼睛赢过文字。"
      progress={
        phase === "idle"
          ? `${TRIAL_COUNT} 题`
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
        <p className="drill__placeholder">字写「变大」却在转圈 → 答「转圈」。</p>
      )}
      {phase === "running" && trial && (
        <div className="reverse-cue">
          <p className="reverse-cue__cue" aria-label={`文字线索：${cueLabel}`}>
            {cueLabel}
          </p>
          <div
            className={[
              "reverse-cue__shape",
              animating ? `reverse-cue__shape--${trial.actual}` : "",
              feedback === "ok" ? "reverse-cue__shape--ok" : "",
              feedback === "bad" ? "reverse-cue__shape--bad" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-hidden="true"
          />
          <div className="reverse-cue__choices" role="group" aria-label="选择实际动作">
            {choices.map((action) => (
              <button
                key={action.key}
                type="button"
                className="reverse-cue__choice"
                onClick={() => answerAction(action.key)}
                disabled={!awaitingAnswer || feedback !== null}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {phase === "done" && (
        <p className="drill__placeholder">文字只是线索。眼睛看到的才是答案。</p>
      )}
    </DrillShell>
  );
}
