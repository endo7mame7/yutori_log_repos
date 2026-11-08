// 画面（ホーム／記録／分析／設定／履歴）の描画とイベント処理。
import { CONDITION_METRICS, DAY_TYPES, NOTE_FIELDS, SERIES, WORK_RATINGS, WORKLOAD_LEVELS, createEmptyRecord, normalizeRecord, overallScore, validateRecord } from './model.js';
import { addDays, isValidDateKey, longLabel, shortLabel, todayKey, weekdayLabel } from './date.js';
import { createStore } from './store.js';
import { MIN_RECORDS, buildSeries, formatDiff, formatScore, formatSleep, summarize } from './analysis.js';
import { renderChart } from './chart.js';

const store = createStore();
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

// ---- 表示状態（端末ごとの見た目の好み。消えても問題ない） ----
const UI_KEY = 'yutori-log:ui';
const ui = { period: 7, visible: ['overall', 'sleep_quality', 'physical_condition', 'stress_level'], selected: null };
try {
  const saved = JSON.parse(localStorage.getItem(UI_KEY) ?? '{}');
  if ([7, 30].includes(saved.period)) ui.period = saved.period;
  if (Array.isArray(saved.visible)) ui.visible = saved.visible.filter((k) => SERIES.some((s) => s.key === k));
} catch {
  /* 保存できない環境でも既定値で動く */
}
function saveUi() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ period: ui.period, visible: ui.visible }));
  } catch {
    /* noop */
  }
}

// ---- ヘルパー ----
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = hash.split('?');
  return { view: path || 'home', params: new URLSearchParams(query) };
}

function go(view, params) {
  const q = params ? `?${new URLSearchParams(params)}` : '';
  location.hash = `#/${view}${q}`;
}

