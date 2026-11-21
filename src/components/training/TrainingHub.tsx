/**
 * TrainingHub.tsx owns drill selection, sequential suite playback, and the end summary.
 * Users can tick any subset or start the full catalog; the hub mounts one drill at a time
 * and only advances after that drill reports DrillResult, keeping session order predictable.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDurationMs } from "@/lib/schulte";
import {
  TRAINING_CATALOG,
  allTrainingIds,
  getTrainingMeta,
  type DrillResult,
  type TrainingId,
} from "@/lib/trainings";
import {
  pullAndMergeSessions,
  pullAndMergeSuiteRuns,
  recordDrillCompletion,
  recordSuiteRun,
} from "@/lib/training-history";
import { GestaltDrill } from "./GestaltDrill";
import { NumberSizeDrill } from "./NumberSizeDrill";
import { ReverseCueDrill } from "./ReverseCueDrill";
import { SchulteDrill } from "./SchulteDrill";
import { SequenceMemoryDrill } from "./SequenceMemoryDrill";
import { StroopDrill } from "./StroopDrill";

type HubPhase = "select" | "running" | "summary";

/**
 * TrainingHub renders the picker, the active drill, or the suite summary depending on phase.
 * Selection state survives a finished summary so “再练一次” can reuse the same checklist.
 */
