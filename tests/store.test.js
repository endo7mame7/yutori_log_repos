import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { memoryStorage, rec } from './helpers.js';

test('保存した記録は再読み込み後も保持される（Phase 1 完了条件）', () => {
  const storage = memoryStorage();
  const a = createStore({ storage });
  a.saveRecord(rec('2026-11-08', { mood: 4 }));
  const b = createStore({ storage });
  assert.equal(b.getRecord('2026-11-08').condition.mood, 4);
  assert.equal(b.listRecords().length, 1);
});

test('同じ日付は1件で、編集時に id と created_at を保つ', () => {
  let t = 0;
  const store = createStore({ storage: memoryStorage(), now: () => new Date(Date.UTC(2026, 10, 8, 0, 0, t++)) });
  const first = store.saveRecord(rec('2026-11-08', { mood: 2 }));
  const second = store.saveRecord(rec('2026-11-08', { mood: 5 }));
  assert.equal(store.listRecords().length, 1);
  assert.equal(second.id, first.id);
  assert.equal(second.created_at, first.created_at);
  assert.notEqual(second.updated_at, first.updated_at);
  assert.equal(store.getRecord('2026-11-08').condition.mood, 5);
});

test('一覧は新しい日付順、削除できる', () => {
  const store = createStore({ storage: memoryStorage() });
  store.saveRecord(rec('2026-11-06', { mood: 3 }));
  store.saveRecord(rec('2026-11-08', { mood: 3 }));
  store.saveRecord(rec('2026-11-07', { mood: 3 }));
  assert.deepEqual(store.listRecords().map((r) => r.record_date), ['2026-11-08', '2026-11-07', '2026-11-06']);
  store.deleteRecord('2026-11-07');
  assert.equal(store.getRecord('2026-11-07'), null);
});

test('下書きは保存すると消える', () => {
  const store = createStore({ storage: memoryStorage() });
  store.saveDraft('2026-11-08', { condition: { mood: 1 } });
  assert.ok(store.getDraft('2026-11-08'));
  store.saveRecord(rec('2026-11-08', { mood: 2 }));
  assert.equal(store.getDraft('2026-11-08'), null);
});

test('設定は正規化され、項目は最低1つ有効', () => {
  const store = createStore({ storage: memoryStorage() });
  const s = store.saveSettings({ enabled_metrics: [], reminder_time: 'bad', theme: 'neon' });
  assert.equal(s.enabled_metrics.length, 5);
  assert.equal(s.reminder_time, '21:00');
  assert.equal(s.theme, 'auto');
});

test('JSON エクスポート → インポートで復元でき、新しい方を残す', () => {
  const src = createStore({ storage: memoryStorage(), now: () => new Date('2026-11-08T10:00:00Z') });
  src.saveRecord(rec('2026-11-07', { mood: 4 }, { notes: { concern_note: 'メモ' } }));
  src.saveRecord(rec('2026-11-08', { mood: 5 }));
  const json = src.exportJSON();

  const dst = createStore({ storage: memoryStorage(), now: () => new Date('2026-11-09T10:00:00Z') });
  dst.saveRecord(rec('2026-11-08', { mood: 1 })); // こちらが新しい
  const result = dst.importJSON(json);
  assert.deepEqual(result, { added: 1, updated: 0, skipped: 1 });
  assert.equal(dst.getRecord('2026-11-07').notes.concern_note, 'メモ');
  assert.equal(dst.getRecord('2026-11-08').condition.mood, 1);
});

test('他形式のファイルは取り込まない', () => {
  const store = createStore({ storage: memoryStorage() });
  assert.throws(() => store.importJSON('{"records":[]}'), /エクスポートファイルではありません/);
});

test('CSV はカンマや改行を含むメモをエスケープする', () => {
  const store = createStore({ storage: memoryStorage() });
  store.saveRecord(rec('2026-11-08', { mood: 4, stress_level: 2 }, { notes: { concern_note: 'a,"b"\nc' } }));
  const csv = store.exportCSV();
  assert.ok(csv.startsWith('﻿日付,'));
  assert.ok(csv.includes('"a,""b""\nc"'));
  assert.ok(csv.includes(',3.00,'));
});

test('壊れた保存データでも起動できる', () => {
  const storage = memoryStorage();
  storage.setItem('yutori-log:v1', '{broken');
  const store = createStore({ storage });
  assert.equal(store.listRecords().length, 0);
});
