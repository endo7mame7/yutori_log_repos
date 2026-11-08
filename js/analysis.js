// 分析（設計書 5. 分析機能仕様）。分析値は保存済み記録から都度算出する。
// 未記録日は欠損（null）として扱い、ゼロで補完しない。
import { CONDITION_METRICS, SERIES, WORKLOAD_LEVELS, overallScore, seriesValue, sleepMinutes } from './model.js';
import { addDays, rangeKeys } from './date.js';

/** これ未満の件数では傾向を判定せず「データ不足」とする */
export const MIN_RECORDS = 3;

export function mean(values) {
  const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  if (v.length === 0) return { avg: null, n: 0 };
  return { avg: v.reduce((a, b) => a + b, 0) / v.length, n: v.length };
}

export function recordsInRange(recordsByDate, endKey, days) {
  return rangeKeys(endKey, days).map((k) => recordsByDate[k]).filter(Boolean);
}

/** グラフ用：日付ごとの各系列の値（未記録は null） */
export function buildSeries(recordsByDate, endKey, days) {
  const dates = rangeKeys(endKey, days);
  const series = {};
  for (const s of SERIES) series[s.key] = dates.map((d) => seriesValue(recordsByDate[d], s.key));
  return { dates, series };
}

export function summarize(recordsByDate, endKey, days) {
  const records = recordsInRange(recordsByDate, endKey, days);
  const prevRecords = recordsInRange(recordsByDate, addDays(endKey, -days), days);

  const overall = mean(records.map(overallScore));
  const prevOverall = mean(prevRecords.map(overallScore));
  const enough = (m) => m.n >= MIN_RECORDS;

  const metrics = {};
  for (const m of CONDITION_METRICS) metrics[m.key] = mean(records.map((r) => r.condition[m.key]));

  const workload = {};
  for (const level of WORKLOAD_LEVELS) {
    const group = records.filter((r) => r.workload.workload_level === level.key);
    workload[level.key] = {
      overall: mean(group.map(overallScore)),
      stress: mean(group.map((r) => r.condition.stress_level)),
    };
  }

  const byType = (type) => records.filter((r) => r.day_type === type);
  const holiday = {
    holiday: mean(byType('holiday').map(overallScore)),
    work: mean(byType('work').map(overallScore)),
    recovery: holidayRecovery(recordsByDate, endKey, days),
  };

  return {
    days,
    count: records.length,
    rate: records.length / days,
    enough: records.length >= MIN_RECORDS,
    overall: {
      ...overall,
      prevAvg: prevOverall.avg,
      prevN: prevOverall.n,
      diff: enough(overall) && enough(prevOverall) ? overall.avg - prevOverall.avg : null,
    },
    metrics,
    sleepMinutes: mean(records.map(sleepMinutes)),
    workload,
    holiday,
  };
}

/**
 * 休日の回復：連続した休日の「直前の勤務日」と「直後の勤務日」の疲労（身体の調子）を比較する。
 * 両方の記録がそろった休日ブロックのみを対象にする。
 */
export function holidayRecovery(recordsByDate, endKey, days) {
  const dates = rangeKeys(endKey, days);
  const pairs = [];
  let i = 0;
  while (i < dates.length) {
    if (recordsByDate[dates[i]]?.day_type !== 'holiday') {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < dates.length && recordsByDate[dates[j + 1]]?.day_type === 'holiday') j++;
    const before = recordsByDate[addDays(dates[i], -1)];
    const after = recordsByDate[addDays(dates[j], 1)];
    const b = before?.day_type === 'work' ? before.condition.physical_condition : null;
    const a = after?.day_type === 'work' ? after.condition.physical_condition : null;
    if (b !== null && a !== null && b !== undefined && a !== undefined) pairs.push({ before: b, after: a });
    i = j + 1;
  }
  return {
    n: pairs.length,
    before: mean(pairs.map((p) => p.before)).avg,
    after: mean(pairs.map((p) => p.after)).avg,
  };
}

export function formatScore(v) {
  return v === null || v === undefined ? '—' : v.toFixed(1);
}

export function formatDiff(v) {
  if (v === null || v === undefined) return '—';
  const r = Math.round(v * 10) / 10;
  if (r === 0) return '±0.0';
  return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(1);
}

export function formatSleep(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}時間${String(m % 60).padStart(2, '0')}分`;
}
