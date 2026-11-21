/**
 * SettingsView.tsx — aim-trainer settings panel (control / crosshair / scene / sound).
 * Ported from aim-trainer-web SettingsView.vue (MIT). Drafts edits locally, previews
 * crosshair/sound to the parent, and persists via store helpers only on Apply.
 * Control tab includes a cm/360 cross-game converter so users can hop archives
 * (e.g. VALORANT → Minecraft Java) without hand-rewriting in-game sens.
 */

"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Crosshair } from "@/components/aim/Crosshair";
import { SoundFX } from "@/lib/aim-trainer/core/audio";
import {
  DEFAULT_ROTATION_EXPR,
  evaluateExpression,
  formatExpression,
  rotationScope,
} from "@/lib/aim-trainer/core/expression";
import {
  DPI_MAX,
  DPI_MIN,
  cm360FromSens,
  convertSensAcrossProfiles,
  convertSensAcrossYaw,
  degPerCountForProfile,
  edpi,
  formatCm360,
  rotationExprForYawFactor,
} from "@/lib/aim-trainer/core/gain";
import {
  GAME_PROFILES,
  MINECRAFT_NOTE,
  PEACE_ELITE_EMULATOR_NOTE,
  clampSensitivity,
  findProfile,
  isMinecraftProfile,
  isPubgExpProfile,
  sensitivityRangeOf,
} from "@/lib/aim-trainer/store/profiles";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type SensitivitySettings,
} from "@/lib/aim-trainer/store/settings";
import { loadRecommendation } from "@/lib/aim-trainer/store/recommendation";

import {
  CROSSHAIR_STYLES,
  DEFAULT_CROSSHAIR,
  PRESET_COLORS,
  loadCrosshair,
  saveCrosshair,
  type CrosshairSettings,
  type CrosshairStyle,
} from "@/lib/aim-trainer/store/crosshair";
import {
  BACKGROUND_OPTIONS,
  DEFAULT_APPEARANCE,
  TARGET_COLORS,
  loadAppearance,
  saveAppearance,
  type AppearanceSettings,
} from "@/lib/aim-trainer/store/appearance";
import {
  DEFAULT_SOUND,
  HIT_SOUNDS,
  MUSIC_TRACKS,
  loadSoundSettings,
  saveSoundSettings,
  type HitSoundId,
  type SoundSettings,
} from "@/lib/aim-trainer/store/sound";
import "./aim-settings.css";

/** Custom rotation yaw factor the user asked to convert into (not native VALORANT 0.07). */
const CUSTOM_YAW_FACTOR = 0.0027;

/** Settings panel tab ids matching the Vue source. */
export type SettingsTab = "control" | "crosshair" | "scene" | "sound";

/** Parent callbacks for live preview, persist/apply, and dismiss. */
export type SettingsViewProps = {
  /** Tab shown when the panel opens; defaults to control. */
  initialTab?: SettingsTab;
  /** Persist + apply sensitivity after Save. */
  onApplySensitivity: (s: SensitivitySettings) => void;
  /** Persist + apply crosshair after Save. */
  onApplyCrosshair: (s: CrosshairSettings) => void;
  /** Persist + apply appearance after Save. */
  onApplyAppearance: (s: AppearanceSettings) => void;
  /** Persist + apply sound after Save. */
  onApplySound: (s: SoundSettings) => void;
  /** Live crosshair preview while the user edits (not persisted). */
  onPreviewCrosshair: (s: CrosshairSettings) => void;
  /** Live sound preview while the user edits (not persisted). */
  onPreviewSound: (s: SoundSettings) => void;
  /** Close without saving (also restores original crosshair/sound preview). */
  onClose: () => void;
  /** Optional jump into the sensitivity calibration wizard. */
  onOpenCalibration?: () => void;
};

/** Sidebar tab definitions with Chinese labels. */
const TABS: Array<{ id: SettingsTab; label: string; index: string }> = [
  { id: "control", label: "操控", index: "01" },
  { id: "crosshair", label: "准心", index: "02" },
  { id: "scene", label: "场景", index: "03" },
  { id: "sound", label: "声音", index: "04" },
];

