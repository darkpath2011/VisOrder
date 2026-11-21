/**
 * visorder-events.ts defines the shared source tag for VisOrder performance events.
 * Aim sessions, cognitive drills, and sensitivity calibration all stamp `source` so
 * recommenders can route data into prior / gain / gate slots without mixing signals.
 */

/** Origin of a persisted performance event used by sensitivity estimation. */
export type VisOrderEventSource = "aim" | "drill" | "calib";
