// 日付ユーティリティ。日付は端末のローカル日付 "YYYY-MM-DD" 文字列で扱う。

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayKey(now = new Date()) {
  return toDateKey(now);
}

export function isValidDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + n);
  return toDateKey(date);
}

/** endKey を含む直近 days 日分の日付キー（古い順） */
export function rangeKeys(endKey, days) {
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(addDays(endKey, -i));
  return keys;
}

export function weekdayLabel(key) {
  return WEEKDAYS[parseDateKey(key).getDay()];
}

export function shortLabel(key) {
  const date = parseDateKey(key);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function longLabel(key) {
  const date = parseDateKey(key);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${weekdayLabel(key)}）`;
}
