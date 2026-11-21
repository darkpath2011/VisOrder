"use client";

/**
 * Trainer.tsx is the interactive 5×5 Schulte session: shuffle, ordered clicks, timer, history.
 * State advances only on the next expected digit so wrong taps give feedback without moving the goal;
 * completed times are stored local-first (and synced when signed in) so progress survives reloads.
 */

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_GRID_SIZE,
  buildBoard,
  formatDurationMs,
  summarizeRecords,
  type TrainingRecord,
} from "@/lib/schulte";
import {
  clearAllHistory,
  readSchulteHistory,
  recordDrillCompletion,
  toSchulteRecords,
} from "@/lib/training-history";

type SessionPhase = "idle" | "running" | "done";

type TrainerProps = {
  /** Optional suite callback fired once when 1→25 completes successfully. */
  onComplete?: (durationMs: number) => void;
  /** When true, omit the history sidebar for embedded suite layouts. */
  hideHistory?: boolean;
};

/**
 * Trainer mounts the live board, countdown-free stopwatch, and recent-session list.
 * History is read after mount to avoid SSR/localStorage mismatch hydration errors.
 */
/** Deterministic placeholder so SSR/prerender never calls Math.random during state init. */
const INITIAL_BOARD = Array.from(
  { length: DEFAULT_GRID_SIZE * DEFAULT_GRID_SIZE },
  (_, index) => index + 1,
);

