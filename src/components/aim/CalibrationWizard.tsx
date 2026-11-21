/**
 * CalibrationWizard.tsx renders setup, comfort, blocked, and result panels for
 * sens-finder. Trial gameplay stays in AimTrainerApp; this component only handles
 * non-pointer-lock steps and never claims a universal “best” sensitivity.
 */

"use client";

import { useMemo, useRef, useState } from "react";
import { computeCognitivePrior } from "@/lib/aim-trainer/calib/cognitivePrior";
import type { CalibRecommendation, TaskFamily } from "@/lib/aim-trainer/calib/types";
import {
  DPI_MAX,
  DPI_MIN,
  clampDpi,
  formatCm360,
  sensFromCm360,
} from "@/lib/aim-trainer/core/gain";
import { findProfile } from "@/lib/aim-trainer/store/profiles";
import {
  loadSettings,
  saveSettings,
  type SensitivitySettings,
} from "@/lib/aim-trainer/store/settings";

export type CalibrationWizardPhase =
  | "setup"
  | "subjective"
  | "holdoutIntro"
  | "result"
  | "blocked";

export type CalibrationWizardProps = {
  phase: CalibrationWizardPhase;
  /** cm/360 awaiting a comfort rating when phase is subjective. */
  pendingCm360?: number | null;
  recommendation?: CalibRecommendation | null;
  blockedReason?: string | null;
  progressLabel?: string | null;
  onStart: (input: {
    taskFamily: TaskFamily;
    forceDespiteDefer: boolean;
  }) => void;
  onSubjective: (comfort: number) => void;
  onContinueHoldout: () => void;
  onApply: () => void;
  onClose: () => void;
};

const FAMILY_OPTIONS: Array<{ id: TaskFamily; label: string; hint: string }> = [
  {
    id: "balanced",
    label: "平衡",
    hint: "甩枪与微调混合（默认）",
  },
  {
    id: "flick",
    label: "甩枪",
    hint: "偏重远距快速到位",
  },
  {
    id: "micro",
    label: "微调",
    hint: "偏重近距精确停枪",
  },
];

/**
 * CalibrationWizard collects task-family / DPI readiness, Likert comfort, and
 * presents dual-optima results with an apply action into current settings.
 */
