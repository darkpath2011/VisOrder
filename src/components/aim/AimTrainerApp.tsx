/**
 * AimTrainerApp.tsx is the React shell for the aim-trainer-web engine.
 * It owns Engine / MusicPlayer lifecycle, menu ↔ game screen transitions,
 * pause / result overlays, sensitivity calibration wizard trials, and wires
 * settings callbacks into the 3D stage. Core gameplay stays under lib/aim-trainer.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Engine } from "@/lib/aim-trainer/core/engine";
import { MusicPlayer } from "@/lib/aim-trainer/core/music";
import { playUiClick } from "@/lib/aim-trainer/core/uiSound";
import type { GameSession, HudState } from "@/lib/aim-trainer/core/session";
import type { ModeConfig } from "@/lib/aim-trainer/modes/types";
import { gridshotConfig } from "@/lib/aim-trainer/modes/gridshot";
import { gridshot3x3Config } from "@/lib/aim-trainer/modes/gridshot3x3";
import { sixshotConfig } from "@/lib/aim-trainer/modes/sixshot";
import { sixshotBeginnerConfig } from "@/lib/aim-trainer/modes/sixshotBeginner";
import {
  modeForVariant,
  pickVariant,
} from "@/lib/aim-trainer/modes/sensFinder";
import {
  applyRecommendationToSettings,
  createCalibRun,
  currentCondition,
  finalizeFit,
  recordHoldoutScore,
  recordSubjective,
  recordTrial,
  trialsComplete,
  type CalibRunState,
} from "@/lib/aim-trainer/calib/orchestrator";
import { scoreTrialObj } from "@/lib/aim-trainer/calib/metrics";
import { checkSensitivityDrift } from "@/lib/aim-trainer/calib/drift";
import type {
  CalibRecommendation,
  TaskFamily,
  TrialMetrics,
} from "@/lib/aim-trainer/calib/types";
import {
  loadAppearance,
  type AppearanceSettings,
} from "@/lib/aim-trainer/store/appearance";
import {
  loadCrosshair,
  type CrosshairSettings,
} from "@/lib/aim-trainer/store/crosshair";
import { findProfile } from "@/lib/aim-trainer/store/profiles";
import { LocalScoreStorage } from "@/lib/aim-trainer/store/scoreStorage";
import {
  loadSettings,
  pullAndMergeSettings,
  saveSettings,
  type SensitivitySettings,
} from "@/lib/aim-trainer/store/settings";
import {
  appendAimSessionLog,
  pullAndMergeAimSessions,
} from "@/lib/aim-trainer/store/sessionLog";
import {
  pullAndMergeRecommendations,
  saveRecommendation,
} from "@/lib/aim-trainer/store/recommendation";
import {
  loadSoundSettings,
  previewSoundSettings,
  saveSoundSettings,
  type SoundSettings,
} from "@/lib/aim-trainer/store/sound";
import {
  CalibrationWizard,
  type CalibrationWizardPhase,
} from "./CalibrationWizard";
import { Crosshair } from "./Crosshair";
import { HudView } from "./HudView";
import { SettingsView, type SettingsTab } from "./SettingsView";
import "./aim.css";

/** Catalog of playable modes shown on the aim trainer menu. */
const MODES: ModeConfig[] = [
  gridshotConfig,
  gridshot3x3Config,
  sixshotBeginnerConfig,
  sixshotConfig,
];

type Screen = "menu" | "game" | "calib";

/** Reports whether two crosshair snapshots match field-for-field. */
function sameCrosshair(a: CrosshairSettings, b: CrosshairSettings): boolean {
  return (
    a.style === b.style &&
    a.color === b.color &&
    a.size === b.size &&
    a.thickness === b.thickness &&
    a.gap === b.gap &&
    a.outline === b.outline
  );
}

/** Reports whether two sound snapshots match field-for-field. */
function sameSound(a: SoundSettings, b: SoundSettings): boolean {
  return (
    a.muted === b.muted &&
    a.musicVolume === b.musicVolume &&
    a.effectsVolume === b.effectsVolume &&
    a.uiVolume === b.uiVolume &&
    a.trackId === b.trackId &&
    a.hitSoundId === b.hitSoundId
  );
}

/**
 * AimTrainerApp mounts the WebGL stage and React overlays for menu, HUD, pause,
 * results, and the sensitivity calibration wizard.
 */
