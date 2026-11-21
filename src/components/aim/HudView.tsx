/**
 * HudView.tsx overlays countdown and in-round score stats on the aim stage.
 * Ported from aim-trainer-web (MIT); it is presentational and never owns session state.
 */

"use client";

import type { HudState } from "@/lib/aim-trainer/core/session";

type HudViewProps = {
  /** Latest HUD snapshot pushed by GameSession. */
  hud: HudState;
};

/**
 * HudView shows the center countdown or corner score/time/accuracy readouts.
 * Pointer events stay off so the overlay never steals Pointer Lock clicks.
 */
export function HudView({ hud }: HudViewProps) {
  if (hud.phase === "countdown") {
    return (
      <div className="aim-countdown">{hud.countdown || "GO"}</div>
    );
  }

  if (hud.phase !== "running") {
    return null;
  }

  return (
    <div className="aim-hud">
      <div className="aim-hud__top-right">
        <div className="aim-stat aim-stat--score">
          <span className="aim-stat__label">SCORE</span>
          <span className="aim-stat__value">{hud.score.toLocaleString()}</span>
        </div>
        <div className="aim-stat aim-stat--time">
          <span className="aim-stat__label">TIME</span>
          <span className="aim-stat__value">{hud.timeLeft}</span>
        </div>
      </div>
      <div className="aim-hud__bottom-left">
        <div className="aim-stat">
          <span className="aim-stat__label">ACCURACY</span>
          <span className="aim-stat__value">{hud.accuracy.toFixed(1)}%</span>
        </div>
        <div className="aim-stat">
          <span className="aim-stat__label">SHOTS</span>
          <span className="aim-stat__value">{hud.shots}</span>
        </div>
      </div>
    </div>
  );
}
