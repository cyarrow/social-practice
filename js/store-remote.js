/*
 * 試算表模式的資料存取層：CONFIG.apiUrl 有值時取代 window.Store。
 * 函式名稱和 store.js 相同，介面不用分兩套。
 * 學生用專屬連結的代碼呼叫；老師登入後用 token 呼叫。
 */
(function () {
  'use strict';
  if (!window.CONFIG || !window.CONFIG.apiUrl) return;
  const Core = window.Core;
  const Local = window.Store;
  const API = window.CONFIG.apiUrl;

  /* ---------- 小工具 ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 無法儲存時略過 */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 同上 */ } }
  let memToken = null;
  function getToken() { try { return sessionStorage.getItem('pp.teacherToken') || memToken; } catch (e) { return memToken; } }
  function setToken(t) { memToken = t; try { if (t) sessionStorage.setItem('pp.teacherToken', t); else sessionStorage.removeItem('pp.teacherToken'); } catch (e) { /* 同上 */ } }
  function getCode() { return lsGet('pp.code'); }
  const isTeacherCtx = () => /^#\/t(\/|$)/.test(location.hash || '');
  const clone = (x) => JSON.parse(JSON.stringify(x));

  let busy = 0;
  function setBusy(d) {
    busy = Math.max(0, busy + d);
    if (document.body) document.body.classList.toggle('busy', busy > 0);
  }

  // 這些動作重送可能會重複建立資料，連線失敗時不自動重試
  const NO_RETRY = ['t_addStudent', 't_addAttempts', 't_updateStudent'];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function call(action, payload, teacher) {
    const body = Object.assign({ action }, payload || {});
    if (teacher) body.token = getToken(); else body.code = getCode();
    const tries = NO_RETRY.includes(action) ? 1 : 3;
    let res;
    setBusy(1);
    try {
      for (let i = 0; i < tries; i++) {
        try {
          const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
          res = await r.json();
          break;
        } catch (e) {
          // Google 偶爾會連線失敗（尤其閒置後第一次呼叫），等一下再試
          if (i === tries - 1) {
            const err = new Error('連不上伺服器。請確認網路連線後再試一次。');
            err.code = 'network';
            throw err;
          }
          await wait(1500 * (i + 1));
        }
      }
    } finally {
      setBusy(-1);
    }
    if (!res.ok) {
      const err = new Error(res.error || '伺服器發生錯誤，請稍後再試。');
      err.code = res.code || '';
      if (err.code === 'auth') setToken(null);
      throw err;
    }
    return res.data;
  }

  /* ---------- 學生資料 ---------- */
  let S = null;
  let bootP = null;
  function boot(force) {
    if (!bootP || force) {
      bootP = call('me').then((d) => {
        d.exams.forEach((e) => { e.builtin = false; e.modified = false; });
        S = d;
        return d;
      }).catch((e) => { bootP = null; throw e; });
    }
    return bootP;
  }
  const keyCache = {};

  // 作答中的答案先存在這台電腦，再分批送到試算表
  const draftKey = (id) => 'pp.draft.' + id;
  const timers = {};
  function readDraft(id) { try { return JSON.parse(lsGet(draftKey(id)) || 'null'); } catch (e) { return null; } }
  function flush(id) {
    clearTimeout(timers[id]);
    delete timers[id];
    const d = readDraft(id);
    if (!d) return Promise.resolve();
    return call('saveProgress', { attemptId: id, answers: d.answers, flags: d.flags, current: d.current }).catch((e) => {
      console.warn('暫存失敗，稍後再試', e);
      timers[id] = setTimeout(() => flush(id), 8000);
    });
  }
  window.addEventListener('pagehide', () => Object.keys(timers).forEach(flush));

  /* ---------- 老師資料 ---------- */
  let T = null;
  let tAt = 0;
  async function ensureT(force) {
    if (!T || force || Date.now() - tAt > 15000) {
      const d = await call('t_overview', {}, true);
      d.attempts.forEach((a) => { a.student = a.studentName; });
      d.exams.forEach((e) => { e.builtin = false; e.modified = false; });
      T = d;
      tAt = Date.now();
    }
    return T;
  }

  const sortAttempts = (list) => list.slice().sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));

  const Store = {
    mode: 'remote',
    features: { studentName: false, exportResults: false, resultImport: false, restoreBackup: false, clearAttempts: false, students: true },

    /* 專屬連結 */
    async enter(code) {
      lsSet('pp.code', String(code || '').trim().toLowerCase());
      S = null;
      bootP = null;
    },
    async ready() {
      if (!getCode()) return { ok: false, reason: 'nocode' };
      try {
        await boot();
        return { ok: true };
      } catch (e) {
        if (e.code === 'badcode') lsDel('pp.code');
        return { ok: false, reason: e.code || 'error', message: e.message };
      }
    },
    async sync() { if (isTeacherCtx()) await ensureT(false); },
    studentLink(code) { return location.href.split('#')[0] + '#/s/' + code; },

    /* 學生 */
    async getStudent() { return S && S.student ? { name: S.student.name } : null; },
    async setStudent() { throw new Error('學生名字由老師設定。'); },

    /* 考卷 */
    async listExams() {
      if (isTeacherCtx()) return clone((await ensureT()).exams);
      await boot();
      return clone(S.exams);
    },
    async getExam(id) {
      const list = await Store.listExams();
      return list.find((e) => e.id === id) || null;
    },
    async getReviewExam(id) {
      if (isTeacherCtx()) return Store.getExam(id);
      const exam = await Store.getExam(id);
      if (!exam) return null;
      if (!keyCache[id]) keyCache[id] = (await call('examKeys', { examId: id })).keys;
      const keys = keyCache[id];
      if (!keys) { exam.hasKeys = false; return exam; }
      Core.flatQuestions(exam).forEach(({ q }) => {
        if (keys[q.id]) { q.answer = keys[q.id].answer; q.explanation = keys[q.id].explanation; }
      });
      exam.hasKeys = true;
      return exam;
    },
    async saveExam(exam) {
      const copy = clone(exam);
      delete copy.builtin;
      delete copy.modified;
      const saved = await call('t_saveExam', { exam: copy }, true);
      await ensureT(true);
      return saved;
    },
    async revertExam() {},
    async deleteExam(id) { await call('t_deleteExam', { id }, true); await ensureT(true); },
    async restoreHidden() {},
    async hiddenCount() { return 0; },
    async updateSettings(id, patch) {
      const s = await call('t_settings', { id, patch }, true);
      if (T) { const e = T.exams.find((x) => x.id === id); if (e) e.settings = s; }
      return s;
    },

    /* 作答 */
    async listAttempts(filter) {
      let list;
      if (isTeacherCtx()) list = (await ensureT()).attempts;
      else { await boot(); list = S.attempts.map((a) => Store._withDraft(a)); }
      list = clone(list);
      if (filter && filter.examId) list = list.filter((a) => a.examId === filter.examId);
      if (filter && filter.status) list = list.filter((a) => a.status === filter.status);
      if (filter && filter.includeDemo === false) list = list.filter((a) => !a.demo);
      return sortAttempts(list);
    },
    _withDraft(a) {
      if (a.status !== 'in_progress') return a;
      const d = readDraft(a.id);
      return d ? Object.assign({}, a, { answers: d.answers, flags: d.flags, current: d.current }) : a;
    },
    async getAttempt(id) {
      const list = await Store.listAttempts();
      return list.find((a) => a.id === id) || null;
    },
    async startAttempt(exam) {
      const a = await call('startAttempt', { examId: exam.id });
      a.student = a.studentName;
      S.attempts = S.attempts.filter((x) => x.id !== a.id).concat([a]);
      return clone(a);
    },
    async saveProgress(id, patch) {
      const a = S && S.attempts.find((x) => x.id === id);
      if (!a || a.status !== 'in_progress') return a || null;
      const d = Object.assign(readDraft(id) || { answers: a.answers, flags: a.flags, current: a.current }, patch, { at: Date.now() });
      lsSet(draftKey(id), JSON.stringify(d));
      clearTimeout(timers[id]);
      timers[id] = setTimeout(() => flush(id), 1500);
      return Object.assign({}, a, d);
    },
    async submitAttempt(id, opts) {
      clearTimeout(timers[id]);
      delete timers[id];
      const cur = await Store.getAttempt(id);
      const done = await call('submit', { attemptId: id, answers: cur ? cur.answers : null, flags: cur ? cur.flags : null, auto: !!(opts && opts.auto) });
      // 交卷時一起拿到解析，成績單不用再問一次伺服器
      if ('keys' in done) keyCache[done.examId] = done.keys;
      delete done.keys;
      done.student = done.studentName;
      S.attempts = S.attempts.filter((x) => x.id !== id).concat([done]);
      lsDel(draftKey(id));
      return clone(done);
    },
    async deleteAttempt(id) { await call('t_deleteAttempt', { id }, true); await ensureT(true); },

    /* 錯題 */
    async getPractice() { await boot(); return clone(S.practice || {}); },
    async logPractice() {},
    async checkPractice(examId, qid, chosen) {
      const r = await call('practice', { examId, qid, chosen });
      if (S) S.practice[examId + '/' + qid] = { at: r.at, correct: r.full };
      return r;
    },

    /* 學生名單 */
    async listStudents() { return clone((await ensureT()).students); },
    async addStudent(name) { const s = await call('t_addStudent', { name }, true); await ensureT(true); return s; },
    async updateStudent(studentId, patch) {
      const s = await call('t_updateStudent', Object.assign({ studentId }, patch), true);
      await ensureT(true);
      return s;
    },

    /* 匯出與示範資料 */
    async exportAttempts() { return { kind: 'practice-attempts', attempts: [] }; },
    async importAttempts() { throw new Error('接上試算表後，成績會自動送到老師那裡，不需要匯入。'); },
    async exportAll() {
      const t = await ensureT(true);
      return { kind: 'practice-sheet-export', exportedAt: new Date().toISOString(), exams: t.exams, students: t.students, attempts: t.attempts };
    },
    async importAll() { throw new Error('試算表模式請直接在 Google 試算表的「版本記錄」還原。'); },
    async clearDemo() { await call('t_clearDemo', {}, true); await ensureT(true); },
    async addAttempts(list) {
      await call('t_addAttempts', { attempts: list.map((a) => Object.assign({}, a, { studentId: 'demo' })) }, true);
      await ensureT(true);
    },

    /* 老師登入 */
    async hasTeacherPass() { return true; },
    async checkTeacherPass(pass) {
      try {
        const r = await call('login', { password: pass });
        setToken(r.token);
        return true;
      } catch (e) {
        if (e.code === 'badpass') return false;
        throw e;
      }
    },
    async setTeacherPass(pass) { await call('t_changePassword', { password: pass }, true); },
    teacherLoggedIn() {
      const t = getToken();
      if (!t) return false;
      const exp = Number(t.split('.')[1]);
      return exp > Date.now();
    },
    logout() { setToken(null); T = null; },

    pref: Local.pref,
  };

  window.Store = Store;
})();
