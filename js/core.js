/*
 * 練習平台核心邏輯：資料格式、計分、文字匯入解析、答案編碼。
 * 不碰 DOM，瀏覽器（window.Core）和 Node（require）都能用；
 * 之後接 Google Apps Script 時，批改也會沿用這份程式。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LETTERS = 'ABCDEFGH';

  /* ---------- 題目走訪 ---------- */

  // 依考卷順序列出每一題（題組會展開），並附上全卷題號
  function flatQuestions(exam) {
    const out = [];
    let no = 0;
    exam.sections.forEach((sec, si) => {
      sec.items.forEach((item) => {
        if (item.type === 'group') {
          item.questions.forEach((q) => out.push({ q, no: ++no, section: si, group: item }));
        } else {
          out.push({ q: item, no: ++no, section: si, group: null });
        }
      });
    });
    return out;
  }

  function maxScore(exam) {
    return round2(flatQuestions(exam).reduce((s, x) => s + (x.q.points || 0), 0));
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function normAnswer(a) {
    return (a || '').toUpperCase().split('').filter((c) => LETTERS.includes(c)).sort().join('');
  }

  /* ---------- 計分 ---------- */

  // 學測多選計分：n 個選項錯 k 個，得 (n − 2k) / n × 配分，低於 0 以 0 計；未作答 0 分
  function scoreMulti(chosen, correct, nOptions, points) {
    chosen = normAnswer(chosen);
    correct = normAnswer(correct);
    if (!chosen) return 0;
    let wrong = 0;
    for (let i = 0; i < nOptions; i++) {
      const L = LETTERS[i];
      if (chosen.includes(L) !== correct.includes(L)) wrong++;
    }
    return round2(Math.max(0, (nOptions - 2 * wrong) / nOptions) * points);
  }

  function scoreQuestion(q, chosen) {
    chosen = normAnswer(chosen);
    if (q.type === 'multi') return scoreMulti(chosen, q.answer, q.options.length, q.points);
    return chosen && chosen === normAnswer(q.answer) ? q.points : 0;
  }

  // answers: { 題目id: 'AB' }；回傳整份考卷的批改結果
  function grade(exam, answers) {
    const perQ = {};
    const byLesson = {};
    const bySection = exam.sections.map((s) => ({ title: s.title, earned: 0, max: 0 }));
    let earned = 0;
    let max = 0;
    flatQuestions(exam).forEach(({ q, section }) => {
      const chosen = normAnswer(answers[q.id]);
      const got = scoreQuestion(q, chosen);
      perQ[q.id] = {
        chosen,
        earned: got,
        max: q.points,
        status: !chosen ? 'blank' : got === q.points ? 'correct' : got > 0 ? 'partial' : 'wrong',
      };
      earned += got;
      max += q.points;
      bySection[section].earned += got;
      bySection[section].max += q.points;
      const L = q.lesson || '未分類';
      byLesson[L] = byLesson[L] || { earned: 0, max: 0 };
      byLesson[L].earned += got;
      byLesson[L].max += q.points;
    });
    bySection.forEach((s) => { s.earned = round2(s.earned); s.max = round2(s.max); });
    Object.values(byLesson).forEach((s) => { s.earned = round2(s.earned); s.max = round2(s.max); });
    return { earned: round2(earned), max: round2(max), perQ, bySection, byLesson };
  }

  /* ---------- 答案編碼 ----------
   * 發布出去的題庫把答案和解析編碼起來，打開原始碼不會直接看到。
   * 這只是遮擋，不是加密；真正保密要等改成由 Google Apps Script 批改。
   */
  function b64encode(str) {
    if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64decode(str) {
    if (typeof Buffer !== 'undefined') return Buffer.from(str, 'base64').toString('utf8');
    return decodeURIComponent(escape(atob(str)));
  }
  function sealExam(exam) {
    const copy = JSON.parse(JSON.stringify(exam));
    flatQuestions(copy).forEach(({ q }) => {
      q.key = b64encode(JSON.stringify({ a: q.answer, e: q.explanation || '' })).split('').reverse().join('');
      delete q.answer;
      delete q.explanation;
    });
    copy.sealed = true;
    return copy;
  }
  function unsealExam(exam) {
    if (!exam.sealed) return exam;
    const copy = JSON.parse(JSON.stringify(exam));
    flatQuestions(copy).forEach(({ q }) => {
      const k = JSON.parse(b64decode(q.key.split('').reverse().join('')));
      q.answer = k.a;
      q.explanation = k.e;
      delete q.key;
    });
    delete copy.sealed;
    return copy;
  }

  /* ---------- 檢查考卷資料 ---------- */
  function validateExam(exam) {
    const errs = [];
    if (!exam.title) errs.push('缺少考卷標題');
    if (!exam.timeLimit || exam.timeLimit <= 0) errs.push('作答時間需大於 0');
    if (!exam.sections || !exam.sections.length) errs.push('考卷沒有任何大題');
    const ids = new Set();
    flatQuestions(exam).forEach(({ q, no }) => {
      const tag = `第 ${no} 題`;
      if (ids.has(q.id)) errs.push(`${tag}：題目代號重複（${q.id}）`);
      ids.add(q.id);
      if (!q.stem) errs.push(`${tag}：沒有題幹`);
      if (!q.options || q.options.length < 2) errs.push(`${tag}：選項少於 2 個`);
      const a = normAnswer(q.answer);
      if (!a) errs.push(`${tag}：沒有答案`);
      if (q.type === 'single' && a.length > 1) errs.push(`${tag}：單選題只能有一個答案`);
      if (a && q.options && a.split('').some((L) => LETTERS.indexOf(L) >= q.options.length)) {
        errs.push(`${tag}：答案超出選項範圍`);
      }
      if (!(q.points > 0)) errs.push(`${tag}：配分需大於 0`);
    });
    return errs;
  }

  /* ---------- 文字匯入 ----------
   * 格式（詳見 docs/匯入格式.md）：
   *   #考卷 標題   #科目 歷史   #時間 40   #課次 L4,L5   #說明 ...
   *   #來源 第 3 題 | 標題 | 網址
   *   ## 單選題 2        ← 大題，數字是每題配分
   *   1. 題幹
   *   | 表頭 | 表頭 |     ← 題幹裡的表格（第一列為表頭）
   *   (A) 選項 ……
   *   答案：C   解析：……   課次：L5   出處：講義 p.24   配分：3   題型：多選
   *   ## 題組 3
   *   【題組一：標題】     ← 之後到第一個題號前的文字都是文章段落
   */
  function parseText(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const exam = {
      id: '', title: '', subject: '', lessons: [], timeLimit: 40, description: '',
      settings: { reveal: 'immediate', published: true },
      sections: [], sources: [],
    };
    const errors = [];
    let sec = null;
    let group = null;
    let q = null;
    let field = null; // 正在接續的欄位（解析可跨行）
    let qid = 0;
    let gid = 0;

    const secType = () => (sec && sec.kind) || 'single';
    function finishQ() { q = null; field = null; }
    function newSection(kindWord, title, points) {
      finishQ();
      group = null;
      const kind = /多選/.test(kindWord) ? 'multi' : /題組|閱讀/.test(kindWord) ? 'group' : 'single';
      sec = { title: title.trim(), kind, points: points ? Number(points) : null, items: [] };
      exam.sections.push(sec);
    }

    lines.forEach((raw, i) => {
      const line = raw.trim();
      const ln = i + 1;
      if (!line) { field = null; return; }

      let m;
      if ((m = line.match(/^#(考卷|科目|時間|課次|說明|來源|代號)\s*[:：]?\s*(.*)$/))) {
        const v = m[2].trim();
        if (m[1] === '考卷') exam.title = v;
        else if (m[1] === '科目') exam.subject = v;
        else if (m[1] === '時間') exam.timeLimit = parseInt(v, 10) || 40;
        else if (m[1] === '課次') exam.lessons = v.split(/[,，、\s]+/).filter(Boolean);
        else if (m[1] === '說明') exam.description = v;
        else if (m[1] === '代號') exam.id = v;
        else if (m[1] === '來源') {
          const parts = v.split('|').map((s) => s.trim());
          if (parts.length >= 3) exam.sources.push({ ref: parts[0], title: parts[1], url: parts[2] });
          else if (parts.length === 2) exam.sources.push({ ref: '', title: parts[0], url: parts[1] });
          else errors.push(`第 ${ln} 行：來源格式應為「題號 | 標題 | 網址」`);
        }
        return;
      }
      if ((m = line.match(/^##\s*(.+?)(?:\s+(\d+(?:\.\d+)?))?\s*$/))) {
        newSection(m[1], m[1], m[2]);
        return;
      }
      if ((m = line.match(/^【(.+)】$/))) {
        if (!sec) newSection('題組', '題組', null);
        finishQ();
        group = { id: 'g' + (++gid), type: 'group', title: m[1].trim(), passage: [], questions: [] };
        sec.items.push(group);
        return;
      }
      if ((m = line.match(/^(\d+)\s*[.．、]\s*(.+)$/))) {
        if (!sec) newSection('單選題', '單選題', null);
        q = {
          id: 'q' + (++qid),
          type: secType() === 'multi' ? 'multi' : 'single',
          stem: m[2].trim(),
          options: [],
          answer: '',
          explanation: '',
          lesson: '',
          ref: '',
          points: sec.points || 0,
        };
        if (group) group.questions.push(q);
        else sec.items.push(q);
        field = 'stem';
        return;
      }
      if (!q) {
        if (group) { group.passage.push(line); return; }
        errors.push(`第 ${ln} 行：不知道這行屬於哪一題（「${line.slice(0, 20)}」）`);
        return;
      }
      if ((m = line.match(/^[(（]\s*([A-Ha-h])\s*[)）]\s*(.*)$/))) {
        const idx = LETTERS.indexOf(m[1].toUpperCase());
        if (idx !== q.options.length) errors.push(`第 ${ln} 行：選項 (${m[1]}) 順序不對`);
        q.options.push(m[2].trim());
        field = 'option';
        return;
      }
      if ((m = line.match(/^(答案|解析|課次|出處|配分|題型)\s*[:：]\s*(.*)$/))) {
        const v = m[2].trim();
        if (m[1] === '答案') q.answer = normAnswer(v);
        else if (m[1] === '解析') { q.explanation = v; field = 'explanation'; return; }
        else if (m[1] === '課次') q.lesson = v;
        else if (m[1] === '出處') q.ref = v;
        else if (m[1] === '配分') q.points = Number(v) || q.points;
        else if (m[1] === '題型') q.type = /多/.test(v) ? 'multi' : 'single';
        field = null;
        return;
      }
      if (line.startsWith('|') && field === 'stem') {
        const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
        if (cells.every((c) => /^:?-+:?$/.test(c))) return; // Markdown 分隔列
        q.table = q.table || [];
        q.table.push(cells);
        return;
      }
      // 接續上一個欄位的文字
      if (field === 'stem') q.stem += '\n' + line;
      else if (field === 'explanation') q.explanation += '\n' + line;
      else if (field === 'option') q.options[q.options.length - 1] += line;
      else errors.push(`第 ${ln} 行：無法辨識（「${line.slice(0, 20)}」）`);
    });

    if (!exam.title) errors.push('缺少「#考卷 標題」');
    exam.sections.forEach((s) => {
      s.note = (s.points ? `每題 ${s.points} 分` : '') + (s.kind === 'multi' ? '；依學測方式計分' : '');
      delete s.kind;
      delete s.points;
    });
    if (!exam.lessons.length) {
      exam.lessons = [...new Set(flatQuestions(exam).map((x) => x.q.lesson).filter(Boolean))];
    } else if (exam.lessons.length === 1) {
      flatQuestions(exam).forEach((x) => { if (!x.q.lesson) x.q.lesson = exam.lessons[0]; });
    }
    if (exam.sections.length) validateExam(exam).forEach((e) => errors.push(e));
    return { exam, errors };
  }

  /* ---------- 其他小工具 ---------- */
  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function letter(i) { return LETTERS[i]; }

  return {
    LETTERS, letter, flatQuestions, maxScore, normAnswer, scoreMulti, scoreQuestion, grade,
    sealExam, unsealExam, validateExam, parseText, uid, round2,
  };
});
