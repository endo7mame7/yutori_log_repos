// データモデル定義（設計書 6. データ設計）。
// すべての評価値は 1〜5 で「5＝良好、1＝不調」に統一する。

export const SCHEMA_VERSION = 1;

/** コンディション項目（Condition）。総合スコアの算出対象。 */
export const CONDITION_METRICS = [
  { key: 'sleep_quality', label: '睡眠の質', short: '睡眠', low: 'ほとんど眠れなかった', high: 'ぐっすり眠れた' },
  { key: 'physical_condition', label: '身体の調子（疲労の少なさ）', short: '疲労', low: '強い疲れがある', high: '疲れはほぼない' },
  { key: 'mental_condition', label: '精神的な余裕', short: '精神', low: '余裕がない', high: '余裕がある' },
  { key: 'mood', label: '今日の気分', short: '気分', low: 'かなり落ち込んだ', high: 'とても良い' },
  { key: 'stress_level', label: 'ストレスの少なさ', short: 'ストレス', low: '強いストレス', high: 'ほぼ感じない' },
];

/** 仕事に関する 1〜5 評価（Workload） */
export const WORK_RATINGS = [
  { key: 'burden', label: '負担感の少なさ', short: '負担感', low: '負担がとても大きい', high: '負担はほぼない' },
  { key: 'concentration', label: '集中しやすさ', short: '集中', low: '集中できなかった', high: 'よく集中できた' },
];

export const WORKLOAD_LEVELS = [
  { key: 'low', label: '少ない' },
  { key: 'ok', label: '適切' },
  { key: 'high', label: '多い' },
];

export const DAY_TYPES = [
  { key: 'work', label: '勤務日' },
  { key: 'holiday', label: '休日' },
];

/** 自由記述（LifeNote）。すべて任意。 */
export const NOTE_FIELDS = [
  { key: 'support_note', label: '困りごと・相談したいこと', placeholder: '誰かに相談したいこと、困っていること' },
  { key: 'rest_note', label: '休息・家庭での時間', placeholder: '休めた時間、家族と過ごした時間など' },
  { key: 'achievement_note', label: '今日できたこと', placeholder: '小さなことでも大丈夫です' },
  { key: 'concern_note', label: '気になったこと', placeholder: '体調や気持ちで気になったこと' },
  { key: 'tomorrow_note', label: '明日気をつけたいこと', placeholder: '明日試したいこと、気をつけたいこと' },
];

/** グラフの系列。色は画面間で固定する（設計書 5.1）。 */
export const SERIES = [
  { key: 'overall', label: '総合', color: 'var(--s-overall)' },
  { key: 'sleep_quality', label: '睡眠', color: 'var(--s-sleep)' },
  { key: 'physical_condition', label: '疲労', color: 'var(--s-physical)' },
  { key: 'stress_level', label: 'ストレス', color: 'var(--s-stress)' },
  { key: 'mood', label: '気分', color: 'var(--s-mood)' },
  { key: 'mental_condition', label: '精神', color: 'var(--s-mental)' },
];

export const DEFAULT_SETTINGS = {
  reminder_time: '21:00',
  reminder_enabled: true,
  enabled_metrics: CONDITION_METRICS.map((m) => m.key),
  theme: 'auto',
  export_preferences: { format: 'json' },
};

export function normalizeRating(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function normalizeInt(value, min, max) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i >= min && i <= max ? i : null;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().slice(0, 2000) : '';
}

function pickKey(value, options) {
  return options.some((o) => o.key === value) ? value : null;
}

export function createEmptyRecord(date) {
  return normalizeRecord({ record_date: date });
}

/** 入力値を検証済みの DailyRecord に整える。 */
export function normalizeRecord(input = {}) {
  const condition = {};
  for (const m of CONDITION_METRICS) condition[m.key] = normalizeRating(input.condition?.[m.key]);

  const w = input.workload ?? {};
  const workload = {
    workload_level: pickKey(w.workload_level, WORKLOAD_LEVELS),
    burden: normalizeRating(w.burden),
    concentration: normalizeRating(w.concentration),
    overexertion: w.overexertion === true,
  };

  const notes = {};
  for (const f of NOTE_FIELDS) notes[f.key] = normalizeText(input.notes?.[f.key]);

  const sleepH = normalizeInt(input.sleep?.hours, 0, 24);
  const sleepM = normalizeInt(input.sleep?.minutes, 0, 59);
  const sleep = {
    hours: sleepH === null && sleepM !== null ? 0 : sleepH,
    minutes: sleepM === null && sleepH !== null ? 0 : sleepM,
  };
  if (sleep.hours === 24) sleep.minutes = 0;

  return {
    id: typeof input.id === 'string' ? input.id : null,
    record_date: input.record_date,
    created_at: input.created_at ?? null,
    updated_at: input.updated_at ?? null,
    day_type: pickKey(input.day_type, DAY_TYPES),
    sleep,
    condition,
    workload,
    notes,
  };
}

/** 保存に必要な条件（コンディション項目を1つ以上評価）を満たすか */
export function validateRecord(record) {
  const errors = [];
  if (!record.record_date) errors.push('日付を選んでください。');
  const hasRating = CONDITION_METRICS.some((m) => record.condition[m.key] !== null);
  if (!hasRating) errors.push('コンディション項目を1つ以上選んでください。');
  return errors;
}

/**
 * 総合コンディション：記録されたコンディション項目の単純平均（設計書 9-5 の初期案）。
 * 1項目も記録がなければ null（欠損）。
 */
export function overallScore(record) {
  const values = CONDITION_METRICS.map((m) => record.condition?.[m.key]).filter((v) => v !== null && v !== undefined);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function sleepMinutes(record) {
  const { hours, minutes } = record.sleep ?? {};
  if (hours === null || hours === undefined) return null;
  return hours * 60 + (minutes ?? 0);
}

/** グラフ・分析で使う系列値を取り出す */
export function seriesValue(record, key) {
  if (!record) return null;
  if (key === 'overall') return overallScore(record);
  return record.condition?.[key] ?? null;
}