export function TrainingHub() {
  const [phase, setPhase] = useState<HubPhase>("select");
  const [selected, setSelected] = useState<TrainingId[]>(() => allTrainingIds());
  const [queue, setQueue] = useState<TrainingId[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [results, setResults] = useState<DrillResult[]>([]);
  const [pendingAdvance, setPendingAdvance] = useState(false);

  useEffect(() => {
    // Pull cloud drill + suite history when a signed-in user opens the hub.
    void pullAndMergeSessions();
    void pullAndMergeSuiteRuns();
  }, []);

  const currentId = queue[queueIndex];
  const currentMeta = currentId ? getTrainingMeta(currentId) : null;

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = selected.length === TRAINING_CATALOG.length;

  /**
   * toggleTraining adds or removes a catalog id from the picker selection.
   * The last remaining item cannot be cleared so Start never launches an empty queue.
   */
  function toggleTraining(id: TrainingId) {
    setSelected((current) => {
      if (current.includes(id)) {
        if (current.length === 1) {
          return current;
        }
        return current.filter((item) => item !== id);
      }
      return TRAINING_CATALOG.map((item) => item.id).filter(
        (item) => item === id || current.includes(item),
      );
    });
  }

  /**
   * selectAll marks every catalog drill; clearToOne keeps only Schulte as a safe default.
   */
  function selectAll() {
    setSelected(allTrainingIds());
  }

  function selectOnly(id: TrainingId) {
    setSelected([id]);
  }

  /**
   * startQueue freezes the selected order into a run queue and mounts the first drill.
   * Results reset so a new suite never mixes metrics with a previous summary.
   */
  function startQueue(ids: TrainingId[]) {
    if (ids.length === 0) {
      return;
    }
    setQueue(ids);
    setQueueIndex(0);
    setResults([]);
    setPendingAdvance(false);
    setPhase("running");
  }

  /**
   * handleDrillComplete stores the result and unlocks the advance control.
   * Non-Schulte drills persist here; Schulte already records inside Trainer to avoid duplicates.
   */
  function handleDrillComplete(result: DrillResult) {
    if (result.trainingId !== "schulte") {
      recordDrillCompletion(result);
    }
    setResults((current) => [...current, result]);
    setPendingAdvance(true);
  }

  /**
   * advanceQueue moves to the next drill or opens the summary when the queue is exhausted.
   * Multi-drill suites are persisted for cognitive prior / fatigue gating (not sens).
   */
  function advanceQueue() {
    if (queueIndex + 1 >= queue.length) {
      setPendingAdvance(false);
      setPhase("summary");
      // Persist multi-drill suites for cognitive prior / fatigue gating only.
      setResults((current) => {
        if (current.length >= 2) {
          recordSuiteRun(current);
        }
        return current;
      });
      return;
    }
    setPendingAdvance(false);
    setQueueIndex((current) => current + 1);
  }

  function backToSelect() {
    setPhase("select");
    setPendingAdvance(false);
  }

  const totalDurationMs = results.reduce((sum, item) => sum + item.durationMs, 0);

  return (
    <div className="hub">
      {phase === "select" && (
        <section className="hub-select" aria-label="选择训练">
          <div className="hub-select__toolbar">
            <p className="hub-select__hint">
              勾选要练的项目，或一次练完全部六项。
            </p>
            <div className="hub-select__toolbar-actions">
              <button type="button" className="btn btn--text" onClick={selectAll}>
                {allSelected ? "已全选" : "全选"}
              </button>
              <button
                type="button"
                className="btn btn--text"
                onClick={() => selectOnly("schulte")}
              >
                仅舒尔特
              </button>
            </div>
          </div>

          <ul className="hub-select__list">
            {TRAINING_CATALOG.map((item, index) => {
              const checked = selectedSet.has(item.id);
              return (
                <li key={item.id}>
                  <label
                    className={
                      checked
                        ? "hub-card hub-card--selected"
                        : "hub-card"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTraining(item.id)}
                      className="hub-card__check"
                    />
                    <span className="hub-card__index" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="hub-card__body">
                      <span className="hub-card__title">{item.title}</span>
                      <span className="hub-card__focus">{item.focus}</span>
                      <span className="hub-card__how">{item.how}</span>
                      <span className="hub-card__hint">{item.durationHint}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="hub-select__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => startQueue(allTrainingIds())}
            >
              一次练完全部
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => startQueue(selected)}
              disabled={selected.length === 0}
            >
              开始所选（{selected.length}）
            </button>
          </div>
        </section>
      )}

      {phase === "running" && currentId && currentMeta && (
        <section className="hub-run" aria-label="训练进行中">
          <div className="hub-run__chrome">
            <button type="button" className="btn btn--text" onClick={backToSelect}>
              退出
            </button>
            <p className="hub-run__progress">
              {queueIndex + 1} / {queue.length}
              <span className="hub-run__progress-name"> · {currentMeta.title}</span>
            </p>
            <span className="hub-run__spacer" aria-hidden="true" />
          </div>

          <div className="hub-run__drill" key={`${currentId}-${queueIndex}`}>
            <ActiveDrill
              id={currentId}
              compact={queue.length > 1}
              onComplete={handleDrillComplete}
            />
          </div>

          {pendingAdvance && (
            <div className="hub-run__advance">
              <p>本项完成</p>
              <button type="button" className="btn btn--primary" onClick={advanceQueue}>
                {queueIndex + 1 >= queue.length ? "查看总结" : "下一项"}
              </button>
            </div>
          )}
        </section>
      )}

      {phase === "summary" && (
        <section className="hub-summary" aria-label="训练总结">
          <h2 className="hub-summary__title">本轮完成</h2>
          <p className="hub-summary__lede">
            共 {results.length} 项 · 合计 {formatDurationMs(totalDurationMs)}
          </p>
          <ol className="hub-summary__list">
            {results.map((result) => {
              const meta = getTrainingMeta(result.trainingId);
              return (
                <li key={`${result.trainingId}-${result.durationMs}`}>
                  <div>
                    <strong>{meta.title}</strong>
                    <span>{result.detail ?? formatDurationMs(result.durationMs)}</span>
                  </div>
                  {typeof result.accuracy === "number" && (
                    <em>{Math.round(result.accuracy * 100)}%</em>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="hub-summary__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => startQueue(queue.length > 0 ? queue : selected)}
            >
              按同样组合再练
            </button>
            <button type="button" className="btn btn--ghost" onClick={backToSelect}>
              重新选择
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

type ActiveDrillProps = {
  id: TrainingId;
  compact: boolean;
  onComplete: (result: DrillResult) => void;
};

/**
 * ActiveDrill switches on catalog id to mount the matching interactive drill component.
 * The key on the parent remounts this tree whenever the suite advances to a new slot.
 */
function ActiveDrill({ id, compact, onComplete }: ActiveDrillProps) {
  switch (id) {
    case "schulte":
      return <SchulteDrill compact={compact} onComplete={onComplete} />;
    case "stroop":
      return <StroopDrill onComplete={onComplete} />;
    case "number-size":
      return <NumberSizeDrill onComplete={onComplete} />;
    case "sequence":
      return <SequenceMemoryDrill onComplete={onComplete} />;
    case "reverse-cue":
      return <ReverseCueDrill onComplete={onComplete} />;
    case "gestalt":
      return <GestaltDrill onComplete={onComplete} />;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