export function AimTrainerApp() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const musicRef = useRef<MusicPlayer | null>(null);
  const scoreStoreRef = useRef(new LocalScoreStorage());
  const startMusicOnGestureRef = useRef<(() => void) | null>(null);
  const calibStateRef = useRef<CalibRunState | null>(null);

  const [screen, setScreen] = useState<Screen>("menu");
  const [selectedMode, setSelectedMode] = useState<ModeConfig | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<HudState | null>(null);
  const [resultBest, setResultBest] = useState<number | null>(null);
  const [resultIsNew, setResultIsNew] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("control");
  const [crosshair, setCrosshair] = useState<CrosshairSettings>(() =>
    loadCrosshair(),
  );
  const [sound, setSound] = useState<SoundSettings>(() => loadSoundSettings());
  const [lockHint, setLockHint] = useState("");

  const [calibOpen, setCalibOpen] = useState(false);
  const [calibPhase, setCalibPhase] =
    useState<CalibrationWizardPhase>("setup");
  const [calibBlockedReason, setCalibBlockedReason] = useState<string | null>(
    null,
  );
  const [calibPendingCm360, setCalibPendingCm360] = useState<number | null>(
    null,
  );
  const [calibProgress, setCalibProgress] = useState<string | null>(null);
  const [calibInTrial, setCalibInTrial] = useState(false);
  const [driftMessage, setDriftMessage] = useState<string | null>(null);
  const [calibRecommendation, setCalibRecommendation] =
    useState<CalibRecommendation | null>(null);

  // Keep latest screen/result for Engine callbacks without rebinding every render.
  const screenRef = useRef(screen);
  const resultRef = useRef(result);
  const calibInTrialRef = useRef(false);
  /** When true, the next pointer-unlock is for a calib UI overlay — skip pause. */
  const ignoreUnlockPauseRef = useRef(false);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);
  useEffect(() => {
    resultRef.current = result;
  }, [result]);
  useEffect(() => {
    calibInTrialRef.current = calibInTrial;
  }, [calibInTrial]);

  useEffect(() => {
    setDriftMessage(checkSensitivityDrift().message);
  }, []);

  useEffect(() => {
    // Pull aim / recommendation / settings cloud rows when a signed-in user opens /aim.
    let active = true;
    void (async () => {
      await Promise.all([
        pullAndMergeAimSessions(),
        pullAndMergeRecommendations(),
        pullAndMergeSettings(),
      ]);
      if (!active) return;
      const synced = loadSettings();
      engineRef.current?.setSensitivity(
        findProfile(synced.profileId),
        synced.sensitivity,
        synced.rotationExpr,
      );
      setDriftMessage(checkSensitivityDrift().message);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const appearanceNow = loadAppearance();
    const soundNow = loadSoundSettings();
    const engine = new Engine(
      container,
      appearanceNow.backgroundId,
      appearanceNow.targetColor,
    );
    const music = new MusicPlayer(soundNow);
    engineRef.current = engine;
    musicRef.current = music;

    music.start();
    const startMusicOnGesture = () => {
      music.start();
      if (startMusicOnGestureRef.current) {
        document.removeEventListener("pointerdown", startMusicOnGestureRef.current);
        document.removeEventListener("keydown", startMusicOnGestureRef.current);
        startMusicOnGestureRef.current = null;
      }
    };
    startMusicOnGestureRef.current = startMusicOnGesture;
    document.addEventListener("pointerdown", startMusicOnGesture);
    document.addEventListener("keydown", startMusicOnGesture);

    const saved = loadSettings();
    engine.setSensitivity(
      findProfile(saved.profileId),
      saved.sensitivity,
      saved.rotationExpr,
    );

    const onDocClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest("button")) {
        playUiClick();
      }
    };
    document.addEventListener("click", onDocClick);

    engine.onLockChange = (locked) => {
      if (locked) {
        ignoreUnlockPauseRef.current = false;
        setLockHint("");
        return;
      }
      // Intentional unlock for comfort / result overlays — do not enter pause.
      if (ignoreUnlockPauseRef.current) {
        ignoreUnlockPauseRef.current = false;
        return;
      }
      if (screenRef.current === "calib" || screenRef.current === "menu") {
        return;
      }
      if (
        (screenRef.current === "game" || calibInTrialRef.current) &&
        !resultRef.current
      ) {
        setPaused(true);
        engine.detach();
      }
    };
    engine.onLockFail = () => {
      if (ignoreUnlockPauseRef.current) return;
      if (screenRef.current === "calib" || screenRef.current === "menu") {
        return;
      }
      if (
        (screenRef.current === "game" || calibInTrialRef.current) &&
        !resultRef.current
      ) {
        setPaused(true);
        engine.detach();
        setLockHint("鼠标锁定失败，请稍候片刻再点击继续");
      }
    };

    return () => {
      if (startMusicOnGestureRef.current) {
        document.removeEventListener(
          "pointerdown",
          startMusicOnGestureRef.current,
        );
        document.removeEventListener("keydown", startMusicOnGestureRef.current);
        startMusicOnGestureRef.current = null;
      }
      disposeSession();
      engine.dispose();
      engineRef.current = null;
      music.dispose();
      musicRef.current = null;
      document.removeEventListener("click", onDocClick);
    };
    // Mount once; screen/result are read via refs in lock callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function disposeSession() {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    engineRef.current?.detach();
  }

  /**
   * releaseCalibPointerLock exits FPS lock before DOM overlays so Likert / result
   * buttons are clickable and mouse movement no longer yaws the camera.
   */
  function releaseCalibPointerLock(): void {
    ignoreUnlockPauseRef.current = true;
    calibInTrialRef.current = false;
    screenRef.current = "calib";
    engineRef.current?.exitLock();
    setPaused(false);
  }

  /**
   * openCalibOverlay switches to a calibration UI phase with the cursor unlocked.
   */
  function openCalibOverlay(phase: CalibrationWizardPhase): void {
    setCalibInTrial(false);
    setScreen("calib");
    setCalibPhase(phase);
    releaseCalibPointerLock();
    restoreUserSensitivity();
  }

  function startGame(mode: ModeConfig) {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    disposeSession();
    musicRef.current?.start();
    setSelectedMode(mode);
    setScreen("game");
    setCalibInTrial(false);
    setPaused(false);
    setResult(null);
    setResultBest(null);
    setResultIsNew(false);
    setHud(null);

    const session = engine.createSession(mode);
    sessionRef.current = session;
    session.onHud = (s) => setHud(s);
    session.onEnd = (s) => {
      const prev = scoreStoreRef.current.getBest(mode.id);
      const isNew = scoreStoreRef.current.saveBest(mode.id, s.score);
      setResultBest(isNew ? s.score : (prev ?? s.score));
      setResultIsNew(prev !== null && isNew);
      setResult(s);
      // L1: persist per-round metrics with the sens/DPI in effect.
      appendAimSessionLog({
        modeId: mode.id,
        score: s.score,
        hits: s.hits,
        shots: s.shots,
        accuracy: s.accuracy,
        avgKillTime: s.avgKillTime,
        completedAt: Date.now(),
        settings: loadSettings(),
      });
      setDriftMessage(checkSensitivityDrift().message);
    };
    session.start();
    engine.requestLock();
  }

  function applyGainForCm360(cm360: number): void {
    const engine = engineRef.current;
    if (!engine) return;
    const settings = loadSettings();
    if (settings.dpi === null) return;
    const profile = findProfile(settings.profileId);
    const next = applyRecommendationToSettings(settings, profile, cm360);
    if (!next) return;
    engine.setSensitivity(profile, next.sensitivity, next.rotationExpr);
  }

  function restoreUserSensitivity(): void {
    const settings = loadSettings();
    engineRef.current?.setSensitivity(
      findProfile(settings.profileId),
      settings.sensitivity,
      settings.rotationExpr,
    );
  }

  function startCalibTrial(): void {
    const engine = engineRef.current;
    const state = calibStateRef.current;
    if (!engine || !state) return;

    const condition = currentCondition(state);
    if (!condition) {
      // Objective trials done → fit then hold-out intro.
      const fitted = finalizeFit(state);
      calibStateRef.current = fitted;
      setCalibRecommendation(fitted.recommendation);
      openCalibOverlay("holdoutIntro");
      return;
    }

    applyGainForCm360(condition.cm360);
    const variant = pickVariant(state.taskFamily);
    const mode = modeForVariant(variant);
    disposeSession();
    setCalibInTrial(true);
    setScreen("game");
    setPaused(false);
    setResult(null);
    setHud(null);
    setCalibProgress(
      `校准试次 ${state.conditionIndex + 1}/${state.conditions.length}`,
    );

    const session = engine.createSession(mode, { kinematics: true });
    sessionRef.current = session;
    session.onHud = (s) => setHud(s);
    session.onEnd = (s) => {
      const trial: TrialMetrics = {
        conditionId: condition.id,
        cm360: condition.cm360,
        variant,
        hits: s.hits,
        shots: s.shots,
        accuracy: s.accuracy,
        avgKillTime: s.avgKillTime,
        meanOvershootDeg: s.meanOvershootDeg ?? 0,
        meanReversals: s.meanReversals ?? 0,
        durationSec: mode.duration,
      };
      const next = recordTrial(calibStateRef.current!, trial);
      calibStateRef.current = next;
      disposeSession();

      if (next.pendingSubjectiveCm360 !== null) {
        setCalibPendingCm360(next.pendingSubjectiveCm360);
        openCalibOverlay("subjective");
        return;
      }

      if (trialsComplete(next)) {
        const fitted = finalizeFit(next);
        calibStateRef.current = fitted;
        setCalibRecommendation(fitted.recommendation);
        openCalibOverlay("holdoutIntro");
        return;
      }

      // Chain next condition without returning to menu.
      startCalibTrial();
    };
    session.start();
    engine.requestLock();
  }

  function startHoldoutTrial(): void {
    const engine = engineRef.current;
    const state = calibStateRef.current;
    if (!engine || !state) return;

    if (state.holdoutIndex >= state.holdoutLevels.length) {
      openCalibOverlay("result");
      return;
    }

    const cm360 = state.holdoutLevels[state.holdoutIndex];
    applyGainForCm360(cm360);
    const variant = pickVariant(state.taskFamily);
    const mode = modeForVariant(variant);
    disposeSession();
    setCalibInTrial(true);
    setScreen("game");
    setPaused(false);
    setResult(null);
    setHud(null);
    setCalibProgress(
      `验证 ${state.holdoutIndex + 1}/${state.holdoutLevels.length}`,
    );

    const session = engine.createSession(mode, { kinematics: true });
    sessionRef.current = session;
    session.onHud = (s) => setHud(s);
    session.onEnd = (s) => {
      const trial: TrialMetrics = {
        conditionId: `holdout-${state.holdoutIndex}`,
        cm360,
        variant,
        hits: s.hits,
        shots: s.shots,
        accuracy: s.accuracy,
        avgKillTime: s.avgKillTime,
        meanOvershootDeg: s.meanOvershootDeg ?? 0,
        meanReversals: s.meanReversals ?? 0,
        durationSec: mode.duration,
      };
      const sObj = scoreTrialObj(trial);
      const next = recordHoldoutScore(calibStateRef.current!, sObj);
      calibStateRef.current = next;
      disposeSession();

      if (next.holdoutIndex >= next.holdoutLevels.length) {
        setCalibRecommendation(next.recommendation);
        openCalibOverlay("result");
        return;
      }
      startHoldoutTrial();
    };
    session.start();
    engine.requestLock();
  }

  function openCalibration(): void {
    setSettingsOpen(false);
    setCalibOpen(true);
    setCalibBlockedReason(null);
    setCalibPendingCm360(null);
    setCalibRecommendation(null);
    calibStateRef.current = null;
    openCalibOverlay("setup");
  }

  function closeCalibration(): void {
    disposeSession();
    releaseCalibPointerLock();
    setCalibOpen(false);
    setCalibInTrial(false);
    setCalibPhase("setup");
    setScreen("menu");
    restoreUserSensitivity();
    setDriftMessage(checkSensitivityDrift().message);
  }

  function handleCalibStart(input: {
    taskFamily: TaskFamily;
    forceDespiteDefer: boolean;
  }): void {
    const settings = loadSettings();
    const created = createCalibRun({
      settings,
      profile: findProfile(settings.profileId),
      taskFamily: input.taskFamily,
      forceDespiteDefer: input.forceDespiteDefer,
    });
    if (!created.ok) {
      setCalibBlockedReason(created.reason);
      setCalibPhase("blocked");
      return;
    }
    calibStateRef.current = created.state;
    startCalibTrial();
  }

  function handleSubjective(comfort: number): void {
    if (!calibStateRef.current) return;
    const next = recordSubjective(calibStateRef.current, comfort);
    calibStateRef.current = next;
    setCalibPendingCm360(null);
    if (trialsComplete(next)) {
      const fitted = finalizeFit(next);
      calibStateRef.current = fitted;
      setCalibRecommendation(fitted.recommendation);
      setCalibPhase("holdoutIntro");
      return;
    }
    startCalibTrial();
  }

  function handleApplyRecommendation(): void {
    const rec = calibStateRef.current?.recommendation;
    if (!rec) return;
    const settings = loadSettings();
    if (settings.dpi === null) return;
    const profile = findProfile(settings.profileId);
    const next = applyRecommendationToSettings(settings, profile, rec.cm360);
    if (!next) return;
    saveSettings(next);
    engineRef.current?.setSensitivity(
      profile,
      next.sensitivity,
      next.rotationExpr,
    );
    saveRecommendation({
      cm360: rec.cm360,
      cm360Low: rec.cm360Low,
      cm360High: rec.cm360High,
      profileIdAtFit: settings.profileId,
      dpi: settings.dpi,
      taskFamily: rec.taskFamily,
      sObj: rec.sObj,
      sSub: rec.sSub,
      verified: rec.verified,
      createdAt: Date.now(),
      confidence: rec.confidence,
    });
    closeCalibration();
  }

  function resume() {
    setLockHint("");
    setPaused(false);
    if (sessionRef.current) {
      engineRef.current?.attach(sessionRef.current);
    }
    engineRef.current?.requestLock();
  }

  function restart() {
    if (calibInTrial && calibStateRef.current) {
      const state = calibStateRef.current;
      const inHoldout =
        state.recommendation !== null &&
        state.holdoutLevels.length > 0 &&
        state.holdoutIndex < state.holdoutLevels.length;
      if (inHoldout) {
        startHoldoutTrial();
        return;
      }
      startCalibTrial();
      return;
    }
    if (selectedMode) {
      startGame(selectedMode);
    }
  }

  function backToMenu() {
    disposeSession();
    setScreen("menu");
    setPaused(false);
    setResult(null);
    setResultBest(null);
    setResultIsNew(false);
    setSettingsOpen(false);
    setHud(null);
    setSelectedMode(null);
    setCalibInTrial(false);
    if (calibOpen) {
      closeCalibration();
    }
  }

  function openSettings(tab: SettingsTab = "control") {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  function toggleMute() {
    setSound((prev) => {
      const next = { ...prev, muted: !prev.muted };
      saveSoundSettings(next);
      musicRef.current?.applySettings(next);
      return next;
    });
  }

  const applyCrosshair = useCallback((s: CrosshairSettings) => {
    setCrosshair((prev) => (sameCrosshair(prev, s) ? prev : s));
  }, []);

  const applyAppearance = useCallback((s: AppearanceSettings) => {
    engineRef.current?.setBackground(s.backgroundId);
    engineRef.current?.setTargetColor(s.targetColor);
  }, []);

  const applySound = useCallback((s: SoundSettings) => {
    setSound((prev) => {
      if (sameSound(prev, s)) return prev;
      musicRef.current?.applySettings(s);
      return s;
    });
  }, []);

  const previewSound = useCallback((s: SoundSettings) => {
    previewSoundSettings(s);
    musicRef.current?.applySettings(s);
    musicRef.current?.start();
    setSound((prev) => (sameSound(prev, s) ? prev : s));
  }, []);

  const applySettings = useCallback((s: SensitivitySettings) => {
    engineRef.current?.setSensitivity(
      findProfile(s.profileId),
      s.sensitivity,
      s.rotationExpr,
    );
  }, []);

  const showCalibWizard =
    calibOpen &&
    !calibInTrial &&
    !paused &&
    (calibPhase === "setup" ||
      calibPhase === "blocked" ||
      calibPhase === "subjective" ||
      calibPhase === "holdoutIntro" ||
      calibPhase === "result");

  return (
    <div className="aim-viewport">
      <div ref={containerRef} className="aim-stage" />

      {(screen === "game" || calibInTrial) && !paused && !result && (
        <Crosshair settings={crosshair} />
      )}
      {(screen === "game" || calibInTrial) && hud && <HudView hud={hud} />}
      {calibInTrial && calibProgress && !paused && !result && (
        <div className="aim-calib-hud-progress">{calibProgress}</div>
      )}

      {settingsOpen && (
        <SettingsView
          initialTab={settingsTab}
          onApplySensitivity={applySettings}
          onApplyCrosshair={applyCrosshair}
          onApplyAppearance={applyAppearance}
          onApplySound={applySound}
          onPreviewCrosshair={applyCrosshair}
          onPreviewSound={previewSound}
          onClose={closeSettings}
          onOpenCalibration={openCalibration}
        />
      )}

      {showCalibWizard && (
        <CalibrationWizard
          phase={calibPhase}
          pendingCm360={calibPendingCm360}
          recommendation={calibRecommendation}
          blockedReason={calibBlockedReason}
          progressLabel={calibProgress}
          onStart={handleCalibStart}
          onSubjective={handleSubjective}
          onContinueHoldout={() => startHoldoutTrial()}
          onApply={handleApplyRecommendation}
          onClose={closeCalibration}
        />
      )}

      {screen === "menu" && !calibOpen && (
        <div className="aim-menu">
          <button
            type="button"
            className="aim-mute-btn"
            title={sound.muted ? "开启声音" : "静音"}
            onClick={toggleMute}
          >
            <span
              className={
                sound.muted
                  ? "aim-sound-bars aim-sound-bars--muted"
                  : "aim-sound-bars"
              }
            >
              <i />
              <i />
              <i />
            </span>
          </button>
          <div className="aim-menu-inner">
            <div className="aim-logo">
              <h1>
                AIM<span className="aim-accent">TRAINER</span>
                <span className="aim-web">WEB</span>
              </h1>
              <p className="aim-tagline">在线 FPS 练枪 · 无需下载</p>
            </div>

            {driftMessage ? (
              <div className="aim-drift-banner" role="status">
                <p>{driftMessage}</p>
                <button
                  type="button"
                  className="aim-btn aim-btn--primary"
                  onClick={openCalibration}
                >
                  复测灵敏度
                </button>
              </div>
            ) : null}

            <div className="aim-modes">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="aim-mode-card"
                  onClick={() => startGame(m)}
                >
                  <span className="aim-mode-name">{m.name}</span>
                  <span className="aim-mode-detail">
                    {m.nameEn} · {m.duration}s
                  </span>
                </button>
              ))}
            </div>
            <div className="aim-menu-actions">
              <button
                type="button"
                className="aim-cta"
                onClick={() => openSettings("control")}
              >
                游戏设置
              </button>
              <button
                type="button"
                className="aim-cta aim-cta--secondary"
                onClick={openCalibration}
              >
                灵敏度校准
              </button>
            </div>
            <p className="aim-hint">
              点击模式开始 · 锁定鼠标后移动视角，左键射击 · Esc 暂停
            </p>
            <p className="aim-credit">
              基于{" "}
              <a
                href="https://github.com/jiao329/aim-trainer-web"
                target="_blank"
                rel="noreferrer"
              >
                aim-trainer-web
              </a>
            </p>
          </div>
        </div>
      )}

      {paused && (
        <div className="aim-overlay">
          <div className="aim-panel">
            <h2>已暂停</h2>
            {lockHint ? <p className="aim-lock-hint">{lockHint}</p> : null}
            <div className="aim-panel-actions">
              <button type="button" className="aim-btn aim-btn--primary" onClick={resume}>
                继续
              </button>
              <button type="button" className="aim-btn" onClick={restart}>
                重新开始
              </button>
              {!calibInTrial && (
                <button
                  type="button"
                  className="aim-btn"
                  onClick={() => openSettings("control")}
                >
                  设置
                </button>
              )}
              <button type="button" className="aim-btn" onClick={backToMenu}>
                返回菜单
              </button>
            </div>
          </div>
        </div>
      )}

      {result && !calibInTrial && (
        <div className="aim-overlay">
          <div className="aim-panel">
            <div className="aim-grade-wrap">
              <span className="aim-score-main">
                {result.score.toLocaleString()}
              </span>
              {resultIsNew ? (
                <span className="aim-new-record">NEW RECORD</span>
              ) : null}
            </div>
            <h2 className="aim-result-title">结算</h2>
            <div className="aim-result-stats">
              <div className="aim-rs">
                <span className="aim-rs__label">HITS</span>
                <span className="aim-rs__value">{result.hits}</span>
              </div>
              <div className="aim-rs">
                <span className="aim-rs__label">ACCURACY</span>
                <span className="aim-rs__value">
                  {result.accuracy.toFixed(1)}%
                </span>
              </div>
              <div className="aim-rs">
                <span className="aim-rs__label">AVG KILL TIME</span>
                <span className="aim-rs__value">
                  {result.avgKillTime === null
                    ? "—"
                    : `${result.avgKillTime.toFixed(2)}s`}
                </span>
              </div>
            </div>
            <div className="aim-best-line">
              BEST{" "}
              <b>
                {resultBest !== null ? resultBest.toLocaleString() : "—"}
              </b>
            </div>
            <div className="aim-panel-actions">
              <button
                type="button"
                className="aim-btn aim-btn--primary"
                onClick={restart}
              >
                再来一局
              </button>
              <button type="button" className="aim-btn" onClick={backToMenu}>
                返回菜单
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
