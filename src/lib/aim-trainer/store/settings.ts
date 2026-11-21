/**
 * settings.ts persists aim-trainer control settings local-first, then syncs to
 * aim_settings when signed in. Besides profile + sensitivity, users may store DPI
 * for cm/360 conversion and a custom rotation expression that the engine evaluates
 * when mapping mouse counts to camera yaw. Cloud merge is last-write-wins on
 * updated_at so a single row per user stays consistent across devices.
 */

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  DEFAULT_ROTATION_EXPR,
  evaluateExpression,
  formatExpression,
  rotationScope,
} from "../core/expression";
import { clampDpi } from "../core/gain";
import { clampSensitivity, findProfile } from "./profiles";

/** Control settings: game profile, in-game sens, DPI, and optional rotation formula. */
export interface SensitivitySettings {
  /** Selected GAME_PROFILES id (valorant / cs2 / peace-elite-emulator). */
  profileId: string;
  /** In-game sensitivity slider value for the selected profile. */
  sensitivity: number;
  /**
   * Mouse DPI used for cm/360 / eDPI; null means unset.
   * Calibration and recommend-write paths require a non-null value.
   */
  dpi: number | null;
  /**
   * Math expression returning radians per mouse count.
   * Variables: sens, yaw, fov, pi. Example: sens * yaw * pi / 180
   */
  rotationExpr: string;
}

/** Local envelope stores settings plus an updatedAt clock for cloud LWW merge. */
type SettingsEnvelope = {
  settings: SensitivitySettings;
  /** Unix epoch ms of the last local write used for cloud last-write-wins. */
  updatedAt: number;
};

export const DEFAULT_SETTINGS: SensitivitySettings = {
  profileId: "valorant",
  sensitivity: 1,
  dpi: null,
  rotationExpr: DEFAULT_ROTATION_EXPR,
};

/** localStorage key for control settings (legacy plain object or envelope). */
const KEY = "aim-trainer-web.settings";
/** Cloud table matching supabase/migrations aim_settings. */
const TABLE = "aim_settings";

/** Row shape returned from public.aim_settings selects. */
type CloudSettingsRow = {
  profile_id: string;
  sensitivity: number;
  dpi: number | null;
  rotation_expr: string;
  updated_at: string;
};

/**
 * sanitizeRotationExpr formats when possible and falls back to the default formula.
 * Empty or invalid expressions are replaced so gameplay always has a usable mapping.
 */
export function sanitizeRotationExpr(expr: string | undefined): string {
  const raw = typeof expr === "string" ? expr.trim() : "";
  if (!raw) return DEFAULT_ROTATION_EXPR;
  const formatted = formatExpression(raw);
  if (formatted.ok) return formatted.formatted;
  const probe = evaluateExpression(
    raw,
    rotationScope(1, 0.07, 70.5328004329168),
  );
  return probe.ok ? raw : DEFAULT_ROTATION_EXPR;
}

/**
 * normalizeSettings clamps sensitivity/DPI to valid ranges and sanitizes the formula.
 */
export function normalizeSettings(
  settings: SensitivitySettings,
): SensitivitySettings {
  const profile = findProfile(settings.profileId);
  return {
    profileId: profile.id,
    sensitivity: clampSensitivity(profile, settings.sensitivity),
    dpi: clampDpi(settings.dpi),
    rotationExpr: sanitizeRotationExpr(settings.rotationExpr),
  };
}

/**
 * writeEnvelope replaces the local settings envelope used for LWW cloud merge.
 */
function writeEnvelope(envelope: SettingsEnvelope): SettingsEnvelope {
  const next: SettingsEnvelope = {
    settings: normalizeSettings(envelope.settings),
    updatedAt: envelope.updatedAt,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Persistence failure does not affect the current session.
  }
  return next;
}

/**
 * readEnvelope loads settings plus updatedAt, migrating legacy plain objects.
 * Legacy saves without updatedAt receive Date.now() so the first signed-in push
 * can establish a cloud clock without inventing an older timestamp.
 */
