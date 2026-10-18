/*
 * 報表用的小型 SVG 圖表：分數變化折線圖、每題得分率直條圖。
 * 線 2px、點 r=4 加一圈底色、直條最寬 24px、格線 1px；滑過會顯示數值。
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v !== null && v !== undefined) el.setAttribute(k, v); });
    kids.forEach((k) => { if (k) el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return el;
  }

  let tip = null;
  function bindTip(el, text) {
    el.addEventListener('mouseenter', (e) => {
      if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; document.body.appendChild(tip); }
      tip.textContent = '';
      text.split('\n').forEach((line, i) => {
        if (i) tip.appendChild(document.createElement('br'));
        tip.appendChild(document.createTextNode(line));
      });
      tip.hidden = false;
      move(e);
    });
    el.addEventListener('mousemove', move);
    el.addEventListener('mouseleave', () => { if (tip) tip.hidden = true; });
  }
  function move(e) {
    if (!tip) return;
    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  // 換頁時把殘留的提示框收起來
  window.addEventListener('hashchange', () => { if (tip) tip.hidden = true; });

  /*
   * series: [{ name, points: [{ t: 毫秒時間, y: 0–100, tip }] }]
   */
  function line(series, opts) {
    opts = opts || {};
    const W = 720;
    const H = opts.height || 260;
    const m = { l: 40, r: 56, t: 16, b: 34 };
    const all = series.flatMap((x) => x.points);
    const box = document.createElement('div');
    box.className = 'chart';
    if (!all.length) { box.innerHTML = '<p class="empty">還沒有資料</p>'; return box; }
    if (series.length > 1) {
      const lg = document.createElement('div');
      lg.className = 'legend';
      series.slice(0, SERIES.length).forEach((x, i) => {
        const sp = document.createElement('span');
        const sw = document.createElement('i');
        sw.style.background = SERIES[i];
        sp.append(sw, x.name);
        lg.appendChild(sp);
      });
      box.appendChild(lg);
    }
    let t0 = Math.min(...all.map((p) => p.t));
    let t1 = Math.max(...all.map((p) => p.t));
    if (t1 - t0 < 86400000) { t0 -= 43200000; t1 += 43200000; }
    const X = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
    const Y = (y) => m.t + (1 - y / 100) * (H - m.t - m.b);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label || '分數變化折線圖' });
    const grid = s('g', { class: 'grid' });
    [0, 20, 40, 60, 80, 100].forEach((v) => {
      grid.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }));
      grid.appendChild(s('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, String(v)));
    });
    svg.appendChild(grid);
    // 時間軸：最多 6 個日期
    const days = 6;
    for (let i = 0; i < days; i++) {
      const t = t0 + ((t1 - t0) * i) / (days - 1);
      const d = new Date(t);
      svg.appendChild(s('text', { x: X(t), y: H - 10, 'text-anchor': i === 0 ? 'start' : i === days - 1 ? 'end' : 'middle' }, `${d.getMonth() + 1}/${d.getDate()}`));
    }
    series.slice(0, SERIES.length).forEach((ser, si) => {
      const pts = ser.points.slice().sort((a, b) => a.t - b.t);
      const color = SERIES[si];
      if (pts.length > 1) {
        const area = `M${X(pts[0].t)},${Y(0)} ` + pts.map((p) => `L${X(p.t)},${Y(p.y)}`).join(' ') + ` L${X(pts[pts.length - 1].t)},${Y(0)} Z`;
        if (series.length === 1) svg.appendChild(s('path', { d: area, fill: color, 'fill-opacity': 0.1, stroke: 'none' }));
        svg.appendChild(s('path', { d: 'M' + pts.map((p) => `${X(p.t)},${Y(p.y)}`).join(' L'), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      }
      pts.forEach((p, i) => {
        const last = i === pts.length - 1;
        svg.appendChild(s('circle', { cx: X(p.t), cy: Y(p.y), r: last ? 5 : 4, fill: color, stroke: 'var(--paper)', 'stroke-width': 2 }));
        if (last) svg.appendChild(s('text', { x: X(p.t) + 10, y: Y(p.y) + 4, class: 'val' }, String(Math.round(p.y))));
        const hit = s('circle', { cx: X(p.t), cy: Y(p.y), r: 12, fill: 'transparent', style: 'cursor:default' });
        bindTip(hit, p.tip || `${Math.round(p.y)} 分`);
        svg.appendChild(hit);
      });
    });
    box.appendChild(svg);
    return box;
  }

  /*
   * bars: [{ label: '1', value: 0–100, tip, low }]，依序由左到右
   */
  function columns(bars, opts) {
    opts = opts || {};
    const W = 720;
    const H = opts.height || 220;
    const m = { l: 40, r: 8, t: 20, b: 30 };
    const box = document.createElement('div');
    box.className = 'chart';
    if (!bars.length) { box.innerHTML = '<p class="empty">還沒有資料</p>'; return box; }
    const band = (W - m.l - m.r) / bars.length;
    const bw = Math.min(24, Math.max(4, band - 4));
    const Y = (v) => m.t + (1 - v / 100) * (H - m.t - m.b);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label || '每題得分率直條圖' });
    const grid = s('g', { class: 'grid' });
    [0, 50, 100].forEach((v) => {
      grid.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }));
      grid.appendChild(s('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, v + '%'));
    });
    svg.appendChild(grid);
    const every = bars.length > 24 ? 5 : 1;
    bars.forEach((b, i) => {
      const cx = m.l + band * i + band / 2;
      const y = Y(b.value);
      const h0 = Y(0) - y;
      const r = Math.min(4, h0, bw / 2);
      const x = cx - bw / 2;
      // 頂端 4px 圓角、底部平
      const d = h0 <= 0 ? '' :
        `M${x},${Y(0)} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + bw - r},${y} Q${x + bw},${y} ${x + bw},${y + r} L${x + bw},${Y(0)} Z`;
      if (d) svg.appendChild(s('path', { d, fill: b.low ? 'var(--red)' : 'var(--chart-bar)' }));
      if (b.low) svg.appendChild(s('text', { x: cx, y: y - 6, 'text-anchor': 'middle', class: 'val' }, String(Math.round(b.value))));
      if (i % every === 0 || i === bars.length - 1) svg.appendChild(s('text', { x: cx, y: H - 10, 'text-anchor': 'middle' }, b.label));
      const hit = s('rect', { x: m.l + band * i, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' });
      bindTip(hit, b.tip || `${b.label}：${Math.round(b.value)}%`);
      svg.appendChild(hit);
    });
    box.appendChild(svg);
    return box;
  }

  window.Charts = { line, columns };
})();
