// 複数系列の折れ線グラフ（SVG）。縦軸は 1〜5 で固定、未記録日は線を途切れさせる。
import { SERIES } from './model.js';
import { shortLabel, weekdayLabel } from './date.js';

const W = 520;
const H = 280;
const PAD = { left: 34, right: 12, top: 16, bottom: 40 };

const yOf = (v) => PAD.top + ((5 - v) / 4) * (H - PAD.top - PAD.bottom);

/** null で区切られた連続区間ごとに点列を返す */
export function segments(points) {
  const out = [];
  let cur = [];
  for (const p of points) {
    if (p.v === null || p.v === undefined) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

export function renderChart({ dates, series, visible, selected }) {
  const n = dates.length;
  const plotW = W - PAD.left - PAD.right;
  const xOf = (i) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const step = n > 1 ? plotW / (n - 1) : plotW;
  const labelEvery = n <= 7 ? 1 : n <= 14 ? 2 : 5;

  const grid = [5, 4, 3, 2, 1]
    .map((v) => `<line x1="${PAD.left}" y1="${yOf(v)}" x2="${W - PAD.right}" y2="${yOf(v)}" class="grid"/>` +
      `<text x="${PAD.left - 10}" y="${yOf(v) + 4}" class="ylabel">${v}</text>`)
    .join('');

  const xlabels = dates
    .map((d, i) => {
      if (n > 7 && (n - 1 - i) % labelEvery !== 0) return '';
      const text = n <= 7 ? weekdayLabel(d) : shortLabel(d);
      return `<text x="${xOf(i)}" y="${H - 14}" class="xlabel">${text}</text>`;
    })
    .join('');

  const lines = SERIES.filter((s) => visible.includes(s.key))
    .map((s) => {
      const pts = series[s.key].map((v, i) => ({ v, x: xOf(i), y: v === null ? 0 : yOf(v) }));
      const width = s.key === 'overall' ? 4.5 : 3;
      const paths = segments(pts)
        .map((seg) => seg.length === 1
          ? ''
          : `<polyline points="${seg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`)
        .join('');
      const dots = pts
        .filter((p) => p.v !== null)
        .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${n <= 7 ? 5.5 : 3.5}" fill="${s.color}"/>`)
        .join('');
      return `<g>${paths}${dots}</g>`;
    })
    .join('');

  const sel = selected !== null && selected !== undefined && selected >= 0 && selected < n
    ? `<line x1="${xOf(selected)}" y1="${PAD.top - 6}" x2="${xOf(selected)}" y2="${H - PAD.bottom + 4}" class="selline"/>`
    : '';

  const hits = dates
    .map((d, i) => `<rect x="${(xOf(i) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H}" fill="transparent" data-index="${i}" class="hit"><title>${shortLabel(d)}</title></rect>`)
    .join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="コンディション推移グラフ（縦軸1〜5、5が良好）">${grid}${xlabels}${sel}${lines}${hits}</svg>`;
}
