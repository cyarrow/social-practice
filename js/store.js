/*
 * 資料存取層。原型版本把所有資料存在這台電腦的瀏覽器（localStorage）。
 * 之後改接 Google Apps Script 時，只要換掉這個檔案、保留同樣的函式名稱即可，
 * 所以每個函式都回傳 Promise。
 */
(function () {
  'use strict';
  const Core = window.Core;
  const P = 'pp.'; // localStorage 前綴

  function read(key, fallback) {
    try {
      const v = localStorage.getItem(P + key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(P + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('無法儲存資料', e);
      return false;
    }
  }

  const DEFAULT_SETTINGS = { published: true, reveal: 'immediate', released: false };

  // 內建題庫（data/bank.js）＋老師自己新增或修改過的考卷
  function allExams() {
    const custom = read('customExams', {});
    const hidden = read('hiddenExams', []);
    const settings = read('examSettings', {});
    const list = [];
    (window.BANK || []).forEach((sealed) => {
      if (hidden.includes(sealed.id)) return;
      const base = custom[sealed.id] || Core.unsealExam(sealed);
      list.push(withSettings(base, settings, { builtin: true, modified: !!custom[sealed.id] }));
    });
    Object.values(custom).forEach((e) => {
      if (!(window.BANK || []).some((b) => b.id === e.id)) {
        list.push(withSettings(e, settings, { builtin: false, modified: false }));
      }
    });
    return list;
  }
  function withSettings(exam, settings, flags) {
    const e = JSON.parse(JSON.stringify(exam));
    e.settings = Object.assign({}, DEFAULT_SETTINGS, e.settings || {}, settings[e.id] || {});
    e.builtin = flags.builtin;
    e.modified = flags.modified;
    return e;
  }

  function attempts() { return read('attempts', []); }
  function saveAttempts(list) { return write('attempts', list); }

  const Store = {
    mode: 'local',

    /* 學生 */
    async getStudent() { return read('student', null); },
    async setStudent(name) { const s = { name: name.trim() }; write('student', s); return s; },

    /* 考卷 */
    async listExams() { return allExams(); },
    async getExam(id) { return allExams().find((e) => e.id === id) || null; },
    async saveExam(exam) {
      const custom = read('customExams', {});
      const copy = JSON.parse(JSON.stringify(exam));
      delete copy.builtin;
      delete copy.modified;
      copy.updatedAt = new Date().toISOString();
      custom[copy.id] = copy;
      write('customExams', custom);
      // 考卷內的設定以 examSettings 為準，避免兩邊不同步
      await Store.updateSettings(copy.id, copy.settings || {});
      return copy;
    },
    async revertExam(id) {
      const custom = read('customExams', {});
      delete custom[id];
      write('customExams', custom);
    },
    async deleteExam(id) {
      const custom = read('customExams', {});
      const isBuiltin = (window.BANK || []).some((b) => b.id === id);
      delete custom[id];
      write('customExams', custom);
      if (isBuiltin) {
        const hidden = read('hiddenExams', []);
        if (!hidden.includes(id)) hidden.push(id);
        write('hiddenExams', hidden);
      }
    },
    async restoreHidden() { write('hiddenExams', []); },
    async hiddenCount() { return read('hiddenExams', []).length; },
    async updateSettings(id, patch) {
      const s = read('examSettings', {});
      s[id] = Object.assign({}, s[id] || {}, patch);
      write('examSettings', s);
      return s[id];
    },

    /* 作答 */
    async listAttempts(filter) {
      let list = attempts();
      if (filter && filter.examId) list = list.filter((a) => a.examId === filter.examId);
      if (filter && filter.status) list = list.filter((a) => a.status === filter.status);
      if (filter && filter.includeDemo === false) list = list.filter((a) => !a.demo);
      return list.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    },
    async getAttempt(id) { return attempts().find((a) => a.id === id) || null; },
    async startAttempt(exam, student) {
      const now = Date.now();
      const a = {
        id: Core.uid('a'),
        examId: exam.id,
        examTitle: exam.title,
        subject: exam.subject,
        student: student ? student.name : '學生',
        startedAt: new Date(now).toISOString(),
        deadline: new Date(now + exam.timeLimit * 60000).toISOString(),
        timeLimit: exam.timeLimit,
        answers: {},
        flags: {},
        current: 0,
        status: 'in_progress',
      };
      const list = attempts();
      list.push(a);
      saveAttempts(list);
      return a;
    },
    async saveProgress(id, patch) {
      const list = attempts();
      const a = list.find((x) => x.id === id);
      if (!a || a.status !== 'in_progress') return a || null;
      Object.assign(a, patch);
      saveAttempts(list);
      return a;
    },
    async submitAttempt(id, opts) {
      const list = attempts();
      const a = list.find((x) => x.id === id);
      if (!a) throw new Error('找不到這次作答紀錄');
      if (a.status === 'submitted') return a;
      const exam = await Store.getExam(a.examId);
      if (!exam) throw new Error('這份考卷已被刪除，無法批改');
      const r = Core.grade(exam, a.answers);
      const end = Math.min(Date.now(), Date.parse(a.deadline));
      a.status = 'submitted';
      a.submittedAt = new Date(end).toISOString();
      a.autoSubmitted = !!(opts && opts.auto);
      a.durationSec = Math.max(0, Math.round((end - Date.parse(a.startedAt)) / 1000));
      // 把每題的題號、課次、正解一起存下來，之後就算考卷被修改，報表也算得出來
      const meta = {};
      Core.flatQuestions(exam).forEach(({ q, no }) => {
        meta[q.id] = { no, lesson: q.lesson || '未分類', answer: Core.normAnswer(q.answer), type: q.type, n: q.options.length };
      });
      Object.keys(r.perQ).forEach((qid) => Object.assign(r.perQ[qid], meta[qid]));
      a.result = r;
      saveAttempts(list);
      return a;
    },
    async deleteAttempt(id) {
      saveAttempts(attempts().filter((a) => a.id !== id));
    },

    /* 錯題訂正紀錄：key = 考卷id/題目id */
    async getPractice() { return read('practice', {}); },
    async logPractice(key, correct) {
      const p = read('practice', {});
      p[key] = { at: new Date().toISOString(), correct: !!correct };
      write('practice', p);
    },

    /* 匯出與匯入 */
    async exportAttempts() {
      return { kind: 'practice-attempts', exportedAt: new Date().toISOString(), student: read('student', null), attempts: attempts().filter((a) => a.status === 'submitted' && !a.demo) };
    },
    async importAttempts(data) {
      if (!data || data.kind !== 'practice-attempts' || !Array.isArray(data.attempts)) {
        throw new Error('這不是學生端匯出的成績檔');
      }
      const list = attempts();
      let added = 0;
      data.attempts.forEach((a) => {
        if (!a.id || list.some((x) => x.id === a.id)) return;
        list.push(a);
        added++;
      });
      saveAttempts(list);
      return added;
    },
    async exportAll() {
      const keys = ['student', 'customExams', 'hiddenExams', 'examSettings', 'attempts', 'practice'];
      const data = { kind: 'practice-backup', exportedAt: new Date().toISOString() };
      keys.forEach((k) => { data[k] = read(k, null); });
      return data;
    },
    async importAll(data) {
      if (!data || data.kind !== 'practice-backup') throw new Error('這不是平台的備份檔');
      ['student', 'customExams', 'hiddenExams', 'examSettings', 'attempts', 'practice'].forEach((k) => {
        if (data[k] !== null && data[k] !== undefined) write(k, data[k]);
      });
    },
    async clearDemo() { saveAttempts(attempts().filter((a) => !a.demo)); },
    async addAttempts(list) { saveAttempts(attempts().concat(list)); },

    /* 老師密碼（只是門鎖，不是真正的安全機制） */
    async hasTeacherPass() { return !!read('teacherPass', null); },
    async setTeacherPass(pass) { write('teacherPass', hash(pass)); },
    async checkTeacherPass(pass) { return read('teacherPass', null) === hash(pass); },

    /* 介面偏好 */
    pref(key, value) {
      const prefs = read('prefs', {});
      if (value === undefined) return prefs[key];
      prefs[key] = value;
      write('prefs', prefs);
      return value;
    },
  };

  // FNV-1a，只用來避免密碼以明碼存放
  function hash(s) {
    let h = 0x811c9dc5;
    const str = 'pp-salt:' + s;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
  }

  window.Store = Store;
})();