/** Quick-insert rotation formulas shown under the expression editor. */
const ROTATION_PRESETS: Array<{ label: string; expr: string }> = [
  { label: "默认", expr: DEFAULT_ROTATION_EXPR },
  { label: "0.0027", expr: rotationExprForYawFactor(CUSTOM_YAW_FACTOR) },
  { label: "半 yaw", expr: "sens * yaw * pi / 360" },
  { label: "双倍", expr: "sens * yaw * pi / 90" },
  { label: "仅 yaw", expr: "yaw * pi / 180" },
];

/**
 * SettingsView drafts all four setting domains, previews crosshair/sound to the parent,
 * and only writes localStorage + apply callbacks when the user confirms Save.
 */
export function SettingsView({
  initialTab = "control",
  onApplySensitivity,
  onApplyCrosshair,
  onApplyAppearance,
  onApplySound,
  onPreviewCrosshair,
  onPreviewSound,
  onClose,
  onOpenCalibration,
}: SettingsViewProps) {
  // Snapshots used to restore live preview on Cancel.
  const [originalSensitivity] = useState(() => loadSettings());
  const [originalCrosshair] = useState(() => loadCrosshair());
  const [originalAppearance] = useState(() => loadAppearance());
  const [originalSound] = useState(() => loadSoundSettings());

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [sensitivity, setSensitivity] = useState<SensitivitySettings>(() => ({
    ...originalSensitivity,
  }));
  /** Target archive for the cross-game cm/360 converter (default: Minecraft Java). */
  const [convertTargetId, setConvertTargetId] = useState(() => {
    const currentId = originalSensitivity.profileId;
    return currentId === "minecraft-java"
      ? "valorant"
      : "minecraft-java";
  });
  const [crosshair, setCrosshair] = useState<CrosshairSettings>(() => ({
    ...originalCrosshair,
  }));
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => ({
    ...originalAppearance,
  }));
  const [sound, setSound] = useState<SoundSettings>(() => ({ ...originalSound }));

  // Keep convert target off the active archive after profile switches / apply.
  useEffect(() => {
    if (convertTargetId === sensitivity.profileId) {
      const fallback =
        GAME_PROFILES.find((p) => p.id !== sensitivity.profileId)?.id ??
        "valorant";
      setConvertTargetId(fallback);
    }
  }, [convertTargetId, sensitivity.profileId]);

  const soundPreviewRef = useRef<SoundFX | null>(null);
  if (soundPreviewRef.current === null) {
    soundPreviewRef.current = new SoundFX();
  }

  useEffect(() => {
    return () => {
      soundPreviewRef.current?.dispose();
      soundPreviewRef.current = null;
    };
  }, []);

  const activeProfile = useMemo(
    () => findProfile(sensitivity.profileId),
    [sensitivity.profileId],
  );
  const range = useMemo(
    () => sensitivityRangeOf(activeProfile),
    [activeProfile],
  );
  const activeTitle = TABS.find((tab) => tab.id === activeTab)?.label ?? "";

  /** Physical gain preview; null cm/360 until DPI is filled. */
  const gainPreview = useMemo(() => {
    const cm360 = cm360FromSens(
      activeProfile,
      sensitivity.sensitivity,
      sensitivity.dpi,
    );
    const effective =
      sensitivity.dpi !== null
        ? edpi(sensitivity.dpi, sensitivity.sensitivity)
        : null;
    return { cm360, edpi: effective };
  }, [activeProfile, sensitivity.dpi, sensitivity.sensitivity]);

  const lastRecommendation = useMemo(() => loadRecommendation(), []);

  const convertTarget = useMemo(
    () => findProfile(convertTargetId),
    [convertTargetId],
  );

  /** Live cross-game conversion keeping the draft cm/360. */
  const crossConvert = useMemo(
    () =>
      convertSensAcrossProfiles(
        activeProfile,
        sensitivity.sensitivity,
        convertTarget,
        sensitivity.dpi,
      ),
    [
      activeProfile,
      convertTarget,
      sensitivity.dpi,
      sensitivity.sensitivity,
    ],
  );

  /** Live validation + rad/count preview for the draft rotation expression. */
  const rotationPreview = useMemo(() => {
    const sens = clampSensitivity(activeProfile, sensitivity.sensitivity);
    const scope = rotationScope(
      sens,
      activeProfile.yawDeg,
      activeProfile.verticalFovDeg,
    );
    const result = evaluateExpression(
      sensitivity.rotationExpr || DEFAULT_ROTATION_EXPR,
      scope,
    );
    if (!result.ok) {
      return { ok: false as const, error: result.error, degPerCount: null };
    }
    if (result.value < 0) {
      return {
        ok: false as const,
        error: "结果不能为负数",
        degPerCount: null,
      };
    }
    return {
      ok: true as const,
      error: null,
      radPerCount: result.value,
      degPerCount: (result.value * 180) / Math.PI,
    };
  }, [activeProfile, sensitivity.rotationExpr, sensitivity.sensitivity]);

  // Mirror draft state for event handlers so preview can run outside setState updaters.
  const crosshairRef = useRef(crosshair);
  const soundRef = useRef(sound);
  crosshairRef.current = crosshair;
  soundRef.current = sound;

  /**
   * updateCrosshair drafts local reticle state only.
   * Parent preview is deferred to Apply/Cancel — pushing every keystroke caused
   * parent setState loops when a new object was written each time.
   */
  function updateCrosshair(
    patch: Partial<CrosshairSettings> | ((prev: CrosshairSettings) => CrosshairSettings),
  ): void {
    const prev = crosshairRef.current;
    const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
    if (
      prev.style === next.style &&
      prev.color === next.color &&
      prev.size === next.size &&
      prev.thickness === next.thickness &&
      prev.gap === next.gap &&
      prev.outline === next.outline
    ) {
      return;
    }
    crosshairRef.current = next;
    setCrosshair(next);
  }

  /**
   * updateSound drafts local sound settings and previews volume/track on the parent.
   */
  function updateSound(
    patch: Partial<SoundSettings> | ((prev: SoundSettings) => SoundSettings),
  ): void {
    const prev = soundRef.current;
    const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
    if (
      prev.muted === next.muted &&
      prev.musicVolume === next.musicVolume &&
      prev.effectsVolume === next.effectsVolume &&
      prev.uiVolume === next.uiVolume &&
      prev.trackId === next.trackId &&
      prev.hitSoundId === next.hitSoundId
    ) {
      return;
    }
    soundRef.current = next;
    setSound(next);
    onPreviewSound(next);
  }

  /** Fixed-size crosshair snapshot used only in style option mini-previews. */
  function previewSettings(style: CrosshairStyle): CrosshairSettings {
    return { ...crosshair, style, size: 24, thickness: 2, gap: 7 };
  }

  /** Select a hit sound and audition it when effects are audible. */
  function selectHitSound(id: HitSoundId): void {
    updateSound((prev) => {
      const next = { ...prev, hitSoundId: id };
      if (!next.muted && next.effectsVolume > 0) {
        soundPreviewRef.current?.previewHit(id, next.effectsVolume / 100);
      }
      return next;
    });
  }

  /** Normalize, persist all domains, notify parent, then close. */
  function apply(): void {
    if (!rotationPreview.ok) return;
    const formatted = formatExpression(
      sensitivity.rotationExpr || DEFAULT_ROTATION_EXPR,
    );
    const draft: SensitivitySettings = {
      ...sensitivity,
      rotationExpr: formatted.ok
        ? formatted.formatted
        : sensitivity.rotationExpr,
    };
    const normalizedSensitivity = normalizeSettings(draft);
    setSensitivity(normalizedSensitivity);
    saveSettings(normalizedSensitivity);
    saveCrosshair({ ...crosshair });
    saveAppearance({ ...appearance });
    saveSoundSettings({ ...sound });
    onApplySensitivity(normalizedSensitivity);
    onApplyCrosshair({ ...crosshair });
    onApplyAppearance({ ...appearance });
    onApplySound({ ...sound });
    onClose();
  }

  /** Restore live previews to originals and close without saving. */
  function cancel(): void {
    onPreviewCrosshair({ ...originalCrosshair });
    onPreviewSound({ ...originalSound });
    onClose();
  }

  /** Reset only the currently visible tab to its store defaults. */
  function resetActive(): void {
    if (activeTab === "control") setSensitivity({ ...DEFAULT_SETTINGS });
    if (activeTab === "crosshair") updateCrosshair(() => ({ ...DEFAULT_CROSSHAIR }));
    if (activeTab === "scene") setAppearance({ ...DEFAULT_APPEARANCE });
    if (activeTab === "sound") updateSound(() => ({ ...DEFAULT_SOUND }));
  }

  function onSensitivityNumber(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void {
    const value =
      e.target.type === "number" || e.target.type === "range"
        ? Number(e.target.value)
        : e.target.value;
    if (e.target.id === "profile" || e.target.name === "profileId") {
      setSensitivity((prev) => ({ ...prev, profileId: String(value) }));
      return;
    }
    if (e.target.id === "dpi") {
      const raw = e.target.value === "" ? null : Number(value);
      setSensitivity((prev) => ({
        ...prev,
        dpi: raw === null || !Number.isFinite(raw) ? null : raw,
      }));
      return;
    }
    setSensitivity((prev) => ({
      ...prev,
      sensitivity: typeof value === "number" ? value : Number(value),
    }));
  }

  /** Pretty-print the draft rotation formula in place when syntax is valid. */
  function formatRotationExpr(): void {
    const result = formatExpression(
      sensitivity.rotationExpr || DEFAULT_ROTATION_EXPR,
    );
    if (!result.ok) return;
    setSensitivity((prev) => ({ ...prev, rotationExpr: result.formatted }));
  }

  /**
   * convertToCustomYawFormula rewrites the rotation expr to sens*0.0027*pi/180 and
   * scales the sens slider so °/count (and feel) stay the same as the current profile yaw.
   * Because VALORANT's native slider max is 10, the converted sens is baked into the
   * expression when it would exceed the profile range; the slider keeps the in-game value.
   */
  function convertToCustomYawFormula(): void {
    const fromYaw = activeProfile.yawDeg;
    const gameSens = clampSensitivity(activeProfile, sensitivity.sensitivity);
    const formulaSens = convertSensAcrossYaw(
      gameSens,
      fromYaw,
      CUSTOM_YAW_FACTOR,
    );
    const roundedFormulaSens = Number(formulaSens.toFixed(3));
    const range = sensitivityRangeOf(activeProfile);
    if (roundedFormulaSens > range.max) {
      // Keep 游戏内灵敏度 as the real VALORANT number; put converted coeff in the expr.
      setSensitivity((prev) => ({
        ...prev,
        sensitivity: gameSens,
        rotationExpr: `${roundedFormulaSens} * ${CUSTOM_YAW_FACTOR} * pi / 180`,
      }));
      return;
    }
    setSensitivity((prev) => ({
      ...prev,
      sensitivity: clampSensitivity(activeProfile, roundedFormulaSens),
      rotationExpr: rotationExprForYawFactor(CUSTOM_YAW_FACTOR),
    }));
  }

  return (
    <div
      className="aim-settings"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <section className="settings-shell" aria-label="游戏设置">
        <aside className="settings-nav">
          <header className="settings-brand">
            <span className="eyebrow">AIM TRAINER</span>
            <h2>设置中心</h2>
          </header>
          <nav aria-label="设置分类">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`tab-btn${activeTab === tab.id ? " active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="tab-index">{tab.index}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
          <p className="nav-note">所有设置保存在当前浏览器</p>
        </aside>

        <div className="settings-main">
          <header className="content-header">
            <div>
              <span className="eyebrow">{activeTitle} SETTINGS</span>
              <h3>{activeTitle}设置</h3>
            </div>
            <button
              type="button"
              className="icon-close"
              title="关闭设置"
              onClick={cancel}
            >
              ×
            </button>
          </header>

          <div className="settings-content">
            {activeTab === "control" && (
              <div className="section-stack control-layout">
                <div className="field-block">
                  <label htmlFor="profile">游戏档案</label>
                  <select
                    id="profile"
                    name="profileId"
                    value={sensitivity.profileId}
                    onChange={onSensitivityNumber}
                  >
                    {GAME_PROFILES.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  <p>
                    {isPubgExpProfile(activeProfile) ||
                    isMinecraftProfile(activeProfile)
                      ? `有效 ${degPerCountForProfile(activeProfile, sensitivity.sensitivity).toFixed(4)}° / count · FOV ${activeProfile.verticalFovDeg.toFixed(2)}°`
                      : `yaw ${activeProfile.yawDeg}° / count · FOV ${activeProfile.verticalFovDeg.toFixed(2)}°`}
                  </p>
                  {isPubgExpProfile(activeProfile) ? (
                    <p>{PEACE_ELITE_EMULATOR_NOTE}</p>
                  ) : null}
                  {isMinecraftProfile(activeProfile) ? (
                    <p>{MINECRAFT_NOTE}</p>
                  ) : null}
                </div>

                <div className="field-block">
                  <div className="label-row">
                    <label htmlFor="sensitivity">
                      {isPubgExpProfile(activeProfile)
                        ? "镜头灵敏度"
                        : isMinecraftProfile(activeProfile)
                          ? "灵敏度 %"
                          : "游戏内灵敏度"}
                    </label>
                    <output>
                      {sensitivity.sensitivity}
                      {activeProfile.sensUnit ?? ""}
                    </output>
                  </div>
                  <input
                    id="sensitivity"
                    value={sensitivity.sensitivity}
                    onChange={onSensitivityNumber}
                    type="range"
                    min={range.min}
                    max={range.max}
                    step={range.step}
                  />
                  <input
                    value={sensitivity.sensitivity}
                    onChange={onSensitivityNumber}
                    className="number-input"
                    type="number"
                    min={range.min}
                    max={range.max}
                    step={range.step}
                  />
                  <p>
                    有效范围 {range.min} - {range.max}，步进 {range.step}
                  </p>
                </div>

                <div className="field-block">
                  <div className="label-row">
                    <label htmlFor="dpi">鼠标 DPI</label>
                    <output>
                      {sensitivity.dpi !== null ? sensitivity.dpi : "未填"}
                    </output>
                  </div>
                  <input
                    id="dpi"
                    value={sensitivity.dpi ?? ""}
                    onChange={onSensitivityNumber}
                    className="number-input"
                    type="number"
                    min={DPI_MIN}
                    max={DPI_MAX}
                    step={50}
                    placeholder="例如 800"
                  />
                  <p>
                    用于 cm/360
                    {isPubgExpProfile(activeProfile) ||
                    isMinecraftProfile(activeProfile)
                      ? ""
                      : " / eDPI"}
                    ；校准与写入推荐前必须填写（{DPI_MIN}–{DPI_MAX}）
                  </p>
                  <p>
                    {formatCm360(gainPreview.cm360)}
                    {!isPubgExpProfile(activeProfile) &&
                    !isMinecraftProfile(activeProfile) &&
                    gainPreview.edpi !== null
                      ? ` · eDPI ${Math.round(gainPreview.edpi)}`
                      : ""}
                  </p>
                </div>

                <div className="field-block">
                  <label htmlFor="convert-target">跨游戏换算</label>
                  <p>
                    保持当前 {formatCm360(gainPreview.cm360)}
                    ，换到另一款游戏的腰射灵敏度（需已填 DPI）。
                  </p>
                  <select
                    id="convert-target"
                    value={convertTargetId}
                    onChange={(e) => setConvertTargetId(e.target.value)}
                  >
                    {GAME_PROFILES.filter(
                      (profile) => profile.id !== sensitivity.profileId,
                    ).map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  {crossConvert.error && !crossConvert.cm360 ? (
                    <p>{crossConvert.error}</p>
                  ) : (
                    <p>
                      → {convertTarget.name}{" "}
                      <strong>
                        {crossConvert.sensitivity}
                        {convertTarget.sensUnit ?? ""}
                      </strong>
                      {crossConvert.error ? ` · ${crossConvert.error}` : ""}
                    </p>
                  )}
                  <button
                    type="button"
                    className="text-btn"
                    disabled={
                      Boolean(crossConvert.error && !crossConvert.cm360) ||
                      convertTarget.id === sensitivity.profileId
                    }
                    onClick={() => {
                      if (crossConvert.error && !crossConvert.cm360) return;
                      setSensitivity((prev) =>
                        normalizeSettings({
                          ...prev,
                          profileId: convertTarget.id,
                          sensitivity: crossConvert.sensitivity,
                          rotationExpr: DEFAULT_ROTATION_EXPR,
                        }),
                      );
                      setConvertTargetId(activeProfile.id);
                    }}
                  >
                    应用到该档案
                  </button>
                </div>

                {(lastRecommendation || onOpenCalibration) && (
                  <div className="field-block">
                    <label>灵敏度校准</label>
                    {lastRecommendation ? (
                      <p>
                        上次估计 {lastRecommendation.cm360.toFixed(1)} cm/360
                        （区间 {lastRecommendation.cm360Low.toFixed(1)}–
                        {lastRecommendation.cm360High.toFixed(1)}）· 任务族{" "}
                        {lastRecommendation.taskFamily}
                        {lastRecommendation.verified ? " · 已验证" : ""}
                      </p>
                    ) : (
                      <p>尚无校准记录。关闭系统/游戏加速后进行多增益短测。</p>
                    )}
                    {onOpenCalibration && (
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => {
                          // Persist draft DPI/sens before leaving settings so calib can start.
                          const normalized = normalizeSettings(sensitivity);
                          saveSettings(normalized);
                          onApplySensitivity(normalized);
                          onClose();
                          onOpenCalibration();
                        }}
                      >
                        打开灵敏度校准
                      </button>
                    )}
                  </div>
                )}

                <div className="field-block expr-block">
                  <div className="label-row">
                    <label htmlFor="rotation-expr">旋转算法表达式</label>
                    <div className="expr-actions">
                      <button
                        type="button"
                        className="text-btn expr-format-btn"
                        onClick={convertToCustomYawFormula}
                        title="保持当前手感，换算到 sens × 0.0027 × π / 180"
                      >
                        换算为 0.0027 公式
                      </button>
                      <button
                        type="button"
                        className="text-btn expr-format-btn"
                        onClick={formatRotationExpr}
                        disabled={!rotationPreview.ok}
                      >
                        格式化
                      </button>
                    </div>
                  </div>
                  <textarea
                    id="rotation-expr"
                    className="expr-input"
                    spellCheck={false}
                    rows={3}
                    value={sensitivity.rotationExpr}
                    onChange={(e) =>
                      setSensitivity((prev) => ({
                        ...prev,
                        rotationExpr: e.target.value,
                      }))
                    }
                    onBlur={() => {
                      if (rotationPreview.ok) formatRotationExpr();
                    }}
                    placeholder={DEFAULT_ROTATION_EXPR}
                    aria-invalid={!rotationPreview.ok}
                  />
                  <div className="expr-presets" role="group" aria-label="公式预设">
                    {ROTATION_PRESETS.map((preset) => (
                      <button
                        key={preset.expr}
                        type="button"
                        className={`expr-preset${
                          sensitivity.rotationExpr.trim() === preset.expr
                            ? " active"
                            : ""
                        }`}
                        onClick={() =>
                          setSensitivity((prev) => ({
                            ...prev,
                            rotationExpr: preset.expr,
                          }))
                        }
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <p className="expr-help">
                    变量：<code>sens</code> <code>yaw</code> <code>fov</code>{" "}
                    <code>pi</code> · 运算：+ − * / ^ · 函数：abs sqrt min max
                    sin cos tan
                  </p>
                  {rotationPreview.ok ? (
                    <p className="expr-status expr-status--ok">
                      当前 ≈ {rotationPreview.degPerCount.toExponential(4)} °/count
                      {" · "}
                      {rotationPreview.radPerCount.toExponential(4)} rad/count
                    </p>
                  ) : (
                    <p className="expr-status expr-status--bad" role="alert">
                      {rotationPreview.error}
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeTab === "crosshair" && (
              <div className="crosshair-layout">
                <div className="preview-stage">
                  <span className="preview-label">LIVE PREVIEW</span>
                  <Crosshair settings={crosshair} />
                </div>

                <div className="section-stack crosshair-controls">
                  <div className="field-block">
                    <label>准心样式</label>
                    <div className="style-options">
                      {CROSSHAIR_STYLES.map((style) => (
                        <button
                          key={style.id}
                          type="button"
                          className={`style-option${
                            crosshair.style === style.id ? " active" : ""
                          }`}
                          onClick={() =>
                            updateCrosshair((prev) => ({ ...prev, style: style.id }))
                          }
                        >
                          <span className="mini-preview">
                            <Crosshair settings={previewSettings(style.id)} />
                          </span>
                          <span>{style.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="field-block">
                    <label>准心颜色</label>
                    <div className="color-row">
                      {PRESET_COLORS.map((preset) => (
                        <button
                          key={preset.color}
                          type="button"
                          className={`swatch${
                            crosshair.color.toLowerCase() === preset.color
                              ? " active"
                              : ""
                          }`}
                          style={{ background: preset.color }}
                          title={preset.name}
                          onClick={() =>
                            updateCrosshair((prev) => ({
                              ...prev,
                              color: preset.color,
                            }))
                          }
                        />
                      ))}
                      <label className="color-picker">
                        <input
                          value={crosshair.color}
                          type="color"
                          onChange={(e) =>
                            updateCrosshair((prev) => ({
                              ...prev,
                              color: e.target.value,
                            }))
                          }
                        />
                        <span>{crosshair.color.toUpperCase()}</span>
                      </label>
                    </div>
                  </div>

                  <div className="slider-grid">
                    <label className="slider-field">
                      <span>
                        整体大小 <output>{crosshair.size} px</output>
                      </span>
                      <input
                        value={crosshair.size}
                        type="range"
                        min={8}
                        max={48}
                        step={1}
                        onChange={(e) =>
                          updateCrosshair((prev) => ({
                            ...prev,
                            size: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                    <label className="slider-field">
                      <span>
                        线条粗细 <output>{crosshair.thickness} px</output>
                      </span>
                      <input
                        value={crosshair.thickness}
                        type="range"
                        min={1}
                        max={6}
                        step={1}
                        onChange={(e) =>
                          updateCrosshair((prev) => ({
                            ...prev,
                            thickness: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                    <label className="slider-field">
                      <span>
                        中心间距 <output>{crosshair.gap} px</output>
                      </span>
                      <input
                        value={crosshair.gap}
                        type="range"
                        min={2}
                        max={16}
                        step={1}
                        onChange={(e) =>
                          updateCrosshair((prev) => ({
                            ...prev,
                            gap: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                    <label className="toggle-row">
                      <span>深色描边</span>
                      <input
                        checked={crosshair.outline}
                        type="checkbox"
                        onChange={(e) =>
                          updateCrosshair((prev) => ({
                            ...prev,
                            outline: e.target.checked,
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "scene" && (
              <div className="section-stack">
                <div className="field-block">
                  <label>训练背景</label>
                  <div className="background-grid">
                    {BACKGROUND_OPTIONS.map((background) => (
                      <button
                        key={background.id}
                        type="button"
                        className={`background-option${
                          appearance.backgroundId === background.id ? " active" : ""
                        }`}
                        onClick={() =>
                          setAppearance((prev) => ({
                            ...prev,
                            backgroundId: background.id,
                          }))
                        }
                      >
                        <span
                          className="background-preview"
                          style={{ background: background.preview }}
                        />
                        <span className="background-copy">
                          <b>{background.name}</b>
                          <small>{background.description}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field-block target-color-block">
                  <div>
                    <label>目标颜色</label>
                    <p>所有训练模式会统一使用该颜色。</p>
                  </div>
                  <div className="color-row">
                    {TARGET_COLORS.map((preset) => (
                      <button
                        key={preset.color}
                        type="button"
                        className={`swatch target-swatch${
                          appearance.targetColor.toLowerCase() === preset.color
                            ? " active"
                            : ""
                        }`}
                        style={{ background: preset.color }}
                        title={preset.name}
                        onClick={() =>
                          setAppearance((prev) => ({
                            ...prev,
                            targetColor: preset.color,
                          }))
                        }
                      />
                    ))}
                    <label className="color-picker">
                      <input
                        value={appearance.targetColor}
                        type="color"
                        onChange={(e) =>
                          setAppearance((prev) => ({
                            ...prev,
                            targetColor: e.target.value,
                          }))
                        }
                      />
                      <span>{appearance.targetColor.toUpperCase()}</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "sound" && (
              <div className="sound-layout">
                <div className="section-stack">
                  <label className="master-toggle">
                    <span>
                      <b>全部声音</b>
                      <small>一键静音音乐和反馈音效</small>
                    </span>
                    <input
                      checked={sound.muted}
                      type="checkbox"
                      onChange={(e) =>
                        updateSound((prev) => ({
                          ...prev,
                          muted: e.target.checked,
                        }))
                      }
                    />
                  </label>

                  <div
                    className={`volume-list${sound.muted ? " disabled" : ""}`}
                  >
                    <label className="slider-field">
                      <span>
                        背景音乐 <output>{sound.musicVolume}%</output>
                      </span>
                      <input
                        value={sound.musicVolume}
                        type="range"
                        min={0}
                        max={100}
                        onChange={(e) =>
                          updateSound((prev) => ({
                            ...prev,
                            musicVolume: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                    <label className="slider-field">
                      <span>
                        命中音效 <output>{sound.effectsVolume}%</output>
                      </span>
                      <input
                        value={sound.effectsVolume}
                        type="range"
                        min={0}
                        max={100}
                        onChange={(e) =>
                          updateSound((prev) => ({
                            ...prev,
                            effectsVolume: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                    <label className="slider-field">
                      <span>
                        界面反馈 <output>{sound.uiVolume}%</output>
                      </span>
                      <input
                        value={sound.uiVolume}
                        type="range"
                        min={0}
                        max={100}
                        onChange={(e) =>
                          updateSound((prev) => ({
                            ...prev,
                            uiVolume: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                  </div>

                  <div
                    className={`field-block hit-sound-picker${
                      sound.muted ? " disabled" : ""
                    }`}
                  >
                    <label>命中音效</label>
                    <div className="hit-sound-grid">
                      {HIT_SOUNDS.map((hitSound) => (
                        <button
                          key={hitSound.id}
                          type="button"
                          className={`hit-sound-option${
                            sound.hitSoundId === hitSound.id ? " active" : ""
                          }`}
                          disabled={sound.muted}
                          onClick={() => selectHitSound(hitSound.id)}
                        >
                          <span className="hit-sound-icon" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                          <span>
                            <b>{hitSound.name}</b>
                            <small>{hitSound.description}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="field-block music-picker">
                  <label>背景音乐</label>
                  <div className="track-list">
                    {MUSIC_TRACKS.map((track) => (
                      <button
                        key={track.id}
                        type="button"
                        className={`track-option${
                          sound.trackId === track.id ? " active" : ""
                        }`}
                        onClick={() =>
                          updateSound((prev) => ({
                            ...prev,
                            trackId: track.id,
                          }))
                        }
                      >
                        <span className="track-eq">
                          <i />
                          <i />
                          <i />
                          <i />
                        </span>
                        <span className="track-copy">
                          <b>{track.name}</b>
                          <small>{track.description}</small>
                        </span>
                        <span className="track-bpm">{track.bpm} BPM</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <footer className="settings-footer">
            <button type="button" className="text-btn" onClick={resetActive}>
              恢复本页默认值
            </button>
            <div className="footer-actions">
              <button type="button" className="btn" onClick={cancel}>
                取消
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={apply}
                disabled={activeTab === "control" && !rotationPreview.ok}
                title={
                  activeTab === "control" && !rotationPreview.ok
                    ? "请先修正旋转算法表达式"
                    : undefined
                }
              >
                保存并应用
              </button>
            </div>
          </footer>
        </div>
      </section>
    </div>
  );
}
