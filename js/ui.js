/* 共用介面工具：建立元素、路由、對話框、提示、題目渲染。 */
(function () {
  'use strict';
  const Core = window.Core;

  // h('div', {class: 'x', onclick: fn}, '文字', child, [children])
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v; // 只用於程式內固定字串
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    append(el, children);
    return el;
  }
  function append(el, children) {
    children.forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) append(el, c);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    });
  }
  // 文字裡的換行轉成段落
  function paras(text, cls) {
    return String(text || '').split('\n').filter((s) => s.trim()).map((s) => h('p', cls ? { class: cls } : null, s));
  }

  /* ---------- 格式 ---------- */
  function fmtScore(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return String(Core.round2(n)).replace(/\.0+$/, '');
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function fmtDuration(sec) {
    if (!sec && sec !== 0) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m ? `${m} 分 ${s} 秒` : `${s} 秒`;
  }
  function fmtDate(iso, withTime) {
    if (!iso) return '—';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
    return withTime === false ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function pct(earned, max) { return max ? Math.round((earned / max) * 100) : 0; }

  /* ---------- 路由 ---------- */
  const routes = [];
  let notFound = null;
  let cleanup = null;
  function route(pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ re, keys, handler });
  }
  function go(path) {
    if (location.hash === '#' + path) render();
    else location.hash = path;
  }
  function currentPath() { return decodeURIComponent((location.hash || '#/').slice(1)) || '/'; }
  // 每次換頁編一個號碼。試算表模式下頁面要等伺服器回應，
  // 如果等待中又換了頁，舊頁面晚到時不能蓋掉新頁面。
  let seq = 0;
  let lastDone = 0;
  async function render() {
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    const token = ++seq;
    const path = currentPath();
    for (const r of routes) {
      const m = path.match(r.re);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
        let c;
        let err = null;
        try {
          c = await r.handler(params);
        } catch (e) {
          err = e;
        }
        if (token !== seq) {
          // 已經換頁了：收掉這一頁的計時器等資源；若新頁面已經畫好又被蓋掉，就重畫一次
          if (typeof c === 'function') { try { c(); } catch (e) { console.error(e); } }
          if (lastDone > token) render();
          return;
        }
        lastDone = token;
        if (err) {
          console.error(err);
          if (err.code === 'auth') { go('/t'); return; }
          showError(err);
          return;
        }
        if (typeof c === 'function') cleanup = c;
        return;
      }
    }
    if (notFound) notFound(path);
  }
  function start(fallback) {
    notFound = fallback;
    window.addEventListener('hashchange', render);
    render();
  }
  function showError(e) {
    const root = document.getElementById('app');
    root.replaceChildren(h('main', null, h('div', { class: 'wrap narrow' },
      h('div', { class: 'panel' },
        h('h1', { class: 'page-title' }, '發生錯誤'),
        h('p', { class: 'lede' }, e && e.message ? e.message : String(e)),
        h('div', { class: 'btn-row', style: { marginTop: '20px' } }, h('a', { class: 'btn', href: '#/' }, '回首頁'))))));
  }

  /* ---------- 對話框與提示 ---------- */
  function dialog(opts) {
    return new Promise((resolve) => {
      const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape' && opts.cancel !== false) close(false); };
      const ok = h('button', { class: 'btn ' + (opts.danger ? 'danger' : 'primary'), onclick: () => close(true) }, opts.ok || '確定');
      const back = h('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === back && opts.cancel !== false) close(false); } },
        h('div', { class: 'modal' },
          h('h2', null, opts.title),
          h('div', { class: 'body' }, typeof opts.body === 'string' ? paras(opts.body) : opts.body),
          h('div', { class: 'btn-row' },
            opts.cancel === false ? null : h('button', { class: 'btn ghost', onclick: () => close(false) }, opts.cancelText || '取消'),
            ok)));
      document.body.appendChild(back);
      document.addEventListener('keydown', onKey);
      ok.focus();
    });
  }
  function toast(msg, ms) {
    let zone = document.querySelector('.toast-zone');
    if (!zone) { zone = h('div', { class: 'toast-zone', 'aria-live': 'polite' }); document.body.appendChild(zone); }
    const t = h('div', { class: 'toast' }, msg);
    zone.appendChild(t);
    setTimeout(() => t.remove(), ms || 2600);
  }

  /* ---------- 檔案 ---------- */
  // 下載檔案；在不允許下載的環境（例如預覽頁）改成顯示文字讓人複製
  function saveFile(filename, text) {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: filename });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      console.warn(e);
    }
    const area = h('textarea', { class: 'input code', readonly: true, style: { minHeight: '160px' } }, text);
    dialog({
      title: '已產生檔案',
      body: [
        h('p', null, `如果瀏覽器沒有自動下載「${filename}」，可以按「複製內容」，再貼到記事本存檔。`),
        area,
      ],
      ok: '複製內容',
      cancelText: '關閉',
    }).then((yes) => {
      if (!yes) return;
      copyText(text, area);
    });
  }
  function copyText(text, fallbackEl) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('已複製'), () => selectFallback(fallbackEl));
    } else selectFallback(fallbackEl);
  }
  function selectFallback(el) {
    if (el) { el.focus(); el.select(); }
    toast('請按 Ctrl＋C 複製選取的內容');
  }
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('無法讀取檔案'));
      r.readAsText(file, 'utf-8');
    });
  }

  /* ---------- 圖片 ---------- */
  // 題目或題組的圖片：點圖片會在新分頁開原圖；載入失敗時改顯示替代文字。
  // cache（Map）：同一頁重畫時沿用已載入的圖片元素，版面不會因為重新載圖而跳動
  function figure(img, cache) {
    const src = img && typeof img.src === 'string' ? img.src.trim() : '';
    if (!src || !Core.isImageSrc(src)) return null;
    const alt = img.alt || '';
    const key = src + '\n' + alt;
    if (cache && cache.has(key)) return cache.get(key);
    const fig = h('figure', { class: 'q-figure' });
    const pic = h('img', {
      alt,
      loading: 'lazy',
      onerror: () => fig.replaceChildren(h('div', { class: 'q-figure-missing', role: 'note' },
        h('b', null, '圖片無法顯示'), alt ? '：' + alt : '')),
      src,
    });
    fig.append(
      h('a', { href: src, target: '_blank', rel: 'noopener', title: '在新分頁開啟原圖' }, pic),
      alt ? h('figcaption', null, alt) : null);
    if (cache) cache.set(key, fig);
    return fig;
  }
  // 題組文章：段落加上題組的圖片
  function passageBody(group) {
    return [paras((group.passage || []).join('\n')), figure(group.image)];
  }

  /* ---------- 題目渲染 ----------
   * stemBlock(q, { figures })：figures 是 figure() 用的 Map 快取（選填）
   * opts.chosen：已選答案字串
   * opts.onChoose(letter)：可作答時的點選回呼
   * opts.reveal：{ answer, showAnswer } 顯示正解與對錯
   * opts.who：標示「誰選了」的稱呼，預設「你」；老師端用「學生」
   */
  function stemBlock(q, opts) {
    const out = [h('div', { class: 'stem' }, paras(q.stem))];
    if (q.table && q.table.length) {
      const [head, ...rows] = q.table;
      out.push(h('div', { class: 'stem-table table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, head.map((c) => h('th', null, c)))),
        h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))))));
    }
    out.push(figure(q.image, opts && opts.figures));
    return out;
  }
  function optionList(q, opts) {
    const chosen = Core.normAnswer(opts.chosen);
    const reveal = opts.reveal;
    const answer = reveal && reveal.showAnswer ? Core.normAnswer(reveal.answer) : '';
    const multi = q.type === 'multi';
    const who = opts.who || '你';
    return h('div', { class: 'options', role: multi ? 'group' : 'radiogroup' }, q.options.map((text, i) => {
      const L = Core.letter(i);
      const picked = chosen.includes(L);
      let cls = 'opt' + (multi ? ' multi' : '');
      let mark = null;
      if (answer) {
        if (answer.includes(L)) { cls += ' is-answer'; mark = picked ? `✓ ${who}選了，正確` : '✓ 正確答案'; }
        else if (picked) { cls += ' is-wrong'; mark = `✗ ${who}選了，錯誤`; }
      }
      const attrs = {
        class: cls,
        type: 'button',
        disabled: !opts.onChoose,
        'data-letter': L,
        onclick: opts.onChoose ? () => opts.onChoose(L) : null,
      };
      attrs[multi ? 'aria-pressed' : 'aria-checked'] = picked ? 'true' : 'false';
      if (!multi) attrs.role = 'radio';
      return h('button', attrs,
        h('span', { class: 'key', 'aria-hidden': 'true' }, L),
        h('span', null, h('span', { class: 'sr-only' }, `(${L}) `), text, mark ? h('span', { class: 'mark' }, mark) : null));
    }));
  }
  // 外部連結：只有 http(s) 網址才做成連結，其他（例如 javascript:）只顯示文字
  function extLink(url) {
    const u = String(url || '').trim();
    if (window.Core.isWebUrl(u)) return h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, u);
    return h('span', { class: 'muted' }, u);
  }

  function typeLabel(q) { return q.type === 'multi' ? '多選題' : '單選題'; }

  function subjectOf(exam) { return exam.subject || '綜合'; }

  window.UI = {
    h, append, paras, fmtScore, fmtClock, fmtDuration, fmtDate, pct,
    route, go, start, render, currentPath, dialog, toast, saveFile, copyText, readFile,
    figure, passageBody, stemBlock, optionList, typeLabel, extLink, subjectOf, showError,
  };
})();