export function Trainer({ onComplete, hideHistory = false }: TrainerProps) {
  const [board, setBoard] = useState<number[]>(INITIAL_BOARD);
  const [nextTarget, setNextTarget] = useState(1);
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  const [shakeIndex, setShakeIndex] = useState<number | null>(null);
  const [history, setHistory] = useState<TrainingRecord[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // Shuffle only after mount so prerender stays deterministic; first Start still reshuffles.
    setBoard(buildBoard());
    setHistory(readSchulteHistory());
  }, []);

  useEffect(() => {
    if (phase !== "running") {
      return;
    }
    // Centisecond display only needs ~20Hz; rAF + setState at 60fps was re-rendering the whole board.
    timerRef.current = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedMs(performance.now() - startedAtRef.current);
      }
    }, 50);
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
    };
  }, [phase]);

  const summary = summarizeRecords(history);
  const totalCells = DEFAULT_GRID_SIZE * DEFAULT_GRID_SIZE;

  /**
   * beginSession reshuffles the board and starts the stopwatch on the next interaction cycle.
   * Previous elapsed time is cleared so a restart never bleeds into the new attempt.
   */
  function beginSession() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setBoard(buildBoard());
    setNextTarget(1);
    setElapsedMs(0);
    setFlashIndex(null);
    setShakeIndex(null);
    startedAtRef.current = performance.now();
    setPhase("running");
  }

  /**
   * handleCellClick advances when the tapped value equals nextTarget; otherwise shakes the cell.
   * The first correct tap does not restart timing because beginSession already opened the clock.
   */
  function handleCellClick(value: number, index: number) {
    if (phase !== "running") {
      return;
    }
    if (value !== nextTarget) {
      setShakeIndex(index);
      window.setTimeout(() => setShakeIndex(null), 280);
      return;
    }

    setFlashIndex(index);
    window.setTimeout(() => setFlashIndex(null), 220);

    if (nextTarget === totalCells) {
      const durationMs =
        startedAtRef.current === null
          ? elapsedMs
          : performance.now() - startedAtRef.current;
      setElapsedMs(durationMs);
      setPhase("done");
      startedAtRef.current = null;
      const sessions = recordDrillCompletion(
        {
          trainingId: "schulte",
          durationMs,
          detail: formatDurationMs(durationMs),
        },
        { size: DEFAULT_GRID_SIZE },
      );
      setHistory(toSchulteRecords(sessions));
      setNextTarget(totalCells + 1);
      onComplete?.(durationMs);
      return;
    }

    setNextTarget((current) => current + 1);
  }

  /**
   * resetProgress clears local and cloud history after an explicit user reset action.
   */
  function resetProgress() {
    void clearAllHistory().then(() => setHistory([]));
  }

  return (
    <div className={hideHistory ? "trainer trainer--solo" : "trainer"}>
      <div className="trainer__stage">
        <div className="trainer__meta">
          <div className="trainer__stat">
            <span className="trainer__label">目标</span>
            <strong className="trainer__value">
              {phase === "done" ? "完成" : nextTarget <= totalCells ? nextTarget : "—"}
            </strong>
          </div>
          <div className="trainer__stat">
            <span className="trainer__label">用时</span>
            <strong className="trainer__value trainer__value--mono">
              {formatDurationMs(elapsedMs)}
            </strong>
          </div>
          <div className="trainer__stat">
            <span className="trainer__label">进度</span>
            <strong className="trainer__value">
              {Math.min(nextTarget - 1, totalCells)}/{totalCells}
            </strong>
          </div>
        </div>

        <div
          className="trainer__grid"
          style={{ gridTemplateColumns: `repeat(${DEFAULT_GRID_SIZE}, 1fr)` }}
          role="grid"
          aria-label="舒尔特方格 5×5"
        >
          {board.map((value, index) => {
            const found = phase !== "idle" && value < nextTarget;
            const className = [
              "trainer__cell",
              found ? "trainer__cell--found" : "",
              flashIndex === index ? "trainer__cell--flash" : "",
              shakeIndex === index ? "trainer__cell--shake" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={`${value}-${index}`}
                type="button"
                className={className}
                onClick={() => handleCellClick(value, index)}
                disabled={phase !== "running" || found}
                aria-label={`数字 ${value}`}
              >
                {value}
              </button>
            );
          })}
        </div>

        <div className="trainer__actions">
          {phase === "idle" && (
            <button type="button" className="btn btn--primary" onClick={beginSession}>
              开始本轮
            </button>
          )}
          {phase === "running" && (
            <button type="button" className="btn btn--ghost" onClick={beginSession}>
              重新开始
            </button>
          )}
          {phase === "done" && (
            <>
              <p className="trainer__done">
                本轮 {formatDurationMs(elapsedMs)}
                {summary.bestMs !== null && elapsedMs <= summary.bestMs
                  ? " · 新纪录"
                  : ""}
              </p>
              {!onComplete && (
                <button type="button" className="btn btn--primary" onClick={beginSession}>
                  再练一轮
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {!hideHistory && (
        <aside className="trainer__side" aria-label="训练记录">
          <h2 className="trainer__side-title">时间曲线</h2>
          <p className="trainer__side-copy">
            每天约 5 分钟。记录用时，看进步，别焦虑。
          </p>
          <dl className="trainer__summary">
            <div>
              <dt>最佳</dt>
              <dd>
                {summary.bestMs === null ? "—" : formatDurationMs(summary.bestMs)}
              </dd>
            </div>
            <div>
              <dt>最近</dt>
              <dd>
                {summary.latestMs === null
                  ? "—"
                  : formatDurationMs(summary.latestMs)}
              </dd>
            </div>
            <div>
              <dt>次数</dt>
              <dd>{summary.count}</dd>
            </div>
          </dl>

          {history.length === 0 ? (
            <p className="trainer__empty">完成一轮后，这里会留下你的用时。</p>
          ) : (
            <>
              <ProgressSparkline records={history} />
              <ol className="trainer__history">
                {[...history].reverse().slice(0, 12).map((record) => (
                  <li key={record.completedAt}>
                    <time dateTime={new Date(record.completedAt).toISOString()}>
                      {new Date(record.completedAt).toLocaleString("zh-CN", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <span>{formatDurationMs(record.durationMs)}</span>
                  </li>
                ))}
              </ol>
              <button type="button" className="btn btn--text" onClick={resetProgress}>
                清空记录
              </button>
            </>
          )}
        </aside>
      )}
    </div>
  );
}

type ProgressSparklineProps = {
  records: TrainingRecord[];
};

/**
 * ProgressSparkline plots recent durations as a simple polyline for at-a-glance trend reading.
 * Y is inverted so faster (smaller) times sit higher on the chart.
 */
function ProgressSparkline({ records }: ProgressSparklineProps) {
  const points = records.slice(-20);
  if (points.length < 2) {
    return null;
  }
  const durations = points.map((item) => item.durationMs);
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const span = Math.max(max - min, 1);
  const width = 280;
  const height = 72;
  const path = points
    .map((item, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((item.durationMs - min) / span) * (height - 8) - 4;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className="trainer__spark"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="最近用时趋势"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}
