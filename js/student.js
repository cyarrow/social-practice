/* 學生端：考卷列表、考前說明、作答、成績單、錯題本、作答紀錄。 */
(function () {
  'use strict';
  const { h, fmtScore, fmtClock, fmtDuration, fmtDate, pct, paras } = UI;
  const Core = window.Core;
  const Store = window.Store;
  const APP_NAME = '社會科練習室';
  const SUBJECTS = ['全部', '地理', '歷史', '公民', '綜合'];

  /* ---------- 版面 ---------- */
  async function shell(active, content) {
    document.body.classList.remove('taking', 'teacher');
    const student = await Store.getStudent();
    const link = (href, text, key) => h('a', { href, 'aria-current': active === key ? 'page' : null }, text);
    const app = document.getElementById('app');
    app.replaceChildren(
      h('header', { class: 'masthead' }, h('div', { class: 'wrap' },
        h('a', { class: 'brand', href: '#/' },
          h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '社'),
          h('span', { class: 'brand-name' }, APP_NAME),
          h('span', { class: 'brand-tag' }, '國中社會 · 複習練習')),
        h('nav', { class: 'nav', 'aria-label': '主選單' },
          link('#/', '考卷', 'home'),
          link('#/wrong', '錯題本', 'wrong'),
          link('#/history', '作答紀錄', 'history'),
          h('button', { class: 'who', type: 'button', onclick: renameStudent, title: '修改名字' }, student ? student.name : '尚未輸入名字')))),
      h('main', null, h('div', { class: 'wrap' }, content)),
      h('footer', { class: 'footer' }, h('div', { class: 'wrap' },
        h('span', null, '作答紀錄存在這台電腦的瀏覽器裡。換電腦或清除瀏覽資料會看不到之前的紀錄。'),
        h('a', { href: '#/t' }, '老師專區'))));
    window.scrollTo(0, 0);
  }

  async function renameStudent() {
    const s = await Store.getStudent();
    const input = h('input', { class: 'input', id: 'student-name', value: s ? s.name : '', maxlength: 20, placeholder: '例如：王小明' });
    const ok = await UI.dialog({ title: '你的名字', body: [h('p', null, '名字會出現在成績單上，讓老師知道是誰寫的。'), input], ok: '儲存' });
    if (ok && input.value.trim()) {
      await Store.setStudent(input.value);
      UI.render();
    }
  }

  // 先把時間已經到了、還沒交的考卷交出去
  async function settleExpired() {
    const list = await Store.listAttempts({ status: 'in_progress' });
    const done = [];
    for (const a of list) {
      if (Date.parse(a.deadline) <= Date.now()) {
        try { done.push(await Store.submitAttempt(a.id, { auto: true })); } catch (e) { console.warn(e); }
      }
    }
    return done;
  }

  /* ---------- 首頁 ---------- */
  async function home() {
    const expired = await settleExpired();
    const exams = (await Store.listExams()).filter((e) => e.settings.published);
    const attempts = await Store.listAttempts({ includeDemo: false });
    const student = await Store.getStudent();
    const inProgress = attempts.filter((a) => a.status === 'in_progress');
    const submitted = attempts.filter((a) => a.status === 'submitted');
    const wrong = await wrongBook();
    let filter = Store.pref('subject') || '全部';

    const listBox = h('div', { class: 'exam-list' });
    const chipBox = h('div', { class: 'chips', role: 'group', 'aria-label': '依科目篩選' });
    function draw() {
      chipBox.replaceChildren(...SUBJECTS.filter((s) => s === '全部' || exams.some((e) => UI.subjectOf(e) === s)).map((s) =>
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === s), onclick: () => { filter = s; Store.pref('subject', s); draw(); } }, s)));
      const shown = exams.filter((e) => filter === '全部' || UI.subjectOf(e) === filter);
      listBox.replaceChildren(...(shown.length ? shown.map((e) => examRow(e, submitted.filter((a) => a.examId === e.id))) :
        [h('p', { class: 'empty' }, '這個科目目前沒有考卷。')]));
    }
    draw();

    const notices = [];
    expired.forEach((a) => notices.push(h('div', { class: 'notice' },
      h('div', null, h('b', null, a.examTitle), ' 的作答時間已到，系統已自動交卷。'),
      h('a', { class: 'btn small', href: '#/result/' + a.id }, '看成績'))));
    inProgress.filter((a) => !expired.some((x) => x.id === a.id)).forEach((a) => {
      const left = (Date.parse(a.deadline) - Date.now()) / 1000;
      notices.push(h('div', { class: 'notice' },
        h('div', null, '你有一份考卷還沒交：', h('b', null, a.examTitle), h('span', { class: 'muted' }, `（剩 ${fmtClock(left)}，計時沒有暫停）`)),
        h('a', { class: 'btn primary small', href: '#/take/' + a.id }, '繼續作答')));
    });

    const recent = submitted.slice(0, 5);
    await shell('home', [
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, student ? `${student.name}，你好` : '歡迎'),
        h('h1', { class: 'page-title' }, '今天要練哪一份？'),
        h('p', { class: 'lede' }, '每份考卷都有倒數計時，時間到會自動交卷。交卷後可以看到分數、每題解析，答錯的題目會收進錯題本。')),
      notices.length ? h('div', { style: { display: 'grid', gap: '10px', marginBottom: '24px' } }, notices) : null,
      student ? null : h('div', { class: 'notice quiet', style: { marginBottom: '24px' } },
        h('div', null, '第一次使用嗎？先輸入你的名字，成績單上才知道是誰寫的。'),
        h('button', { class: 'btn small', type: 'button', onclick: renameStudent }, '輸入名字')),
      h('div', { class: 'grid-2' },
        h('section', { class: 'panel' },
          h('div', { class: 'panel-title', style: { justifyContent: 'space-between' } }, h('h2', null, '考卷'), chipBox),
          listBox),
        h('aside', { style: { display: 'grid', gap: '20px' } },
          h('section', { class: 'panel' },
            h('h2', { class: 'panel-title' }, '錯題本'),
            h('div', { class: 'big-stat' }, h('b', null, wrong.items.length), h('span', { class: 'muted' }, '題待訂正')),
            h('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)', margin: '8px 0 16px' } },
              wrong.items.length ? '練到答對就會從錯題本移除。' : '交卷後，答錯或只拿部分分數的題目會出現在這裡。'),
            h('a', { class: 'btn', href: '#/wrong' }, '打開錯題本')),
          h('section', { class: 'panel' },
            h('h2', { class: 'panel-title' }, '最近成績'),
            recent.length ? h('div', { class: 'side-list' }, recent.map((a) =>
              h('a', { class: 'side-item', href: '#/result/' + a.id },
                h('span', { class: 't' }, a.examTitle, h('br'), h('span', { class: 'muted', style: { fontSize: 'var(--fs-xs)' } }, fmtDate(a.submittedAt))),
                h('b', { class: 'num' }, fmtScore(a.result.earned))))) :
              h('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)' } }, '還沒有成績。寫完第一份考卷後，分數會列在這裡。')))),
    ]);
  }

  function examRow(e, done) {
    const n = Core.flatQuestions(e).length;
    const best = done.length ? Math.max(...done.map((a) => a.result.earned)) : null;
    return h('article', { class: 'exam-row' },
      h('div', null,
        h('span', { class: 'tag' }, [UI.subjectOf(e)].concat(e.lessons || []).join(' · ')),
        h('h3', null, h('a', { href: '#/exam/' + e.id }, e.title)),
        h('div', { class: 'meta' },
          h('span', null, `${n} 題`), h('span', null, `${e.timeLimit} 分鐘`), h('span', null, `滿分 ${fmtScore(Core.maxScore(e))}`),
          e.createdAt ? h('span', null, `${e.createdAt.replace(/-/g, '/')} 出題`) : null)),
      h('div', { class: 'exam-side' },
        best === null ? h('span', { class: 'best muted' }, '尚未作答') :
          h('span', { class: 'best' }, '最高 ', h('b', null, fmtScore(best)), ` 分 · 寫過 ${done.length} 次`),
        h('a', { class: 'btn ' + (best === null ? 'primary' : ''), href: '#/exam/' + e.id }, best === null ? '開始作答' : '再寫一次')));
  }

  /* ---------- 考前說明 ---------- */
  async function intro({ id }) {
    const exam = await Store.getExam(id);
    if (!exam) throw new Error('找不到這份考卷，可能已被老師移除。');
    const done = (await Store.listAttempts({ examId: id, status: 'submitted', includeDemo: false }));
    const running = (await Store.listAttempts({ examId: id, status: 'in_progress' })).find((a) => Date.parse(a.deadline) > Date.now());
    const student = await Store.getStudent();
    const qs = Core.flatQuestions(exam);
    const nameInput = student ? null : h('input', { class: 'input', id: 'intro-name', maxlength: 20, placeholder: '例如：王小明' });
    const hasMulti = qs.some((x) => x.q.type === 'multi');
    const reveal = exam.settings.reveal === 'immediate' ? '交卷後馬上可以看到答案與解析。' : '答案與解析要等老師開放後才看得到；交卷後會先看到分數。';

    async function begin() {
      if (running) { UI.go('/take/' + running.id); return; }
      let s = student;
      if (!s) {
        if (!nameInput.value.trim()) { UI.toast('請先輸入你的名字'); nameInput.focus(); return; }
        s = await Store.setStudent(nameInput.value);
      }
      const ok = await UI.dialog({
        title: '準備好了嗎？',
        body: `按下「開始」後會倒數 ${exam.timeLimit} 分鐘。中途關掉視窗，計時也不會暫停；時間到會自動交卷。`,
        ok: '開始',
      });
      if (!ok) return;
      const a = await Store.startAttempt(exam, s);
      UI.go('/take/' + a.id);
    }

    await shell('home', h('div', { class: 'narrow', style: { margin: '0 auto' } },
      h('p', { style: { marginBottom: '20px' } }, h('a', { href: '#/', class: 'muted' }, '← 回考卷列表')),
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, [UI.subjectOf(exam)].concat(exam.lessons || []).join(' · ')),
        h('h1', { class: 'page-title' }, exam.title),
        exam.description ? h('p', { class: 'lede' }, exam.description) : null),
      h('section', { class: 'panel' },
        h('dl', { class: 'rules', style: { margin: 0 } },
          h('div', null, h('dt', null, '題數'), h('dd', null, qs.length, h('small', { class: 'muted' }, ' 題'))),
          h('div', null, h('dt', null, '作答時間'), h('dd', null, exam.timeLimit, h('small', { class: 'muted' }, ' 分鐘'))),
          h('div', null, h('dt', null, '滿分'), h('dd', null, fmtScore(Core.maxScore(exam)))),
          h('div', null, h('dt', null, '寫過'), h('dd', null, done.length, h('small', { class: 'muted' }, ' 次')))),
        h('div', { class: 'table-wrap', style: { marginTop: '24px' } }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, '大題'), h('th', { class: 'r' }, '題數'), h('th', null, '配分'))),
          h('tbody', null, exam.sections.map((s, si) => h('tr', null,
            h('td', null, s.title), h('td', { class: 'r' }, qs.filter((x) => x.section === si).length), h('td', null, s.note || '')))))),
        h('h2', { class: 'rule-title', style: { fontSize: 'var(--fs-lg)', marginTop: '28px', marginBottom: '10px' } }, '作答須知'),
        h('ul', { class: 'rule-text', style: { padding: 0 } },
          h('li', null, '時間到會自動交卷，已經選的答案都會算分。'),
          h('li', null, '每選一個答案就會自動存檔；關掉視窗再回來可以接著寫，但倒數不會暫停。'),
          hasMulti ? h('li', null, '多選題依學測方式計分：每題 5 個選項，錯 1 個選項得 60%、錯 2 個得 20%、錯 3 個以上 0 分；整題沒作答 0 分。') : null,
          h('li', null, '不確定的題目可以先「標記」，交卷前方便回頭檢查。'),
          h('li', null, reveal)),
        nameInput ? h('div', { class: 'field', style: { marginTop: '24px', maxWidth: '320px' } }, h('label', { for: 'intro-name' }, '你的名字'), nameInput) : null,
        h('div', { class: 'btn-row', style: { marginTop: '28px' } },
          h('button', { class: 'btn primary large', type: 'button', onclick: begin }, running ? '繼續作答' : '開始作答'),
          done.length ? h('a', { class: 'btn ghost', href: '#/result/' + done[0].id }, '看上次成績') : null))));
  }

  /* ---------- 作答 ---------- */
  async function take({ id }) {
    let attempt = await Store.getAttempt(id);
    if (!attempt) throw new Error('找不到這次作答紀錄。');
    if (attempt.status === 'submitted') { UI.go('/result/' + id); return; }
    const exam = await Store.getExam(attempt.examId);
    if (!exam) throw new Error('這份考卷已被移除。');
    if (Date.parse(attempt.deadline) <= Date.now()) {
      await Store.submitAttempt(id, { auto: true });
      UI.go('/result/' + id);
      return;
    }

    const flat = Core.flatQuestions(exam);
    const answers = Object.assign({}, attempt.answers);
    const flags = Object.assign({}, attempt.flags);
    let idx = Math.min(attempt.current || 0, flat.length - 1);
    let submitting = false;
    const warned = { five: false, one: false };

    document.body.classList.add('taking');
    document.body.classList.remove('teacher');
    const timerText = h('span', { class: 'num' }, '--:--');
    const timer = h('div', { class: 'timer', role: 'timer', 'aria-label': '剩餘時間' }, h('i', { class: 'dot', 'aria-hidden': 'true' }), h('small', null, '剩餘'), timerText);
    const nav = h('nav', { class: 'qnav', 'aria-label': '題號' });
    const stage = h('div', { class: 'qstage' });
    document.getElementById('app').replaceChildren(h('div', { class: 'exam-shell' },
      h('header', { class: 'exam-bar' },
        h('div', { class: 'title' }, h('h1', null, exam.title), h('p', null, `${attempt.student} · ${flat.length} 題 · ${exam.timeLimit} 分鐘`)),
        timer,
        h('button', { class: 'btn primary', type: 'button', onclick: () => trySubmit(false) }, '交卷')),
      h('div', { class: 'exam-body' }, nav, stage)));

    function save() {
      Store.saveProgress(id, { answers, flags, current: idx });
    }
    function choose(L) {
      const q = flat[idx].q;
      const cur = Core.normAnswer(answers[q.id]);
      if (q.type === 'multi') {
        answers[q.id] = cur.includes(L) ? cur.replace(L, '') : Core.normAnswer(cur + L);
      } else {
        answers[q.id] = cur === L ? '' : L;
      }
      if (!answers[q.id]) delete answers[q.id];
      save();
      draw();
    }
    function goTo(i) {
      idx = Math.max(0, Math.min(flat.length - 1, i));
      save();
      draw(true);
    }
    function toggleFlag() {
      const q = flat[idx].q;
      if (flags[q.id]) delete flags[q.id]; else flags[q.id] = true;
      save();
      draw();
    }

    function drawNav() {
      const answered = flat.filter((x) => answers[x.q.id]).length;
      const blocks = [];
      exam.sections.forEach((s, si) => {
        const items = flat.map((x, i) => ({ x, i })).filter(({ x }) => x.section === si);
        if (!items.length) return;
        blocks.push(h('h2', null, s.title));
        blocks.push(h('div', { class: 'qgrid' }, items.map(({ x, i }) => {
          const cls = ['qbtn', answers[x.q.id] ? 'done' : '', flags[x.q.id] ? 'flag' : '', i === idx ? 'current' : ''].join(' ');
          const label = `第 ${x.no} 題${answers[x.q.id] ? '，已作答' : '，未作答'}${flags[x.q.id] ? '，已標記' : ''}`;
          return h('button', { class: cls, type: 'button', 'aria-label': label, 'aria-current': i === idx ? 'true' : null, onclick: () => goTo(i) }, x.no);
        })));
      });
      nav.replaceChildren(...blocks,
        h('div', { class: 'progress-line' }, `已作答 ${answered} / ${flat.length} 題`,
          h('div', { class: 'progress-track' }, h('i', { style: { width: pct(answered, flat.length) + '%' } }))),
        h('div', { class: 'qlegend' },
          h('span', null, h('i', { class: 'done' }), '已作答'),
          h('span', null, h('i'), '未作答'),
          h('span', null, h('i', { class: 'flag' }), '標記待檢查')));
    }

    let lastGroup = null;
    function drawStage(scrollTop) {
      const { q, no, group } = flat[idx];
      const isMulti = q.type === 'multi';
      const qBlock = h('div', { class: 'qpane-inner' },
        h('div', { class: 'qhead' },
          h('span', { class: 'qno' }, no),
          h('span', { class: 'qtype' }, `${UI.typeLabel(q)} · ${fmtScore(q.points)} 分`)),
        UI.stemBlock(q),
        isMulti ? h('p', { class: 'multi-hint' }, '可選多個答案；依學測方式計分，選錯會扣分。') : null,
        UI.optionList(q, { chosen: answers[q.id], onChoose: choose }),
        h('div', { class: 'qfoot' },
          h('button', { class: 'btn', type: 'button', disabled: idx === 0, onclick: () => goTo(idx - 1) }, '← 上一題'),
          h('button', { class: 'btn ghost flag-toggle', type: 'button', 'aria-pressed': String(!!flags[q.id]), onclick: toggleFlag }, flags[q.id] ? '已標記待檢查' : '標記待檢查'),
          idx < flat.length - 1 ?
            h('button', { class: 'btn', type: 'button', onclick: () => goTo(idx + 1) }, '下一題 →') :
            h('button', { class: 'btn primary', type: 'button', onclick: () => trySubmit(false) }, '寫完了，交卷')),
        h('p', { class: 'kbd-hint', style: { marginTop: '16px' } },
          '鍵盤：', h('kbd', null, 'A'), '–', h('kbd', null, isMulti ? 'E' : 'D'), ' 選答案　', h('kbd', null, '←'), h('kbd', null, '→'), ' 換題　', h('kbd', null, 'F'), ' 標記'));

      if (group) {
        const keepPassage = lastGroup === group && stage.querySelector('.passage');
        const passageScroll = keepPassage ? stage.querySelector('.passage').scrollTop : 0;
        const nums = flat.filter((x) => x.group === group).map((x) => x.no);
        const passage = h('section', { class: 'passage', 'aria-label': '題組文章' },
          h('span', { class: 'tag' }, `第 ${nums[0]}–${nums[nums.length - 1]} 題共用`),
          h('h2', null, group.title),
          paras(group.passage.join('\n')));
        const pane = h('section', { class: 'qpane' }, qBlock);
        stage.className = 'qstage split';
        stage.replaceChildren(passage, pane);
        passage.scrollTop = passageScroll;
      } else {
        stage.className = 'qstage';
        stage.replaceChildren(h('section', { class: 'qpane' }, qBlock));
      }
      lastGroup = group;
      if (scrollTop) stage.querySelectorAll('.qpane').forEach((p) => { p.scrollTop = 0; });
    }
    function draw(scrollTop) { drawNav(); drawStage(scrollTop); }

    async function trySubmit(auto) {
      if (submitting) return;
      if (!auto) {
        const blank = flat.filter((x) => !answers[x.q.id]).map((x) => x.no);
        const flagged = flat.filter((x) => flags[x.q.id]).map((x) => x.no);
        const body = [];
        if (blank.length) body.push(h('p', null, `還有 ${blank.length} 題沒作答：第 ${blank.slice(0, 12).join('、')}${blank.length > 12 ? ' …' : ''} 題。`));
        if (flagged.length) body.push(h('p', null, `你標記了 ${flagged.length} 題待檢查：第 ${flagged.join('、')} 題。`));
        if (!body.length) body.push(h('p', null, '每一題都寫完了。交卷後就不能再修改答案。'));
        else body.push(h('p', null, '交卷後就不能再修改答案。'));
        const ok = await UI.dialog({ title: '確定要交卷嗎？', body, ok: '交卷', cancelText: '再檢查一下' });
        if (!ok) return;
      }
      submitting = true;
      await Store.saveProgress(id, { answers, flags, current: idx });
      await Store.submitAttempt(id, { auto });
      UI.go('/result/' + id);
    }

    function tick() {
      const left = (Date.parse(attempt.deadline) - Date.now()) / 1000;
      timerText.textContent = fmtClock(Math.ceil(left));
      timer.classList.toggle('warn', left <= 300);
      if (left <= 300 && !warned.five && left > 60) { warned.five = true; UI.toast('剩下 5 分鐘'); }
      if (left <= 60 && !warned.one) { warned.one = true; warned.five = true; UI.toast('剩下 1 分鐘，時間到會自動交卷', 4000); }
      if (left <= 0) {
        clearInterval(timerId);
        document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
        trySubmit(true);
      }
    }
    function onKey(e) {
      if (document.querySelector('.modal-backdrop')) return;
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const q = flat[idx].q;
      const k = e.key.toUpperCase();
      const i = Core.LETTERS.indexOf(k);
      if (i >= 0 && i < q.options.length && k.length === 1) { e.preventDefault(); choose(k); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(idx + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(idx - 1); }
      else if (k === 'F') { e.preventDefault(); toggleFlag(); }
    }

    let timerId = null;
    draw(true);
    tick();
    if (!submitting) timerId = setInterval(tick, 250);
    document.addEventListener('keydown', onKey);
    return () => {
      clearInterval(timerId);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('taking');
    };
  }

  /* ---------- 成績單 ---------- */
  function canReveal(exam) {
    return exam && (exam.settings.reveal === 'immediate' || exam.settings.released);
  }
  const STATUS = {
    correct: { text: '答對', cls: 'good' },
    partial: { text: '部分得分', cls: 'partial' },
    wrong: { text: '答錯', cls: 'bad' },
    blank: { text: '未作答', cls: '' },
  };

  async function result({ id }) {
    const a = await Store.getAttempt(id);
    if (!a) throw new Error('找不到這次作答紀錄。');
    if (a.status !== 'submitted') { UI.go('/take/' + id); return; }
    const exam = await Store.getExam(a.examId);
    const r = a.result;
    const reveal = canReveal(exam);
    const per = Object.values(r.perQ);
    const count = (s) => per.filter((p) => p.status === s).length;
    let filter = 'all';

    const reviewBox = h('div', { class: 'review' });
    const filterBox = h('div', { class: 'chips', role: 'group', 'aria-label': '篩選題目' });
    function drawReview() {
      const opts = [['all', '全部'], ['miss', `答錯與部分得分（${count('wrong') + count('partial')}）`], ['blank', `未作答（${count('blank')}）`]];
      filterBox.replaceChildren(...opts.map(([k, t]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; drawReview(); } }, t)));
      if (!exam) { reviewBox.replaceChildren(h('p', { class: 'empty' }, '這份考卷已被移除，無法顯示題目。')); return; }
      const flat = Core.flatQuestions(exam).filter(({ q }) => {
        const p = r.perQ[q.id];
        if (!p) return false;
        if (filter === 'miss') return p.status === 'wrong' || p.status === 'partial';
        if (filter === 'blank') return p.status === 'blank';
        return true;
      });
      reviewBox.replaceChildren(...(flat.length ? flat.map((x) => reviewItem(x, r.perQ[x.q.id], reveal)) : [h('p', { class: 'empty' }, '沒有符合的題目。')]));
    }
    drawReview();

    const lessons = Object.entries(r.byLesson).sort((x, y) => x[0].localeCompare(y[0], 'zh-Hant', { numeric: true }));
    await shell('history', [
      h('p', { style: { marginBottom: '20px' } }, h('a', { href: '#/', class: 'muted' }, '← 回考卷列表')),
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, '成績單 · ' + (a.subject || '')),
        h('h1', { class: 'page-title' }, a.examTitle)),
      a.autoSubmitted ? h('div', { class: 'notice', style: { marginBottom: '20px' } }, h('div', null, '作答時間到，系統已自動交卷。')) : null,
      h('section', { class: 'panel' },
        h('div', { class: 'score-hero' },
          h('div', { class: 'score' }, h('b', null, fmtScore(r.earned)), h('span', null, '/ ' + fmtScore(r.max))),
          h('dl', { class: 'score-meta', style: { margin: 0 } },
            h('div', null, h('dt', null, '答對'), h('dd', null, `${count('correct')} / ${per.length} 題`)),
            h('div', null, h('dt', null, '部分得分'), h('dd', null, `${count('partial')} 題`)),
            h('div', null, h('dt', null, '未作答'), h('dd', null, `${count('blank')} 題`)),
            h('div', null, h('dt', null, '作答時間'), h('dd', null, fmtDuration(a.durationSec))),
            h('div', null, h('dt', null, '交卷時間'), h('dd', null, fmtDate(a.submittedAt))),
            h('div', null, h('dt', null, '作答者'), h('dd', null, a.student))))),
      h('div', { class: 'grid-halves', style: { marginTop: '20px' } },
        h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '各大題得分'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
            h('thead', null, h('tr', null, h('th', null, '大題'), h('th', { class: 'r' }, '得分'), h('th', { class: 'r' }, '得分率'))),
            h('tbody', null, r.bySection.map((s) => h('tr', null,
              h('td', null, s.title), h('td', { class: 'r' }, `${fmtScore(s.earned)} / ${fmtScore(s.max)}`), h('td', { class: 'r' }, pct(s.earned, s.max) + '%'))))))),
        h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, '各課次得分率', h('small', null, '低於 60% 以紅色標示')),
          h('div', { class: 'bars' }, lessons.map(([L, s]) => {
            const p = pct(s.earned, s.max);
            return h('div', { class: 'bar-row' },
              h('span', { class: 'lbl' }, L),
              h('div', { class: 'bar-track', title: `${L}：${fmtScore(s.earned)} / ${fmtScore(s.max)} 分` }, h('div', { class: 'bar-fill' + (p < 60 ? ' low' : ''), style: { width: p + '%' } })),
              h('span', { class: 'val' }, `${p}%`));
          })))),
      h('section', { class: 'panel', style: { marginTop: '20px' } },
        h('div', { class: 'panel-title', style: { justifyContent: 'space-between' } }, h('h2', null, '逐題檢討'), filterBox),
        reveal ? null : h('div', { class: 'notice quiet', style: { marginBottom: '8px' } }, h('div', null, '老師還沒開放這份考卷的答案與解析。你可以先看哪些題目答錯，想一想再問老師。')),
        reviewBox),
      reveal && exam && exam.sources && exam.sources.length ? h('section', { class: 'panel', style: { marginTop: '20px' } },
        h('h2', { class: 'panel-title' }, '時事題資料來源'),
        h('ul', { class: 'sources', style: { padding: 0 } }, exam.sources.map((s) =>
          h('li', null, s.ref ? h('b', null, s.ref + '：') : null, s.title, ' ', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.url))))) : null,
      h('div', { class: 'btn-row', style: { marginTop: '28px' } },
        exam ? h('a', { class: 'btn primary', href: '#/exam/' + exam.id }, '再寫一次') : null,
        count('wrong') + count('partial') ? h('a', { class: 'btn', href: '#/practice/' + a.examId }, '練這份的錯題') : null,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => exportResults() }, '匯出成績檔給老師')),
    ]);
  }

  function reviewItem({ q, no, group }, p, reveal) {
    const st = STATUS[p.status] || STATUS.blank;
    return h('article', { class: 'review-item' },
      h('div', { class: 'qhead' },
        h('span', null, h('span', { class: 'qno' }, no), ' ', h('span', { class: 'qtype' }, `${UI.typeLabel(q)}${q.lesson ? ' · ' + q.lesson : ''}`)),
        h('span', { class: 'btn-row' }, h('span', { class: 'pill ' + st.cls }, st.text), h('span', { class: 'num muted', style: { fontSize: 'var(--fs-sm)' } }, `${fmtScore(p.earned)} / ${fmtScore(p.max)} 分`))),
      group ? h('details', { class: 'passage-box' }, h('summary', null, '題組文章：' + group.title), h('div', null, paras(group.passage.join('\n')))) : null,
      UI.stemBlock(q),
      UI.optionList(q, { chosen: p.chosen, reveal: { answer: q.answer, showAnswer: reveal } }),
      reveal ? h('div', { class: 'explain' },
        h('h4', null, `解析　正確答案 ${q.answer}${p.chosen ? `　你的答案 ${p.chosen}` : '　你沒有作答'}`),
        paras(q.explanation || '（這題沒有解析）'),
        q.ref ? h('p', { class: 'ref' }, '出處：' + q.ref) : null) :
        h('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)', marginTop: '10px' } }, p.chosen ? `你的答案：${p.chosen}` : '你沒有作答'));
  }

  async function exportResults() {
    const data = await Store.exportAttempts();
    if (!data.attempts.length) { UI.toast('還沒有交卷的紀錄'); return; }
    const name = (data.student && data.student.name) || '學生';
    UI.saveFile(`${name}_成績檔_${fmtDate(new Date().toISOString(), false).replace(/\//g, '')}.json`, JSON.stringify(data));
  }

  /* ---------- 錯題本 ---------- */
  // 每題看「最近一次作答」的結果；之後在錯題練習答對就算訂正
  async function wrongBook() {
    const attempts = (await Store.listAttempts({ status: 'submitted', includeDemo: false })).slice().reverse(); // 舊到新
    const practice = await Store.getPractice();
    const latest = {};
    attempts.forEach((a) => {
      Object.entries(a.result.perQ).forEach(([qid, p]) => {
        latest[a.examId + '/' + qid] = { examId: a.examId, qid, status: p.status, at: a.submittedAt, chosen: p.chosen };
      });
    });
    const exams = await Store.listExams();
    const items = [];
    Object.entries(latest).forEach(([key, v]) => {
      if (v.status === 'correct') return;
      const pr = practice[key];
      if (pr && pr.correct && pr.at > v.at) return;
      const exam = exams.find((e) => e.id === v.examId);
      if (!exam) return;
      const x = Core.flatQuestions(exam).find((f) => f.q.id === v.qid);
      if (!x) return;
      items.push(Object.assign({ key, exam }, v, x));
    });
    items.sort((a, b) => a.exam.title.localeCompare(b.exam.title, 'zh-Hant') || a.no - b.no);
    return { items };
  }

  async function wrong() {
    const { items } = await wrongBook();
    const byExam = {};
    items.forEach((it) => { (byExam[it.examId] = byExam[it.examId] || []).push(it); });
    await shell('wrong', [
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, '錯題本'),
        h('h1', { class: 'page-title' }, items.length ? `還有 ${items.length} 題待訂正` : '目前沒有待訂正的題目'),
        h('p', { class: 'lede' }, '這裡收的是每份考卷最近一次作答時答錯、只拿部分分數或沒作答的題目。練習時不計時，答對就會從錯題本移除。')),
      items.length ? h('div', { class: 'btn-row', style: { marginBottom: '24px' } }, h('a', { class: 'btn primary large', href: '#/practice' }, `全部練一次（${items.length} 題）`)) : null,
      ...Object.values(byExam).map((list) => h('section', { class: 'panel' },
        h('div', { class: 'panel-title', style: { justifyContent: 'space-between' } },
          h('h2', null, list[0].exam.title, h('small', null, ` ${list.length} 題`)),
          h('a', { class: 'btn small', href: '#/practice/' + list[0].examId }, '練這份')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, '題號'), h('th', null, '課次'), h('th', null, '題目'), h('th', null, '上次結果'))),
          h('tbody', null, list.map((it) => h('tr', null,
            h('td', { class: 'num' }, it.no),
            h('td', null, it.q.lesson || '—'),
            h('td', null, it.q.stem.length > 60 ? it.q.stem.slice(0, 60) + '…' : it.q.stem),
            h('td', null, h('span', { class: 'pill ' + STATUS[it.status].cls }, STATUS[it.status].text))))))))),
      items.length ? null : h('section', { class: 'panel' }, h('p', { class: 'empty' }, '寫完考卷後，需要訂正的題目會出現在這裡。')),
    ]);
  }

  async function practice({ examId }) {
    let { items } = await wrongBook();
    if (examId) items = items.filter((it) => it.examId === examId);
    if (!items.length) { UI.go('/wrong'); return; }
    let i = 0;
    let chosen = '';
    let checked = false;
    let right = 0;
    const box = h('div');

    function draw() {
      const it = items[i];
      const q = it.q;
      const revealed = checked && canReveal(it.exam);
      const got = checked ? Core.scoreQuestion(q, chosen) : 0;
      const full = checked && got === q.points;
      box.replaceChildren(h('section', { class: 'panel' },
        h('div', { class: 'qhead', style: { justifyContent: 'space-between' } },
          h('span', null, h('span', { class: 'qno' }, `${i + 1}`), h('span', { class: 'qtype' }, ` / ${items.length}　${it.exam.title} 第 ${it.no} 題 · ${UI.typeLabel(q)}`)),
          h('span', { class: 'pill' }, '上次：' + STATUS[it.status].text)),
        it.group ? h('details', { class: 'passage-box', open: true }, h('summary', null, '題組文章：' + it.group.title), h('div', null, paras(it.group.passage.join('\n')))) : null,
        UI.stemBlock(q),
        UI.optionList(q, {
          chosen,
          onChoose: checked ? null : (L) => {
            if (q.type === 'multi') chosen = chosen.includes(L) ? chosen.replace(L, '') : Core.normAnswer(chosen + L);
            else chosen = chosen === L ? '' : L;
            draw();
          },
          reveal: { answer: q.answer, showAnswer: revealed },
        }),
        checked ? h('div', { class: 'explain' },
          h('h4', null, full ? '答對了！這題會從錯題本移除' : got > 0 ? `部分得分（${fmtScore(got)} / ${fmtScore(q.points)} 分），再想想看` : '還沒答對'),
          revealed ? [paras(q.explanation || '（這題沒有解析）'), q.ref ? h('p', { class: 'ref' }, '出處：' + q.ref) : null] :
            h('p', null, '老師還沒開放這份考卷的解析。')) : null,
        h('div', { class: 'qfoot' },
          h('a', { class: 'btn ghost', href: '#/wrong' }, '結束練習'),
          checked ?
            h('button', { class: 'btn primary', type: 'button', onclick: next }, i < items.length - 1 ? '下一題 →' : '看練習結果') :
            h('button', { class: 'btn primary', type: 'button', disabled: !chosen, onclick: check }, '檢查答案'))));
    }
    async function check() {
      checked = true;
      const full = Core.scoreQuestion(items[i].q, chosen) === items[i].q.points;
      if (full) right++;
      await Store.logPractice(items[i].key, full);
      draw();
    }
    function next() {
      if (i < items.length - 1) { i++; chosen = ''; checked = false; draw(); window.scrollTo(0, 0); return; }
      box.replaceChildren(h('section', { class: 'panel' },
        h('h2', { class: 'panel-title' }, '練習結束'),
        h('p', { class: 'lede' }, `這一輪 ${items.length} 題，答對 ${right} 題。${right < items.length ? '沒答對的題目還留在錯題本裡。' : '全部訂正完成！'}`),
        h('div', { class: 'btn-row', style: { marginTop: '20px' } }, h('a', { class: 'btn primary', href: '#/wrong' }, '回錯題本'), h('a', { class: 'btn', href: '#/' }, '回首頁'))));
    }
    draw();
    await shell('wrong', h('div', { class: 'narrow', style: { margin: '0 auto' } },
      h('div', { class: 'page-head' }, h('span', { class: 'eyebrow' }, '錯題練習 · 不計時'), h('h1', { class: 'page-title' }, examId ? items[0].exam.title : '全部錯題')),
      box));
  }

  /* ---------- 作答紀錄 ---------- */
  async function history() {
    await settleExpired();
    const list = await Store.listAttempts({ includeDemo: false });
    await shell('history', [
      h('div', { class: 'page-head' },
        h('span', { class: 'eyebrow' }, '作答紀錄'),
        h('h1', { class: 'page-title' }, list.length ? `寫過 ${list.filter((a) => a.status === 'submitted').length} 份考卷` : '還沒有作答紀錄'),
        h('p', { class: 'lede' }, '可以把成績檔匯出給老師；老師在「老師專區」匯入後就能看到你的成績分析。')),
      h('section', { class: 'panel' },
        list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, '時間'), h('th', null, '考卷'), h('th', { class: 'r' }, '分數'), h('th', { class: 'r' }, '作答時間'), h('th', null, '狀態'), h('th', null, ''))),
          h('tbody', null, list.map((a) => h('tr', null,
            h('td', { class: 'num' }, fmtDate(a.submittedAt || a.startedAt)),
            h('td', null, a.examTitle),
            h('td', { class: 'r' }, a.status === 'submitted' ? `${fmtScore(a.result.earned)} / ${fmtScore(a.result.max)}` : '—'),
            h('td', { class: 'r' }, a.status === 'submitted' ? fmtDuration(a.durationSec) : '—'),
            h('td', null, a.status === 'submitted' ? (a.autoSubmitted ? h('span', { class: 'pill' }, '時間到自動交卷') : h('span', { class: 'pill' }, '已交卷')) : h('span', { class: 'pill solid' }, '作答中')),
            h('td', null, h('a', { class: 'btn small', href: (a.status === 'submitted' ? '#/result/' : '#/take/') + a.id }, a.status === 'submitted' ? '看成績' : '繼續'))))))) :
          h('p', { class: 'empty' }, '寫完第一份考卷後，紀錄會出現在這裡。'),
        list.some((a) => a.status === 'submitted') ? h('div', { class: 'btn-row', style: { marginTop: '20px' } }, h('button', { class: 'btn', type: 'button', onclick: exportResults }, '匯出成績檔給老師')) : null),
    ]);
  }

  window.Student = { home, intro, take, result, wrong, practice, history, APP_NAME, canReveal, STATUS, reviewItem };
})();
