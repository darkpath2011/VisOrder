/**
 * GestaltDrill.tsx flashes left/right radicals and asks for the completed character.
 * The task mirrors gestalt “whole over parts” recognition: brief exposure of halves,
 * then a four-choice identification so the suite trains rapid lexical completion.
 */

"use client";

import { useRef, useState } from "react";
import { shuffle } from "@/lib/random";
import { formatDurationMs } from "@/lib/schulte";
import type { DrillResult } from "@/lib/trainings";
import { DrillShell } from "./DrillShell";

type GestaltItem = {
  /** Left radical or component shown on the left half. */
  left: string;
  /** Right radical or component shown on the right half. */
  right: string;
  /** Correct completed character. */
  answer: string;
  /** Distractor characters for the four-choice panel. */
  distractors: readonly string[];
};

/** Seed pairs inspired by the source demo plus a few similar 左右结构 items. */
const BANK: readonly GestaltItem[] = [
  { left: "口", right: "乞", answer: "吃", distractors: ["企", "迄", "恰"] },
  { left: "女", right: "子", answer: "好", distractors: ["安", "字", "如"] },
  { left: "扌", right: "巴", answer: "把", distractors: ["爬", "色", "疤"] },
  { left: "纟", right: "工", answer: "红", distractors: ["江", "扛", "虹"] },
  { left: "木", right: "寸", answer: "村", distractors: ["材", "树", "对"] },
  { left: "日", right: "月", answer: "明", distractors: ["朋", "冒", "晴"] },
  { left: "氵", right: "青", answer: "清", distractors: ["请", "情", "晴"] },
  { left: "火", right: "丁", answer: "灯", distractors: ["打", "盯", "订"] },
  { left: "钅", right: "兑", answer: "锐", distractors: ["说", "税", "悦"] },
  { left: "忄", right: "青", answer: "情", distractors: ["清", "请", "晴"] },
] as const;

/** How many gestalt items complete one drill session. */
const TRIAL_COUNT = 8;

type Phase = "idle" | "running" | "done";

type GestaltDrillProps = {
  /** Called once when all items are answered. */
  onComplete: (result: DrillResult) => void;
};

/**
 * GestaltDrill runs shuffled radical-completion trials and reports accuracy.
 * Choice order reshuffles every trial so position memory cannot replace recognition.
 */
export function GestaltDrill({ onComplete }: GestaltDrillProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [queue, setQueue] = useState<GestaltItem[]>([]);
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [choices, setChoices] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<"ok" | "bad" | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  /**
   * loadChoices builds a four-option panel from the answer plus three distractors.
   */
  function loadChoices(item: GestaltItem) {
    setChoices(shuffle([item.answer, ...item.distractors]));
  }

  /**
   * beginSession samples TRIAL_COUNT items from the bank and starts the stopwatch.
   */
  function beginSession() {
    clearTimer();
    const nextQueue = shuffle(BANK).slice(0, TRIAL_COUNT);
    setQueue(nextQueue);
    setIndex(0);
    setCorrect(0);
    setElapsedMs(0);
    setFeedback(null);
    if (nextQueue[0]) {
      loadChoices(nextQueue[0]);
    }
    startedAtRef.current = performance.now();
    setPhase("running");
    timerRef.current = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedMs(performance.now() - startedAtRef.current);
      }
    }, 50);
  }

  /**
   * answerChoice scores the selected character and advances or finishes the session.
   */
  function answerChoice(choice: string) {
    if (phase !== "running" || feedback !== null) {
      return;
    }
    const item = queue[index];
    if (!item) {
      return;
    }
    const isCorrect = choice === item.answer;
    const nextCorrect = correct + (isCorrect ? 1 : 0);
    setFeedback(isCorrect ? "ok" : "bad");
    window.setTimeout(() => {
      setFeedback(null);
      if (index + 1 >= queue.length) {
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
          trainingId: "gestalt",
          durationMs,
          accuracy: nextCorrect / TRIAL_COUNT,
          detail: `${nextCorrect}/${TRIAL_COUNT} 正确 · ${formatDurationMs(durationMs)}`,
        });
        return;
      }
      const nextIndex = index + 1;
      setCorrect(nextCorrect);
      setIndex(nextIndex);
      const nextItem = queue[nextIndex];
      if (nextItem) {
        loadChoices(nextItem);
      }
    }, 260);
  }

  const item = queue[index];

  return (
    <DrillShell
      title="视觉完形"
      instruction="左右偏旁合在一起是什么字？一眼认整体。"
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
        <p className="drill__placeholder">口 + 乞 → 吃。别一个个零件慢慢拼。</p>
      )}
      {phase === "running" && item && (
        <div className="gestalt">
          <div
            className={[
              "gestalt__halves",
              feedback === "ok" ? "gestalt__halves--ok" : "",
              feedback === "bad" ? "gestalt__halves--bad" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={`左边 ${item.left}，右边 ${item.right}`}
          >
            <span className="gestalt__half">{item.left}</span>
            <span className="gestalt__plus" aria-hidden="true">
              +
            </span>
            <span className="gestalt__half">{item.right}</span>
          </div>
          <div className="gestalt__choices" role="group" aria-label="选择完整汉字">
            {choices.map((choice) => (
              <button
                key={choice}
                type="button"
                className="gestalt__choice"
                onClick={() => answerChoice(choice)}
                disabled={feedback !== null}
              >
                {choice}
              </button>
            ))}
          </div>
        </div>
      )}
      {phase === "done" && (
        <p className="drill__placeholder">完形：大脑爱一次认出整个字。</p>
      )}
    </DrillShell>
  );
}