export function CalibrationWizard({
  phase,
  recommendation,
  blockedReason,
  progressLabel,
  onStart,
  onSubjective,
  onContinueHoldout,
  onApply,
  onClose,
}: CalibrationWizardProps) {
  const [settings, setSettings] = useState<SensitivitySettings>(() =>
    loadSettings(),
  );
  const [dpiDraft, setDpiDraft] = useState<string>(() =>
    settings.dpi !== null ? String(settings.dpi) : "",
  );
  const [dpiError, setDpiError] = useState<string | null>(null);
  const [taskFamily, setTaskFamily] = useState<TaskFamily>("balanced");
  const [forceDespiteDefer, setForceDespiteDefer] = useState(false);
  const dpiInputRef = useRef<HTMLInputElement | null>(null);
  const prior = useMemo(() => computeCognitivePrior(), []);
  const profile = findProfile(settings.profileId);
  const parsedDpi = clampDpi(
    dpiDraft.trim() === "" ? null : Number(dpiDraft),
  );
  const blockedByDefer = prior.deferCalibration && !forceDespiteDefer;

  /**
   * handleStart validates DPI then persists and starts the run.
   * The primary button stays enabled so a clipped/disabled control cannot trap users;
   * invalid DPI focuses the field instead of silently no-oping.
   */
  function handleStart(): void {
    if (blockedByDefer) {
      setDpiError("请先勾选「仍要继续」，或稍后再校准。");
      return;
    }
    if (parsedDpi === null) {
      setDpiError(`请填写鼠标 DPI（${DPI_MIN}–${DPI_MAX}）`);
      dpiInputRef.current?.focus();
      dpiInputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setDpiError(null);
    const next = { ...settings, dpi: parsedDpi };
    saveSettings(next);
    setSettings(next);
    onStart({ taskFamily, forceDespiteDefer });
  }

  return (
    <div className="aim-overlay aim-calib-overlay">
      <div className="aim-panel aim-calib-panel">
        {phase === "setup" && (
          <>
            <h2>灵敏度校准</h2>
            <p className="aim-calib-lead">
              针对任务族做多增益短测，分别估计客观表现与主观舒适；结果是区间估计，不是绝对最佳值。同任务族多次结果一致时会融合 cm/360 并上调置信；不一致则加宽区间、下调置信。
            </p>
            <ul className="aim-calib-checklist">
              <li>请关闭系统鼠标加速与游戏加速度（raw input）</li>
              <li>
                当前档案 {profile.name} · 感度 {settings.sensitivity}
              </li>
              <li>{prior.reason}</li>
            </ul>
            <label className="aim-calib-dpi">
              <span>鼠标 DPI（必填）</span>
              <input
                ref={dpiInputRef}
                type="number"
                min={DPI_MIN}
                max={DPI_MAX}
                step={50}
                value={dpiDraft}
                placeholder="例如 800"
                onChange={(e) => {
                  setDpiDraft(e.target.value);
                  setDpiError(null);
                }}
              />
            </label>
            {(dpiError ||
              (dpiDraft.trim() !== "" && parsedDpi === null) ||
              dpiDraft.trim() === "") && (
              <p className="aim-lock-hint" role="alert">
                {dpiError ??
                  (dpiDraft.trim() === ""
                    ? "填写真实鼠标 DPI 后点「开始校准」。"
                    : `DPI 需在 ${DPI_MIN}–${DPI_MAX} 之间。`)}
              </p>
            )}
            {prior.deferCalibration && (
              <label className="aim-calib-force">
                <input
                  type="checkbox"
                  checked={forceDespiteDefer}
                  onChange={(e) => {
                    setForceDespiteDefer(e.target.checked);
                    setDpiError(null);
                  }}
                />
                仍要继续（置信会下调）
              </label>
            )}
            <fieldset className="aim-calib-family">
              <legend>任务族</legend>
              {FAMILY_OPTIONS.map((opt) => (
                <label key={opt.id} className="aim-calib-family-option">
                  <input
                    type="radio"
                    name="taskFamily"
                    checked={taskFamily === opt.id}
                    onChange={() => setTaskFamily(opt.id)}
                  />
                  <span>
                    <strong>{opt.label}</strong>
                    <small>{opt.hint}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="aim-panel-actions">
              <button
                type="button"
                className="aim-btn aim-btn--primary"
                onClick={handleStart}
              >
                开始校准
              </button>
              <button type="button" className="aim-btn" onClick={onClose}>
                取消
              </button>
            </div>
          </>
        )}

        {phase === "blocked" && (
          <>
            <h2>暂缓校准</h2>
            <p>{blockedReason}</p>
            <div className="aim-panel-actions">
              <button type="button" className="aim-btn" onClick={onClose}>
                返回
              </button>
            </div>
          </>
        )}

        {phase === "subjective" && (
          <>
            <h2>舒适度</h2>
            <p>
              刚才这一组增益手感如何？（不显示具体感度数值，避免锚定）
            </p>
            {progressLabel ? <p className="aim-calib-progress">{progressLabel}</p> : null}
            <div className="aim-calib-likert">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="aim-btn"
                  onClick={() => onSubjective(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="aim-hint">1 很别扭 · 5 很跟手</p>
          </>
        )}

        {phase === "holdoutIntro" && (
          <>
            <h2>独立验证</h2>
            <p>
              接下来用未见过的短测验证推荐增益与邻近增益，避免「用训练数据证明自己」。
            </p>
            {recommendation ? (
              <p>
                候选约 {formatCm360(recommendation.cm360)}（界面不显示具体感度数字）
              </p>
            ) : null}
            <div className="aim-panel-actions">
              <button
                type="button"
                className="aim-btn aim-btn--primary"
                onClick={onContinueHoldout}
              >
                开始验证
              </button>
            </div>
          </>
        )}

        {phase === "result" && recommendation && (
          <>
            <h2>校准结果</h2>
            <p className="aim-calib-lead">{recommendation.explanation}</p>
            <div className="aim-result-stats aim-calib-stats">
              <div className="aim-rs">
                <span className="aim-rs__label">推荐（表现带内最舒适）</span>
                <span className="aim-rs__value">
                  {sensFromCm360(
                    profile,
                    recommendation.cm360,
                    settings.dpi ?? 800,
                  )}
                </span>
                <span className="aim-rs__sub">
                  {formatCm360(recommendation.cm360)}
                </span>
              </div>
              <div className="aim-rs">
                <span className="aim-rs__label">建议区间</span>
                <span className="aim-rs__value">
                  {recommendation.cm360Low.toFixed(1)}–
                  {recommendation.cm360High.toFixed(1)}
                </span>
                <span className="aim-rs__sub">cm/360</span>
              </div>
              <div className="aim-rs">
                <span className="aim-rs__label">表现最佳</span>
                <span className="aim-rs__value">
                  {formatCm360(recommendation.cm360ObjBest)}
                </span>
              </div>
              <div className="aim-rs">
                <span className="aim-rs__label">最舒适</span>
                <span className="aim-rs__value">
                  {formatCm360(recommendation.cm360SubBest)}
                </span>
              </div>
            </div>
            <p className="aim-hint">
              任务族 {recommendation.taskFamily} · 置信{" "}
              {(recommendation.confidence * 100).toFixed(0)}%
              {recommendation.verified ? " · 验证通过" : " · 验证未优于邻近，区间已加宽"}
            </p>
            {(settings.dpi ?? parsedDpi) === null ? (
              <p className="aim-lock-hint">缺少 DPI，无法写入游戏内感度。</p>
            ) : null}
            <div className="aim-panel-actions">
              <button
                type="button"
                className="aim-btn aim-btn--primary"
                disabled={(settings.dpi ?? parsedDpi) === null}
                onClick={onApply}
              >
                写入设置
              </button>
              <button type="button" className="aim-btn" onClick={onClose}>
                稍后
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
