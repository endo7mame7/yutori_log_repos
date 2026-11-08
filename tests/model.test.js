import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecord, overallScore, sleepMinutes, validateRecord } from '../js/model.js';

test('評価値は 1〜5 の整数のみ受け付け、それ以外は未入力', () => {
  const r = normalizeRecord({ record_date: '2026-11-08', condition: { mood: '4', stress_level: 0, sleep_quality: 6, physical_condition: 2.5, mental_condition: '' } });
  assert.equal(r.condition.mood, 4);
  assert.equal(r.condition.stress_level, null);
  assert.equal(r.condition.sleep_quality, null);
  assert.equal(r.condition.physical_condition, null);
  assert.equal(r.condition.mental_condition, null);
});

test('総合は記録した項目のみの単純平均、未入力は null', () => {
  assert.equal(overallScore(normalizeRecord({ condition: { mood: 4, stress_level: 2 } })), 3);
  assert.equal(overallScore(normalizeRecord({})), null);
});

test('コンディション項目が1つもないと保存できない', () => {
  assert.equal(validateRecord(normalizeRecord({ record_date: '2026-11-08' })).length, 1);
  assert.deepEqual(validateRecord(normalizeRecord({ record_date: '2026-11-08', condition: { mood: 3 } })), []);
});

test('睡眠時間は片方だけの入力を 0 で補う', () => {
  assert.equal(sleepMinutes(normalizeRecord({ sleep: { hours: '7', minutes: '' } })), 420);
  assert.equal(sleepMinutes(normalizeRecord({ sleep: { hours: '', minutes: '30' } })), 30);
  assert.equal(sleepMinutes(normalizeRecord({ sleep: { hours: '', minutes: '' } })), null);
  assert.equal(normalizeRecord({ sleep: { hours: '25' } }).sleep.hours, null);
});

test('不正な選択肢は null、自由記述は前後の空白を除く', () => {
  const r = normalizeRecord({ day_type: 'x', workload: { workload_level: 'high', overexertion: 'yes' }, notes: { concern_note: '  頭痛  ' } });
  assert.equal(r.day_type, null);
  assert.equal(r.workload.workload_level, 'high');
  assert.equal(r.workload.overexertion, false);
  assert.equal(r.notes.concern_note, '頭痛');
});
