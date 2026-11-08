// 端末内保存（localStorage）。記録は日付ごとに1件。
import { CONDITION_METRICS, DEFAULT_SETTINGS, NOTE_FIELDS, SCHEMA_VERSION, WORK_RATINGS, WORKLOAD_LEVELS, DAY_TYPES, normalizeRecord, overallScore, sleepMinutes } from './model.js';
import { isValidDateKey } from './date.js';

const STORAGE_KEY = 'yutori-log:v1';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/** localStorage が使えるか確認し、使えなければメモリ上の保存に切り替える */
export function detectStorage() {
  try {
    const s = globalThis.localStorage;
    const probe = '__yutori_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return { storage: s, persistent: true };
  } catch {
    return { storage: memoryStorage(), persistent: false };
  }
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyState() {
  return { version: SCHEMA_VERSION, records: {}, settings: { ...DEFAULT_SETTINGS }, drafts: {} };
}

function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  if (typeof s.reminder_time !== 'string' || !/^\d{2}:\d{2}$/.test(s.reminder_time)) s.reminder_time = DEFAULT_SETTINGS.reminder_time;
  s.reminder_enabled = s.reminder_enabled !== false;
  const valid = CONDITION_METRICS.map((m) => m.key);
  const enabled = Array.isArray(s.enabled_metrics) ? s.enabled_metrics.filter((k) => valid.includes(k)) : [];
  s.enabled_metrics = enabled.length ? valid.filter((k) => enabled.includes(k)) : [...valid];
  if (!['auto', 'light', 'dark'].includes(s.theme)) s.theme = 'auto';
  return s;
}

export function createStore({ storage, persistent = true, now = () => new Date() } = {}) {
  if (!storage) ({ storage, persistent } = detectStorage());
  let state = load();

  function load() {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      const s = emptyState();
      for (const [date, rec] of Object.entries(parsed.records ?? {})) {
        if (isValidDateKey(date)) s.records[date] = normalizeRecord({ ...rec, record_date: date });
      }
      s.settings = normalizeSettings(parsed.settings);
      s.drafts = typeof parsed.drafts === 'object' && parsed.drafts ? parsed.drafts : {};
      return s;
    } catch {
      return emptyState();
    }
  }

  function persist() {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  return {
    get persistent() {
      return persistent;
    },

    getRecord(date) {
      return state.records[date] ?? null;
    },

    /** 新しい日付順 */
    listRecords() {
      return Object.values(state.records).sort((a, b) => (a.record_date < b.record_date ? 1 : -1));
    },

    recordsByDate() {
      return state.records;
    },

    saveRecord(input) {
      if (!isValidDateKey(input.record_date)) throw new Error('invalid date');
      const existing = state.records[input.record_date];
      const stamp = now().toISOString();
      const rec = normalizeRecord({
        ...input,
        id: existing?.id ?? input.id ?? newId(),
        created_at: existing?.created_at ?? stamp,
        updated_at: stamp,
      });
      state.records[rec.record_date] = rec;
      delete state.drafts[rec.record_date];
      if (!persist()) throw new Error('保存に失敗しました。端末の空き容量を確認してください。');
      return rec;
    },

    deleteRecord(date) {
      delete state.records[date];
      delete state.drafts[date];
      persist();
    },

    getSettings() {
      return { ...state.settings };
    },

    saveSettings(patch) {
      state.settings = normalizeSettings({ ...state.settings, ...patch });
      persist();
      return { ...state.settings };
    },

    getDraft(date) {
      return state.drafts[date] ?? null;
    },

    saveDraft(date, data) {
      state.drafts[date] = data;
      persist();
    },

    clearDraft(date) {
      delete state.drafts[date];
      persist();
    },

    exportJSON() {
      return JSON.stringify(
        { app: 'yutori-log', version: SCHEMA_VERSION, exported_at: now().toISOString(), records: this.listRecords().reverse(), settings: state.settings },
        null,
        2,
      );
    },

    exportCSV() {
      const label = (list, key) => list.find((o) => o.key === key)?.label ?? '';
      const header = [
        '日付', '区分', '睡眠時間(分)',
        ...CONDITION_METRICS.map((m) => m.label), '総合(単純平均)',
        '業務量', ...WORK_RATINGS.map((m) => m.label), '無理をした',
        ...NOTE_FIELDS.map((f) => f.label), '更新日時',
      ];
      const rows = this.listRecords().reverse().map((r) => {
        const overall = overallScore(r);
        return [
          r.record_date, label(DAY_TYPES, r.day_type), sleepMinutes(r) ?? '',
          ...CONDITION_METRICS.map((m) => r.condition[m.key] ?? ''), overall === null ? '' : overall.toFixed(2),
          label(WORKLOAD_LEVELS, r.workload.workload_level), ...WORK_RATINGS.map((m) => r.workload[m.key] ?? ''), r.workload.overexertion ? 'はい' : '',
          ...NOTE_FIELDS.map((f) => r.notes[f.key]), r.updated_at ?? '',
        ];
      });
      const esc = (v) => {
        const s = String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      return '﻿' + [header, ...rows].map((row) => row.map(esc).join(',')).join('\r\n');
    },

    /** エクスポートした JSON を取り込む。同じ日付は更新日時が新しい方を残す。 */
    importJSON(text) {
      const data = JSON.parse(text);
      if (data?.app !== 'yutori-log' || !Array.isArray(data.records)) throw new Error('ゆとりログのエクスポートファイルではありません。');
      let added = 0;
      let updated = 0;
      let skipped = 0;
      for (const raw of data.records) {
        if (!isValidDateKey(raw?.record_date)) {
          skipped++;
          continue;
        }
        const rec = normalizeRecord(raw);
        const existing = state.records[rec.record_date];
        if (!existing) {
          state.records[rec.record_date] = { ...rec, id: rec.id ?? newId() };
          added++;
        } else if ((rec.updated_at ?? '') > (existing.updated_at ?? '')) {
          state.records[rec.record_date] = { ...rec, id: existing.id, created_at: existing.created_at ?? rec.created_at };
          updated++;
        } else {
          skipped++;
        }
      }
      if (!persist()) throw new Error('保存に失敗しました。');
      return { added, updated, skipped };
    },

    clearAll() {
      state = emptyState();
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        /* noop */
      }
    },
  };
}
