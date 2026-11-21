/**
 * types.ts defines sensitivity-calibration domain types for VisOrder sens-finder.
 * Objective and subjective scores stay separate so the UI can show S_obj*, S_sub*,
 * and the band-constrained recommendation without collapsing them into one black box.
 */

/** Task-family weights for aggregating Fitts variants during calibration. */
export type TaskFamily = "balanced" | "flick" | "micro";

/** One gain condition expressed in physical cm/360 space. */
export type GainCondition = {
  /** Unique id within a run (includes repeat index). */
  id: string;
  /** Physical cm/360 for this condition. */
  cm360: number;
  /** Repeat index starting at 0. */
  repeat: number;
};

/** Fitts-style target difficulty variant used inside a short trial. */
export type FittsVariant = "farLarge" | "farSmall" | "nearSmall";

/** Per-trial objective metrics collected during a sens-finder block. */
export type TrialMetrics = {
  /** Condition id this trial belonged to. */
  conditionId: string;
  /** cm/360 used while recording. */
  cm360: number;
  /** Fitts variant tag for task-family weighting. */
  variant: FittsVariant;
  /** Hits during the short trial. */
  hits: number;
  /** Shots during the short trial. */
  shots: number;
  /** Accuracy percent 0–100. */
  accuracy: number;
  /** Mean kill time in seconds; null when no hits. */
  avgKillTime: number | null;
  /** Mean absolute overshoot angle in degrees (past target bearing). */
  meanOvershootDeg: number;
  /** Mean direction-reversal count per kill during aiming. */
  meanReversals: number;
  /** Wall duration of the trial in seconds. */
  durationSec: number;
};

/** Subjective rating collected after all repeats of one cm/360 level. */
export type SubjectiveRating = {
  /** cm/360 level that was just played. */
  cm360: number;
  /** Comfort Likert 1–5. */
  comfort: number;
};

/** Aggregated dual scores for one unique cm/360 level. */
export type GainScore = {
  cm360: number;
  /** Objective composite in roughly [0, 1] (higher is better). */
  sObj: number;
  /** Subjective comfort normalized to [0, 1]; null until rated. */
  sSub: number | null;
  /** Number of objective trials contributing. */
  nTrials: number;
};

/** Final recommendation produced by fit + hold-out. */
export type CalibRecommendation = {
  cm360: number;
  cm360Low: number;
  cm360High: number;
  /** Pure objective peak. */
  cm360ObjBest: number;
  /** Pure subjective peak (falls back to obj when unrated). */
  cm360SubBest: number;
  sObj: number;
  sSub: number;
  verified: boolean;
  confidence: number;
  taskFamily: TaskFamily;
  explanation: string;
};

/** Orchestrator phase names for the calibration wizard UI. */
export type CalibPhase =
  | "setup"
  | "trial"
  | "subjective"
  | "fitting"
  | "holdout"
  | "result"
  | "blocked";
