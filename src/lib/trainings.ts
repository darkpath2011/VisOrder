/**
 * trainings.ts defines the VisOrder cognitive-drill catalog and shared session types.
 * Each entry carries copy for the picker and a stable id the hub uses to mount the
 * matching drill; result shapes stay minimal so suite progress can summarize any mix.
 */

/** Stable id for one selectable VisOrder drill in the catalog and session queue. */
export type TrainingId =
  | "schulte"
  | "stroop"
  | "number-size"
  | "sequence"
  | "reverse-cue"
  | "gestalt";

/** Catalog metadata shown on the training picker before a session starts. */
export type TrainingMeta = {
  /** Stable catalog key used by TrainingHub routing. */
  id: TrainingId;
  /** Short Chinese title for the picker card. */
  title: string;
  /** One-line skill focus shown under the title. */
  focus: string;
  /** How-to blurb describing the interaction rules. */
  how: string;
  /** Approximate duration label for planning a full suite run. */
  durationHint: string;
};

/** Outcome reported when a single drill finishes inside a suite or solo session. */
export type DrillResult = {
  /** Which catalog drill produced this result. */
  trainingId: TrainingId;
  /** Wall-clock milliseconds from start interaction to completion. */
  durationMs: number;
  /** Optional accuracy ratio in [0, 1] when the drill scores discrete trials. */
  accuracy?: number;
  /** Optional human-readable score line for the suite summary. */
  detail?: string;
};

/**
 * TRAINING_CATALOG lists the six VisOrder drills in the recommended full-suite order.
 * Order matches a typical attention warm-up → inhibition → memory → gestalt progression.
 */
export const TRAINING_CATALOG: readonly TrainingMeta[] = [
  {
    id: "schulte",
    title: "舒尔特方格",
    focus: "视觉搜索＋选择性注意",
    how: "5×5 数字表，按序点出 1→25。每天换布局，熟了就只是背答案。",
    durationHint: "约 30 秒",
  },
  {
    id: "stroop",
    title: "字色干扰",
    focus: "抑制控制（斯特鲁普）",
    how: "彩色汉字 20 个：只答字体颜色，别念字。红色的「绿」要点「红」。",
    durationHint: "约 1 分钟",
  },
  {
    id: "number-size",
    title: "数值干扰",
    focus: "规则战胜视觉显著性",
    how: "字号大小不一的数字，别管字号，按数值从小到大依次点选。",
    durationHint: "约 1 分钟",
  },
  {
    id: "sequence",
    title: "序列记忆",
    focus: "工作记忆＋组块",
    how: "6 样物品依次闪现，连顺序一起复述。可编故事联想，别硬背。",
    durationHint: "约 1 分钟",
  },
  {
    id: "reverse-cue",
    title: "反向线索",
    focus: "让眼睛赢过文字",
    how: "字写「变大」实际在转圈 → 答「转圈」。四种动作：变大、变小、不动、转圈。",
    durationHint: "约 1 分钟",
  },
  {
    id: "gestalt",
    title: "视觉完形",
    focus: "格式塔整体识别",
    how: "左右偏旁抢答拼字（口+乞→吃）。练一眼认出整词，而不是拆零件。",
    durationHint: "约 1 分钟",
  },
] as const;

/**
 * getTrainingMeta resolves catalog copy for a drill id used by the runner chrome.
 * Throws when the id is unknown so suite wiring mistakes surface during development.
 */
export function getTrainingMeta(id: TrainingId): TrainingMeta {
  const found = TRAINING_CATALOG.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Unknown training id: ${id}`);
  }
  return found;
}

/**
 * allTrainingIds returns every catalog id in suite order for the “练完全部” action.
 */
export function allTrainingIds(): TrainingId[] {
  return TRAINING_CATALOG.map((item) => item.id);
}