function applyTheme() {
  const { theme } = store.getSettings();
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function scoreChip(v) {
  if (v === null || v === undefined) return '<span class="score empty">—</span>';
  const level = Math.max(1, Math.min(5, Math.round(v)));
  return `<span class="score lv${level}">${formatScore(v)}</span>`;
}

function labelOf(list, key) {
  return list.find((o) => o.key === key)?.label ?? '';
}

// ---- ホーム ----
function greeting(now) {
  const h = now.getHours();
  if (h < 11) return 'おはようございます';
  if (h < 18) return 'こんにちは';
  return 'おつかれさまです';
}

function viewHome() {
  const now = new Date();
  const today = todayKey(now);
  const rec = store.getRecord(today);
  const settings = store.getSettings();
  const [hh, mm] = settings.reminder_time.split(':').map(Number);
  const reminderDue = settings.reminder_enabled && !rec && now.getHours() * 60 + now.getMinutes() >= hh * 60 + mm;

  const week = buildSeries(store.recordsByDate(), today, 7);
  const recent = store.listRecords().slice(0, 5);

  return `
    <header class="page-head">
      <p class="eyebrow">${esc(longLabel(today))}</p>
      <h1>${greeting(now)}</h1>
    </header>
    ${store.persistent ? '' : '<div class="notice warn">この環境では端末に保存できないため、ページを閉じると記録が消えます。</div>'}
    ${reminderDue ? `<div class="notice">記録の時間です（${esc(settings.reminder_time)}）。今日の様子を少しだけ残しておきましょう。</div>` : ''}
    <section class="card today">
      ${rec
        ? `<div class="row between"><div><p class="muted small">今日の記録</p><h2>記録できました</h2></div>${scoreChip(overallScore(rec))}</div>
           <ul class="metric-chips">${CONDITION_METRICS.map((m) => `<li><span>${esc(m.short)}</span>${scoreChip(rec.condition[m.key])}</li>`).join('')}</ul>
           <a class="btn secondary block" href="#/record?date=${today}">今日の記録を編集する</a>`
        : `<p class="muted small">今日の記録</p><h2>まだ記録していません</h2>
           <p>3〜5分ほどで記録できます。わかる項目だけで大丈夫です。</p>
           <a class="btn primary block" href="#/record?date=${today}">今日の記録をつける</a>
           <p class="muted small center">体調がすぐれない日は、無理に記録しなくて大丈夫です。</p>`}
    </section>
    <section class="card">
      <div class="row between"><h2>この7日間</h2><a class="link" href="#/analysis">分析を見る</a></div>
      <ol class="week">
        ${week.dates.map((d, i) => `<li><a href="#/record?date=${d}" aria-label="${esc(longLabel(d))}の記録"><span class="wd">${weekdayLabel(d)}</span>${scoreChip(week.series.overall[i])}</a></li>`).join('')}
      </ol>
      <p class="muted small">数値は総合コンディション（記録した項目の単純平均、5＝良好）。</p>
    </section>
    <section class="card">
      <div class="row between"><h2>最近の記録</h2>${recent.length ? '<a class="link" href="#/history">すべての履歴</a>' : ''}</div>
      ${recent.length ? recordList(recent) : '<p class="muted">まだ記録はありません。最初の記録をつけてみましょう。</p>'}
    </section>`;
}

function recordList(records) {
  return `<ul class="record-list">${records
    .map((r) => `<li><a href="#/record?date=${r.record_date}">
        <span class="date">${esc(longLabel(r.record_date))}</span>
        <span class="tags">${r.day_type ? `<span class="tag">${esc(labelOf(DAY_TYPES, r.day_type))}</span>` : ''}${r.workload.workload_level ? `<span class="tag">業務量：${esc(labelOf(WORKLOAD_LEVELS, r.workload.workload_level))}</span>` : ''}</span>
        ${scoreChip(overallScore(r))}
      </a></li>`)
    .join('')}</ul>`;
}

// ---- 履歴 ----
function viewHistory() {
  const records = store.listRecords();
  const groups = new Map();
  for (const r of records) {
    const month = r.record_date.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(r);
  }
  return `
    <header class="page-head"><p class="eyebrow"><a class="link" href="#/home">← ホーム</a></p><h1>記録の履歴</h1></header>
    ${records.length === 0 ? '<p class="muted">まだ記録はありません。</p>' : ''}
    ${[...groups.entries()].map(([month, list]) => {
      const [y, m] = month.split('-');
      return `<section class="card"><h2>${y}年${Number(m)}月 <span class="muted small">${list.length}件</span></h2>${recordList(list)}</section>`;
    }).join('')}`;
}

// ---- 記録 ----
let formLast = {};

function ratingGroup(name, metric, value) {
  return `<fieldset class="rating" data-name="${name}">
    <legend>${esc(metric.label)}</legend>
    <div class="rating-options">
      ${[1, 2, 3, 4, 5].map((v) => `<label><input type="radio" name="${name}" value="${v}" ${value === v ? 'checked' : ''}><span>${v}</span></label>`).join('')}
    </div>
    <div class="rating-hint"><span>1：${esc(metric.low)}</span><span>5：${esc(metric.high)}</span></div>
  </fieldset>`;
}

function choiceGroup(name, legend, options, value) {
  return `<fieldset class="choice" data-name="${name}">
    <legend>${esc(legend)}</legend>
    <div class="choice-options">
      ${options.map((o) => `<label><input type="radio" name="${name}" value="${o.key}" ${value === o.key ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}
    </div>
  </fieldset>`;
}

function formToRecord(form, date) {
  const fd = new FormData(form);
  const input = { record_date: date, day_type: fd.get('day_type'), sleep: { hours: fd.get('sleep_h'), minutes: fd.get('sleep_m') }, condition: {}, workload: {}, notes: {} };
  for (const m of CONDITION_METRICS) input.condition[m.key] = fd.get(`c.${m.key}`);
  input.workload.workload_level = fd.get('w.workload_level');
  for (const m of WORK_RATINGS) input.workload[m.key] = fd.get(`w.${m.key}`);
  input.workload.overexertion = fd.get('w.overexertion') === 'on';
  for (const f of NOTE_FIELDS) input.notes[f.key] = fd.get(`n.${f.key}`) ?? '';
  return normalizeRecord(input);
}

function viewRecord(params) {
  const today = todayKey();
  let date = params.get('date');
  if (!isValidDateKey(date) || date > today) date = today;

  const saved = store.getRecord(date);
  const draft = store.getDraft(date);
  const rec = draft ? normalizeRecord({ ...draft, record_date: date }) : saved ?? createEmptyRecord(date);
  const enabled = store.getSettings().enabled_metrics;
  const hiddenWithValue = CONDITION_METRICS.filter((m) => !enabled.includes(m.key) && rec.condition[m.key] !== null);

  formLast = {};
  for (const m of CONDITION_METRICS) formLast[`c.${m.key}`] = rec.condition[m.key] === null ? null : String(rec.condition[m.key]);
  for (const m of WORK_RATINGS) formLast[`w.${m.key}`] = rec.workload[m.key] === null ? null : String(rec.workload[m.key]);
  formLast['w.workload_level'] = rec.workload.workload_level;
  formLast.day_type = rec.day_type;

  const hasWorkDetail = rec.workload.burden !== null || rec.workload.concentration !== null || rec.workload.overexertion;
  const hasNotes = NOTE_FIELDS.some((f) => rec.notes[f.key]);

  return `
    <header class="page-head">
      <p class="eyebrow">${saved ? '保存済みの記録を編集' : '新しい記録'}</p>
      <div class="date-nav">
        <button type="button" class="icon-btn" data-action="prev-day" aria-label="前の日">‹</button>
        <label class="date-field"><span class="sr-only">日付</span><input type="date" id="record-date" value="${date}" max="${today}"></label>
        <button type="button" class="icon-btn" data-action="next-day" aria-label="次の日" ${date >= today ? 'disabled' : ''}>›</button>
      </div>
      <p class="muted small">${esc(longLabel(date))}</p>
    </header>
    ${draft ? `<div class="notice row between"><span>保存していない入力内容を復元しました。</span><button type="button" class="link" data-action="discard-draft">破棄する</button></div>` : ''}
    <form id="record-form" data-date="${date}" novalidate>
      <section class="card">
        <h2>今日の区分</h2>
        ${choiceGroup('day_type', '勤務日／休日', DAY_TYPES, rec.day_type)}
      </section>

      <section class="card">
        <h2>睡眠</h2>
        <div class="sleep-time">
          <label>睡眠時間 <span class="optional">任意</span></label>
          <div class="row">
            <input type="number" name="sleep_h" inputmode="numeric" min="0" max="24" value="${rec.sleep.hours ?? ''}" aria-label="睡眠時間（時間）"><span>時間</span>
            <input type="number" name="sleep_m" inputmode="numeric" min="0" max="59" step="5" value="${rec.sleep.minutes ?? ''}" aria-label="睡眠時間（分）"><span>分</span>
          </div>
        </div>
        ${enabled.includes('sleep_quality') || rec.condition.sleep_quality !== null ? ratingGroup('c.sleep_quality', CONDITION_METRICS[0], rec.condition.sleep_quality) : ''}
      </section>

      <section class="card">
        <h2>コンディション</h2>
        <p class="muted small">5＝良好、1＝不調。わかる項目だけ選んでください（1つ以上で保存できます）。同じ数字をもう一度押すと選択を外せます。</p>
        ${CONDITION_METRICS.slice(1).filter((m) => enabled.includes(m.key) || rec.condition[m.key] !== null).map((m) => ratingGroup(`c.${m.key}`, m, rec.condition[m.key])).join('')}
        ${hiddenWithValue.length ? '<p class="muted small">※設定で非表示にした項目も、この日に値があるため表示しています。</p>' : ''}
      </section>

      <section class="card">
        <h2>仕事</h2>
        ${choiceGroup('w.workload_level', '業務量', WORKLOAD_LEVELS, rec.workload.workload_level)}
        <details ${hasWorkDetail ? 'open' : ''}>
          <summary>負担感・集中しやすさ <span class="optional">任意</span></summary>
          ${WORK_RATINGS.map((m) => ratingGroup(`w.${m.key}`, m, rec.workload[m.key])).join('')}
          <label class="check"><input type="checkbox" name="w.overexertion" ${rec.workload.overexertion ? 'checked' : ''}><span>今日は無理をした</span></label>
        </details>
      </section>

      <section class="card">
        <details ${hasNotes ? 'open' : ''}>
          <summary><h2 class="inline">ふりかえり・メモ</h2> <span class="optional">任意</span></summary>
          ${NOTE_FIELDS.map((f) => `<label class="note"><span>${esc(f.label)}</span><textarea name="n.${f.key}" rows="2" maxlength="2000" placeholder="${esc(f.placeholder)}">${esc(rec.notes[f.key])}</textarea></label>`).join('')}
        </details>
      </section>

      <p id="form-error" class="error" role="alert" hidden></p>
      <div class="form-actions">
        <button type="submit" class="btn primary block">${saved ? '更新する' : '保存する'}</button>
        <p id="draft-status" class="muted small center" aria-live="polite"></p>
        ${saved ? '<button type="button" class="btn danger-text block" data-action="delete-record">この日の記録を削除</button>' : ''}
      </div>
    </form>`;
}

function onRecordInput(form) {
  const date = form.dataset.date;
  store.saveDraft(date, formToRecord(form, date));
  const status = document.getElementById('draft-status');
  if (status) status.textContent = '入力内容を一時保存しました（まだ記録は保存されていません）';
}

// ---- 分析 ----
function viewAnalysis() {
  const today = todayKey();
  const byDate = store.recordsByDate();
  const data = buildSeries(byDate, today, ui.period);
  const sum = summarize(byDate, today, ui.period);
  if (ui.selected !== null && ui.selected >= data.dates.length) ui.selected = null;

  const selDate = ui.selected === null ? null : data.dates[ui.selected];
  const selRec = selDate ? byDate[selDate] : null;
  const sleepFatigue = ui.visible.length === 2 && ui.visible.includes('sleep_quality') && ui.visible.includes('physical_condition');

  const insufficient = (n, need = MIN_RECORDS) => `<p class="muted small">データ不足（${n}件／${need}件以上で表示）</p>`;

  const metricRows = CONDITION_METRICS.map((m) => {
    const { avg, n } = sum.metrics[m.key];
    const s = SERIES.find((x) => x.key === m.key);
    return `<li><span class="mlabel"><i class="dot" style="background:${s?.color}"></i>${esc(m.short)}</span>
      ${n >= MIN_RECORDS ? `<span class="bar"><span style="width:${((avg - 1) / 4) * 100}%;background:${s?.color}"></span></span><b>${formatScore(avg)}</b>` : `<span class="muted small">データ不足（${n}件）</span>`}</li>`;
  }).join('');

  const workRows = WORKLOAD_LEVELS.map((l) => {
    const g = sum.workload[l.key];
    return `<tr><th>${esc(l.label)}</th><td>${g.overall.n}件</td><td>${g.overall.n >= 2 ? formatScore(g.overall.avg) : '—'}</td><td>${g.stress.n >= 2 ? formatScore(g.stress.avg) : '—'}</td></tr>`;
  }).join('');
  const workTotal = WORKLOAD_LEVELS.reduce((a, l) => a + sum.workload[l.key].overall.n, 0);

  const h = sum.holiday;

  return `
    <header class="page-head"><p class="eyebrow">分析</p><h1>コンディションの推移</h1></header>
    <div class="segmented" role="group" aria-label="表示期間">
      ${[7, 30].map((p) => `<button type="button" data-action="period" data-period="${p}" aria-pressed="${ui.period === p}">${p}日間</button>`).join('')}
    </div>

    <section class="card">
      <div class="legend" role="group" aria-label="表示する系列">
        ${SERIES.map((s) => `<button type="button" data-action="toggle-series" data-key="${s.key}" aria-pressed="${ui.visible.includes(s.key)}"><i class="dot" style="background:${s.color}"></i>${esc(s.label)}</button>`).join('')}
      </div>
      <div class="chart-wrap" id="chart">${renderChart({ dates: data.dates, series: data.series, visible: ui.visible, selected: ui.selected })}</div>
      ${sum.count === 0 ? '<p class="muted small center">この期間の記録はまだありません。</p>' : ''}
      <div class="row between wrap">
        <p class="muted small">縦軸は 5＝良好、1＝不調。未記録の日は線が途切れます。グラフをタップするとその日の値を表示します。</p>
        <button type="button" class="btn small secondary" data-action="sleep-fatigue" aria-pressed="${sleepFatigue}">睡眠と疲労を比べる</button>
      </div>
      ${selDate ? `<div class="day-detail">
        <div class="row between"><b>${esc(longLabel(selDate))}</b>${selRec ? `<a class="link" href="#/record?date=${selDate}">記録を開く</a>` : ''}</div>
        ${selRec
          ? `<ul class="metric-chips">${SERIES.map((s) => `<li><span><i class="dot" style="background:${s.color}"></i>${esc(s.label)}</span>${scoreChip(data.series[s.key][ui.selected])}</li>`).join('')}</ul>
             <p class="muted small">${[selRec.day_type ? labelOf(DAY_TYPES, selRec.day_type) : '', selRec.workload.workload_level ? `業務量：${labelOf(WORKLOAD_LEVELS, selRec.workload.workload_level)}` : '', selRec.sleep.hours !== null ? `睡眠：${formatSleep(selRec.sleep.hours * 60 + (selRec.sleep.minutes ?? 0))}` : ''].filter(Boolean).map(esc).join('・')}</p>`
          : '<p class="muted small">この日は未記録です。</p>'}
      </div>` : ''}
    </section>

    <div class="cards">
      <section class="card">
        <h2>総合コンディション</h2>
        ${sum.overall.n >= MIN_RECORDS
          ? `<p class="big">${formatScore(sum.overall.avg)}<small> / 5</small></p>
             <p class="muted small">前の${ui.period}日間との差：<b>${formatDiff(sum.overall.diff)}</b>${sum.overall.diff === null ? `（前期間は${sum.overall.prevN}件のため比較なし）` : ''}</p>`
          : insufficient(sum.overall.n)}
        <p class="muted small">総合＝その日に記録したコンディション項目（最大5項目）の単純平均。</p>
      </section>

      <section class="card">
        <h2>記録状況</h2>
        <p class="big">${sum.count}<small> / ${ui.period}日</small></p>
        <p class="muted small">記録率 ${Math.round(sum.rate * 100)}%。記録できない日があっても大丈夫です。</p>
        ${sum.sleepMinutes.n ? `<p class="muted small">平均睡眠時間：${formatSleep(sum.sleepMinutes.avg)}（${sum.sleepMinutes.n}件）</p>` : ''}
      </section>
    </div>

    <section class="card">
      <h2>項目別の平均</h2>
      <ul class="metric-bars">${metricRows}</ul>
    </section>

    <section class="card">
      <h2>業務量との関係</h2>
      ${workTotal >= MIN_RECORDS
        ? `<table class="table"><thead><tr><th>業務量</th><th>件数</th><th>総合の平均</th><th>ストレスの少なさ</th></tr></thead><tbody>${workRows}</tbody></table>
           <p class="muted small">件数が2件未満の区分は「—」と表示します。</p>`
        : insufficient(workTotal)}
    </section>

    <section class="card">
      <h2>休日の回復</h2>
      ${h.holiday.n + h.work.n >= MIN_RECORDS
        ? `<table class="table"><thead><tr><th>区分</th><th>件数</th><th>総合の平均</th></tr></thead><tbody>
            <tr><th>勤務日</th><td>${h.work.n}件</td><td>${h.work.n ? formatScore(h.work.avg) : '—'}</td></tr>
            <tr><th>休日</th><td>${h.holiday.n}件</td><td>${h.holiday.n ? formatScore(h.holiday.avg) : '—'}</td></tr></tbody></table>
           ${h.recovery.n ? `<p class="small">休日の前後の勤務日で疲労の少なさを比べると <b>${formatScore(h.recovery.before)} → ${formatScore(h.recovery.after)}</b>（${h.recovery.n}回の休日）。</p>` : '<p class="muted small">休日の前後の勤務日がどちらも記録された休日がまだないため、前後比較は表示できません。</p>'}`
        : insufficient(h.holiday.n + h.work.n)}
      <p class="muted small">記録画面の「勤務日／休日」をもとに集計します。</p>
    </section>

    <div class="notice warn small">相関が見られても、因果関係を示すものではありません。数値だけで健康状態を判断せず、気になるときは周囲や専門家に相談してください。</div>`;
}

// ---- 設定 ----
function viewSettings() {
  const s = store.getSettings();
  return `
    <header class="page-head"><p class="eyebrow">設定</p><h1>設定</h1></header>
    <form id="settings-form">
      <section class="card">
        <h2>記録のお知らせ</h2>
        <label class="check"><input type="checkbox" name="reminder_enabled" ${s.reminder_enabled ? 'checked' : ''}><span>指定時刻を過ぎて未記録のとき、ホームにお知らせを表示する</span></label>
        <label class="field">時刻 <input type="time" name="reminder_time" value="${esc(s.reminder_time)}"></label>
        <p class="muted small">現在はアプリを開いたときの表示のみです（プッシュ通知は今後対応予定）。</p>
      </section>
      <section class="card">
        <h2>記録する項目</h2>
        <p class="muted small">記録画面に表示するコンディション項目を選べます（1つ以上）。</p>
        ${CONDITION_METRICS.map((m) => `<label class="check"><input type="checkbox" name="metric" value="${m.key}" ${s.enabled_metrics.includes(m.key) ? 'checked' : ''}><span>${esc(m.label)}</span></label>`).join('')}
      </section>
      <section class="card">
        <h2>表示</h2>
        ${choiceGroup('theme', 'テーマ', [{ key: 'auto', label: '端末に合わせる' }, { key: 'light', label: 'ライト' }, { key: 'dark', label: 'ダーク' }], s.theme)}
      </section>
    </form>
    <section class="card">
      <h2>データの管理</h2>
      <p class="muted small">記録はこの端末のブラウザ内にだけ保存され、外部に送信されません。機種変更やブラウザのデータ削除に備えて、定期的にエクスポートしてください。</p>
      <div class="stack">
        <button type="button" class="btn secondary block" data-action="export-json">バックアップ（JSON）を書き出す</button>
        <button type="button" class="btn secondary block" data-action="export-csv">表計算用（CSV）を書き出す</button>
        <label class="btn secondary block file-btn">バックアップから読み込む<input type="file" accept="application/json,.json" data-action="import-json" hidden></label>
        <button type="button" class="btn danger-text block" data-action="clear-all">すべての記録を削除</button>
      </div>
      <p class="muted small">記録件数：${store.listRecords().length}件</p>
    </section>
    <section class="card">
      <h2>このアプリについて</h2>
      <p class="small">ゆとりログは、毎日の短い記録から心身の変化や仕事の負荷に気づくためのセルフチェックアプリです。医療的な診断を行うものではありません。つらい状態が続くときは、家族・職場・医療機関などに相談してください。</p>
    </section>`;
}

// ---- 描画 ----
const VIEWS = { home: viewHome, record: viewRecord, analysis: viewAnalysis, settings: viewSettings, history: viewHistory };
const NAV_OF = { home: 'home', history: 'home', record: 'record', analysis: 'analysis', settings: 'settings' };
let lastView = null;

function render() {
  const { view, params } = parseRoute();
  const fn = VIEWS[view] ?? viewHome;
  const name = VIEWS[view] ? view : 'home';
  app.innerHTML = fn(params);
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.nav === NAV_OF[name]) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (lastView !== name || name === 'record') window.scrollTo(0, 0);
  lastView = name;
}

// ---- イベント ----
app.addEventListener('click', (e) => {
  const radio = e.target.closest('input[type="radio"]');
  if (radio && radio.form?.id === 'record-form') {
    if (formLast[radio.name] === radio.value) {
      radio.checked = false;
      formLast[radio.name] = null;
      onRecordInput(radio.form);
    } else formLast[radio.name] = radio.value;
    return;
  }

  const hit = e.target.closest('.hit');
  if (hit) {
    const i = Number(hit.dataset.index);
    ui.selected = ui.selected === i ? null : i;
    render();
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const form = document.getElementById('record-form');

  switch (action) {
    case 'prev-day':
    case 'next-day': {
      const date = form.dataset.date;
      const next = addDays(date, action === 'prev-day' ? -1 : 1);
      if (next <= todayKey()) go('record', { date: next });
      break;
    }
    case 'discard-draft':
      store.clearDraft(form.dataset.date);
      render();
      toast('一時保存した入力内容を破棄しました');
      break;
    case 'delete-record':
      if (confirm(`${longLabel(form.dataset.date)}の記録を削除しますか？この操作は元に戻せません。`)) {
        store.deleteRecord(form.dataset.date);
        render();
        toast('記録を削除しました');
      }
      break;
    case 'period':
      ui.period = Number(el.dataset.period);
      ui.selected = null;
      saveUi();
      render();
      break;
    case 'toggle-series': {
      const key = el.dataset.key;
      ui.visible = ui.visible.includes(key) ? ui.visible.filter((k) => k !== key) : [...ui.visible, key];
      saveUi();
      render();
      break;
    }
    case 'sleep-fatigue':
      ui.visible = el.getAttribute('aria-pressed') === 'true' ? ['overall', 'sleep_quality', 'physical_condition', 'stress_level'] : ['sleep_quality', 'physical_condition'];
      saveUi();
      render();
      break;
    case 'export-json':
      download(`yutori-log-${todayKey()}.json`, store.exportJSON(), 'application/json');
      break;
    case 'export-csv':
      download(`yutori-log-${todayKey()}.csv`, store.exportCSV(), 'text/csv');
      break;
    case 'clear-all':
      if (confirm('すべての記録と設定を削除しますか？') && confirm('本当に削除しますか？バックアップがない場合、元に戻せません。')) {
        store.clearAll();
        applyTheme();
        render();
        toast('すべての記録を削除しました');
      }
      break;
    default:
  }
});

app.addEventListener('input', (e) => {
  const form = e.target.form;
  if (form?.id === 'record-form' && e.target.type !== 'radio') onRecordInput(form);
});

app.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'record-date') {
    if (isValidDateKey(t.value) && t.value <= todayKey()) go('record', { date: t.value });
    else t.value = document.getElementById('record-form').dataset.date;
    return;
  }
  if (t.form?.id === 'record-form') {
    if (t.type === 'radio') onRecordInput(t.form);
    return;
  }
  if (t.form?.id === 'settings-form') {
    const fd = new FormData(t.form);
    const metrics = fd.getAll('metric');
    if (metrics.length === 0) {
      t.checked = true;
      toast('項目は1つ以上選んでください');
      return;
    }
    store.saveSettings({ reminder_enabled: fd.get('reminder_enabled') === 'on', reminder_time: fd.get('reminder_time') || '21:00', enabled_metrics: metrics, theme: fd.get('theme') });
    applyTheme();
    toast('設定を保存しました');
    return;
  }
  if (t.dataset.action === 'import-json' && t.files?.[0]) {
    try {
      const result = store.importJSON(await t.files[0].text());
      toast(`読み込みました（追加 ${result.added}件・更新 ${result.updated}件・変更なし ${result.skipped}件）`);
      render();
    } catch (err) {
      toast(err instanceof SyntaxError ? 'ファイルを読み込めませんでした' : err.message);
    }
    t.value = '';
  }
});

app.addEventListener('submit', (e) => {
  if (e.target.id !== 'record-form') return;
  e.preventDefault();
  const form = e.target;
  const rec = formToRecord(form, form.dataset.date);
  const errors = validateRecord(rec);
  const errEl = document.getElementById('form-error');
  if (errors.length) {
    errEl.textContent = errors.join(' ');
    errEl.hidden = false;
    errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  try {
    store.saveRecord(rec);
    toast(`${shortLabel(rec.record_date)}の記録を保存しました`);
    go('home');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

window.addEventListener('hashchange', render);
applyTheme();
render();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
