import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeries, formatDiff, holidayRecovery, summarize } from '../js/analysis.js';
import { normalizeRecord } from '../js/model.js';
import { segments } from '../js/chart.js';

function db(list) {
  const out = {};
  for (const r of list) out[r.record_date] = normalizeRecord(r);
  return out;
}

test('未記録日は null のまま（ゼロ補完しない）', () => {
  const data = buildSeries(db([{ record_date: '2026-11-08', condition: { sleep_quality: 4, mood: 2 } }]), '2026-11-08', 7);
  assert.equal(data.dates.length, 7);
  assert.deepEqual(data.series.sleep_quality, [null, null, null, null, null, null, 4]);
  assert.equal(data.series.overall[6], 3);
});

test('記録が3件未満なら傾向を判定しない', () => {
  const s = summarize(db([
    { record_date: '2026-11-07', condition: { mood: 4 } },
    { record_date: '2026-11-08', condition: { mood: 2 } },
  ]), '2026-11-08', 7);
  assert.equal(s.count, 2);
  assert.equal(s.enough, false);
  assert.equal(s.overall.diff, null);
});

test('平均・前期間との差・記録率', () => {
  const list = [];
  for (let d = 1; d <= 7; d++) list.push({ record_date: `2026-11-0${d}`, condition: { mood: 2 } });
  list.push({ record_date: '2026-11-08', condition: { mood: 4 } });
  list.push({ record_date: '2026-11-09', condition: { mood: 4 } });
  list.push({ record_date: '2026-11-10', condition: { mood: 4 } });
  const s = summarize(db(list), '2026-11-10', 3);
  assert.equal(s.overall.avg, 4);
  assert.equal(s.overall.prevAvg, 2);
  assert.equal(s.overall.diff, 2);
  assert.equal(s.rate, 1);
});

test('業務量区分ごとの平均', () => {
  const s = summarize(db([
    { record_date: '2026-11-06', condition: { stress_level: 2 }, workload: { workload_level: 'high' } },
    { record_date: '2026-11-07', condition: { stress_level: 1 }, workload: { workload_level: 'high' } },
    { record_date: '2026-11-08', condition: { stress_level: 5 }, workload: { workload_level: 'ok' } },
  ]), '2026-11-08', 7);
  assert.equal(s.workload.high.stress.avg, 1.5);
  assert.equal(s.workload.high.stress.n, 2);
  assert.equal(s.workload.ok.stress.avg, 5);
  assert.equal(s.workload.low.overall.n, 0);
});

test('休日の回復：連休の前後の勤務日の疲労を比較する', () => {
  const r = holidayRecovery(db([
    { record_date: '2026-11-06', day_type: 'work', condition: { physical_condition: 2 } },
    { record_date: '2026-11-07', day_type: 'holiday', condition: { physical_condition: 3 } },
    { record_date: '2026-11-08', day_type: 'holiday', condition: { physical_condition: 4 } },
    { record_date: '2026-11-09', day_type: 'work', condition: { physical_condition: 4 } },
  ]), '2026-11-09', 7);
  assert.deepEqual(r, { n: 1, before: 2, after: 4 });
});

test('グラフは欠損で線を区切る', () => {
  const segs = segments([{ v: 1 }, { v: 2 }, { v: null }, { v: 3 }]);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].length, 2);
});

test('formatDiff', () => {
  assert.equal(formatDiff(0.04), '±0.0');
  assert.equal(formatDiff(-0.56), '−0.6');
  assert.equal(formatDiff(1), '+1.0');
  assert.equal(formatDiff(null), '—');
});
