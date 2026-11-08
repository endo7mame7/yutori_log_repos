import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isValidDateKey, rangeKeys, toDateKey, weekdayLabel } from '../js/date.js';

test('toDateKey はローカル日付を YYYY-MM-DD で返す', () => {
  assert.equal(toDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('addDays は月・年またぎを扱える', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('rangeKeys は終了日を含む古い順の配列', () => {
  assert.deepEqual(rangeKeys('2026-11-08', 3), ['2026-11-06', '2026-11-07', '2026-11-08']);
  assert.equal(rangeKeys('2026-11-08', 30).length, 30);
});

test('isValidDateKey は存在しない日付を拒否する', () => {
  assert.ok(isValidDateKey('2026-02-28'));
  assert.ok(!isValidDateKey('2026-02-30'));
  assert.ok(!isValidDateKey('2026/02/01'));
  assert.ok(!isValidDateKey(undefined));
});

test('weekdayLabel', () => {
  assert.equal(weekdayLabel('2026-11-08'), '日');
});
