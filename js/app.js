/* 路由：#/ 開頭是學生端，#/t 開頭是老師端。 */
(function () {
  'use strict';
  const { route } = UI;
  route('/', Student.home);
  route('/exam/:id', Student.intro);
  route('/take/:id', Student.take);
  route('/result/:id', Student.result);
  route('/wrong', Student.wrong);
  route('/practice', Student.practice);
  route('/practice/:examId', Student.practice);
  route('/history', Student.history);

  route('/t', Teacher.gate);
  route('/t/home', Teacher.home);
  route('/t/exams', Teacher.exams);
  route('/t/preview/:id', Teacher.preview);
  route('/t/edit/:id', Teacher.edit);
  route('/t/new', Teacher.edit);
  route('/t/import', Teacher.import);
  route('/t/reports', Teacher.reports);
  route('/t/data', Teacher.data);

  UI.start(() => UI.go('/'));
})();
