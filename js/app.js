/* 路由：#/ 開頭是學生端，#/t 開頭是老師端。 */
(function () {
  'use strict';
  const { route } = UI;
  // 學生頁面：試算表模式下要先確認專屬連結有效
  const student = (fn) => async (params) => {
    const r = await Store.ready();
    if (!r.ok) return Student.landing(r);
    return fn(params);
  };
  route('/s/:code', Student.enter);
  route('/', student(Student.home));
  route('/exam/:id', student(Student.intro));
  route('/take/:id', student(Student.take));
  route('/result/:id', student(Student.result));
  route('/wrong', student(Student.wrong));
  route('/practice', student(Student.practice));
  route('/practice/:examId', student(Student.practice));
  route('/history', student(Student.history));

  route('/t', Teacher.gate);
  route('/t/home', Teacher.home);
  route('/t/exams', Teacher.exams);
  route('/t/preview/:id', Teacher.preview);
  route('/t/edit/:id', Teacher.edit);
  route('/t/new', Teacher.edit);
  route('/t/import', Teacher.import);
  route('/t/reports', Teacher.reports);
  route('/t/data', Teacher.data);
  route('/t/students', Teacher.students);

  UI.start(() => UI.go('/'));
})();
