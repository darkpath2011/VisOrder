/**
 * Crosshair.tsx renders the on-screen reticle driven by CrosshairSettings.
 * Ported from aim-trainer-web (MIT); styles stay CSS-variable driven so the
 * settings panel can preview size, thickness, gap, color, and outline live.
 */

"use client";

import type { CSSProperties } from "react";
import type { CrosshairSettings } from "@/lib/aim-trainer/store/crosshair";

type CrosshairProps = {
  /** Live crosshair settings from storage or the settings preview path. */
  settings: CrosshairSettings;
};

/**
 * Crosshair draws the active reticle style centered over the 3D stage.
 * Pointer events are disabled so clicks reach the WebGL canvas for Pointer Lock.
 */
export function Crosshair({ settings }: CrosshairProps) {
  const cssVars = {
    "--ch": settings.color,
    "--ch-size": `${settings.size}px`,
    "--ch-thickness": `${settings.thickness}px`,
    "--ch-gap": `${settings.gap}px`,
    "--ch-dot": `${Math.max(2, Math.round(settings.size * 0.22))}px`,
    "--ch-outline": settings.outline ? "rgba(0, 0, 0, 0.72)" : "transparent",
  } as CSSProperties;

  return (
    <div className="aim-crosshair" style={cssVars}>
      {settings.style === "dot" && <span className="aim-ch aim-ch--dot" />}

      {settings.style === "cross" && (
        <>
          <span className="aim-ch aim-ch--bar aim-ch--bar-h" />
          <span className="aim-ch aim-ch--bar aim-ch--bar-v" />
        </>
      )}

      {settings.style === "hollow-cross" && (
        <>
          <span className="aim-ch aim-ch--line aim-ch--up" />
          <span className="aim-ch aim-ch--line aim-ch--down" />
          <span className="aim-ch aim-ch--line aim-ch--left" />
          <span className="aim-ch aim-ch--line aim-ch--right" />
        </>
      )}

      {settings.style === "ring" && <span className="aim-ch aim-ch--ring" />}

      {settings.style === "ring-dot" && (
        <>
          <span className="aim-ch aim-ch--ring" />
          <span className="aim-ch aim-ch--dot aim-ch--dot-small" />
        </>
      )}
    </div>
  );
}
