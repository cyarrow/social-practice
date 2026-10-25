/* 老師端：密碼、總覽、考卷管理、編輯器、匯入、成績報表、作答明細、資料管理。 */
(function () {
  'use strict';
  const { h, fmtScore, fmtDate, fmtDuration, pct, paras } = UI;
  const Core = window.Core;
  const Store = window.Store;

  /* ---------- 門鎖 ---------- */
  function unlocked() {
    if (Store.teacherLoggedIn) return Store.teacherLoggedIn();
    try { return sessionStorage.getItem('pp.teacherOK') === '1'; } catch (e) { return !!window.__teacherOK; }
  }
  function setUnlocked() {
    window.__teacherOK = true;
    try { sessionStorage.setItem('pp.teacherOK', '1'); } catch (e) { /* 預覽環境可能不允許 */ }
  }
  function lock() {
    if (Store.logout) Store.logout();
    window.__teacherOK = false;
    try { sessionStorage.removeItem('pp.teacherOK'); } catch (e) { /* 同上 */ }
    UI.go('/');
  }
  function guard(fn) {
    return async (params) => {
      if (!unlocked()) { UI.go('/t'); return; }
      return fn(params);
    };
  }

  async function gate() {
    if (unlocked()) { UI.go('/t/home'); return; }
    const has = await Store.hasTeacherPass();
    const pass = h('input', { class: 'input', id: 't-pass', type: 'password', autocomplete: has ? 'current-password' : 'new-password' });
    const pass2 = has ? null : h('input', { class: 'input', id: 't-pass2', type: 'password', autocomplete: 'new-password' });
    const err = h('p', { class: 'err-list', 'aria-live': 'polite' });
    async function submit(e) {
      e.preventDefault();
      if (!pass.value) { err.textContent = '請輸入密碼。'; return; }
      if (!has) {
        if (pass.value.length < 4) { err.textContent = '密碼至少 4 個字。'; return; }
        if (pass.value !== pass2.value) { err.textContent = '兩次輸入的密碼不一樣。'; return; }
        await Store.setTeacherPass(pass.value);
      } else {
        let ok = false;
        try {
          ok = await Store.checkTeacherPass(pass.value);
        } catch (e2) {
          err.textContent = e2.message;
          return;
        }
        if (!ok) {
          err.textContent = '密碼不正確。';
          pass.select();
          return;
        }
      }
      setUnlocked();
      UI.go('/t/home');
    }
    await shell(null, h('div', { class: 'narrow', style: { margin: '0 auto', maxWidth: '460px' } },
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, '老師專區'),
        h('h1', { class: 'page-title' }, has ? '輸入老師密碼' : '設定老師密碼'),
        h('p', { class: 'lede' }, has ? '這裡可以管理考卷、匯入題目和看成績分析。' :
          '第一次使用，請設定一組密碼。學生打開老師專區時需要這組密碼。')),
      h('form', { class: 'panel', onsubmit: submit, style: { display: 'grid', gap: '16px' } },
        h('div', { class: 'field' }, h('label', { for: 't-pass' }, '密碼'), pass),
        pass2 ? h('div', { class: 'field' }, h('label', { for: 't-pass2' }, '再輸入一次'), pass2) : null,
        err,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'submit' }, has ? '進入' : '設定並進入'), h('a', { class: 'btn ghost', href: '#/' }, '回學生端')),
        Store.mode === 'remote' ? null : h('p', { class: 'muted', style: { fontSize: 'var(--fs-xs)' } }, '提醒：原型版本的密碼只存在這台電腦，用來避免誤入，不是嚴格的安全機制。')),
    ), true);
    pass.focus();
  }

  /* ---------- 版面 ---------- */
  async function shell(active, content, bare) {
    document.body.classList.remove('taking');
    document.body.classList.add('teacher');
    const link = (href, text, key) => h('a', { href, 'aria-current': active === key ? 'page' : null }, text);
    document.getElementById('app').replaceChildren(
      h('header', { class: 'masthead' }, h('div', { class: 'wrap' },
        h('a', { class: 'brand', href: bare ? '#/' : '#/t/home' },
          h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '師'),
          h('span', { class: 'brand-name' }, Student.APP_NAME),
          h('span', { class: 'brand-tag' }, '老師專區')),
        bare ? null : h('nav', { class: 'nav', 'aria-label': '老師選單' },
          link('#/t/home', '總覽', 'home'),
          link('#/t/exams', '考卷管理', 'exams'),
          Store.features.students ? link('#/t/students', '學生', 'students') : null,
          link('#/t/import', '匯入', 'import'),
          link('#/t/reports', '成績報表', 'reports'),
          link('#/t/data', '資料', 'data'),
          h('button', { class: 'who', type: 'button', onclick: lock }, '登出並回學生端')))),
      h('main', null, h('div', { class: 'wrap' }, content)));
    window.scrollTo(0, 0);
  }

  function submittedOnly(list) { return list.filter((a) => a.status === 'submitted'); }

  /* ---------- 總覽 ---------- */
  async function home() {
    const everything = await Store.listAttempts();
    const attempts = submittedOnly(everything);
    // 正在作答、時間還沒到的考卷（不會即時更新，重新整理才會變）
    const running = everything.filter((a) => a.status === 'in_progress' && !a.demo && Date.parse(a.deadline) > Date.now());
    const exams = await Store.listExams();
    const real = attempts.filter((a) => !a.demo);
    const scores = attempts.map((a) => pct(a.result.earned, a.result.max));
    const avg = scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null;
    const lessons = lessonStats(attempts);
    const weakest = lessons.filter((l) => l.max > 0).sort((a, b) => a.rate - b.rate).slice(0, 3);

    await shell('home', [
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, '老師專區'),
        h('h1', { class: 'page-title' }, '總覽'),
        h('p', { class: 'lede' }, Store.mode === 'remote' ?
          '學生交卷後，成績會自動存到你的 Google 試算表，這裡的數字也會跟著更新。' :
          '原型版本的成績只存在各自的電腦裡。學生在自己的筆電作答後，請他從「作答紀錄」匯出成績檔，你再到「匯入」頁匯進來。')),
      running.length ? h('div', { style: { display: 'grid', gap: '10px', marginBottom: '20px' } }, running.map((a) =>
        h('div', { class: 'notice quiet' }, h('div', null,
          h('b', null, a.student), ` 正在寫〈${a.examTitle}〉，剩 ${Math.max(1, Math.ceil((Date.parse(a.deadline) - Date.now()) / 60000))} 分鐘`)))) : null,
      attempts.length ? null : h('div', { class: 'notice', style: { marginBottom: '20px' } },
        h('div', null, Store.mode === 'remote' ? '目前還沒有任何成績。學生交卷後就會出現在這裡；也可以先產生一組示範成績，看看報表長什麼樣子。' : '目前還沒有任何成績。可以先匯入學生的成績檔，或產生一組示範成績，看看報表長什麼樣子。'),
        h('div', { class: 'btn-row' },
          Store.features.resultImport ? h('a', { class: 'btn small', href: '#/t/import' }, '匯入成績檔') : null,
          h('button', { class: 'btn small primary', type: 'button', onclick: async () => { await makeDemo(); UI.render(); } }, '產生示範成績'))),
      real.length === 0 && attempts.length ? h('div', { class: 'notice quiet', style: { marginBottom: '20px' } },
        h('div', null, '目前顯示的是示範成績，不是學生的真實紀錄。'),
        h('button', { class: 'btn small', type: 'button', onclick: async () => { await Store.clearDemo(); UI.render(); } }, '清除示範成績')) : null,
      h('dl', { class: 'stat-row', style: { margin: '0 0 20px' } },
        h('div', { class: 'stat' }, h('dt', null, '考卷'), h('dd', null, exams.length, h('small', null, ' 份'))),
        h('div', { class: 'stat' }, h('dt', null, '已交卷'), h('dd', null, attempts.length, h('small', null, ' 次'))),
        h('div', { class: 'stat' }, h('dt', null, '平均得分率'), h('dd', null, avg === null ? '—' : avg, avg === null ? null : h('small', null, ' %'))),
        h('div', { class: 'stat' }, h('dt', null, '最近一次'), h('dd', { style: { fontSize: 'var(--fs-lg)' } }, attempts[0] ? fmtDate(attempts[0].submittedAt) : '—'))),
      h('div', { class: 'grid-2' },
        h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '最近交卷'),
          attempts.length ? attemptTable(attempts.slice(0, 8)) : h('p', { class: 'empty' }, '還沒有交卷紀錄。')),
        h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '最需要加強的課次'),
          weakest.length ? lessonBars(weakest) : h('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)' } }, '有成績之後，這裡會列出得分率最低的課次。'),
          h('div', { class: 'btn-row', style: { marginTop: '20px' } }, h('a', { class: 'btn', href: '#/t/reports' }, '看完整報表')))),
    ]);
  }

  function attemptTable(list) {
    return h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, '交卷時間'), h('th', null, '學生'), h('th', null, '考卷'), h('th', { class: 'r' }, '分數'), h('th', { class: 'r' }, '用時'), h('th', null, ''))),
      h('tbody', null, list.map((a) => h('tr', null,
        h('td', { class: 'num' }, fmtDate(a.submittedAt)),
        h('td', null, a.student, a.demo ? h('span', { class: 'pill', style: { marginLeft: '6px' } }, '示範') : null),
        h('td', null, a.examTitle),
        h('td', { class: 'r' }, `${fmtScore(a.result.earned)} / ${fmtScore(a.result.max)}`),
        h('td', { class: 'r' }, fmtDuration(a.durationSec)),
        h('td', { class: 'nw' }, h('a', { class: 'btn small', href: '#/t/attempt/' + a.id, 'aria-label': `查看${a.student}的〈${a.examTitle}〉作答` }, '查看')))))));
  }

  /* ---------- 單次作答明細 ---------- */
  // 考卷被刪掉時，題目內容看不到，只列出交卷時存下的每題作答
  function perQTable(r) {
    const rows = Object.values(r.perQ).sort((x, y) => (x.no || 0) - (y.no || 0));
    return h('section', { class: 'panel', style: { marginTop: '20px' } },
      h('h2', { class: 'panel-title' }, '逐題作答'),
      h('div', { class: 'notice quiet', style: { marginBottom: '16px' } }, h('div', null, '這份考卷已經被刪除，看不到題目內容。下面是交卷時存下的每題作答。')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, '題號'), h('th', null, '課次'), h('th', null, '學生的答案'), h('th', null, '正解'), h('th', null, '結果'), h('th', { class: 'r' }, '得分'))),
        h('tbody', null, rows.map((p) => {
          const st = Student.STATUS[p.status] || Student.STATUS.blank;
          return h('tr', null,
            h('td', { class: 'num' }, p.no || '—'),
            h('td', null, p.lesson || '—'),
            h('td', null, p.chosen || '（沒有作答）'),
            h('td', null, h('b', null, p.answer || '—')),
            h('td', null, h('span', { class: 'pill ' + st.cls }, st.text)),
            h('td', { class: 'r' }, `${fmtScore(p.earned)} / ${fmtScore(p.max)}`));
        })))));
  }

  async function attempt({ id }) {
    const a = await Store.getAttempt(id);
    if (!a) throw new Error('找不到這筆作答紀錄，可能已經刪除了。');
    // 老師端拿到的考卷含答案；考卷被刪掉時為 null
    const exam = await Store.getExam(a.examId);
    const done = a.status === 'submitted' && a.result;

    async function remove() {
      const ok = await UI.dialog({
        title: '刪除這筆作答紀錄？',
        body: `${a.student}在 ${fmtDate(a.submittedAt || a.startedAt)} 寫的〈${a.examTitle}〉會被刪除，無法復原。這次的分數會從成績報表和學生的作答紀錄裡消失。`,
        ok: '刪除',
        danger: true,
      });
      if (!ok) return;
      try {
        await Store.deleteAttempt(a.id);
      } catch (e) {
        UI.toast('刪除失敗：' + e.message, 4000);
        return;
      }
      UI.toast('已刪除這筆作答紀錄');
      UI.go('/t/reports');
    }

    const pill = (text, cls) => h('span', { class: 'pill' + (cls ? ' ' + cls : '') }, text);
    const blocks = [
      h('p', { style: { marginBottom: '20px' } }, h('a', { href: '#/t/reports', class: 'muted' }, '← 回成績報表')),
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, '作答明細' + (a.subject ? ' · ' + a.subject : '')),
        h('h1', { class: 'page-title' }, a.examTitle),
        h('p', { class: 'lede' },
          h('b', null, a.student),
          done ? `　交卷 ${fmtDate(a.submittedAt)}　用時 ${fmtDuration(a.durationSec)}` : `　開始 ${fmtDate(a.startedAt)}`),
        a.demo || a.autoSubmitted || !done ? h('div', { class: 'btn-row' },
          !done ? pill('作答中', 'solid') : null,
          a.autoSubmitted ? pill('時間到自動交卷') : null,
          a.demo ? pill('示範') : null) : null),
    ];
    if (done) {
      const r = a.result;
      const c = Student.statusCounts(r);
      blocks.push(
        Student.scoreHero(r, [
          ['答對', `${c.correct} / ${c.total} 題`],
          ['部分得分', `${c.partial} 題`],
          ['答錯', `${c.wrong} 題`],
          ['未作答', `${c.blank} 題`],
          ['得分率', pct(r.earned, r.max) + '%'],
        ]),
        Student.breakdown(r),
        // 老師一律看得到答案與解析
        exam ? Student.reviewPanel(r, exam, true, { teacher: true }) : perQTable(r));
    } else {
      blocks.push(h('div', { class: 'notice quiet' }, h('div', null, Date.parse(a.deadline) > Date.now() ?
        `學生還在作答，交卷後才看得到成績。剩 ${Math.max(1, Math.ceil((Date.parse(a.deadline) - Date.now()) / 60000))} 分鐘。` :
        '作答時間已經到了，但還沒批改。學生下次打開網站時，系統會自動交卷。')));
    }
    blocks.push(h('section', { class: 'panel', style: { marginTop: '28px' } },
      h('h2', { class: 'panel-title' }, '刪除紀錄'),
      h('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)', marginBottom: '16px' } }, '測試用或寫錯的紀錄可以刪掉。刪除後無法復原，分數也不會再算進報表。'),
      h('button', { class: 'btn danger', type: 'button', onclick: remove }, '刪除這筆作答紀錄')));
    await shell('reports', blocks);
  }

  function lessonStats(attempts) {
    const m = {};
    attempts.forEach((a) => Object.entries(a.result.byLesson || {}).forEach(([L, s]) => {
      const key = (a.subject ? a.subject + ' ' : '') + L;
      m[key] = m[key] || { lesson: key, earned: 0, max: 0 };
      m[key].earned += s.earned;
      m[key].max += s.max;
    }));
    return Object.values(m).map((x) => Object.assign(x, { rate: x.max ? x.earned / x.max : 0 }))
      .sort((a, b) => a.lesson.localeCompare(b.lesson, 'zh-Hant', { numeric: true }));
  }
  function lessonBars(list) {
    return h('div', { class: 'bars' }, list.map((l) => {
      const p = Math.round(l.rate * 100);
      return h('div', { class: 'bar-row', style: { gridTemplateColumns: '120px minmax(0,1fr) 64px' } },
        h('span', { class: 'lbl' }, l.lesson),
        h('div', { class: 'bar-track', title: `${l.lesson}：${fmtScore(l.earned)} / ${fmtScore(l.max)} 分` }, h('div', { class: 'bar-fill' + (p < 60 ? ' low' : ''), style: { width: p + '%' } })),
        h('span', { class: 'val' }, p + '%'));
    }));
  }

  /* ---------- 考卷管理 ---------- */
  async function exams() {
    const list = await Store.listExams();
    const hidden = await Store.hiddenCount();
    const attempts = submittedOnly(await Store.listAttempts());

    function row(e) {
      const n = Core.flatQuestions(e).length;
      const used = attempts.filter((a) => a.examId === e.id).length;
      const pub = h('input', { type: 'checkbox', id: 'pub-' + e.id, checked: e.settings.published, onchange: async (ev) => { await Store.updateSettings(e.id, { published: ev.target.checked }); UI.toast(ev.target.checked ? '學生看得到這份考卷了' : '已對學生隱藏'); } });
      const reveal = h('select', { class: 'input', id: 'rev-' + e.id, style: { width: 'auto', padding: '4px 8px' }, onchange: async (ev) => { await Store.updateSettings(e.id, { reveal: ev.target.value }); UI.render(); } },
        h('option', { value: 'immediate', selected: e.settings.reveal === 'immediate' }, '交卷後立即'),
        h('option', { value: 'manual', selected: e.settings.reveal === 'manual' }, '老師開放後'));
      return h('tr', null,
        h('td', null,
          h('span', { class: 'tag' }, [UI.subjectOf(e)].concat(e.lessons || []).join(' · ')), h('br'),
          h('a', { href: '#/t/edit/' + e.id, style: { fontWeight: 700 } }, e.title),
          e.modified ? h('span', { class: 'pill', style: { marginLeft: '8px' } }, '已修改') : null,
          !e.builtin && Store.mode === 'local' ? h('span', { class: 'pill', style: { marginLeft: '8px' } }, '自建') : null),
        h('td', { class: 'r' }, n),
        h('td', { class: 'r nw' }, e.timeLimit + ' 分'),
        h('td', { class: 'r' }, used),
        h('td', { class: 'nw' }, h('label', { class: 'toggle' }, pub, '開放')),
        h('td', null, h('div', { style: { display: 'grid', gap: '6px' } }, reveal,
          e.settings.reveal === 'manual' ? h('label', { class: 'toggle' },
            h('input', { type: 'checkbox', id: 'rel-' + e.id, checked: e.settings.released, onchange: async (ev) => { await Store.updateSettings(e.id, { released: ev.target.checked }); UI.toast(ev.target.checked ? '已開放解析' : '已收回解析'); } }),
            '已開放解析') : null)),
        h('td', { class: 'nw' }, h('div', { class: 'btn-row' },
          h('a', { class: 'btn small', href: '#/t/preview/' + e.id }, '解答卷'),
          h('a', { class: 'btn small', href: '#/t/edit/' + e.id }, '編輯'),
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => duplicate(e) }, '複製'),
          e.modified ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => revert(e) }, '還原') : null,
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => remove(e) }, e.builtin ? '移除' : '刪除'))));
    }

    await shell('exams', [
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, '考卷管理'),
        h('h1', { class: 'page-title' }, `${list.length} 份考卷`),
        h('p', { class: 'lede' }, '「開放」控制學生看不看得到；「解析」決定交卷後是否馬上顯示答案。' + (Store.mode === 'remote' ? '考卷存在你的 Google 試算表。' : '修改內建考卷會另存一份，隨時可以還原。'))),
      h('div', { class: 'btn-row', style: { marginBottom: '20px' } },
        h('a', { class: 'btn primary', href: '#/t/new' }, '新增空白考卷'),
        h('a', { class: 'btn', href: '#/t/import' }, '貼上文字匯入'),
        hidden ? h('button', { class: 'btn ghost', type: 'button', onclick: async () => { await Store.restoreHidden(); UI.render(); } }, `還原移除的內建考卷（${hidden}）`) : null),
      h('section', { class: 'panel' }, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, '考卷'), h('th', { class: 'r' }, '題數'), h('th', { class: 'r' }, '時間'), h('th', { class: 'r' }, '交卷次數'), h('th', null, '學生'), h('th', null, '解析'), h('th', null, ''))),
        h('tbody', null, list.map(row))))),
    ]);
  }
  async function duplicate(e) {
    const copy = JSON.parse(JSON.stringify(e));
    copy.id = Core.uid('x');
    copy.title = e.title + '（副本）';
    copy.createdAt = new Date().toISOString().slice(0, 10);
    await Store.saveExam(copy);
    UI.toast('已建立副本');
    UI.go('/t/edit/' + copy.id);
  }
  async function revert(e) {
    if (!(await UI.dialog({ title: '還原成原本的內容？', body: `「${e.title}」的修改會被捨棄，回到內建題庫的版本。`, ok: '還原', danger: true }))) return;
    await Store.revertExam(e.id);
    UI.render();
  }
  async function remove(e) {
    const body = e.builtin ? '內建考卷移除後可以在這一頁按「還原移除的內建考卷」找回來。學生已有的成績不受影響。' : '自己建立的考卷刪除後無法復原。學生已有的成績不受影響，但看不到題目內容。';
    if (!(await UI.dialog({ title: `${e.builtin ? '移除' : '刪除'}「${e.title}」？`, body, ok: e.builtin ? '移除' : '刪除', danger: true }))) return;
    await Store.deleteExam(e.id);
    UI.render();
  }

  /* ---------- 解答卷（老師預覽） ---------- */
  async function preview({ id }) {
    const e = await Store.getExam(id);
    if (!e) throw new Error('找不到這份考卷');
    let lastGroup = null;
    const items = Core.flatQuestions(e).map(({ q, no, group }) => {
      const showGroup = group && group !== lastGroup;
      lastGroup = group;
      return h('article', { class: 'review-item' },
        showGroup ? h('div', { class: 'explain', style: { marginTop: 0, marginBottom: '16px', background: 'var(--ground)' } },
          h('h4', null, '題組文章'), h('p', { style: { fontWeight: 700 } }, group.title), UI.passageBody(group)) : null,
        h('div', { class: 'qhead' },
          h('span', null, h('span', { class: 'qno' }, no), ' ', h('span', { class: 'qtype' }, `${UI.typeLabel(q)} · ${fmtScore(q.points)} 分${q.lesson ? ' · ' + q.lesson : ''}`))),
        UI.stemBlock(q),
        UI.optionList(q, { chosen: '', reveal: { answer: q.answer, showAnswer: true } }),
        h('div', { class: 'explain' }, h('h4', null, '答案 ' + q.answer), paras(q.explanation || '（沒有解析）'), q.ref ? h('p', { class: 'ref' }, '出處：' + q.ref) : null));
    });
    await shell('exams', h('div', { class: 'narrow', style: { margin: '0 auto' } },
      h('p', { style: { marginBottom: '20px' } }, h('a', { href: '#/t/exams', class: 'muted' }, '← 回考卷管理')),
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, '解答卷'),
        h('h1', { class: 'page-title' }, e.title),
        h('p', { class: 'lede' }, `${Core.flatQuestions(e).length} 題 · ${e.timeLimit} 分鐘 · 滿分 ${fmtScore(Core.maxScore(e))}${e.origin ? ' · ' + e.origin : ''}`)),
      h('div', { class: 'btn-row', style: { marginBottom: '20px' } }, h('a', { class: 'btn', href: '#/t/edit/' + e.id }, '編輯這份考卷')),
      h('section', { class: 'panel' }, h('div', { class: 'review' }, items)),
      e.sources && e.sources.length ? h('section', { class: 'panel', style: { marginTop: '20px' } },
        h('h2', { class: 'panel-title' }, '時事題資料來源'),
        h('ul', { class: 'sources', style: { padding: 0 } }, e.sources.map((s) => h('li', null, s.ref ? h('b', null, s.ref + '：') : null, s.title, ' ', UI.extLink(s.url))))) : null));
  }

  /* ---------- 編輯器 ---------- */
  function blankQuestion(type, points) {
    return { id: Core.uid('q'), type: type || 'single', stem: '', options: ['', '', '', ''].concat(type === 'multi' ? [''] : []), answer: '', explanation: '', lesson: '', ref: '', points: points || 2 };
  }
  function tableToText(t) { return (t || []).map((r) => '| ' + r.join(' | ') + ' |').join('\n'); }
  function textToTable(s) {
    const rows = s.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'))
      .map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
      .filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
    return rows.length ? rows : undefined;
  }

  async function edit({ id }) {
    let ex;
    if (id) {
      const e = await Store.getExam(id);
      if (!e) throw new Error('找不到這份考卷');
      ex = JSON.parse(JSON.stringify(e));
    } else {
      ex = {
        id: Core.uid('x'), title: '', subject: '歷史', lessons: [], timeLimit: 40, description: '',
        createdAt: new Date().toISOString().slice(0, 10), origin: '老師自建',
        settings: { published: false, reveal: 'immediate' },
        sections: [
          { title: '壹、單選題', note: '每題 2 分', items: [blankQuestion('single', 2)] },
          { title: '貳、多選題', note: '每題 4 分；依學測方式計分', items: [blankQuestion('multi', 4)] },
        ],
        sources: [],
      };
    }
    delete ex.builtin;
    delete ex.modified;
    const body = h('div');
    const errBox = h('div', { 'aria-live': 'polite' });
    let dirty = false;

    const bind = (obj, key, transform) => (ev) => { obj[key] = transform ? transform(ev.target.value) : ev.target.value; dirty = true; };
    function field(label, input, hint) {
      return h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
    }
    let fid = 0;
    const nid = () => 'f' + (++fid);

    // 題目或題組的圖片：路徑留空就是不放圖（直接刪掉 image，不留空物件）
    function imageFields(obj, label) {
      let src = obj.image ? obj.image.src || '' : '';
      let alt = obj.image ? obj.image.alt || '' : '';
      const preview = h('div', { class: 'image-preview' });
      function drawPreview() {
        const s = src.trim();
        if (!s) preview.replaceChildren();
        else if (!Core.isImageSrc(s)) preview.replaceChildren(h('p', { class: 'hint err' }, '路徑要寫成 images/檔名，或用 https:// 開頭的網址。'));
        else preview.replaceChildren(...[UI.figure({ src: s, alt: alt.trim() || '（還沒寫替代文字）' }),
          alt.trim() ? null : h('p', { class: 'hint err' }, '請寫替代文字，說明圖片的內容。')].filter(Boolean));
      }
      function sync() {
        if (src.trim()) obj.image = { src: src.trim(), alt: alt.trim() };
        else delete obj.image;
        dirty = true;
        drawPreview();
      }
      drawPreview();
      return h('details', { open: !!obj.image }, h('summary', { class: 'muted', style: { cursor: 'pointer', fontSize: 'var(--fs-sm)' } }, label),
        h('div', { style: { marginTop: '8px', display: 'grid', gap: '12px' } },
          h('div', { class: 'form-grid', style: { alignItems: 'start' } },
            field('圖片路徑或網址', h('input', { class: 'input', id: nid(), value: src, placeholder: 'images/geo-l1-terrain.png', oninput: (ev) => { src = ev.target.value; sync(); } }),
              '圖片檔放在 images/ 資料夾，或用 https:// 網址。留空就是不放圖。'),
            field('圖片說明（替代文字）', h('input', { class: 'input', id: nid(), value: alt, placeholder: '例如：臺灣地形分區圖', oninput: (ev) => { alt = ev.target.value; sync(); } }))),
          preview));
    }

    function questionEditor(q, no, list, idx) {
      const optBox = h('div', { style: { display: 'grid', gap: '8px' } });
      function drawOpts() {
        optBox.replaceChildren(...q.options.map((o, i) => {
          const L = Core.letter(i);
          const isAns = Core.normAnswer(q.answer).includes(L);
          const check = h('input', {
            type: q.type === 'multi' ? 'checkbox' : 'radio', name: 'ans-' + q.id, id: nid(), checked: isAns, 'aria-label': `(${L}) 是正確答案`,
            onchange: (ev) => {
              if (q.type === 'multi') {
                const cur = Core.normAnswer(q.answer);
                q.answer = ev.target.checked ? Core.normAnswer(cur + L) : cur.replace(L, '');
              } else q.answer = L;
              dirty = true;
            },
          });
          return h('div', { class: 'opt-edit' },
            h('label', { class: 'key-check' }, check, L),
            h('input', { class: 'input', id: nid(), value: o, 'aria-label': `選項 ${L}`, oninput: (ev) => { q.options[i] = ev.target.value; dirty = true; } }),
            h('button', { class: 'btn small ghost', type: 'button', disabled: q.options.length <= 2, onclick: () => {
              q.options.splice(i, 1);
              q.answer = Core.normAnswer(q.answer).split('').filter((x) => x !== L).map((x) => (x > L ? Core.letter(Core.LETTERS.indexOf(x) - 1) : x)).join('');
              dirty = true;
              drawOpts();
            } }, '刪除'));
        }), h('div', null, h('button', { class: 'btn small', type: 'button', disabled: q.options.length >= 8, onclick: () => { q.options.push(''); dirty = true; drawOpts(); } }, '＋ 加一個選項')));
      }
      drawOpts();
      const typeSel = h('select', { class: 'input', id: nid(), onchange: (ev) => { q.type = ev.target.value; if (q.type === 'single') q.answer = Core.normAnswer(q.answer).slice(0, 1); dirty = true; drawOpts(); } },
        h('option', { value: 'single', selected: q.type === 'single' }, '單選'),
        h('option', { value: 'multi', selected: q.type === 'multi' }, '多選（學測計分）'));
      const tableTa = h('textarea', { class: 'input', id: nid(), placeholder: '| 測站 | 1 月均溫 |\n| 甲 | −18 |', style: { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', minHeight: '64px' },
        oninput: (ev) => { const t = textToTable(ev.target.value); if (t) q.table = t; else delete q.table; dirty = true; } }, tableToText(q.table));
      return h('div', { class: 'editor-q' },
        h('header', null,
          h('span', { class: 'qno' }, no),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn small ghost', type: 'button', disabled: idx === 0, onclick: () => { [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]]; dirty = true; draw(); } }, '上移'),
          h('button', { class: 'btn small ghost', type: 'button', disabled: idx === list.length - 1, onclick: () => { [list[idx + 1], list[idx]] = [list[idx], list[idx + 1]]; dirty = true; draw(); } }, '下移'),
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => { list.splice(idx, 1); dirty = true; draw(); } }, '刪除這題')),
        h('div', { class: 'form-grid' },
          field('題型', typeSel),
          field('配分', h('input', { class: 'input', id: nid(), type: 'number', min: 0.5, step: 0.5, value: q.points, oninput: bind(q, 'points', Number) })),
          field('課次', h('input', { class: 'input', id: nid(), value: q.lesson || '', placeholder: 'L5', oninput: bind(q, 'lesson') })),
          field('出處', h('input', { class: 'input', id: nid(), value: q.ref || '', placeholder: '講義 p.24', oninput: bind(q, 'ref') }))),
        field('題幹', h('textarea', { class: 'input', id: nid(), oninput: bind(q, 'stem') }, q.stem)),
        h('details', { open: !!q.table }, h('summary', { class: 'muted', style: { cursor: 'pointer', fontSize: 'var(--fs-sm)' } }, '題幹表格（選填）'),
          h('div', { style: { marginTop: '8px' } }, field('每列用「|」分隔，第一列是表頭', tableTa))),
        imageFields(q, '題目圖片（選填）'),
        h('div', { class: 'field' }, h('span', { class: 'label' }, q.type === 'multi' ? '選項（勾選所有正確答案）' : '選項（點選正確答案）'), optBox),
        field('解析', h('textarea', { class: 'input', id: nid(), oninput: bind(q, 'explanation') }, q.explanation || '')));
    }

    function draw() {
      fid = 0;
      let no = 0;
      const sections = ex.sections.map((sec, si) => {
        const items = sec.items.map((item, ii) => {
          if (item.type === 'group') {
            const qs = item.questions.map((q, qi) => questionEditor(q, ++no, item.questions, qi));
            return h('div', { class: 'editor-group' },
              h('div', { class: 'btn-row', style: { justifyContent: 'space-between' } },
                h('b', null, '題組'),
                h('div', { class: 'btn-row' },
                  h('button', { class: 'btn small ghost', type: 'button', disabled: ii === 0, onclick: () => { [sec.items[ii - 1], sec.items[ii]] = [sec.items[ii], sec.items[ii - 1]]; dirty = true; draw(); } }, '上移'),
                  h('button', { class: 'btn small ghost', type: 'button', onclick: () => { sec.items.splice(ii, 1); dirty = true; draw(); } }, '刪除題組'))),
              field('題組標題', h('input', { class: 'input', id: nid(), value: item.title, oninput: bind(item, 'title') })),
              field('文章（每段一行）', h('textarea', { class: 'input', id: nid(), style: { minHeight: '160px' }, oninput: (ev) => { item.passage = ev.target.value.split('\n').map((s) => s.trim()).filter(Boolean); dirty = true; } }, item.passage.join('\n'))),
              imageFields(item, '題組圖片（選填，顯示在文章下面）'),
              qs,
              h('div', null, h('button', { class: 'btn small', type: 'button', onclick: () => { item.questions.push(blankQuestion('single', item.questions[0] ? item.questions[0].points : 3)); dirty = true; draw(); } }, '＋ 題組內加一題')));
          }
          return questionEditor(item, ++no, sec.items, ii);
        });
        const lastPts = (() => { const q = sec.items.slice().reverse().find((x) => x.type !== 'group'); return q ? q.points : 2; })();
        return h('section', { class: 'editor-section' },
          h('div', { class: 'form-grid' },
            field('大題名稱', h('input', { class: 'input', id: nid(), value: sec.title, oninput: bind(sec, 'title') })),
            field('配分說明', h('input', { class: 'input', id: nid(), value: sec.note || '', placeholder: '每題 2 分', oninput: bind(sec, 'note') }))),
          items,
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn small', type: 'button', onclick: () => { sec.items.push(blankQuestion('single', lastPts)); dirty = true; draw(); } }, '＋ 單選題'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { sec.items.push(blankQuestion('multi', lastPts)); dirty = true; draw(); } }, '＋ 多選題'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { sec.items.push({ id: Core.uid('g'), type: 'group', title: '題組', passage: [], questions: [blankQuestion('single', 3)] }); dirty = true; draw(); } }, '＋ 題組'),
            h('button', { class: 'btn small ghost', type: 'button', onclick: () => { ex.sections.splice(si, 1); dirty = true; draw(); } }, '刪除這個大題')));
      });
      const srcTa = h('textarea', { class: 'input', id: nid(), style: { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)' }, placeholder: '第 3 題 | 標題 | https://…',
        oninput: (ev) => { ex.sources = ev.target.value.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p.length >= 2 && p.join('')).map((p) => (p.length >= 3 ? { ref: p[0], title: p[1], url: p[2] } : { ref: '', title: p[0], url: p[1] })); dirty = true; } },
        (ex.sources || []).map((s) => [s.ref, s.title, s.url].join(' | ')).join('\n'));
      body.replaceChildren(
        h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '基本資料'),
          h('div', { style: { display: 'grid', gap: '16px' } },
            field('考卷標題', h('input', { class: 'input', id: nid(), value: ex.title, oninput: bind(ex, 'title') })),
            h('div', { class: 'form-grid' },
              field('科目', h('select', { class: 'input', id: nid(), onchange: bind(ex, 'subject') }, ['地理', '歷史', '公民', '綜合'].map((s) => h('option', { selected: ex.subject === s }, s)))),
              field('課次', h('input', { class: 'input', id: nid(), value: (ex.lessons || []).join(', '), placeholder: 'L4, L5', oninput: bind(ex, 'lessons', (v) => v.split(/[,，、\s]+/).filter(Boolean)) })),
              field('作答時間（分鐘）', h('input', { class: 'input', id: nid(), type: 'number', min: 1, value: ex.timeLimit, oninput: bind(ex, 'timeLimit', Number) }))),
            field('說明', h('textarea', { class: 'input', id: nid(), style: { minHeight: '64px' }, oninput: bind(ex, 'description') }, ex.description || '')))),
        h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '題目', h('small', null, `目前 ${Core.flatQuestions(ex).length} 題，滿分 ${fmtScore(Core.maxScore(ex))}`)),
          sections,
          h('div', { class: 'btn-row', style: { marginTop: '24px' } }, h('button', { class: 'btn', type: 'button', onclick: () => { ex.sections.push({ title: '新的大題', note: '', items: [] }); dirty = true; draw(); } }, '＋ 新增大題'))),
        h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '時事題資料來源', h('small', null, '每行一筆：題號 | 標題 | 網址')),
          srcTa));
    }

    async function save() {
      ex.sections.forEach((s) => s.items.forEach((it) => {
        if (it.type !== 'group' && it.type === 'single') it.answer = Core.normAnswer(it.answer).slice(0, 1);
      }));
      const errs = Core.validateExam(ex);
      if (errs.length) {
        errBox.replaceChildren(h('div', { class: 'notice', style: { marginBottom: '16px' } },
          h('div', null, h('b', null, `還有 ${errs.length} 個地方要修正才能儲存：`), h('ul', { class: 'err-list', style: { padding: 0, margin: '8px 0 0' } }, errs.slice(0, 12).map((e) => h('li', null, e))))));
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      errBox.replaceChildren();
      await Store.saveExam(ex);
      dirty = false;
      UI.toast('已儲存');
      UI.go('/t/exams');
    }

    draw();
    await shell('exams', [
      h('p', { style: { marginBottom: '20px' } }, h('a', { href: '#/t/exams', class: 'muted' }, '← 回考卷管理')),
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, id ? '編輯考卷' : '新增考卷'),
        h('h1', { class: 'page-title' }, ex.title || '未命名考卷')),
      errBox,
      h('div', { class: 'btn-row', style: { marginBottom: '20px', position: 'sticky', top: 'calc(61px + env(safe-area-inset-top, 0px))', zIndex: 5, background: 'var(--ground)', padding: '10px 0' } },
        h('button', { class: 'btn primary', type: 'button', onclick: save }, '儲存'),
        h('a', { class: 'btn ghost', href: '#/t/exams' }, '取消')),
      body,
    ]);
    const onLeave = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }

  /* ---------- 匯入 ---------- */
  const SAMPLE = [
    '#考卷 L5 宋元時期的互動｜小考',
    '#科目 歷史',
    '#時間 15',
    '#課次 L5',
    '#來源 第 2 題 | 新聞標題 | https://example.com/news',
    '',
    '## 壹、單選題 5',
    '1. 澶淵之盟簽訂後，宋遼之間的關係為何？',
    '(A) 宋向遼稱臣',
    '(B) 雙方建立對等外交關係，宋每年給遼歲幣',
    '(C) 遼向宋稱臣納貢',
    '(D) 雙方斷絕往來',
    '答案：B',
    '解析：澶淵之盟後宋遼建立對等外交，宋每年給遼銀、絹。',
    '出處：講義 p.22',
    '',
    '## 貳、多選題 8',
    '2. 關於元代的商貿，下列哪些正確？',
    '(A) 廣設驛站',
    '(B) 廣泛使用紙幣',
    '(C) 廢除市舶司',
    '(D) 穆斯林商人常管理財政',
    '(E) 陸路因西夏阻隔而不發達',
    '答案：ABD',
    '解析：(C) 元沿用市舶司；(E) 是宋代的情形。',
    '',
    '## 參、題組 5',
    '【題組一：清明上河圖】',
    '北宋畫家張擇端的《清明上河圖》中，汴河兩岸商店林立……',
    '3. 畫中的景象最能說明宋代城市的哪個變化？',
    '(A) 坊市制度瓦解',
    '(B) 實施宵禁',
    '(C) 驛站普及',
    '(D) 紙幣出現',
    '答案：A',
  ].join('\n');

  async function importPage() {
    let tab = Store.pref('importTab') || 'text';
    const box = h('div');
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    function drawTabs() {
      const all = [['text', '貼上文字'], ['file', '上傳考卷檔']].concat(Store.features.resultImport ? [['results', '匯入學生成績檔']] : []);
      if (!all.some(([k]) => k === tab)) tab = 'text';
      tabs.replaceChildren(...all.map(([k, t]) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; Store.pref('importTab', k); drawTabs(); drawBody(); } }, t)));
    }
    function drawBody() {
      if (tab === 'text') box.replaceChildren(textImport());
      else if (tab === 'file') box.replaceChildren(fileImport());
      else box.replaceChildren(resultsImport());
    }
    drawTabs();
    drawBody();
    await shell('import', [
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, '匯入'),
        h('h1', { class: 'page-title' }, '把題目或成績匯進平台'),
        h('p', { class: 'lede' }, '請 Claude 出題時，可以要求它「用練習平台的文字格式輸出」，再貼到這裡。也可以上傳 JSON 考卷檔' + (Store.features.resultImport ? '，或匯入學生交來的成績檔。' : '。'))),
      tabs,
      box,
    ]);
  }

  function textImport() {
    const ta = h('textarea', { class: 'input code', id: 'import-text', spellcheck: 'false' }, Store.pref('importDraft') || SAMPLE);
    const out = h('div');
    let parsed = null;
    function check() {
      Store.pref('importDraft', ta.value);
      const { exam, errors } = Core.parseText(ta.value);
      parsed = errors.length ? null : exam;
      const qs = Core.flatQuestions(exam);
      out.replaceChildren(h('section', { class: 'panel' },
        h('h2', { class: 'panel-title' }, '檢查結果'),
        h('dl', { class: 'score-meta', style: { margin: '0 0 16px' } },
          h('div', null, h('dt', null, '標題'), h('dd', null, exam.title || '—')),
          h('div', null, h('dt', null, '題數'), h('dd', null, qs.length)),
          h('div', null, h('dt', null, '滿分'), h('dd', null, fmtScore(Core.maxScore(exam)))),
          h('div', null, h('dt', null, '時間'), h('dd', null, exam.timeLimit + ' 分鐘'))),
        errors.length ? h('div', null, h('p', null, h('b', null, `有 ${errors.length} 個問題：`)), h('ul', { class: 'err-list', style: { padding: 0 } }, errors.slice(0, 20).map((e) => h('li', null, e)))) :
          h('p', { style: { color: 'var(--good)', fontWeight: 700 } }, '格式正確，可以儲存。'),
        Core.maxScore(exam) !== 100 && !errors.length ? h('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)' } }, `提醒：滿分是 ${fmtScore(Core.maxScore(exam))} 分，不是 100 分。`) : null,
        h('div', { class: 'btn-row', style: { marginTop: '16px' } },
          h('button', { class: 'btn primary', type: 'button', disabled: !parsed, onclick: save }, '儲存為新考卷'))));
    }
    async function save() {
      if (!parsed) return;
      parsed.id = parsed.id || Core.uid('x');
      if (await Store.getExam(parsed.id)) parsed.id = Core.uid('x');
      parsed.createdAt = new Date().toISOString().slice(0, 10);
      parsed.origin = '文字匯入';
      parsed.settings = { published: false, reveal: 'immediate' };
      await Store.saveExam(parsed);
      Store.pref('importDraft', '');
      UI.toast('已儲存。確認內容後，到考卷管理勾選「開放」學生才看得到。', 4000);
      UI.go('/t/preview/' + parsed.id);
    }
    return h('div', { class: 'grid-2' },
      h('section', { class: 'panel' },
        h('div', { class: 'field' }, h('label', { for: 'import-text' }, '考卷文字'), ta),
        h('div', { class: 'btn-row', style: { marginTop: '16px' } },
          h('button', { class: 'btn primary', type: 'button', onclick: check }, '檢查格式'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { ta.value = SAMPLE; } }, '放回範例')),
        out),
      h('aside', { class: 'panel', style: { fontSize: 'var(--fs-sm)' } },
        h('h2', { class: 'panel-title' }, '格式說明'),
        h('div', { class: 'rule-text' },
          h('p', null, h('b', null, '考卷資訊'), '：', h('code', null, '#考卷'), '、', h('code', null, '#科目'), '、', h('code', null, '#時間'), '（分鐘）、', h('code', null, '#課次'), '、', h('code', null, '#說明'), '、', h('code', null, '#來源 題號 | 標題 | 網址'), '。'),
          h('p', null, h('b', null, '大題'), '：', h('code', null, '## 單選題 2'), '，最後的數字是每題配分。名稱有「多選」就是多選題，有「題組」就是題組。'),
          h('p', null, h('b', null, '題目'), '：', h('code', null, '1. 題幹'), '，接著 ', h('code', null, '(A)'), ' 到 ', h('code', null, '(E)'), ' 選項，再寫 ', h('code', null, '答案：'), '、', h('code', null, '解析：'), '、', h('code', null, '課次：'), '、', h('code', null, '出處：'), '、', h('code', null, '配分：'), '。'),
          h('p', null, h('b', null, '題組'), '：', h('code', null, '【題組一：標題】'), '一行，下面到第一個題號之前都是文章；題組裡的多選題加 ', h('code', null, '題型：多選'), '。'),
          h('p', null, h('b', null, '表格'), '：題幹下面用 ', h('code', null, '| 欄 | 欄 |'), ' 每列一行，第一列是表頭。'),
          h('p', null, h('b', null, '圖片'), '：題幹下面（選項前）寫 ', h('code', null, '圖片：images/檔名.png | 替代文字'), '；寫在題組文章裡就是題組的圖。每題最多一張。'),
          h('p', { class: 'muted' }, '多選題一律依學測方式計分。'))));
  }

  function fileImport() {
    const input = h('input', { type: 'file', id: 'exam-file', accept: '.json,.txt,application/json,text/plain' });
    const out = h('div', { style: { marginTop: '16px' } });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        const text = await UI.readFile(f);
        let list;
        if (/\.txt$/i.test(f.name)) {
          const { exam, errors } = Core.parseText(text);
          if (errors.length) throw new Error(errors.slice(0, 5).join('；'));
          list = [exam];
        } else {
          const data = JSON.parse(text);
          if (data.kind === 'practice-attempts') throw new Error('這是學生成績檔，請改用「匯入學生成績檔」分頁。');
          if (data.kind === 'practice-backup') throw new Error('這是完整備份檔，請到「資料」頁還原。');
          list = Array.isArray(data) ? data : [data];
        }
        const saved = [];
        for (const e0 of list) {
          const e = e0.sealed ? Core.unsealExam(e0) : e0;
          const errs = Core.validateExam(e);
          if (errs.length) throw new Error(`「${e.title || '未命名'}」：${errs.slice(0, 3).join('；')}`);
          e.id = e.id && !(await Store.getExam(e.id)) ? e.id : Core.uid('x');
          e.settings = Object.assign({ published: false, reveal: 'immediate' }, e.settings || {});
          e.origin = e.origin || '檔案匯入';
          out.replaceChildren(h('p', { class: 'muted' }, `正在儲存「${e.title}」…（${saved.length + 1} / ${list.length}）`));
          await Store.saveExam(e);
          saved.push(e.title);
        }
        out.replaceChildren(h('div', { class: 'notice quiet' }, h('div', null, `已匯入 ${saved.length} 份：${saved.join('、')}。到考卷管理勾選「開放」，學生才看得到。`), h('a', { class: 'btn small', href: '#/t/exams' }, '前往考卷管理')));
      } catch (e) {
        out.replaceChildren(h('div', { class: 'notice' }, h('div', null, '匯入失敗：' + e.message)));
      }
    });
    return h('section', { class: 'panel narrow' },
      h('h2', { class: 'panel-title' }, '上傳考卷檔'),
      h('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)', marginBottom: '16px' } }, '支援兩種檔案：文字格式（.txt），或平台的考卷 JSON（.json，可以是一份或多份）。匯入後預設不開放給學生。'),
      h('div', { class: 'field' }, h('label', { for: 'exam-file' }, '選擇檔案'), input),
      out);
  }

  function resultsImport() {
    const input = h('input', { type: 'file', id: 'res-file', accept: '.json,application/json' });
    const ta = h('textarea', { class: 'input code', id: 'res-text', style: { minHeight: '120px' }, placeholder: '或把成績檔內容貼在這裡' });
    const out = h('div', { style: { marginTop: '16px' } });
    async function take(text) {
      try {
        const n = await Store.importAttempts(JSON.parse(text));
        out.replaceChildren(h('div', { class: 'notice quiet' }, h('div', null, n ? `匯入 ${n} 筆新的作答紀錄。` : '沒有新的紀錄（這些成績之前已經匯入過）。'), h('a', { class: 'btn small', href: '#/t/reports' }, '看成績報表')));
      } catch (e) {
        out.replaceChildren(h('div', { class: 'notice' }, h('div', null, '匯入失敗：' + (e instanceof SyntaxError ? '檔案內容不是正確的 JSON。' : e.message))));
      }
    }
    input.addEventListener('change', async () => { if (input.files[0]) take(await UI.readFile(input.files[0])); });
    return h('section', { class: 'panel narrow' },
      h('h2', { class: 'panel-title' }, '匯入學生成績檔'),
      h('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)', marginBottom: '16px' } }, '學生在「作答紀錄」或成績單按「匯出成績檔給老師」會得到一個 .json 檔。重複匯入同一個檔案不會重複計算。'),
      h('div', { style: { display: 'grid', gap: '16px' } },
        h('div', { class: 'field' }, h('label', { for: 'res-file' }, '選擇成績檔'), input),
        h('div', { class: 'field' }, h('label', { for: 'res-text' }, '貼上內容'), ta),
        h('div', null, h('button', { class: 'btn primary', type: 'button', onclick: () => ta.value.trim() && take(ta.value) }, '匯入貼上的內容'))),
      out);
  }

  /* ---------- 成績報表 ---------- */
  async function reports() {
    const all = submittedOnly(await Store.listAttempts());
    const exams = await Store.listExams();
    const students = [...new Set(all.map((a) => a.student))];
    let examId = Store.pref('repExam') || '';
    let student = Store.pref('repStudent') || '';
    if (examId && !all.some((a) => a.examId === examId)) examId = '';
    if (student && !students.includes(student)) student = '';
    const body = h('div');

    const examSel = h('select', { class: 'input', id: 'rep-exam', onchange: (e) => { examId = e.target.value; Store.pref('repExam', examId); draw(); } },
      h('option', { value: '' }, '全部考卷'),
      exams.filter((e) => all.some((a) => a.examId === e.id)).map((e) => h('option', { value: e.id, selected: e.id === examId }, e.title)));
    const stuSel = h('select', { class: 'input', id: 'rep-stu', onchange: (e) => { student = e.target.value; Store.pref('repStudent', student); draw(); } },
      h('option', { value: '' }, '全部學生'),
      students.map((s) => h('option', { value: s, selected: s === student }, s)));

    function draw() {
      const list = all.filter((a) => (!examId || a.examId === examId) && (!student || a.student === student));
      if (!list.length) {
        body.replaceChildren(h('section', { class: 'panel' }, h('p', { class: 'empty' }, all.length ? '這個篩選條件下沒有成績。' : '還沒有成績。到「匯入」頁匯入學生的成績檔，或在「總覽」產生示範成績。')));
        return;
      }
      const rates = list.map((a) => pct(a.result.earned, a.result.max));
      const avg = Math.round(rates.reduce((s, x) => s + x, 0) / rates.length);
      const best = Math.max(...rates);
      const latest = list[0];

      // 1. 分數變化
      const bySt = {};
      list.forEach((a) => { (bySt[a.student] = bySt[a.student] || []).push({ t: Date.parse(a.submittedAt), y: pct(a.result.earned, a.result.max), tip: `${fmtDate(a.submittedAt)}\n${a.examTitle}\n${fmtScore(a.result.earned)} / ${fmtScore(a.result.max)} 分` }); });
      const series = Object.entries(bySt).map(([name, points]) => ({ name, points }));

      const blocks = [
        h('dl', { class: 'stat-row', style: { margin: '0 0 20px' } },
          h('div', { class: 'stat' }, h('dt', null, '交卷次數'), h('dd', null, list.length)),
          h('div', { class: 'stat' }, h('dt', null, '平均得分率'), h('dd', null, avg, h('small', null, ' %'))),
          h('div', { class: 'stat' }, h('dt', null, '最高得分率'), h('dd', null, best, h('small', null, ' %'))),
          h('div', { class: 'stat' }, h('dt', null, '最近一次'), h('dd', null, pct(latest.result.earned, latest.result.max), h('small', null, ` % · ${fmtDate(latest.submittedAt, false)}`)))),
        h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '分數變化', h('small', null, series.length > 3 ? '只畫前三位學生；完整數字在下方表格' : '每個點是一次交卷，換算成百分制')),
          Charts.line(series)),
      ];

      // 2、3. 每題得分率與選項分布（選定一份考卷時）
      const exam = examId ? exams.find((e) => e.id === examId) : null;
      if (exam) {
        const flat = Core.flatQuestions(exam);
        const stats = flat.map(({ q, no }) => {
          const ps = list.map((a) => a.result.perQ[q.id]).filter(Boolean);
          const earned = ps.reduce((s, p) => s + p.earned, 0);
          const max = ps.reduce((s, p) => s + p.max, 0);
          const counts = {};
          ps.forEach((p) => (p.chosen || '').split('').forEach((L) => { counts[L] = (counts[L] || 0) + 1; }));
          return { q, no, rate: max ? (earned / max) * 100 : 0, n: ps.length, counts, blank: ps.filter((p) => !p.chosen).length };
        });
        blocks.push(h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '每題得分率', h('small', null, '低於 50% 以紅色標示並標上數字；滑過直條可看題目')),
          Charts.columns(stats.map((s) => ({ label: String(s.no), value: s.rate, low: s.rate < 50, tip: `第 ${s.no} 題 · ${s.q.lesson || ''}\n得分率 ${Math.round(s.rate)}%（${s.n} 次作答）\n${s.q.stem.slice(0, 40)}${s.q.stem.length > 40 ? '…' : ''}` })))));
        blocks.push(h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '選項分布', h('small', null, '綠色是正確選項；格子裡是選這個選項的次數')),
          h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
            h('thead', null, h('tr', null, h('th', null, '題號'), h('th', null, '課次'), h('th', null, '正解'), h('th', { style: { minWidth: '260px' } }, '各選項被選次數'), h('th', { class: 'r' }, '未作答'), h('th', { class: 'r' }, '得分率'))),
            h('tbody', null, stats.map((s) => h('tr', null,
              h('td', { class: 'num' }, s.no),
              h('td', null, s.q.lesson || '—'),
              h('td', null, h('b', null, s.q.answer)),
              h('td', null, h('div', { class: 'dist' }, Core.LETTERS.slice(0, 5).split('').map((L, i) => {
                if (i >= s.q.options.length) return h('div', { class: 'dist-cell na' });
                const c = s.counts[L] || 0;
                const isAns = s.q.answer.includes(L);
                return h('div', { class: 'dist-cell' + (isAns ? ' correct' : ''), title: `(${L}) ${s.q.options[i]}` }, `${L} ${c}`, h('span', { class: 'fill', style: { width: (s.n ? (c / s.n) * 100 : 0) + '%' } }));
              }))),
              h('td', { class: 'r' }, s.blank),
              h('td', { class: 'r', style: { color: s.rate < 50 ? 'var(--bad)' : null, fontWeight: s.rate < 50 ? 700 : null } }, Math.round(s.rate) + '%'))))))));
      } else {
        blocks.push(h('div', { class: 'notice quiet' }, h('div', null, '選定一份考卷，就能看到每題得分率和選項分布。')));
      }

      // 4. 課次弱點
      const lessons = lessonStats(list);
      blocks.push(h('div', { class: 'grid-halves', style: { marginTop: '20px' } },
        h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '各課次得分率', h('small', null, '低於 60% 以紅色標示')),
          lessonBars(lessons)),
        h('section', { class: 'panel' },
          h('div', { class: 'panel-title', style: { justifyContent: 'space-between' } }, h('h2', null, '給家長的摘要'), h('button', { class: 'btn small', type: 'button', onclick: () => UI.copyText(parentText(list, lessons)) }, '複製文字')),
          h('div', { class: 'parent-note' }, paras(parentText(list, lessons))))));

      blocks.push(h('section', { class: 'panel', style: { marginTop: '20px' } },
        h('h2', { class: 'panel-title' }, '所有交卷紀錄'),
        attemptTable(list)));
      body.replaceChildren(...blocks);
    }
    draw();

    await shell('reports', [
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, '成績報表'),
        h('h1', { class: 'page-title' }, '學習狀況')),
      h('div', { class: 'form-grid', style: { marginBottom: '20px', maxWidth: '640px' } },
        h('div', { class: 'field' }, h('label', { for: 'rep-exam' }, '考卷'), examSel),
        h('div', { class: 'field' }, h('label', { for: 'rep-stu' }, '學生'), stuSel)),
      body,
    ]);
  }

  function parentText(list, lessons) {
    const sorted = list.slice().sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const name = [...new Set(list.map((a) => a.student))].join('、');
    const rate = (a) => pct(a.result.earned, a.result.max);
    const good = lessons.filter((l) => l.rate >= 0.8).map((l) => l.lesson);
    const weak = lessons.filter((l) => l.rate < 0.6).sort((a, b) => a.rate - b.rate).map((l) => l.lesson);
    const lines = [];
    lines.push(`${name}在 ${fmtDate(first.submittedAt, false)} 到 ${fmtDate(last.submittedAt, false)} 之間共完成 ${list.length} 份練習卷，平均得分率 ${Math.round(list.reduce((s, a) => s + rate(a), 0) / list.length)}%。`);
    if (sorted.length >= 2) {
      const d = rate(last) - rate(first);
      lines.push(`最近一次（${last.examTitle}）得分率 ${rate(last)}%，比第一次${d >= 0 ? '進步' : '退步'} ${Math.abs(d)} 個百分點。`);
    }
    if (good.length) lines.push(`掌握得比較好的課次：${good.join('、')}。`);
    if (weak.length) lines.push(`還需要加強的課次：${weak.join('、')}，接下來的課會針對這些部分複習。`);
    else lines.push('目前沒有得分率低於 60% 的課次。');
    return lines.join('\n');
  }

  /* ---------- 示範資料 ---------- */
  async function makeDemo() {
    const exams = (await Store.listExams()).slice(0, 4);
    const list = [];
    const day = 86400000;
    const now = Date.now();
    // 固定亂數，讓示範結果每次都一樣
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    exams.forEach((e, ei) => {
      [0, 1].forEach((round) => {
        if (round === 1 && ei > 1) return;
        const skill = 0.55 + ei * 0.05 + round * 0.15;
        const answers = {};
        Core.flatQuestions(e).forEach(({ q }) => {
          if (rnd() < skill) { answers[q.id] = q.answer; return; }
          if (rnd() < 0.08) return;
          if (q.type === 'multi') {
            const a = q.answer.split('');
            answers[q.id] = rnd() < 0.6 ? a.slice(0, Math.max(1, a.length - 1)).join('') : Core.normAnswer(q.answer + Core.letter(Math.floor(rnd() * q.options.length)));
          } else {
            answers[q.id] = Core.letter((Core.LETTERS.indexOf(q.answer) + 1 + Math.floor(rnd() * (q.options.length - 1))) % q.options.length);
          }
        });
        const t = now - (20 - ei * 4 - round * 9) * day;
        const r = Core.grade(e, answers);
        Core.flatQuestions(e).forEach(({ q, no }) => Object.assign(r.perQ[q.id], { no, lesson: q.lesson || '未分類', answer: q.answer, type: q.type, n: q.options.length }));
        list.push({
          id: Core.uid('demo'), demo: true, examId: e.id, examTitle: e.title, subject: e.subject, student: '示範學生',
          startedAt: new Date(t - e.timeLimit * 50000).toISOString(), submittedAt: new Date(t).toISOString(),
          deadline: new Date(t - e.timeLimit * 50000 + e.timeLimit * 60000).toISOString(), timeLimit: e.timeLimit,
          durationSec: Math.round(e.timeLimit * 50 + rnd() * 300), answers, flags: {}, status: 'submitted', result: r,
        });
      });
    });
    await Store.addAttempts(list);
    UI.toast(`已產生 ${list.length} 筆示範成績`);
  }

  /* ---------- 資料 ---------- */
  async function data() {
    const attempts = await Store.listAttempts();
    const demo = attempts.filter((a) => a.demo).length;
    const restoreInput = h('input', { type: 'file', id: 'restore-file', accept: '.json,application/json' });
    restoreInput.addEventListener('change', async () => {
      const f = restoreInput.files[0];
      if (!f) return;
      try {
        const d = JSON.parse(await UI.readFile(f));
        if (!(await UI.dialog({ title: '用備份檔覆蓋目前的資料？', body: '目前這台電腦上的考卷修改、作答紀錄會被備份檔的內容取代。', ok: '還原', danger: true }))) return;
        await Store.importAll(d);
        UI.toast('已還原備份');
        UI.render();
      } catch (e) {
        UI.toast('還原失敗：' + e.message, 4000);
      }
    });
    const p1 = h('input', { class: 'input', id: 'np1', type: 'password', autocomplete: 'new-password' });
    const p2 = h('input', { class: 'input', id: 'np2', type: 'password', autocomplete: 'new-password' });

    await shell('data', [
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, '資料'),
        h('h1', { class: 'page-title' }, '備份與設定'),
        h('p', { class: 'lede' }, Store.mode === 'remote' ? '資料都存在你的 Google 試算表，Google 會自動保留版本記錄。' : '原型版本的資料都存在這台電腦的瀏覽器。換電腦或清除瀏覽資料前，記得先下載備份。')),
      h('div', { class: 'grid-halves' },
        h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '備份'),
          h('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)', marginBottom: '16px' } }, Store.mode === 'remote' ? '下載一份 JSON 檔，包含所有考卷、學生和作答紀錄。' : '備份檔包含：考卷修改、自建考卷、開放設定、所有作答紀錄。'),
          h('div', { style: { display: 'grid', gap: '16px' } },
            h('div', null, h('button', { class: 'btn primary', type: 'button', onclick: async () => UI.saveFile(`練習平台備份_${fmtDate(new Date().toISOString(), false).replace(/\//g, '')}.json`, JSON.stringify(await Store.exportAll())) }, '下載完整備份')),
            Store.features.restoreBackup ? h('div', { class: 'field' }, h('label', { for: 'restore-file' }, '從備份檔還原'), restoreInput) :
              h('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)' } }, '資料存在你的 Google 試算表。需要還原時，請在試算表的「檔案 → 版本記錄」找回之前的版本。'))),
        h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '示範成績'),
          h('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)', marginBottom: '16px' } }, demo ? `目前有 ${demo} 筆示範成績（學生端看不到）。` : '產生幾筆「示範學生」的成績，用來看報表的樣子。學生端看不到這些資料。'),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn', type: 'button', onclick: async () => { await makeDemo(); UI.render(); } }, '產生示範成績'),
            demo ? h('button', { class: 'btn ghost', type: 'button', onclick: async () => { await Store.clearDemo(); UI.toast('已清除示範成績'); UI.render(); } }, '清除示範成績') : null)),
        h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '更改老師密碼'),
          h('div', { style: { display: 'grid', gap: '12px' } },
            h('div', { class: 'field' }, h('label', { for: 'np1' }, '新密碼'), p1),
            h('div', { class: 'field' }, h('label', { for: 'np2' }, '再輸入一次'), p2),
            h('div', null, h('button', { class: 'btn', type: 'button', onclick: async () => {
              const min = Store.mode === 'remote' ? 6 : 4;
              if (p1.value.length < min) { UI.toast(`密碼至少 ${min} 個字`); return; }
              if (p1.value !== p2.value) { UI.toast('兩次輸入的密碼不一樣'); return; }
              try {
                await Store.setTeacherPass(p1.value);
              } catch (e) {
                UI.toast(e.message, 4000);
                return;
              }
              p1.value = p2.value = '';
              UI.toast('已更新密碼');
            } }, '更新密碼')))),
        Store.features.clearAttempts ? h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '清除作答紀錄'),
          h('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)', marginBottom: '16px' } }, '刪除這台電腦上所有作答紀錄與錯題本進度，考卷不受影響。清除前建議先下載備份。'),
          h('button', { class: 'btn danger', type: 'button', onclick: async () => {
            if (!(await UI.dialog({ title: '清除所有作答紀錄？', body: '刪除後無法復原。', ok: '清除', danger: true }))) return;
            for (const a of await Store.listAttempts()) await Store.deleteAttempt(a.id);
            UI.toast('已清除');
            UI.render();
          } }, '清除作答紀錄')) : null),
    ]);
  }

  /* ---------- 學生與專屬連結 ---------- */
  async function students() {
    if (!Store.features.students) {
      await shell('students', h('section', { class: 'panel' }, h('p', { class: 'empty' }, '接上 Google 試算表後，才能在這裡新增學生、產生專屬連結。')));
      return;
    }
    const list = await Store.listStudents();
    const attempts = submittedOnly(await Store.listAttempts()).filter((a) => !a.demo);
    const nameInput = h('input', { class: 'input', id: 'new-student', maxlength: 20, placeholder: '例如：王小明' });

    // 交卷次數點下去，打開只看這位學生的成績報表
    function countLink(s) {
      const n = attempts.filter((a) => a.studentId === s.studentId).length;
      if (!n) return n;
      return h('a', { href: '#/t/reports', title: `看${s.name}的成績報表`, onclick: () => { Store.pref('repStudent', s.name); Store.pref('repExam', ''); } }, n);
    }

    function linkBox(s) {
      const url = Store.studentLink(s.code);
      const field = h('input', { class: 'input', readonly: true, value: url, 'aria-label': s.name + ' 的專屬連結', style: { fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }, onfocus: (e) => e.target.select() });
      return h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', minWidth: '280px' } }, field,
        h('button', { class: 'btn small', type: 'button', onclick: () => UI.copyText(url, field) }, '複製'));
    }
    async function add() {
      const name = nameInput.value.trim();
      if (!name) { UI.toast('請輸入學生名字'); nameInput.focus(); return; }
      try {
        const s = await Store.addStudent(name);
        await UI.dialog({
          title: `已新增「${s.name}」`,
          body: [h('p', null, '把下面的專屬連結傳給學生。學生點一次連結就能開始作答；換電腦時再點一次就好。'), linkBox(s)],
          ok: '完成',
          cancel: false,
        });
        UI.render();
      } catch (e) {
        UI.toast(e.message, 4000);
      }
    }
    async function reset(s) {
      const ok = await UI.dialog({
        title: `幫「${s.name}」換一組新連結？`,
        body: '舊的連結會立刻失效，作答紀錄都會保留。換好後，記得把新連結傳給學生。',
        ok: '換新連結',
        danger: true,
      });
      if (!ok) return;
      try {
        const n = await Store.updateStudent(s.studentId, { resetCode: true });
        await UI.dialog({ title: '新的專屬連結', body: [h('p', null, '請把這個連結傳給學生，舊連結已經不能用了。'), linkBox(n)], ok: '完成', cancel: false });
        UI.render();
      } catch (e) {
        UI.toast(e.message, 4000);
      }
    }
    async function rename(s) {
      const input = h('input', { class: 'input', id: 'rename-student', value: s.name, maxlength: 20 });
      if (!(await UI.dialog({ title: '修改名字', body: [input], ok: '儲存' }))) return;
      if (!input.value.trim()) return;
      try { await Store.updateStudent(s.studentId, { name: input.value.trim() }); UI.render(); } catch (e) { UI.toast(e.message, 4000); }
    }
    async function toggle(s) {
      if (s.active && !(await UI.dialog({ title: `停用「${s.name}」？`, body: '停用後專屬連結不能再使用，作答紀錄會保留，之後可以再啟用。', ok: '停用', danger: true }))) return;
      try { await Store.updateStudent(s.studentId, { active: !s.active }); UI.render(); } catch (e) { UI.toast(e.message, 4000); }
    }

    await shell('students', [
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, '學生'),
        h('h1', { class: 'page-title' }, list.length ? `${list.length} 位學生` : '新增第一位學生'),
        h('p', { class: 'lede' }, '每位學生有一個專屬連結，學生點連結就能作答，不用帳號密碼。連結不小心外流時，按「換新連結」，舊連結就會失效。')),
      h('section', { class: 'panel' },
        h('h2', { class: 'panel-title' }, '新增學生'),
        h('form', { class: 'btn-row', onsubmit: (e) => { e.preventDefault(); add(); } },
          h('div', { style: { flex: '1 1 220px', maxWidth: '320px' } }, nameInput),
          h('button', { class: 'btn primary', type: 'submit' }, '新增並產生連結'))),
      list.length ? h('section', { class: 'panel' }, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, '名字'), h('th', null, '專屬連結'), h('th', null, '狀態'), h('th', { class: 'r' }, '交卷次數'), h('th', null, ''))),
        h('tbody', null, list.map((s) => h('tr', null,
          h('td', { class: 'nw' }, h('b', null, s.name)),
          h('td', null, s.active ? linkBox(s) : h('span', { class: 'muted' }, '已停用')),
          h('td', { class: 'nw' }, h('span', { class: 'pill ' + (s.active ? 'good' : '') }, s.active ? '使用中' : '已停用')),
          h('td', { class: 'r' }, countLink(s)),
          h('td', { class: 'nw' }, h('div', { class: 'btn-row' },
            h('button', { class: 'btn small ghost', type: 'button', onclick: () => rename(s) }, '改名'),
            s.active ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => reset(s) }, '換新連結') : null,
            h('button', { class: 'btn small ghost', type: 'button', onclick: () => toggle(s) }, s.active ? '停用' : '啟用'))))))))) : null,
    ]);
  }

  window.Teacher = {
    students: guard(students),
    gate,
    home: guard(home),
    exams: guard(exams),
    preview: guard(preview),
    edit: guard(edit),
    import: guard(importPage),
    reports: guard(reports),
    attempt: guard(attempt),
    data: guard(data),
  };
})();