function readEnvelope(): SettingsEnvelope {
  if (typeof window === "undefined") {
    return { settings: { ...DEFAULT_SETTINGS }, updatedAt: 0 };
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { settings: { ...DEFAULT_SETTINGS }, updatedAt: 0 };
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Envelope shape written by the cloud-sync path.
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.settings === "object" &&
      parsed.settings !== null &&
      typeof parsed.updatedAt === "number"
    ) {
      const settings = parsed.settings as Partial<SensitivitySettings>;
      return {
        settings: normalizeSettings({
          profileId:
            typeof settings.profileId === "string"
              ? settings.profileId
              : DEFAULT_SETTINGS.profileId,
          sensitivity:
            typeof settings.sensitivity === "number"
              ? settings.sensitivity
              : DEFAULT_SETTINGS.sensitivity,
          dpi:
            typeof settings.dpi === "number"
              ? settings.dpi
              : settings.dpi === null
                ? null
                : DEFAULT_SETTINGS.dpi,
          rotationExpr:
            typeof settings.rotationExpr === "string"
              ? settings.rotationExpr
              : DEFAULT_SETTINGS.rotationExpr,
        }),
        updatedAt: parsed.updatedAt,
      };
    }

    // Legacy plain SensitivitySettings object.
    const legacy = parsed as Partial<SensitivitySettings>;
    return {
      settings: normalizeSettings({
        profileId:
          typeof legacy.profileId === "string"
            ? legacy.profileId
            : DEFAULT_SETTINGS.profileId,
        sensitivity:
          typeof legacy.sensitivity === "number"
            ? legacy.sensitivity
            : DEFAULT_SETTINGS.sensitivity,
        dpi:
          typeof legacy.dpi === "number"
            ? legacy.dpi
            : legacy.dpi === null
              ? null
              : DEFAULT_SETTINGS.dpi,
        rotationExpr:
          typeof legacy.rotationExpr === "string"
            ? legacy.rotationExpr
            : DEFAULT_SETTINGS.rotationExpr,
      }),
      updatedAt: Date.now(),
    };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, updatedAt: 0 };
  }
}

/**
 * loadSettings reads persisted control settings, filling defaults for older payloads.
 * Older saves without dpi load as null so the UI can prompt before calibration.
 */
export function loadSettings(): SensitivitySettings {
  return readEnvelope().settings;
}

/**
 * toCloudPayload maps local settings into the aim_settings upsert body.
 */
function toCloudPayload(
  settings: SensitivitySettings,
  userId: string,
  updatedAt: number,
) {
  return {
    user_id: userId,
    profile_id: settings.profileId,
    sensitivity: settings.sensitivity,
    dpi: settings.dpi,
    rotation_expr: settings.rotationExpr,
    updated_at: new Date(updatedAt).toISOString(),
  };
}

/**
 * fromCloudRow converts an aim_settings row into a local envelope.
 */
function fromCloudRow(row: CloudSettingsRow): SettingsEnvelope {
  return {
    settings: normalizeSettings({
      profileId: row.profile_id,
      sensitivity: row.sensitivity,
      dpi: row.dpi,
      rotationExpr: row.rotation_expr,
    }),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

/**
 * pushSettingsToCloud upserts the signed-in user's control settings row.
 * No-ops when logged out; swallows network errors so UI saves stay instant.
 */
export async function pushSettingsToCloud(
  settings: SensitivitySettings,
  updatedAt: number,
): Promise<void> {
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from(TABLE)
      .upsert(toCloudPayload(settings, user.id, updatedAt), {
        onConflict: "user_id",
      });
    if (error) {
      console.warn("aim-settings: cloud push failed", error.message);
    }
  } catch (error) {
    console.warn("aim-settings: cloud push unavailable", error);
  }
}

/**
 * saveSettings writes normalized control settings locally then syncs when signed in.
 * Bumps updatedAt so cloud last-write-wins prefers this device's change.
 */
export function saveSettings(settings: SensitivitySettings): void {
  const envelope = writeEnvelope({
    settings: normalizeSettings(settings),
    updatedAt: Date.now(),
  });
  void pushSettingsToCloud(envelope.settings, envelope.updatedAt);
}

/**
 * pullAndMergeSettings downloads cloud settings and applies last-write-wins merge.
 * When local is newer, pushes it; when remote is newer, overwrites local storage.
 * Returns the winning settings object for callers that refresh UI after sign-in.
 */
export async function pullAndMergeSettings(): Promise<SensitivitySettings> {
  const local = readEnvelope();
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return local.settings;

    const { data, error } = await supabase
      .from(TABLE)
      .select("profile_id,sensitivity,dpi,rotation_expr,updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.warn("aim-settings: cloud pull failed", error.message);
      return local.settings;
    }

    if (!data) {
      // No cloud row yet: backfill when the user has non-default local settings
      // or any local write clock so a fresh login still uploads existing DPI/sens.
      if (local.updatedAt > 0) {
        await pushSettingsToCloud(local.settings, local.updatedAt);
      }
      return local.settings;
    }

    const remote = fromCloudRow(data as CloudSettingsRow);
    if (remote.updatedAt > local.updatedAt) {
      writeEnvelope(remote);
      return remote.settings;
    }
    if (local.updatedAt > remote.updatedAt) {
      await pushSettingsToCloud(local.settings, local.updatedAt);
    }
    return local.settings;
  } catch (error) {
    console.warn("aim-settings: merge unavailable", error);
    return local.settings;
  }
}
