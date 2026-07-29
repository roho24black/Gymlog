// Persistent Node.js sanity-test harness for gym planner.html.
// Run with: node "/Users/romanask/Library/Application Support/GymLog/test.js"
// Mocks DOM/localStorage/canvas, evals the app's inline <script>, and exercises
// the real app functions against a synthetic multi-week history. Add new
// check(...) calls at the bottom as features are added — no need to rebuild
// the mocking boilerplate each session.

const fs = require('fs');
const HTML_PATH = '/Users/romanask/Library/Mobile Documents/com~apple~CloudDocs/GYM/gym planner.html';

const html = fs.readFileSync(HTML_PATH, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
// Drop the trailing auto-boot call (loadST(); render...) so we control init order.
const stripped = script.replace(/loadST\(\);[\s\S]*$/, '');

var domStore = {};
function makeEl(id) {
  if (!domStore[id]) domStore[id] = {
    value: '', innerHTML: '', textContent: '', style: {}, className: '', type: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains(c) { return this._s.has(c); }
    },
    focus() {}, select() {}, addEventListener() {}, setAttribute() {}, appendChild() {}, remove() {},
    scrollTop: 0, scrollHeight: 0,
    querySelectorAll() { return []; }, querySelector() { return null; }, files: null
  };
  return domStore[id];
}
global.window = { addEventListener() {} };
global.navigator = { vibrate() {} };
global.location = { origin: 'https://example.test', pathname: '/gym.html', hash: '', search: '', reload() {} };
global.history = { replaceState() {} };
// Mirrors the Image mock's async-onload pattern. Tests pass a fake file object shaped
// {__content: '...'} rather than a real File/Blob.
global.FileReader = function () {
  var self = this;
  this.readAsText = function (file) {
    setTimeout(function () { if (self.onload) self.onload({target:{result: file.__content}}); }, 0);
  };
  this.readAsDataURL = function (file) {
    setTimeout(function () { if (self.onload) self.onload({target:{result: 'data:image/png;base64,'+(file.__content||'mock')}}); }, 0);
  };
};
// Fires onload on the next tick (real Image decoding is async), like a real browser —
// tests that exercise the photo-background card path await flushMicrotasks() for it.
global.Image = function () {
  this.width = 800; this.height = 600;
  var self = this;
  Object.defineProperty(this, 'src', {
    set(v) { this._src = v; setTimeout(function () { if (self.onload) self.onload(); }, 0); },
    get() { return this._src; }
  });
};
global.document = {
  getElementById: (id) => makeEl(id),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  visibilityState: 'visible',
  createElement: (tag) => {
    var el = {
      tag: tag, style: {}, innerHTML: '', textContent: '', className: '',
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); } },
      addEventListener() {}, querySelector() { return { addEventListener() {}, onclick: null }; },
      remove() {}, appendChild() {}, click() {}, setAttribute() {},
      getContext: tag === 'canvas' ? function () {
        return {
          createLinearGradient() { return { addColorStop() {} }; },
          fillRect() {}, beginPath() {}, arc() {}, arcTo() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, drawImage() {}, setLineDash() {},
          fillText() {}, measureText() { return { width: 40 }; },
          set fillStyle(v) {}, set font(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set textAlign(v) {}
        };
      } : undefined,
      toBlob: tag === 'canvas' ? function (cb) { cb({ size: 1 }); } : undefined,
      toDataURL: tag === 'canvas' ? function () { return 'data:image/png;base64,mock'; } : undefined,
      width: 0, height: 0
    };
    return el;
  },
  body: { appendChild(el) {}, removeChild(el) {} }
};
global.localStorage = { _data: {}, getItem(k) { return this._data[k] || null; }, setItem(k, v) { this._data[k] = v; } };
global.URL = { createObjectURL: () => 'blob://x', revokeObjectURL: () => {} };
global.File = function (parts, name, opts) { this.parts = parts; this.name = name; this.opts = opts; };
global.Blob = function (parts, opts) { this.parts = parts; this.opts = opts; };
global.fetch = function (url, opts) {
  // Construct real Headers so non-ASCII header values (e.g. Cyrillic in a Title)
  // throw here exactly like they would in a real browser, instead of being masked
  // by a shallow mock. This is what would have caught the "Title: <cyrillic>" bug.
  if (opts && opts.headers) new Headers(opts.headers);
  return Promise.resolve({ ok: true });
};
global.requestAnimationFrame = function (cb) { return 0; };
global.cancelAnimationFrame = function (id) {};

eval(stripped);

var errors = [];
var passed = 0;
async function check(label, fn) {
  // startWorkout() ids workouts with Date.now(); back-to-back checks in the same
  // millisecond can collide with a finished workout left over from an earlier check
  // in today's bucket, making getWkt() resolve to the wrong object. Clear today's
  // slate before each check so only synthetic historical dates carry over.
  delete ST.w[todayStr()];
  try { await fn(); passed++; console.log('OK  ', label); }
  catch (e) { errors.push(label + ': ' + e.message); console.log('FAIL', label, '->', e.message); }
}

(async function(){
await check('every fetch "headers:" object literal in the source is ASCII-safe', function () {
  // Regression guard for the "Title: <cyrillic>" bug: non-ASCII header values make
  // `new Headers(...)` throw synchronously, which the app's try/catch swallows —
  // so a fetch silently never leaves the device. Statically validate every
  // `headers: {...}` literal in the real source with the real Headers constructor,
  // so this class of bug fails loudly here instead of shipping silently again.
  var headerBlockRe = /headers:\s*\{([^}]*)\}/g;
  var m, count = 0;
  while ((m = headerBlockRe.exec(stripped))) {
    count++;
    var headersObj = eval('({' + m[1] + '})');
    try { new Headers(headersObj); }
    catch (e) { throw new Error('non-ASCII/invalid header value in: {' + m[1].trim() + '} -> ' + e.message); }
  }
  if (count < 2) throw new Error('expected at least 2 headers blocks (error reporter + bug report) — regex may be broken, got ' + count);
});

// ---- Synthetic dataset covering all exercise types ----
ST = { w: {}, cfg: { name: 'Р', age: 20, weight: 78, height: 180 }, wr: {}, wrMax: {}, templates: [], recovery: null, recentEx: [], bw: {}, customEx: [] };
var today = todayStr();
for (var i = 1; i <= 60; i++) {
  var ds = dateAdd(today, -i);
  if (i % 2 !== 0) continue;
  var exs = [];
  exs.push({ name: 'Приседания со штангой', sets: [
    { w: 80 + i * 0.5, r: 8, done: true },
    { w: 40, r: 12, done: true, warmup: true }
  ]});
  if (i % 4 === 0) exs.push({ name: 'Лестничный тренажёр (Stairmaster)', sets: [{ w: 0, r: 0, dist: 20 + i * 0.2, mins: 20, done: true }] });
  if (i % 6 === 0) exs.push({ name: 'Беговая дорожка', sets: [{ w: 0, r: 0, dist: 5 + i * 0.05, mins: 30, done: true }] });
  if (i % 8 === 0) exs.push({ name: 'Ноги с доской', style: 'Кроль', sets: [{ dist: 200, secs: 180, done: true }] });
  if (i % 10 === 0) exs.push({ name: 'Планка', sets: [{ secs: 60 + i, done: true }] });
  ST.w[ds] = { workouts: [{ id: i, name: 'Тренировка ' + i, loc: 'gym', startTime: Date.now() - i * 86400000, endTime: Date.now() - i * 86400000 + 3600000, exercises: exs }] };
  if (i % 3 === 0) ST.bw[ds] = 78 - i * 0.05;
}
ST.customEx.push({ name: 'Моя придумка', group: 'Грудь' });
saveST();

// ---- Checks ----
await check('computeProgressData with mixed exercise types incl Stairmaster', function () {
  var pd = computeProgressData();
  if (pd.totalStairFloors <= 0) throw new Error('totalStairFloors should be >0');
  if (pd.totalCardioKm <= 0) throw new Error('totalCardioKm should be >0 (treadmill)');
});

['overview', 'strength', 'cardio', 'body'].forEach(function (tab) {
  check('renderProgress subtab=' + tab, function () { PROG_SUBTAB = tab; renderProgress(); });
});

await check('renderCardioChart for stairmaster', function () {
  var pd = computeProgressData(); window._progData = pd;
  renderProgChart('Лестничный тренажёр (Stairmaster)');
});
await check('renderCardioChart for treadmill (dist+pace modes)', function () {
  PROG_CARDIO_MODE = 'dist'; renderProgChart('Беговая дорожка');
  PROG_CARDIO_MODE = 'pace'; renderProgChart('Беговая дорожка');
});
await check('renderProgChart for swim style-keyed name', function () {
  renderProgChart('Ноги с доской · Кроль');
});
await check('achievementsHtml with rich data', function () {
  var pd = computeProgressData();
  var out = achievementsHtml(pd);
  if (typeof out !== 'string' || !out.length) throw new Error('empty achievements html');
});

await check('new achievements: RPE count, circuits completed, measurement log count', function () {
  var pdLow = computeProgressData();
  var rpeAch = ACHIEVEMENTS.filter(function(a){ return a.label === '20 подходов с RPE'; })[0];
  var circAch = ACHIEVEMENTS.filter(function(a){ return a.label === '5 кругов пройдено'; })[0];
  var measAch = ACHIEVEMENTS.filter(function(a){ return a.label === '5 замеров тела'; })[0];
  if (!rpeAch || !circAch || !measAch) throw new Error('one or more new achievements missing from ACHIEVEMENTS');

  // RPE: seed sets with rpe set on a date not covered by the base fixture
  var ds = dateAdd(today, -1);
  var sets = [];
  for (var i = 0; i < 25; i++) sets.push({ w: 60, r: 8, done: true, rpe: 7 });
  ST.w[ds] = { workouts: [{ id: 12345, name: 'W', loc: 'gym', startTime: Date.now(), endTime: Date.now()+1000, exercises: [{ name: 'Приседания со штангой', sets: sets }] }] };
  saveST();
  var pdHigh = computeProgressData();
  if (pdHigh.totalRpeSets < 20) throw new Error('expected totalRpeSets>=20, got ' + pdHigh.totalRpeSets);
  if (rpeAch.check(pdHigh) !== true) throw new Error('RPE achievement should unlock with 20+ rpe sets');
  delete ST.w[ds];
  saveST();

  // Circuits: not completed yet -> locked; simulate circFinish's counter directly
  if (circAch.check(pdLow) !== false) throw new Error('circuit achievement should be locked before any completions');
  if (!ST.stats) ST.stats = {};
  ST.stats.circuitsCompleted = 5;
  saveST();
  if (circAch.check(pdLow) !== true) throw new Error('circuit achievement should unlock at 5 completions');

  // Measurements: 5 distinct dated entries
  ST.measurements = {};
  for (var m = 0; m < 5; m++) ST.measurements[dateAdd(today, -m-20)] = { waist: 80 };
  saveST();
  if (measAch.check(pdLow) !== true) throw new Error('measurement achievement should unlock at 5 logged dates');
});

await check('full workout with Stairmaster manual dist entry', function () {
  startWorkout();
  DB_CB = addExToWorkout;
  addExToWorkout('Лестничный тренажёр (Stairmaster)');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  var idx = wkt.exercises.length - 1;
  openSheet(idx, 0, 'dist');
  if (domStore['sh-title'].textContent !== 'Этажи') throw new Error('wrong sheet title: ' + domStore['sh-title'].textContent);
  SH_VAL = 45;
  shConfirm();
  if (wkt.exercises[idx].sets[0].dist !== 45) throw new Error('dist not saved correctly');
  finishWorkout();
});

await check('static timer resumes from the first not-done set instead of always restarting at exercise 1', function () {
  startWorkout();
  addExToWorkout('Планка');
  addExToWorkout('Боковая планка (левая)');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  // exercise 1 ("Планка") fully done already, exercise 2 not started yet
  wkt.exercises[0].sets.forEach(function(s){ s.secs = 60; s.done = true; });

  openWorkoutTimer();
  tmrStart();
  var cur = TMR.seq[TMR.idx];
  if (cur.ei !== 1) throw new Error('timer should skip the already-done first exercise and start on the second, got ei=' + cur.ei + ' name=' + cur.name);
  if (cur.si !== 0) throw new Error('should start at the first set of the pending exercise, got si=' + cur.si);
  closeTmr();

  // regression guard: with nothing done yet, it must still start at the very beginning
  wkt.exercises[0].sets.forEach(function(s){ s.done = false; });
  openWorkoutTimer();
  tmrStart();
  if (TMR.idx !== 0) throw new Error('with nothing done, timer should still start at idx 0, got ' + TMR.idx);
  closeTmr();

  // everything done -> should refuse to start rather than run a zero-length timer
  wkt.exercises.forEach(function(ex){ ex.sets.forEach(function(s){ s.secs = 60; s.done = true; }); });
  openWorkoutTimer();
  tmrStart();
  if (TMR && TMR.running) throw new Error('timer should not start running when every set is already done');
  closeTmr();
  cancelWorkout();
});

await check('swim manual time entry end-to-end', function () {
  startWorkout();
  addExToWorkout('Ноги с доской');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  if (!ST.cfg) ST.cfg = {};
  ST.cfg.inputMode = 'manual';
  openSheet(0, 0, 'swimtime');
  domStore['sh-manual-min'].value = '2';
  domStore['sh-manual-sec'].value = '15';
  shManualTimeInput();
  shConfirm();
  if (wkt.exercises[0].sets[0].secs !== 135) throw new Error('swim time not saved, got ' + wkt.exercises[0].sets[0].secs);
  finishWorkout();
});

await check('plan-view warmup toggle + manual weight input type not corrupted by prior swimtime field', function () {
  var ds = dateAdd(today, 3);
  createPlan(null, ds);
  var day = ST.w[ds];
  PLAN_WKT = { date: ds, wid: day.workouts[day.workouts.length - 1].id };
  var wkt = getWkt(PLAN_WKT.date, PLAN_WKT.wid);
  wkt.exercises.push(makeEx('Приседания со штангой'));
  wkt.exercises.push(makeEx('Ноги с доской'));
  ST.cfg.inputMode = 'manual';
  openSheet(1, 0, 'swimtime');
  openSheet(0, 0, 'w');
  if (domStore['sh-manual-input'].type !== 'number') throw new Error('weight input type corrupted after swimtime interaction');
  if (domStore['sh-manual-unit'].textContent !== 'кг') throw new Error('weight unit corrupted: ' + domStore['sh-manual-unit'].textContent);
  toggleWarmup(0, 0);
  if (!wkt.exercises[0].sets[0].warmup) throw new Error('warmup not toggled in plan view');
});

await check('exportData / re-import with all fields intact', function () {
  var blobCaptured = null;
  global.Blob = function (parts, opts) { blobCaptured = parts[0]; this.parts = parts; };
  exportData();
  var parsed = JSON.parse(blobCaptured);
  if (!parsed.customEx || !parsed.customEx.some(function (e) { return e.name === 'Моя придумка'; })) throw new Error('customEx missing from export');
  if (!parsed.bw || Object.keys(parsed.bw).length === 0) throw new Error('bw missing from export');
});

await check('shareWorkoutCardImg does not throw (empty and rich summaries)', function () {
  shareWorkoutCardImg({ name: 'Т', durMs: 1800000, vol: 0, sets: 5, prs: [], loc: 'gym', exercises: [] });
  var manyEx = [];
  for (var i = 0; i < 12; i++) manyEx.push({ name: 'Упражнение номер ' + i, text: (80+i) + ' кг × 8' });
  var manyPrs = [];
  for (var j = 0; j < 6; j++) manyPrs.push({ name: 'PR упражнение ' + j, w: 100+j, r: 5 });
  shareWorkoutCardImg({ name: 'Очень длинное название тренировки чтобы проверить обрезку текста', durMs: 5400000, vol: 12345, sets: 30, prs: manyPrs, loc: 'pool', exercises: manyEx });
});

await check('buildWorkoutSummary includes per-exercise breakdown for mixed types', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  addExToWorkout('Беговая дорожка');
  addExToWorkout('Планка');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  wkt.exercises[0].sets.forEach(function(s){ s.w = 90; s.r = 5; s.done = true; });
  wkt.exercises[1].sets[0].dist = 5; wkt.exercises[1].sets[0].mins = 25; wkt.exercises[1].sets[0].done = true;
  wkt.exercises[2].sets[0].secs = 60; wkt.exercises[2].sets[0].done = true;
  var sum = buildWorkoutSummary(wkt);
  if (sum.exercises.length !== 3) throw new Error('expected 3 exercise summaries, got ' + sum.exercises.length);
  if (sum.exercises[0].text.indexOf('кг ×') === -1) throw new Error('strength summary text wrong: ' + sum.exercises[0].text);
  if (sum.exercises[1].text.indexOf('км') === -1) throw new Error('cardio summary text wrong: ' + sum.exercises[1].text);
  if (sum.exercises[2].text.indexOf('с') === -1) throw new Error('static summary text wrong: ' + sum.exercises[2].text);
  shareWorkoutCardImg(sum);
  finishWorkout();
});

await check('superset linking toggles and renders in both active workout and plan view', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  addExToWorkout('Жим ногами 45°');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  if (wkt.exercises[1].linkedToPrev) throw new Error('should start unlinked');
  toggleSuperset(1);
  if (!wkt.exercises[1].linkedToPrev) throw new Error('toggleSuperset did not link');
  toggleSuperset(0);
  if (wkt.exercises[0].linkedToPrev) throw new Error('toggleSuperset should no-op on first exercise (ei=0)');
  renderWorkout();
  toggleSuperset(1);
  if (wkt.exercises[1].linkedToPrev) throw new Error('toggleSuperset did not unlink on second tap');
  finishWorkout();

  var ds = dateAdd(today, 5);
  createPlan(null, ds);
  var day = ST.w[ds];
  PLAN_WKT = { date: ds, wid: day.workouts[day.workouts.length - 1].id };
  var pwkt = getWkt(PLAN_WKT.date, PLAN_WKT.wid);
  pwkt.exercises.push(makeEx('Становая тяга'));
  pwkt.exercises.push(makeEx('Гиперэкстензия'));
  toggleSuperset(1);
  if (!pwkt.exercises[1].linkedToPrev) throw new Error('toggleSuperset did not link in plan view');
  renderWorkout();
  closePlan();
});

await check('shareAchievementsCardImg does not throw (empty and unlocked)', function () {
  var real = computeProgressData();
  window._progData = real;
  shareAchievementsCardImg();
  window._progData = Object.assign({}, real, { totalWkts: 999 });
  shareAchievementsCardImg();
  window._progData = real; // restore so later tests relying on window._progData see the full dataset
});

await check('shareCircuitCardImg does not throw during an active circuit', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  addExToWorkout('Жим ногами 45°');
  toggleSuperset(1);
  setGroupName(0, 'Финальный круг');
  startCircuit(0);
  shareCircuitCardImg();
  closeCirc();
  cancelWorkout();
});

await check('naming a superset group shows up in connector label and circuit runner', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  addExToWorkout('Жим ногами 45°');
  addExToWorkout('Румынская тяга');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  toggleSuperset(1);
  toggleSuperset(2);
  setGroupName(0, 'Ноги убийцы');
  if (wkt.exercises[0].groupName !== 'Ноги убийцы') throw new Error('groupName not saved');
  if (groupStartIdx(wkt.exercises, 2) !== 0) throw new Error('groupStartIdx should resolve to 0, got ' + groupStartIdx(wkt.exercises, 2));
  var connector = superlinkRowHtml(1, true, wkt.exercises[groupStartIdx(wkt.exercises, 1)].groupName);
  if (connector.indexOf('Ноги убийцы') === -1) throw new Error('connector label missing custom group name');
  renderWorkout();
  startCircuit(0);
  if (CIRC.name !== 'Ноги убийцы') throw new Error('circuit did not pick up group name');
  var circHtml = (function(){ return domStore['circ-overlay'] ? domStore['circ-overlay'].innerHTML : ''; })();
  if (circHtml.indexOf('Ноги убийцы') === -1) throw new Error('circuit overlay does not show group name');
  closeCirc();
  cancelWorkout();
});

await check('circuit runner: full work/rest/round flow', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  addExToWorkout('Жим ногами 45°');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  toggleSuperset(1);
  wkt.exercises[0].sets = [{ w: 60, r: 10, done: false }, { w: 60, r: 10, done: false }];
  wkt.exercises[1].sets = [{ w: 80, r: 12, done: false }, { w: 80, r: 12, done: false }];

  startCircuit(0);
  if (!CIRC || CIRC.rounds !== 2) throw new Error('expected rounds=2, got ' + (CIRC && CIRC.rounds));
  if (CIRC.group.length !== 2) throw new Error('expected group of 2 exercises');

  circDone();
  if (!wkt.exercises[0].sets[0].done) throw new Error('set not marked done after circDone');
  if (CIRC.phase !== 'rest' || CIRC.restKind !== 'ex') throw new Error('expected ex-rest, got ' + CIRC.phase + '/' + CIRC.restKind);
  circSkipRest();
  if (CIRC.phase !== 'work' || CIRC.pos !== 1) throw new Error('expected work pos=1, got ' + CIRC.phase + '/' + CIRC.pos);

  circDone();
  if (!wkt.exercises[1].sets[0].done) throw new Error('second exercise set not marked done');
  if (CIRC.phase !== 'rest' || CIRC.restKind !== 'round') throw new Error('expected round-rest, got ' + CIRC.phase + '/' + CIRC.restKind);
  circSkipRest();
  if (CIRC.phase !== 'work' || CIRC.round !== 1 || CIRC.pos !== 0) throw new Error('expected round=1 pos=0, got round=' + CIRC.round + ' pos=' + CIRC.pos);

  circDone(); circSkipRest();
  var statsBefore = (ST.stats && ST.stats.circuitsCompleted) || 0;
  circDone();
  if (CIRC.phase !== 'done') throw new Error('expected done phase after final round, got ' + CIRC.phase);
  if ((ST.stats.circuitsCompleted||0) !== statsBefore + 1) throw new Error('circFinish should increment ST.stats.circuitsCompleted, before=' + statsBefore + ' after=' + ST.stats.circuitsCompleted);

  closeCirc();
  if (CIRC !== null) throw new Error('closeCirc should null out CIRC');
});

await check('circuit renders correctly for mixed exercise types (strength + static + cardio)', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  addExToWorkout('Планка');
  addExToWorkout('Беговая дорожка');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  toggleSuperset(1);
  toggleSuperset(2);
  startCircuit(0);
  if (CIRC.group.length !== 3) throw new Error('expected 3-exercise mixed group');
  var guard = 0;
  while (CIRC.phase !== 'done' && guard < 50) {
    if (CIRC.phase === 'work') circDone();
    else if (CIRC.phase === 'rest') circSkipRest();
    guard++;
  }
  if (CIRC.phase !== 'done') throw new Error('circuit did not reach done phase (guard=' + guard + ')');
  if (!wkt.exercises[1].sets[0].done || !wkt.exercises[2].sets[0].done) throw new Error('static/cardio sets not marked done');
  closeCirc();
});

await check('circuit rest durations adjustable and persisted to ST.cfg', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  addExToWorkout('Жим ногами 45°');
  toggleSuperset(1);
  startCircuit(0);
  var beforeEx = CIRC.restEx, beforeRound = CIRC.restRound;
  circSetRestEx(5);
  circSetRestRound(-15);
  if (CIRC.restEx !== beforeEx + 5) throw new Error('restEx not adjusted');
  if (ST.cfg.circuitRestEx !== beforeEx + 5) throw new Error('circuitRestEx not persisted');
  if (CIRC.restRound !== Math.max(0, beforeRound - 15)) throw new Error('restRound not adjusted');
  if (ST.cfg.circuitRestRound !== CIRC.restRound) throw new Error('circuitRestRound not persisted');
  closeCirc();
});

await check('startCircuit refuses fewer than 2 linked exercises', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  startCircuit(0);
  if (CIRC !== null) throw new Error('should refuse to start circuit with <2 exercises');
  cancelWorkout();
});

await check('sheet edits during circuit refresh circ overlay, not the underlying workout page', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  addExToWorkout('Жим ногами 45°');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  toggleSuperset(1);
  startCircuit(0);
  openSheet(0, 0, 'w');
  SH_VAL = 100;
  shConfirm();
  if (wkt.exercises[0].sets[0].w !== 100) throw new Error('weight not saved via sheet during circuit');
  if (!CIRC) throw new Error('CIRC should remain active after shConfirm during circuit');
  closeCirc();
});

await check('goal-setting for a lift and for bodyweight', function () {
  renderProgChart('Приседания со штангой');
  document.getElementById('goal-ex-input').value = '150';
  setExGoal('Приседания со штангой');
  if (ST.goals.byExName['Приседания со штангой'] !== 150) throw new Error('lift goal not saved');
  if (domStore['prog-chart'].innerHTML.indexOf('до цели') === -1) throw new Error('goal progress not rendered for lift');

  bwSectionHtml();
  document.getElementById('goal-bw-input').value = '75';
  setBwGoal();
  if (ST.goals.bodyweight !== 75) throw new Error('bodyweight goal not saved');
  var html2 = bwSectionHtml();
  if (html2.indexOf('до цели') === -1 && html2.indexOf('достигнута') === -1) throw new Error('bodyweight goal progress not rendered');
});

await check('body measurements log + render + legacy-missing-field default', function () {
  document.getElementById('meas-waist').value = '82';
  document.getElementById('meas-chest').value = '';
  document.getElementById('meas-arm').value = '38.5';
  document.getElementById('meas-hips').value = '';
  logMeasurements();
  var today2 = todayStr();
  if (!ST.measurements[today2] || ST.measurements[today2].waist !== 82) throw new Error('waist not saved');
  if (ST.measurements[today2].chest != null) throw new Error('empty chest field should not be saved');
  PROG_SUBTAB = 'body'; renderProgress();
  if (domStore['prog-body'].innerHTML.indexOf('Замеры тела') === -1) throw new Error('measurements section not rendered');
});

await check('comma-decimal input works for bodyweight, measurements, and lift goals (not just the 1RM calculator)', function () {
  // Same class of bug as the 1RM calculator: these fields must be type="text" (not
  // type="number") so a typed ',' isn't silently stripped by the browser.
  var htmlSrc = fs.readFileSync(HTML_PATH, 'utf8');
  ['bw-input', 'goal-bw-input', "meas-'+f[0]+'", "goal-meas-'+field+'", "'+inputId+'"].forEach(function(idFrag){
    var re = new RegExp('type="number" id="' + idFrag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"');
    if (re.test(htmlSrc)) throw new Error('field matching id "' + idFrag + '" is still type="number"');
  });
  if (htmlSrc.indexOf('id="sh-manual-input" type="number"') !== -1) throw new Error('sh-manual-input is still type="number"');

  bwSectionHtml();
  document.getElementById('bw-input').value = '82,5';
  logBodyweight();
  if (ST.bw[todayStr()] !== 82.5) throw new Error('bodyweight comma-decimal not parsed, got ' + ST.bw[todayStr()]);

  document.getElementById('meas-waist').value = '81,5';
  document.getElementById('meas-chest').value = '';
  document.getElementById('meas-arm').value = '';
  document.getElementById('meas-hips').value = '';
  logMeasurements();
  if (ST.measurements[todayStr()].waist !== 81.5) throw new Error('measurement comma-decimal not parsed, got ' + ST.measurements[todayStr()].waist);

  renderProgChart('Приседания со штангой');
  document.getElementById('goal-ex-input').value = '132,5';
  setExGoal('Приседания со штангой');
  if (ST.goals.byExName['Приседания со штангой'] !== 132.5) throw new Error('lift goal comma-decimal not parsed, got ' + ST.goals.byExName['Приседания со штангой']);
});

await check('measurement trend chart appears once a field has 2+ data points', function () {
  ST.measurements = {};
  var d1 = dateAdd(today, -10), d2 = dateAdd(today, -3);
  ST.measurements[d1] = { waist: 84 };
  ST.measurements[d2] = { waist: 81, chest: 100 };
  saveST();
  if (measurementChartHtml('waist', 'Талия') === '') throw new Error('expected waist chart with 2 points');
  if (measurementChartHtml('chest', 'Грудь') !== '') throw new Error('chest has only 1 point, should not render a chart');
  var html2 = measurementsSectionHtml();
  if (html2.indexOf('Талия') === -1) throw new Error('waist chart title missing from measurements section');
});

await check('measurement goal set + progress text (works in either direction)', function () {
  var chartHtml = measurementChartHtml('waist', 'Талия');
  var m = document.getElementById('goal-meas-waist');
  m.value = '78';
  setMeasGoal('waist');
  if (ST.goals.measurements.waist !== 78) throw new Error('waist goal not saved');
  var chartHtml2 = measurementChartHtml('waist', 'Талия');
  if (chartHtml2.indexOf('до цели') === -1 && chartHtml2.indexOf('достигнута') === -1) throw new Error('waist goal progress not shown');
  if (bwGoalRemainText(81, 78, 'см').indexOf('-3') === -1) throw new Error('shrink-direction goal text wrong: ' + bwGoalRemainText(81, 78, 'см'));
  if (bwGoalRemainText(38, 42, 'см').indexOf('+4') === -1) throw new Error('grow-direction goal text wrong: ' + bwGoalRemainText(38, 42, 'см'));
});

await check('renderExHistory shows set list for strength and cardio exercises', function () {
  var pd = computeProgressData();
  renderProgChart('Приседания со штангой');
  if (!domStore['prog-ex-history'].innerHTML.length) throw new Error('history empty for strength exercise');
  if (domStore['prog-ex-history'].innerHTML.indexOf('кг ×') === -1) throw new Error('history missing weight x reps text');
  renderProgChart('Лестничный тренажёр (Stairmaster)');
  if (!domStore['prog-ex-history'].innerHTML.length) throw new Error('history empty for stairmaster');
});

await check('RPE set via openSheet/shConfirm and rendered in set row', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  openSheet(0, 0, 'rpe');
  if (domStore['sh-title'].textContent.indexOf('RPE') === -1) throw new Error('wrong sheet title for rpe: ' + domStore['sh-title'].textContent);
  SH_VAL = 8;
  shConfirm();
  if (wkt.exercises[0].sets[0].rpe !== 8) throw new Error('rpe not saved, got ' + wkt.exercises[0].sets[0].rpe);
  renderWorkout();
  cancelWorkout();
});

await check('autoExportIfDue throttles to once per 7 days', function () {
  var exportCalls = 0;
  var realExport = exportData;
  exportData = function () { exportCalls++; };
  ST.cfg.lastAutoExport = Date.now();
  autoExportIfDue();
  if (exportCalls !== 0) throw new Error('should not export again within 7 days');
  ST.cfg.lastAutoExport = Date.now() - 8 * 24 * 60 * 60 * 1000;
  autoExportIfDue();
  if (exportCalls !== 1) throw new Error('should export once when overdue, got ' + exportCalls);
  if (Date.now() - ST.cfg.lastAutoExport > 5000) throw new Error('lastAutoExport not refreshed');
  exportData = realExport;
});

await check('RPE-based weight suggestion surfaces from last logged set', function () {
  var ds = dateAdd(today, -1); // more recent than any date in the seeded fixture (which starts at -2)
  ST.w[ds] = { workouts: [{ id: 999, name: 'W', loc: 'gym', startTime: Date.now(), endTime: Date.now()+1000,
    exercises: [{ name: 'Приседания со штангой', sets: [{ w: 80, r: 8, done: true, rpe: 5 }] }] }] };
  saveST();
  var st = getExStats('Приседания со штангой');
  if (st.lastRPE !== 5) throw new Error('lastRPE not captured, got ' + st.lastRPE);
  if (rpeSuggestionText(5).indexOf('+2,5') === -1) throw new Error('low-RPE suggestion text wrong: ' + rpeSuggestionText(5));
  if (rpeSuggestionText(9).indexOf('не повышай') === -1) throw new Error('high-RPE suggestion text wrong: ' + rpeSuggestionText(9));
  if (rpeSuggestionText(7) !== '') throw new Error('mid-RPE should have no suggestion, got: ' + rpeSuggestionText(7));
  if (rpeSuggestionText(0) !== '') throw new Error('missing RPE should have no suggestion');

  startWorkout();
  addExToWorkout('Приседания со штангой');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  renderWorkout();
  var htmlOut = domStore['pg-workout'].innerHTML;
  if (htmlOut.indexOf('можно +2,5') === -1) throw new Error('RPE hint not rendered in active workout view');
  cancelWorkout();
  delete ST.w[ds];
});

function flushMicrotasks() { return new Promise(function(r){ setTimeout(r, 0); }); }

await check('bug report form saves locally, includes context, and posts to ntfy', async function () {
  var fetchCalls = [];
  var realFetch = global.fetch;
  global.fetch = function(url, opts) { fetchCalls.push({url: url, body: opts && opts.body}); return realFetch(url, opts); };
  PROG_SUBTAB = 'overview'; renderProgress();
  if (domStore['prog-body'].innerHTML.indexOf('Сообщить о баге') === -1) throw new Error('bug report box not rendered');
  document.getElementById('bugreport-input').value = '  Кнопка не нажимается на iPhone  ';
  submitBugReport();
  var saved = ST.bugReports[0];
  if (!ST.bugReports.length || saved.text !== 'Кнопка не нажимается на iPhone') throw new Error('report not saved/trimmed correctly, got: ' + JSON.stringify(saved));
  if (saved.sent !== false || saved.archived !== false) throw new Error('new report should start sent=false, archived=false, got: ' + JSON.stringify(saved));
  var call = fetchCalls.filter(function(c){ return c.url.indexOf('gymlog-roman-bugs') !== -1; }).pop();
  if (!call || call.body.indexOf('Кнопка не нажимается') === -1) throw new Error('ntfy fetch not sent with report text');
  if (call.body.indexOf('tab=') === -1 || call.body.indexOf('screen=') === -1) throw new Error('ntfy body missing device/app context: ' + call.body);
  await flushMicrotasks();
  if (!saved.sent) throw new Error('report.sent should flip to true after a successful fetch resolves');
  renderProgress();
  if (domStore['prog-body'].innerHTML.indexOf('Кнопка не нажимается') === -1) throw new Error('saved report not shown in local list');
  global.fetch = realFetch;
});

await check('bug report submit ignores empty/whitespace-only text', function () {
  var before = (ST.bugReports || []).length;
  PROG_SUBTAB = 'overview'; renderProgress();
  document.getElementById('bugreport-input').value = '   ';
  submitBugReport();
  if (ST.bugReports.length !== before) throw new Error('empty report should not be saved');
});

await check('archiveBugReport hides a report from the default list', function () {
  ST.bugReports = [{ ts: 111, text: 'старый баг', sent: true, archived: false }];
  saveST();
  PROG_SUBTAB = 'overview'; renderProgress();
  if (domStore['prog-body'].innerHTML.indexOf('старый баг') === -1) throw new Error('unarchived report should be visible');
  archiveBugReport(111);
  if (!ST.bugReports[0].archived) throw new Error('report not marked archived');
  if (domStore['prog-body'].innerHTML.indexOf('старый баг') !== -1) throw new Error('archived report should be hidden from the list');
});

await check('retryUnsentBugReports resends only unsent reports, silently', async function () {
  var fetchCalls = [];
  var realFetch = global.fetch;
  global.fetch = function(url, opts) { fetchCalls.push(url); return realFetch(url, opts); };
  ST.bugReports = [
    { ts: 1, text: 'уже отправлен', sent: true, archived: false },
    { ts: 2, text: 'не отправлен', sent: false, archived: false }
  ];
  saveST();
  retryUnsentBugReports();
  await flushMicrotasks();
  if (fetchCalls.length !== 1) throw new Error('expected exactly 1 retry fetch (only the unsent report), got ' + fetchCalls.length);
  if (!ST.bugReports[1].sent) throw new Error('previously unsent report should now be marked sent');
  global.fetch = realFetch;
});

await check('standalone 1RM calculator renders in strength tab and computes live', function () {
  PROG_SUBTAB = 'strength'; renderProgress();
  if (domStore['prog-body'].innerHTML.indexOf('Калькулятор 1ПМ') === -1) throw new Error('1RM calculator box not rendered');
  document.getElementById('calc1rm-w').value = '100';
  document.getElementById('calc1rm-r').value = '5';
  calc1rmInput();
  var expected = Math.round(e1RM(100, 5));
  if (domStore['calc1rm-result'].innerHTML.indexOf(String(expected)) === -1) throw new Error('1RM result not shown, expected ' + expected + ' in: ' + domStore['calc1rm-result'].innerHTML);
  if (domStore['calc1rm-result'].innerHTML.indexOf('90%') === -1) throw new Error('percentage breakdown missing');
  document.getElementById('calc1rm-w').value = '';
  calc1rmInput();
  if (domStore['calc1rm-result'].innerHTML !== '') throw new Error('result should clear when inputs incomplete');
});

await check('parseDecimal accepts comma as a decimal separator (Russian keyboard input)', function () {
  if (parseDecimal('82,5') !== 82.5) throw new Error('comma decimal not parsed, got ' + parseDecimal('82,5'));
  if (parseDecimal('82.5') !== 82.5) throw new Error('period decimal broke, got ' + parseDecimal('82.5'));
  if (parseDecimal('100') !== 100) throw new Error('plain integer broke, got ' + parseDecimal('100'));
  if (!isNaN(parseDecimal(''))) throw new Error('empty string should parse to NaN');

  // Regression: this field used to be type="number", which silently strips a typed
  // ',' (invalid per spec) instead of treating it as a decimal point, so "82,5"
  // became "825" and 1RM came out ~10x too high. Guard both the parse and the DOM.
  PROG_SUBTAB = 'strength'; renderProgress();
  var progHtml = domStore['prog-body'].innerHTML;
  if (progHtml.indexOf('type="number" id="calc1rm-w"') !== -1) throw new Error('calc1rm-w must not be type="number" — it silently mangles comma-decimal input');
  document.getElementById('calc1rm-w').value = '82,5';
  document.getElementById('calc1rm-r').value = '5';
  calc1rmInput();
  var expected = Math.round(e1RM(82.5, 5));
  if (domStore['calc1rm-result'].innerHTML.indexOf(String(expected)) === -1) throw new Error('comma-decimal weight not handled, expected ~' + expected + ' in: ' + domStore['calc1rm-result'].innerHTML);
  if (domStore['calc1rm-result'].innerHTML.indexOf('963') !== -1) throw new Error('regression: "82,5" was mangled into 825');
});

await check('substituteEx pre-filters the DB modal to the same muscle group and swaps in place', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  addExToWorkout('Жим ногами 45°');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  wkt.exercises[0].sets = [{w:100,r:5,done:true},{w:100,r:5,done:false},{w:90,r:8,done:false}];
  wkt.exercises[0].note = 'колено побаливает';

  substituteEx(0);
  if (SUBSTITUTE_EI !== 0) throw new Error('SUBSTITUTE_EI not set');
  if (DB_FILTER !== exGroup('Приседания со штангой')) throw new Error('DB modal not pre-filtered to same muscle group, got ' + DB_FILTER);
  if (domStore['db-modal-title'].textContent.indexOf('Замена') === -1) throw new Error('modal title not updated for substitution: ' + domStore['db-modal-title'].textContent);
  if (!domStore['db-modal'].classList.contains('vis')) throw new Error('modal should be open after substituteEx');

  applySubstitute('Жим ногами 45°');
  var newEx = wkt.exercises[0];
  if (newEx.name !== 'Жим ногами 45°') throw new Error('exercise not swapped');
  if (newEx.sets.length !== 3) throw new Error('set count not preserved, got ' + newEx.sets.length);
  if (newEx.note !== 'колено побаливает') throw new Error('note not preserved after substitution');
  if (SUBSTITUTE_EI !== null) throw new Error('SUBSTITUTE_EI not cleared after applying');
  if (domStore['db-modal'].classList.contains('vis')) throw new Error('modal should auto-close after picking a substitute (one-shot action, unlike multi-add)');
  cancelWorkout();
});

await check('substituteEx preserves linkedToPrev/groupName on the substituted exercise', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  addExToWorkout('Жим ногами 45°');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  toggleSuperset(1);
  setGroupName(0, 'Ноги');
  substituteEx(1);
  applySubstitute('Румынская тяга');
  if (!wkt.exercises[1].linkedToPrev) throw new Error('linkedToPrev should survive substitution');
  cancelWorkout();
});

await check('applySubstitute is a safe no-op for same-exercise pick or a stale/missing SUBSTITUTE_EI', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  var before = wkt.exercises[0];
  substituteEx(0);
  applySubstitute('Приседания со штангой');
  if (wkt.exercises[0] !== before) throw new Error('picking the same exercise should not replace the object');
  SUBSTITUTE_EI = null;
  applySubstitute('Жим ногами 45°');
  if (wkt.exercises[0].name !== 'Приседания со штангой') throw new Error('applySubstitute should no-op when SUBSTITUTE_EI is null');
  cancelWorkout();
});

await check('removeEx deletes immediately and undo restores it at the same position', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  addExToWorkout('Жим ногами 45°');
  addExToWorkout('Румынская тяга');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  wkt.exercises[1].sets[0].done = true; // has recorded data — old code would have required a confirm dialog here
  var toastCaptured = null;
  var origToast = uiUndoToast;
  uiUndoToast = function(msg, undoFn) { toastCaptured = { msg: msg, undoFn: undoFn }; };
  removeEx(1);
  if (wkt.exercises.length !== 2) throw new Error('exercise not removed immediately');
  if (wkt.exercises[0].name !== 'Приседания со штангой' || wkt.exercises[1].name !== 'Румынская тяга') throw new Error('wrong exercise removed');
  if (!toastCaptured) throw new Error('undo toast not shown');
  toastCaptured.undoFn();
  if (wkt.exercises.length !== 3 || wkt.exercises[1].name !== 'Жим ногами 45°') throw new Error('undo did not restore exercise at original position');
  uiUndoToast = origToast;
  cancelWorkout();
});

await check('deleteWorkout deletes immediately and undo restores it', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  var wid = ACTIVE_WKT.wid, ds = ACTIVE_WKT.date;
  cancelWorkout(); // leaves nothing; instead exercise a real logged (non-active) workout
  logWorkout(ds);
  var day = ST.w[ds];
  var loggedWid = day.workouts[day.workouts.length-1].id;
  var toastCaptured = null;
  var origToast = uiUndoToast;
  uiUndoToast = function(msg, undoFn) { toastCaptured = { msg: msg, undoFn: undoFn }; };
  deleteWorkout(ds, loggedWid);
  if (ST.w[ds] && (ST.w[ds].workouts||[]).some(function(w){ return w.id === loggedWid; })) throw new Error('workout not removed immediately');
  if (!toastCaptured) throw new Error('undo toast not shown for deleteWorkout');
  toastCaptured.undoFn();
  if (!ST.w[ds] || !ST.w[ds].workouts.some(function(w){ return w.id === loggedWid; })) throw new Error('undo did not restore workout');
  uiUndoToast = origToast;
  delete ST.w[ds];
});

await check('timer mute toggle suppresses beep/vibrate and persists', function () {
  var vibeCalls = 0;
  global.navigator.vibrate = function(){ vibeCalls++; };
  if (timerMuted()) toggleTimerMute(); // ensure starts unmuted
  tmrVibe(10);
  if (vibeCalls !== 1) throw new Error('vibrate should fire when unmuted');
  toggleTimerMute();
  if (!ST.cfg.timerMuted) throw new Error('timerMuted not persisted');
  tmrVibe(10);
  if (vibeCalls !== 1) throw new Error('vibrate should be suppressed when muted');
  var btnHtml = muteToggleBtnHtml();
  if (btnHtml.indexOf('🔇') === -1) throw new Error('mute button should show muted icon');
  toggleTimerMute(); // restore unmuted for later checks
});

await check('configurable rest timer for strength sets', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  var before = defaultRestSet();
  setRestSetCfg(5);
  if (defaultRestSet() !== before + 5) throw new Error('rest not adjusted');
  if (ST.cfg.restSet !== before + 5) throw new Error('restSet not persisted');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  wkt.exercises[0].sets[0].w = 60; wkt.exercises[0].sets[0].r = 10;
  recordSet(0, 0);
  if (REST_TOTAL !== before + 5) throw new Error('recordSet did not use configured rest, got ' + REST_TOTAL);
  restStop();
  setRestSetCfg(-1000);
  if (ST.cfg.restSet !== 0) throw new Error('rest should clamp at 0, got ' + ST.cfg.restSet);
  cancelWorkout();
});

await check('finishWorkout triggers autoExportIfDue without throwing', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  ST.cfg.lastAutoExport = 0;
  var blobCaptured = null;
  global.Blob = function (parts, opts) { blobCaptured = parts[0]; this.parts = parts; };
  finishWorkout();
  if (!ST.cfg.lastAutoExport) throw new Error('lastAutoExport not set after finishWorkout');
});

await check('fully-done exercise auto-collapses; toggling re-expands it', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  addExToWorkout('Жим лёжа');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  wkt.exercises[0].sets.forEach(function(s){ s.w = 60; s.r = 10; });
  wkt.exercises[0].sets.forEach(function(s, si){ toggleSetDone(0, si); });
  if (OPEN_EX[0]) throw new Error('OPEN_EX[0] should be falsy after auto-collapse on completion');
  var html = domStore['pg-workout'].innerHTML;
  if (html.indexOf('ex-chev open') !== -1) throw new Error('a freshly completed exercise should render collapsed');
  toggleEx(0);
  if (!OPEN_EX[0]) throw new Error('toggleEx should expand a collapsed done exercise');
  var html2 = domStore['pg-workout'].innerHTML;
  if (html2.indexOf('ex-chev open') === -1) throw new Error('expanded done exercise should render an open chevron');
  cancelWorkout();
});

await check('addWarmupSets prepends a 50/70/85% ramp, guards duplicates, missing weight, and the empty-bar floor', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой'); // isBarbell -> base 20kg
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  var ei = wkt.exercises.length - 1;
  wkt.exercises[ei].sets.forEach(function(s){ s.w = 100; });
  addWarmupSets(ei);
  var sets = wkt.exercises[ei].sets;
  if (sets.length !== 6) throw new Error('expected 3 warmup + 3 working sets, got ' + sets.length);
  if (!sets[0].warmup || !sets[1].warmup || !sets[2].warmup) throw new Error('first 3 sets should be warmup');
  if (sets[3].warmup) throw new Error('4th set should still be a working set');
  if (sets[0].w !== 50 || sets[1].w !== 70 || sets[2].w !== 85) throw new Error('50/70/85% of 100kg wrong: ' + [sets[0].w,sets[1].w,sets[2].w].join(','));
  if (sets[0].r !== 8 || sets[1].r !== 5 || sets[2].r !== 3) throw new Error('warmup rep scheme wrong: ' + [sets[0].r,sets[1].r,sets[2].r].join(','));

  var lenBefore = sets.length;
  addWarmupSets(ei);
  if (wkt.exercises[ei].sets.length !== lenBefore) throw new Error('addWarmupSets should not duplicate an existing ramp');

  addExToWorkout('Приседания со штангой');
  var ei2 = wkt.exercises.length - 1;
  wkt.exercises[ei2].sets.forEach(function(s){ s.w = 22; });
  addWarmupSets(ei2);
  wkt.exercises[ei2].sets.slice(0,3).forEach(function(s){
    if (s.w < 20) throw new Error('warmup weight should never drop below the empty-bar weight (20kg), got ' + s.w);
  });

  addExToWorkout('Моя придумка'); // no history anywhere -> target weight 0
  var ei3 = wkt.exercises.length - 1;
  var lenBefore3 = wkt.exercises[ei3].sets.length;
  addWarmupSets(ei3);
  if (wkt.exercises[ei3].sets.length !== lenBefore3) throw new Error('addWarmupSets should no-op without a reference working weight');
  cancelWorkout();
});

await check('findLastSimilarWorkout / buildSummaryDelta compare against the most recent same-named workout', function () {
  var pastDs = dateAdd(today, -3);
  ST.w[pastDs] = ST.w[pastDs] || { workouts: [] };
  ST.w[pastDs].workouts.push({ id: 999001, name: 'Дельта-тест', loc: 'gym', startTime: Date.now(), endTime: Date.now()+1000,
    exercises: [{ name: 'Приседания со штангой', sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 10, done: true }] }] });
  saveST();

  startWorkout();
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  wkt.name = 'Дельта-тест';
  addExToWorkout('Приседания со штангой');
  var ei = wkt.exercises.length - 1;
  wkt.exercises[ei].sets.forEach(function(s){ s.w = 80; s.r = 10; s.done = true; });
  var sum = buildWorkoutSummary(wkt);
  var delta = buildSummaryDelta(sum, ACTIVE_WKT.date);
  if (!delta) throw new Error('expected a delta against the earlier same-named workout');
  if (delta.prevDs !== pastDs) throw new Error('should match the most recent same-named workout, got ' + delta.prevDs);
  if (delta.volDelta !== (80*10*3 - 60*10*2)) throw new Error('volDelta wrong, got ' + delta.volDelta);
  if (delta.setsDelta !== 1) throw new Error('setsDelta wrong (3 vs 2 sets), got ' + delta.setsDelta);
  var deltaHtml = summaryDeltaHtml(delta);
  if (deltaHtml.indexOf('+') === -1) throw new Error('positive delta should render with a + sign: ' + deltaHtml);

  var sumNoHistory = buildWorkoutSummary(wkt);
  sumNoHistory.name = 'Совершенно новое название';
  if (buildSummaryDelta(sumNoHistory, ACTIVE_WKT.date) !== null) throw new Error('a never-before-seen workout name should have no delta');
  if (summaryDeltaHtml(null) !== '') throw new Error('summaryDeltaHtml(null) should render nothing');

  cancelWorkout();
  delete ST.w[pastDs];
});

await check('computeDeloadFlag flags 4 consecutive rising completed weeks and stays quiet otherwise', function () {
  var curStart = pStartOfWeek(todayStr());
  var risingVol = {};
  for (var w = 4; w >= 1; w--) risingVol[dateAdd(curStart, -7*w)] = 1000 + (4-w)*200; // 1000,1200,1400,1600
  risingVol[curStart] = 1; // current partial week — must be ignored regardless of value
  if (!computeDeloadFlag({dailyVol: risingVol})) throw new Error('expected the flag on 4 consecutive rising completed weeks');

  var flatVol = {};
  for (var w2 = 4; w2 >= 1; w2--) flatVol[dateAdd(curStart, -7*w2)] = 1000;
  if (computeDeloadFlag({dailyVol: flatVol})) throw new Error('flat volume across weeks should not trigger the flag');

  var dipVol = {}, vals = [1000,1200,900,1500];
  for (var w3 = 4; w3 >= 1; w3--) dipVol[dateAdd(curStart, -7*w3)] = vals[4-w3];
  if (computeDeloadFlag({dailyVol: dipVol})) throw new Error('a down week in the middle should not trigger the flag');
});

await check('tmrCountdownBeep escalates pitch on the last 3 seconds and vibrates only on the final one', function () {
  var beepCalls = [], vibeCalls = 0;
  var origBeep = tmrBeep, origVibe = tmrVibe;
  tmrBeep = function(freq){ beepCalls.push(freq); };
  tmrVibe = function(){ vibeCalls++; };
  tmrCountdownBeep(3); tmrCountdownBeep(2); tmrCountdownBeep(1);
  if (beepCalls.length !== 3) throw new Error('expected 3 beeps for seconds 3,2,1, got ' + beepCalls.length);
  if (!(beepCalls[0] < beepCalls[1] && beepCalls[1] < beepCalls[2])) throw new Error('pitch should escalate toward zero, got ' + beepCalls.join(','));
  if (vibeCalls !== 1) throw new Error('should vibrate only on the final second, got ' + vibeCalls);
  tmrCountdownBeep(4); tmrCountdownBeep(0);
  if (beepCalls.length !== 3) throw new Error('should stay quiet outside the last-3-seconds window');
  tmrBeep = origBeep; tmrVibe = origVibe;
});

await check('todayPlanReminderHtml names an unstarted plan only after 18:00, and clears once launched', function () {
  createPlan(null, todayStr());
  var day = ST.w[todayStr()];
  var wid = day.workouts[day.workouts.length - 1].id;
  var wkt = getWkt(todayStr(), wid);
  wkt.name = 'Вечерняя тренировка';
  saveST();
  var html = todayPlanReminderHtml();
  var hourNow = new Date().getHours();
  if (hourNow < 18) {
    if (html !== '') throw new Error('should stay quiet before 18:00, got: ' + html);
  } else {
    if (html.indexOf('Вечерняя тренировка') === -1) throw new Error('should name the unstarted plan after 18:00: ' + html);
  }
  launchPlan(todayStr(), wid);
  if (todayPlanReminderHtml() !== '') throw new Error('a launched plan should no longer show the reminder');
  cancelWorkout();

  delete ST.w[todayStr()];
  if (todayPlanReminderHtml() !== '') throw new Error('no plan today -> should always be empty');
});

await check('inactivity banner clears immediately once today has a completed workout', function () {
  var oldDaysAgo = dateAdd(today, -5);
  ST.w[oldDaysAgo] = ST.w[oldDaysAgo] || { workouts: [] };
  ST.w[oldDaysAgo].workouts.push({ id: 777001, name: 'W', loc: 'gym', startTime: Date.now(), endTime: Date.now()+1000,
    exercises: [{ name: 'Приседания со штангой', sets: [{ w: 60, r: 8, done: true }] }] });
  // Wipe every OTHER day so daysSinceLastWorkout has nothing more recent to find.
  var saved = {};
  Object.keys(ST.w).forEach(function(ds){ if (ds !== oldDaysAgo && ds !== todayStr()) { saved[ds] = ST.w[ds]; delete ST.w[ds]; } });
  saveST();
  if (daysSinceLastWorkout() !== 5) throw new Error('expected 5 days since last workout, got ' + daysSinceLastWorkout());
  if (inactivityBannerHtml() === '') throw new Error('banner should show when nothing logged in 5 days');

  startWorkout();
  addExToWorkout('Приседания со штангой');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  wkt.exercises[0].sets[0].done = true;
  saveST();
  if (daysSinceLastWorkout() !== 0) throw new Error('should resolve to 0 once today has a completed set, got ' + daysSinceLastWorkout());
  if (inactivityBannerHtml() !== '') throw new Error('banner should clear immediately after training today, not stay up for the rest of the day');
  cancelWorkout();

  delete ST.w[oldDaysAgo];
  Object.keys(saved).forEach(function(ds){ ST.w[ds] = saved[ds]; });
  saveST();
});

await check('per-exercise rest override takes precedence over the workout-wide rest timer', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  var globalRest = defaultRestSet();
  if (restSecFor(wkt.exercises[0]) !== globalRest) throw new Error('with no override, restSecFor should equal the global default');
  toggleExRestOverride(0);
  if (wkt.exercises[0].restOverride !== globalRest) throw new Error('enabling override should seed it from the current global value');
  setExRestOverride(0, 20);
  if (wkt.exercises[0].restOverride !== globalRest + 20) throw new Error('setExRestOverride did not adjust the override');
  wkt.exercises[0].sets[0].w = 50; wkt.exercises[0].sets[0].r = 5;
  recordSet(0, 0);
  if (REST_TOTAL !== globalRest + 20) throw new Error('recordSet should start the rest timer using the per-exercise override, got ' + REST_TOTAL);
  restStop();
  toggleExRestOverride(0);
  if (wkt.exercises[0].restOverride != null) throw new Error('toggling again should clear the override');
  if (restSecFor(wkt.exercises[0]) !== defaultRestSet()) throw new Error('with override cleared, restSecFor should fall back to the global default');
  cancelWorkout();
});

await check('failed-set flag excludes the set from PR/volume/history like warmup, but keeps it visible as done', function () {
  var ds = dateAdd(today, -2);
  ST.w[ds] = { workouts: [{ id: 777002, name: 'W', loc: 'gym', startTime: Date.now(), endTime: Date.now()+1000,
    exercises: [{ name: 'Жим штанги лёжа', sets: [
      { w: 100, r: 5, done: true, rpe: 10, failed: true },
      { w: 80, r: 8, done: true, rpe: 7 }
    ] }] }] };
  saveST();
  var st = getExStats('Жим штанги лёжа');
  if (!st) throw new Error('getExStats should still find the non-failed set');
  if (st.pr !== 80) throw new Error('failed 100kg set must not count toward PR, expected pr=80, got ' + st.pr);
  var pd = computeProgressData();
  if (pd.byExName['Жим штанги лёжа'].some(function(e){ return e.w === 100; })) throw new Error('failed set should not appear in progress history, like a warmup set');
  delete ST.w[ds]; saveST();

  // shConfirm writes/clears the failed flag from the RPE sheet
  startWorkout();
  addExToWorkout('Жим штанги лёжа');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  openSheet(0, 0, 'rpe');
  if (domStore['sh-failed-wrap'].style.display !== 'block') throw new Error('failed toggle should be visible on the RPE sheet');
  shToggleFailed();
  SH_VAL = 9;
  shConfirm();
  if (!wkt.exercises[0].sets[0].failed) throw new Error('shConfirm should persist the failed flag when toggled on');
  openSheet(0, 0, 'rpe');
  if (!SH_FAILED) throw new Error('reopening the sheet should reflect the saved failed state');
  shToggleFailed();
  SH_VAL = 9;
  shConfirm();
  if (wkt.exercises[0].sets[0].failed) throw new Error('toggling off and confirming should clear the failed flag');
  cancelWorkout();
});

await check('configurable weight rounding step feeds into the warm-up ramp', function () {
  if (weightRoundStep() !== 2.5) throw new Error('default rounding step should be 2.5, got ' + weightRoundStep());
  setWeightRoundStep(5);
  if (ST.cfg.roundStep !== 5) throw new Error('setWeightRoundStep did not persist');
  var ramp = warmupRamp(101, 'Приседания со штангой');
  ramp.forEach(function(step){ if (step.w % 5 !== 0) throw new Error('warmup weight not rounded to the 5kg step: ' + step.w); });
  setWeightRoundStep(1);
  var ramp2 = warmupRamp(101, 'Приседания со штангой');
  if (ramp2[2].w !== Math.round(101*0.85)) throw new Error('1kg step should round to the nearest whole kg, got ' + ramp2[2].w);
  setWeightRoundStep(2.5);
});

await check('relative-strength ratio shows on the PR row once bodyweight is known', function () {
  ST.bw[todayStr()] = 80;
  saveST();
  if (currentBodyweight() !== 80) throw new Error('currentBodyweight should read the latest logged entry, got ' + currentBodyweight());
  PROG_SUBTAB = 'strength';
  renderProgress();
  var html = domStore['prog-body'].innerHTML;
  if (html.indexOf('от веса тела') === -1) throw new Error('expected a bodyweight-ratio line on at least one PR row');
});

await check('streak freeze forgives exactly one skipped day but not two in a row', function () {
  var days = {};
  var t = todayStr();
  days[t] = true;
  days[dateAdd(t, -1)] = true;
  // gap at -2
  days[dateAdd(t, -3)] = true;
  days[dateAdd(t, -4)] = true;
  if (computeStreak(days) !== 4) throw new Error('one skipped day should still count the 4 trained days as one streak, got ' + computeStreak(days));

  var days2 = {};
  days2[t] = true;
  days2[dateAdd(t, -1)] = true;
  // gap at -2 AND -3 (two in a row) should break it
  days2[dateAdd(t, -4)] = true;
  if (computeStreak(days2) !== 2) throw new Error('two consecutive skipped days should break the streak, got ' + computeStreak(days2));
});

await check('shareBackupFile prefers the system share sheet when available, else falls back to a plain download', function () {
  var shared = null;
  global.navigator.canShare = function(){ return true; };
  global.navigator.share = function(opts){ shared = opts; return Promise.resolve(); };
  shareBackupFile();
  if (!shared || !shared.files || !shared.files.length) throw new Error('should call navigator.share with a file when canShare is true');
  delete global.navigator.canShare;
  delete global.navigator.share;

  var clicked = false;
  var origCreate = document.createElement.bind(document);
  document.createElement = function(tag){ var el = origCreate(tag); if (tag === 'a') { var origClick = el.click.bind(el); el.click = function(){ clicked = true; origClick(); }; } return el; };
  shareBackupFile();
  if (!clicked) throw new Error('without navigator.share support, should fall back to the anchor-download path');
  document.createElement = origCreate;
});

await check('togglePinTpl sorts pinned templates to the top, stable within each group', function () {
  ST.templates = [{name:'A', exs:[]}, {name:'B', exs:[]}, {name:'C', exs:[]}];
  saveST();
  togglePinTpl(2); // pin C
  renderTemplates();
  var html = domStore['tpl-body'].innerHTML;
  var ia = html.indexOf('>A<'), ib = html.indexOf('>B<'), ic = html.indexOf('>C<');
  if (!(ic < ia && ic < ib)) throw new Error('pinned template C should render before unpinned A and B');
  if (!(ia < ib)) throw new Error('unpinned templates should keep their original relative order');
  togglePinTpl(2);
  if (ST.templates[2].pinned) throw new Error('toggling again should unpin');
  ST.templates = [];
  saveST();
});

await check('renameCustomEx migrates the name across history, templates, goals, and recents; guards collisions', function () {
  var customName = 'Моё тестовое упражнение';
  ST.customEx.push({name: customName, group: 'Грудь'});
  var ds = dateAdd(today, -6);
  ST.w[ds] = { workouts: [{ id: 777003, name: 'W', loc: 'gym', startTime: Date.now(), endTime: Date.now()+1000,
    exercises: [{ name: customName, sets: [{ w: 40, r: 10, done: true }] }] }] };
  ST.templates = [{ name: 'T', exs: [{name: customName, sets:3, reps:10, weight:40}, 'Приседания со штангой'] }];
  if (!ST.goals) ST.goals = {}; if (!ST.goals.byExName) ST.goals.byExName = {};
  ST.goals.byExName[customName] = 60;
  ST.recentEx = [customName, 'Приседания со штангой'];
  saveST();

  var renamed = 'Переименованное упражнение';
  if (!renameCustomEx(customName, renamed)) throw new Error('rename should succeed for a valid new name');
  if (!ST.customEx.some(function(e){ return e.name===renamed; })) throw new Error('customEx entry not renamed');
  if (ST.w[ds].workouts[0].exercises[0].name !== renamed) throw new Error('workout history not migrated');
  if (ST.templates[0].exs[0].name !== renamed) throw new Error('template entry (object form) not migrated');
  if (ST.goals.byExName[renamed] !== 60 || ST.goals.byExName[customName] != null) throw new Error('goal key not migrated');
  if (ST.recentEx.indexOf(renamed) === -1) throw new Error('recentEx not migrated');

  if (renameCustomEx(renamed, 'Приседания со штангой')) throw new Error('rename should refuse a name that collides with an existing exercise');
  if (renameCustomEx(renamed, '   ')) throw new Error('rename should refuse a blank name');
  if (renameCustomEx(renamed, renamed)) throw new Error('rename to the same name should be a no-op returning false');

  delete ST.w[ds];
  ST.customEx = ST.customEx.filter(function(e){ return e.name !== renamed; });
  ST.templates = [];
  delete ST.goals.byExName[renamed];
  ST.recentEx = [];
  saveST();
});

await check('monthComparisonHtml compares this calendar month to the previous one', function () {
  var pdFake = { dailyVol: {}, workoutDays: {} };
  var curKey = todayStr().slice(0,7);
  pdFake.dailyVol[todayStr()] = 500;
  pdFake.workoutDays[todayStr()] = true;
  var html = monthComparisonHtml(pdFake);
  if (html.indexOf('Месяц к месяцу') === -1) throw new Error('expected the month-comparison box to render when this month has data');
  if (monthComparisonHtml({dailyVol:{}, workoutDays:{}}) !== '') throw new Error('should render nothing with zero data in both months');
});

await check('two consecutive easy (RPE<=7) sessions upgrade the progression hint; a single easy set does not', function () {
  var exName = 'Тяга штанги в наклоне';
  var d1 = dateAdd(today, -10), d2 = dateAdd(today, -8);
  ST.w[d1] = { workouts: [{ id: 777004, name: 'W', loc:'gym', startTime:Date.now(), endTime:Date.now()+1000,
    exercises: [{ name: exName, sets: [{w:50,r:8,done:true,rpe:6},{w:50,r:8,done:true,rpe:7}] }] }] };
  ST.w[d2] = { workouts: [{ id: 777005, name: 'W', loc:'gym', startTime:Date.now(), endTime:Date.now()+1000,
    exercises: [{ name: exName, sets: [{w:50,r:8,done:true,rpe:5},{w:50,r:8,done:true,rpe:6}] }] }] };
  saveST();
  if (!lastTwoSessionsEasyRPE(exName)) throw new Error('two consecutive all-easy sessions should trigger the strong signal');
  var hint = rpeSuggestionText(6, exName);
  if (hint.indexOf('Два раза подряд') === -1) throw new Error('strong signal should override the single-set hint text: ' + hint);

  // A single easy set does NOT trigger the strong signal without name context
  if (rpeSuggestionText(6, null).indexOf('Два раза подряд') !== -1) throw new Error('without an exercise name, should fall back to the single-set hint');

  ST.w[d2].workouts[0].exercises[0].sets[1].rpe = 9; // one hard set breaks the "all easy" requirement
  saveST();
  if (lastTwoSessionsEasyRPE(exName)) throw new Error('a single RPE9 set in the most recent session should break the strong signal');

  delete ST.w[d1]; delete ST.w[d2]; saveST();
});

await check('removeAllCalWorkouts clears every workout for the day in one action (after confirming)', function () {
  var ds = dateAdd(today, -7);
  ST.w[ds] = { workouts: [
    { id: 777006, name: 'A', loc:'gym', startTime:Date.now(), endTime:Date.now()+1000, exercises:[] },
    { id: 777007, name: 'B', loc:'gym', startTime:Date.now(), endTime:Date.now()+1000, exercises:[{name:'Приседания со штангой', sets:[{w:50,r:5,done:true}]}] }
  ] };
  saveST();
  removeAllCalWorkouts(ds);
  // A completed set means this goes through the real uiConfirm dialog (not deleted yet) —
  // drive it the same way a real tap on "uc-yes" would, via the mocked onclick assignment.
  if (!ST.w[ds]) throw new Error('should not delete before the confirm dialog is accepted');
  if (!domStore['uc-yes'].onclick) throw new Error('uiConfirm should have wired up the confirm button');
  domStore['uc-yes'].onclick();
  if (ST.w[ds]) throw new Error('day entry should be fully cleared once the bulk delete is confirmed');
});

await check('searchAllNotes finds workout- and exercise-level notes and jumpToCalDate navigates to that date', function () {
  var ds = dateAdd(today, -9);
  ST.w[ds] = { workouts: [{ id: 777008, name: 'Больное плечо', loc:'gym', startTime:Date.now(), endTime:Date.now()+1000, note:'плечо побаливало',
    exercises: [{ name:'Жим штанги лёжа', note:'снизил вес из-за плеча', sets:[{w:40,r:8,done:true}] }] }] };
  saveST();
  var results = searchAllNotes('плеч'); // common stem — the two notes use different grammatical cases
  if (results.length < 2) throw new Error('expected both the workout note and the exercise note to match, got ' + results.length);
  if (!results.some(function(r){ return r.ds === ds && r.text.indexOf('побаливало') !== -1; })) throw new Error('workout-level note not found');
  if (!results.some(function(r){ return r.ds === ds && r.text.indexOf('снизил вес') !== -1; })) throw new Error('exercise-level note not found');
  if (searchAllNotes('совершенно небывалый текст').length !== 0) throw new Error('unrelated query should return no results');

  CAL_YEAR = 1999; CAL_MONTH = 0; SEL_DATE = null;
  jumpToCalDate(ds);
  var p = ds.split('-');
  if (CAL_YEAR !== +p[0] || CAL_MONTH !== +p[1]-1) throw new Error('jumpToCalDate did not move the calendar to the target month');
  if (SEL_DATE !== ds) throw new Error('jumpToCalDate did not select the target date');

  delete ST.w[ds]; saveST();
});

await check('exportCSV includes a header row and one row per completed set, BOM-prefixed for Excel', function () {
  var ds = dateAdd(today, -11);
  ST.w[ds] = { workouts: [{ id: 777009, name: 'CSV Test', loc:'gym', startTime:Date.now(), endTime:Date.now()+1000,
    exercises: [{ name:'Приседания со штангой', sets: [{w:70,r:10,done:true,rpe:8}, {w:0,r:0,done:false}] }] }] };
  saveST();
  var captured = null;
  var origBlob = global.Blob;
  global.Blob = function(parts, opts){ captured = {parts:parts, opts:opts}; this.parts = parts; };
  exportCSV();
  global.Blob = origBlob;
  if (!captured) throw new Error('exportCSV should construct a Blob');
  var text = captured.parts[0];
  if (text.charCodeAt(0) !== 0xFEFF) throw new Error('CSV should start with a UTF-8 BOM for Excel compatibility');
  if (text.indexOf('Date,Workout,Exercise') === -1) throw new Error('missing expected header row');
  if (text.indexOf('Приседания со штангой') === -1) throw new Error('missing the logged exercise row');
  if (text.split('\n').length < 2) throw new Error('expected at least a header row and one data row, only whitespace/incomplete');
  delete ST.w[ds]; saveST();
});

await check('hardDayHint only fires when every rated set today was RPE>=9, and reuses calcRecovery', function () {
  var wktEasy = { exercises: [{ name:'Приседания со штангой', sets: [{w:60,r:8,done:true,rpe:7}] }] };
  if (hardDayHint(wktEasy) !== '') throw new Error('should stay quiet when RPE is below 9');
  var wktMixed = { exercises: [{ name:'Приседания со штангой', sets: [{w:60,r:8,done:true,rpe:9},{w:60,r:5,done:true,rpe:6}] }] };
  if (hardDayHint(wktMixed) !== '') throw new Error('should stay quiet unless ALL rated sets are RPE>=9');
  var wktHard = { exercises: [{ name:'Приседания со штангой', sets: [{w:60,r:8,done:true,rpe:9},{w:60,r:5,done:true,rpe:10}] }] };
  var hint = hardDayHint(wktHard);
  if (hint.indexOf('Тяжёлая тренировка') === -1) throw new Error('expected the hard-day hint text when every rated set is RPE>=9');
  if (hint.indexOf('Ноги') === -1) throw new Error('expected the affected muscle group (Ноги) to be named, via calcRecovery');
});

await check('text note on a body-measurement entry saves, prefills, and shows in history', function () {
  PROG_SUBTAB = 'body';
  renderProgress();
  domStore['meas-waist'].value = '81';
  domStore['meas-note'].value = 'после отпуска';
  logMeasurements();
  if (ST.measurements[todayStr()].note !== 'после отпуска') throw new Error('measurement note not saved');
  renderProgress();
  if (domStore['meas-note'].value !== 'после отпуска') throw new Error('note field should prefill from the latest entry');
  var html = domStore['prog-body'].innerHTML;
  if (html.indexOf('после отпуска') === -1) throw new Error('note should appear in the measurement history list');
});

await check('gearChips/toggleExGear attach equipment to any swim exercise, independent of style', function () {
  startWorkout();
  addExToWorkout('Вольный стиль'); // plain swim exercise, not a style-drill (no EX_VARIANTS entry)
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  var html = gearChips(wkt.exercises[0], 0);
  if (!html || html.indexOf('Ласты') === -1) throw new Error('gear chips should render for any swim exercise, not just style-drills');
  if (styleChips(wkt.exercises[0], 0) !== '') throw new Error('sanity check: this exercise should have no style chips');

  toggleExGear(0, 'fins');
  toggleExGear(0, 'paddles_big');
  if (wkt.exercises[0].gear.length !== 2 || wkt.exercises[0].gear.indexOf('fins') === -1) throw new Error('toggling gear on should add it');
  toggleExGear(0, 'fins');
  if (wkt.exercises[0].gear.indexOf('fins') !== -1) throw new Error('toggling gear off should remove it');
  if (wkt.exercises[0].gear.indexOf('paddles_big') === -1) throw new Error('toggling one gear item off should not remove others');

  addExToWorkout('Приседания со штангой');
  if (gearChips(wkt.exercises[1], 1) !== '') throw new Error('gear chips should not render for a non-swim exercise');
  cancelWorkout();
});

await check('swimDistSummary groups identical distances into "×N", lists mixed distances, ignores unfinished sets', function () {
  var uniform = [{done:true,dist:400},{done:true,dist:400},{done:true,dist:400}];
  if (swimDistSummary(uniform) !== '400м × 3') throw new Error('got: ' + swimDistSummary(uniform));
  var mixed = [{done:true,dist:400},{done:true,dist:400},{done:true,dist:200}];
  if (swimDistSummary(mixed) !== '400м × 2 + 200м') throw new Error('got: ' + swimDistSummary(mixed));
  var withUndone = [{done:true,dist:400},{done:false,dist:400},{done:true,dist:0}];
  if (swimDistSummary(withUndone) !== '400м') throw new Error('should skip not-done sets and zero-distance sets, got: ' + swimDistSummary(withUndone));
  if (swimDistSummary([]) !== '') throw new Error('empty sets should give an empty string');
});

await check('buildWorkoutSummary formats swim distance as grouped groups (not a flattened total) and lists gear/note as sub-lines', function () {
  startWorkout();
  addExToWorkout('Вольный стиль');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  wkt.exercises[0].sets = [{dist:400,secs:0,done:true},{dist:400,secs:0,done:true},{dist:400,secs:0,done:true}];
  wkt.exercises[0].gear = ['fins','snorkel'];
  wkt.exercises[0].note = 'в открытой воде';
  var sum = buildWorkoutSummary(wkt);
  var row = sum.exercises.filter(function(e){ return e.name.indexOf('Вольный стиль')!==-1; })[0];
  if (!row) throw new Error('exercise missing from summary');
  if (row.text.indexOf('1200') !== -1) throw new Error('regression: distance was flattened into a single total instead of 400м × 3, got: ' + row.text);
  if (row.text !== '400м × 3') throw new Error('expected grouped distance format with nothing else appended, got: ' + row.text);
  if (!row.sub || row.sub.length !== 2) throw new Error('expected two sub-lines (gear, note), got: ' + JSON.stringify(row.sub));
  if (row.sub[0].indexOf(gearInfo('fins').label) === -1 || row.sub[0].indexOf(gearInfo('snorkel').label) === -1) throw new Error('expected gear labels (no emoji) as text in the first sub-line, got: ' + row.sub[0]);
  if (row.sub[1] !== 'в открытой воде') throw new Error('expected the exercise note as the second sub-line, got: ' + row.sub[1]);
  cancelWorkout();
});

await check('buildWorkoutSummary falls back to elapsed time (not 0) for an in-progress workout with no endTime yet', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  wkt.startTime = Date.now() - 5*60000; // started 5 minutes ago, not finished
  var sum = buildWorkoutSummary(wkt);
  if (Math.round(sum.durMs/60000) < 4) throw new Error('expected ~5 elapsed minutes on an unfinished workout, got durMs=' + sum.durMs);
  cancelWorkout();
});

await check('shareActiveWorkoutCard builds and shares a card mid-workout without requiring finishWorkout first', function () {
  startWorkout();
  addExToWorkout('Приседания со штангой');
  var wkt = getWkt(ACTIVE_WKT.date, ACTIVE_WKT.wid);
  wkt.exercises[0].sets[0].w = 50; wkt.exercises[0].sets[0].r = 5; wkt.exercises[0].sets[0].done = true;
  shareActiveWorkoutCard(); // should not throw, and must not require wkt.endTime to be set
  if (wkt.endTime) throw new Error('sharing mid-workout should not implicitly finish the workout');
  cancelWorkout();
});

await check('shareWorkoutCardImg sizes the canvas to fit every exercise instead of truncating at 6 rows', function () {
  var canvases = [];
  var origCreate = document.createElement.bind(document);
  document.createElement = function(tag){ var el = origCreate(tag); if (tag === 'canvas') canvases.push(el); return el; };
  var manyEx = [];
  for (var i = 0; i < 20; i++) manyEx.push({ name: 'Упражнение ' + i, text: '100 кг × 5' });
  shareWorkoutCardImg({ name: 'Большая тренировка', durMs: 3600000, vol: 5000, sets: 60, prs: [], loc: 'gym', exercises: manyEx });
  var shortEx = [{ name: 'Одно упражнение', text: '100 кг × 5' }];
  shareWorkoutCardImg({ name: 'Короткая', durMs: 600000, vol: 100, sets: 1, prs: [], loc: 'gym', exercises: shortEx });
  document.createElement = origCreate;
  if (canvases.length !== 2) throw new Error('expected two canvases to be created, got ' + canvases.length);
  // 20 rows at 44px each is well beyond the old fixed 1080px card — this only passes
  // if the canvas actually grew instead of silently clipping rows off the bottom.
  if (canvases[0].height <= 1080) throw new Error('canvas should grow taller than 1080 to fit 20 exercises without truncation, got ' + canvases[0].height);
  if (canvases[1].height !== 1080) throw new Error('a short workout should keep the original 1080px square card, got ' + canvases[1].height);
});

await check('swim gear round-trips through the share-link payload (shareWorkout -> importSharedWorkout)', function () {
  var ds = dateAdd(today, -12);
  ST.w[ds] = { workouts: [{ id: 777010, name: 'Заплыв', loc:'pool', startTime:Date.now(), endTime:Date.now()+1000,
    exercises: [{ name:'Ноги с доской', style:'Кроль', gear:['board','fins'], sets:[{dist:50,secs:0,done:true}] }] }] };
  saveST();
  var capturedUrl = null;
  var origShareLink = uiShareLink;
  uiShareLink = function(url){ capturedUrl = url; };
  shareWorkout(ds, 777010);
  uiShareLink = origShareLink;
  if (!capturedUrl) throw new Error('expected a share link to be produced');
  var payload = JSON.parse(b64dec(decodeURIComponent(capturedUrl.split('#share=')[1])));
  var pe = payload.e[0];
  if (!pe.g || pe.g.indexOf('board')===-1 || pe.g.indexOf('fins')===-1) throw new Error('gear missing from the share payload: ' + JSON.stringify(pe));

  var importDs = dateAdd(today, 14);
  importSharedWorkout(payload, importDs);
  var imported = ST.w[importDs].workouts[ST.w[importDs].workouts.length-1];
  if (!imported.exercises[0].gear || imported.exercises[0].gear.indexOf('board')===-1) throw new Error('gear not restored on import');

  delete ST.w[ds]; delete ST.w[importDs]; saveST();
});

await check('renderShareCard: story format has a taller floor height than square for the same short workout', function () {
  var sum = { name: 'Т', durMs: 600000, vol: 100, sets: 1, prs: [], loc: 'gym', exercises: [{name:'Ex', text:'50 кг × 5', sub:[]}] };
  var squareCanvas = null, storyCanvas = null;
  renderShareCard(sum, {format:'square', bgPhoto:null}, function(c){ squareCanvas = c; });
  renderShareCard(sum, {format:'story', bgPhoto:null}, function(c){ storyCanvas = c; });
  if (!squareCanvas || !storyCanvas) throw new Error('both formats should call back synchronously with no bgPhoto');
  if (squareCanvas.height !== 1080) throw new Error('square floor should be 1080, got ' + squareCanvas.height);
  if (storyCanvas.height !== 1920) throw new Error('story floor should be 1920, got ' + storyCanvas.height);
});

await check('renderShareCard grows taller to fit gear/note sub-lines and a workout-level note, without truncation', function () {
  // Enough filler exercises to already push past the 1080 floor, so the extra height
  // from sub-lines/note is visible instead of being absorbed by the floor clamp.
  var filler = []; for (var i = 0; i < 15; i++) filler.push({name:'Ex'+i, text:'100 кг × 5', sub:[]});
  var baseline = { name: 'Т', durMs: 600000, vol: 0, sets: 1, prs: [], loc: 'pool', exercises: filler.slice() };
  var withSubs = { name: 'Т', durMs: 600000, vol: 0, sets: 1, prs: [], loc: 'pool', note: 'чувствовал себя отлично',
    exercises: filler.concat([{name:'Ex', text:'400м', sub:['Доска, Ласты', 'заметка к упражнению']}]) };
  var hBase = null, hSubs = null;
  renderShareCard(baseline, {format:'square', bgPhoto:null}, function(c){ hBase = c.height; });
  renderShareCard(withSubs, {format:'square', bgPhoto:null}, function(c){ hSubs = c.height; });
  if (hBase <= 1080) throw new Error('test setup error: baseline should already exceed the 1080 floor, got ' + hBase);
  if (hSubs <= hBase) throw new Error('adding a workout note + one more exercise with two sub-lines should grow the card further, got base=' + hBase + ' subs=' + hSubs);
});

await check('renderShareCard with a photo background draws asynchronously (after the mocked Image loads), not synchronously', function () {
  var sum = { name: 'Т', durMs: 600000, vol: 100, sets: 1, prs: [], loc: 'gym', exercises: [] };
  var fired = false;
  renderShareCard(sum, {format:'square', bgPhoto:'data:image/png;base64,fake'}, function(){ fired = true; });
  if (fired) throw new Error('callback should not fire synchronously while the background image is still "loading"');
  return flushMicrotasks().then(function(){
    if (!fired) throw new Error('callback should fire once the mocked Image finishes loading');
  });
});

await check('openShareCardSheet template string has balanced <div>/</div> tags (regression guard: a dropped closing tag silently nests the Фон section and footer buttons inside #card-gallery instead of as siblings — the domStore mock cannot catch this since it never parses HTML)', function () {
  var m = stripped.match(/function openShareCardSheet\([\s\S]*?\n\}\n(?=function renderCardOptSheetChips)/);
  if (!m) throw new Error('could not locate openShareCardSheet source for static analysis');
  var src = m[0];
  var opens = (src.match(/<div/g) || []).length;
  var closes = (src.match(/<\/div>/g) || []).length;
  if (opens !== closes) throw new Error('unbalanced div tags in the sheet template: ' + opens + ' opening vs ' + closes + ' closing');
});

await check('openShareCardSheet: sum is captured once at open (WYSIWYG previews), gallery shows all 5 templates, format/bg drive it, confirm reuses the captured sum', function () {
  var sumCallCount = 0;
  var canvases = [];
  var origCreate = document.createElement.bind(document);
  function trackInto(arr){ return function(tag){ var el = origCreate(tag); if (tag === 'canvas') arr.push(el); return el; }; }
  document.createElement = trackInto(canvases);

  openShareCardSheet(function(){ sumCallCount++; return { name:'Т', durMs:60000, vol:0, sets:0, prs:[], loc:'gym', exercises:[] }; });
  if (sumCallCount !== 1) throw new Error('getSum should be called exactly once, immediately at open — the sheet is a full-screen modal so nothing can change under it while open');
  if (domStore['card-fmt-chips'].innerHTML.indexOf('Квадрат') === -1) throw new Error('format chips did not render');
  if (domStore['card-bg-chips'].innerHTML.indexOf('Своё фото') === -1) throw new Error('background chips did not render');
  ['Тёмный','Космос','Закат'].forEach(function(label){
    if (domStore['card-bg-chips'].innerHTML.indexOf(label) === -1) throw new Error('all three built-in background presets should render as chips, missing: ' + label);
  });
  ['Классика','Крупно','Лента','Мозаика','Чек-лист'].forEach(function(label){
    if (domStore['card-gallery'].innerHTML.indexOf(label) === -1) throw new Error('gallery should list all five templates so the user can actually see them, missing: ' + label);
  });
  if (canvases.length !== 5) throw new Error('opening the sheet should render a live preview canvas for each of the 5 templates, got ' + canvases.length);
  if (domStore['card-tpl-img-classic'].innerHTML.indexOf('<img') === -1) throw new Error('the classic preview slot should have an <img> filled in after rendering');
  if (domStore['card-tpl-img-mosaic'].innerHTML.indexOf('<img') === -1) throw new Error('the mosaic preview slot should have an <img> filled in after rendering');
  if (domStore['card-tpl-img-receipt'].innerHTML.indexOf('<img') === -1) throw new Error('the receipt preview slot should have an <img> filled in after rendering');

  var canvasesForBg = [];
  document.createElement = trackInto(canvasesForBg);
  setCardBgMode('vivid');
  if (CARD_BG_PRESET !== 'vivid') throw new Error('setCardBgMode should switch the active preset');
  if (canvasesForBg.length !== 5) throw new Error('switching background preset should re-render the full 5-template gallery, got ' + canvasesForBg.length);
  document.createElement = trackInto(canvases);

  selectCardTemplate('bold');
  if (CARD_TEMPLATE !== 'bold') throw new Error('selectCardTemplate did not update state');

  setCardFormat('story');
  if (CARD_FORMAT !== 'story') throw new Error('setCardFormat did not update state');

  var fileInputClicked = false;
  document.getElementById('card-bg-input').click = function(){ fileInputClicked = true; };
  setCardBgMode('photo');
  if (!fileInputClicked) throw new Error('choosing "Своё фото" should trigger the hidden file input');

  canvases.length = 0;
  confirmCreateCard();
  document.createElement = origCreate;
  if (sumCallCount !== 1) throw new Error('confirm should reuse the sum captured at open, not call getSum again');
  if (canvases.length !== 1) throw new Error('confirm should produce exactly one final card canvas');
  if (canvases[0].height !== 1920) throw new Error('the story format chosen earlier should carry through to the generated card');
  if (CARD_SUM !== null) throw new Error('sheet state should be cleared after confirm');
});

await check('mosaic and receipt templates render exercises/sub-lines/PRs/notes without crashing, both background presets draw synchronously', function () {
  var sum = {
    name: 'Тренировка ног', durMs: 4440000, vol: 4820, sets: 18, loc: 'gym', note: 'Тяжело, но справился',
    exercises: [
      {name:'Приседания со штангой', text:'100 кг × 8 (4)', sub:['заметка к упражнению']},
      {name:'Жим ногами', text:'160 кг × 10 (3)', sub:[]}
    ],
    prs: [{name:'Приседания со штангой', w:100, r:8}]
  };
  ['mosaic','receipt'].forEach(function(tpl){
    ['dark','vivid','sunset'].forEach(function(bg){
      var fired = false, h = null;
      renderShareCard(sum, {template:tpl, format:'square', bgPhoto:null, bgPreset:bg}, function(c){ fired = true; h = c.height; });
      if (!fired) throw new Error(tpl+'/'+bg+' should draw synchronously when there is no photo background');
      if (h < 1080) throw new Error(tpl+'/'+bg+' card should be at least the square floor height, got ' + h);
    });
  });
  var opts = {template:'unknown-template', format:'square', bgPhoto:null, bgPreset:'unknown-preset'};
  var fellBack = false;
  renderShareCard(sum, opts, function(){ fellBack = true; });
  if (!fellBack) throw new Error('an unrecognised template/preset key should fall back to classic/dark rather than throwing');
});

await check('shareCalWorkoutCard opens the card sheet for a long-finished workout from its Calendar row', function () {
  var ds = dateAdd(today, -13);
  ST.w[ds] = { workouts: [
    { id: 777011, name: 'Старая тренировка', loc:'gym', startTime:Date.now()-3600000, endTime:Date.now(),
      exercises: [{ name:'Приседания со штангой', sets:[{w:80,r:8,done:true}] }] },
    { id: 777012, name: 'Только план', loc:'gym', planned:true, startTime:null, endTime:null,
      exercises: [{ name:'Приседания со штангой', sets:[{w:0,r:0,done:false}] }] }
  ] };
  saveST();
  SEL_DATE = ds;
  renderCalDetail();
  var html = domStore['cal-detail'].innerHTML;
  if (html.indexOf("shareCalWorkoutCard('"+ds+"',777011)") === -1) throw new Error('finished workout row should have a card button');
  if (html.indexOf("shareCalWorkoutCard('"+ds+"',777012)") !== -1) throw new Error('a plan with no done sets should not offer a card — there is nothing to share yet');

  var canvases = [];
  var origCreate = document.createElement.bind(document);
  document.createElement = function(tag){ var el = origCreate(tag); if (tag === 'canvas') canvases.push(el); return el; };
  shareCalWorkoutCard(ds, 777011);
  document.createElement = origCreate;
  if (!CARD_SUM || CARD_SUM.name !== 'Старая тренировка') throw new Error('sheet should open with a summary built from that specific past workout');
  if (canvases.length !== 5) throw new Error('opening the sheet should render the 5-template gallery preview, got ' + canvases.length);
  closeCardOptionsSheet();
  SEL_DATE = null;
  delete ST.w[ds]; saveST();
});

await check('Wake Lock: acquires on workout start, releases on finish, and stays a safe no-op when the API is unsupported', async function () {
  startWorkout(null);
  if (!curWktRef()) throw new Error('startWorkout should have started an active workout');
  if (WAKE_LOCK !== null) throw new Error('WAKE_LOCK should stay null when navigator.wakeLock is unsupported');
  finishWorkout();

  var released = false;
  global.navigator.wakeLock = { request: function(){
    return Promise.resolve({ release: function(){ released = true; return Promise.resolve(); }, addEventListener: function(){} });
  } };
  startWorkout(null);
  await flushMicrotasks();
  if (!WAKE_LOCK) throw new Error('should acquire a real wake lock once the API is available');
  finishWorkout();
  if (WAKE_LOCK !== null) throw new Error('finishWorkout should clear WAKE_LOCK');
  if (!released) throw new Error('finishWorkout should call release() on the acquired lock');
  delete global.navigator.wakeLock;
});

await check('notifyRestDone fires a service-worker notification only when opted in, backgrounded, and permitted; toggleRestNotify manages permission state', async function () {
  var shown = null;
  var NotifMock = { permission: 'default', requestPermission: function(){ NotifMock.permission = 'granted'; return Promise.resolve('granted'); } };
  global.Notification = NotifMock;
  global.window.Notification = NotifMock;
  global.navigator.serviceWorker = { ready: Promise.resolve({ showNotification: function(title, opts){ shown = {title:title, opts:opts}; } }) };

  if (!ST.cfg) ST.cfg = {};
  ST.cfg.restNotify = false;

  toggleRestNotify();
  await flushMicrotasks();
  if (NotifMock.permission !== 'granted') throw new Error('requestPermission should have been driven to granted');
  if (!ST.cfg.restNotify) throw new Error('toggleRestNotify should turn restNotify on once permission is granted');

  document.visibilityState = 'visible';
  notifyRestDone();
  await flushMicrotasks();
  if (shown) throw new Error('should not notify while the app is visible');

  document.visibilityState = 'hidden';
  notifyRestDone();
  await flushMicrotasks();
  if (!shown) throw new Error('should notify once backgrounded with notifications enabled and permitted');
  if (shown.title !== 'Отдых закончен') throw new Error('unexpected notification title: ' + shown.title);

  ST.cfg.restNotify = false;
  document.visibilityState = 'visible';
  delete global.Notification; delete global.window.Notification; delete global.navigator.serviceWorker;
});

await check('shApplyToRemaining applies the picked value to this set and every later undone set, leaving earlier/done sets untouched', function () {
  startWorkout(null);
  var ref = curWktRef();
  var wkt = getWkt(ref.date, ref.wid);
  wkt.exercises.push({name:'Приседания со штангой', sets:[
    {w:50,r:5,done:true}, {w:60,r:5,done:false}, {w:60,r:5,done:false}, {w:60,r:5,done:false}
  ]});
  saveST();
  openSheet(0, 1, 'w');
  SH_VAL = 80;
  shApplyToRemaining();
  var fresh = getWkt(ref.date, ref.wid).exercises[0].sets;
  if (fresh[0].w !== 50) throw new Error('an already-done earlier set must not be touched');
  if (fresh[1].w !== 80 || fresh[2].w !== 80 || fresh[3].w !== 80) throw new Error('this set and every later undone set should all get the new weight');
  cancelWorkout();
});

await check('computeAllTimePRs finds the best (weight, then reps) set per exercise across all history including today, and hallOfFameHtml lists it', function () {
  var d1 = dateAdd(today, -20), d2 = dateAdd(today, -10);
  ST.w[d1] = { workouts: [{ id: 777020, name:'A', loc:'gym', startTime:Date.now(), endTime:Date.now()+1000,
    exercises: [{ name:'Жим штанги лёжа', sets:[{w:80,r:5,done:true},{w:80,r:8,done:true}] }] }] };
  ST.w[d2] = { workouts: [{ id: 777021, name:'B', loc:'gym', startTime:Date.now(), endTime:Date.now()+1000,
    exercises: [{ name:'Жим штанги лёжа', sets:[{w:80,r:6,done:true},{w:60,r:20,done:true}] }] }] };
  saveST();
  var prs = computeAllTimePRs();
  var row = prs.filter(function(p){ return p.name === 'Жим штанги лёжа'; })[0];
  if (!row) throw new Error('should find an all-time PR row for the exercise');
  if (row.w !== 80) throw new Error('PR weight should be the max weight ever lifted, got ' + row.w);
  if (row.r !== 8) throw new Error('at equal max weight, the tie-break should prefer the higher rep count, got ' + row.r);
  if (row.ds !== d1) throw new Error('should keep the date of the actual best set, got ' + row.ds);
  var html = hallOfFameHtml();
  if (html.indexOf('Жим штанги лёжа') === -1) throw new Error('hallOfFameHtml should render the exercise name');
  delete ST.w[d1]; delete ST.w[d2]; saveST();
});

await check('importDataFile confirms via the custom uiConfirm dialog (never a native confirm()) before replacing ST', async function () {
  global.confirm = function(){ throw new Error('native confirm() must never be called — use uiConfirm'); };
  var backup = { w: {'2020-01-01': {workouts:[{id:1,name:'Imported',loc:'gym',exercises:[]}]}},
    cfg:{}, wr:{}, wrMax:{}, templates:[], customEx:[], recentEx:[], bw:{}, measurements:{}, goals:{}, bugReports:[] };
  var file = { __content: JSON.stringify(backup) };
  var input = { files:[file], value:'x' };
  importDataFile(input);
  await flushMicrotasks();
  if (!domStore['uc-yes'].onclick) throw new Error('should present the custom confirm dialog before replacing data');
  var reloaded = false;
  var origReload = global.location.reload;
  global.location.reload = function(){ reloaded = true; };
  domStore['uc-yes'].onclick();
  if (!reloaded) throw new Error('confirming the import should reload the app');
  if (!ST.w['2020-01-01']) throw new Error('ST should have been replaced with the imported backup');
  loadST();
  delete ST.w['2020-01-01']; saveST();
  global.location.reload = origReload;
  delete global.confirm;
});

await check('checkWhatsNew shows the changelog once per version bump for an existing user, never for a brand-new install', function () {
  function captureAppended(fn) {
    var appended = [];
    var orig = document.body.appendChild;
    document.body.appendChild = function(el){ appended.push(el); };
    fn();
    document.body.appendChild = orig;
    return appended;
  }
  ST.w = {}; ST.templates = []; if (!ST.cfg) ST.cfg = {}; delete ST.cfg.lastSeenVersion;
  saveST();
  var a1 = captureAppended(checkWhatsNew);
  if (a1.some(function(el){ return el.id === 'whatsnew-ov'; })) throw new Error('should not show the changelog on a brand-new install with no data yet');
  if (ST.cfg.lastSeenVersion !== APP_VERSION) throw new Error('should still record the current version so a later real update is detected correctly');

  delete ST.cfg.lastSeenVersion;
  ST.templates = [{name:'X', loc:'gym', exs:[]}];
  saveST();
  var a2 = captureAppended(checkWhatsNew);
  if (!a2.some(function(el){ return el.id === 'whatsnew-ov'; })) throw new Error('an existing user should see the changelog once on this version bump');

  var a3 = captureAppended(checkWhatsNew);
  if (a3.some(function(el){ return el.id === 'whatsnew-ov'; })) throw new Error('should not show the changelog again once the version has already been seen');

  ST.templates = [];
  saveST();
});

await check('pushWorkoutSummaryNtfy posts to ntfy.sh on finish (unless disabled), and finishWorkout wires it in', async function () {
  var calls = [];
  var origFetch = global.fetch;
  global.fetch = function(url, opts){ calls.push({url:url, opts:opts}); return Promise.resolve({ok:true}); };

  startWorkout(null);
  var ref = curWktRef();
  var wkt = getWkt(ref.date, ref.wid);
  wkt.exercises.push({name:'Приседания со штангой', sets:[{w:100,r:5,done:true}]});
  saveST();
  if (!ST.cfg) ST.cfg = {};
  ST.cfg.pushWorkoutSummary = true;
  finishWorkout();
  await flushMicrotasks();
  var pushCall = calls.filter(function(c){ return c.url.indexOf('gymlog-roman-workouts') !== -1; })[0];
  if (!pushCall) throw new Error('finishing a workout with completed sets should push a summary to ntfy');
  if (pushCall.opts.headers.Title.indexOf('finished') === -1) throw new Error('unexpected ntfy title header: ' + pushCall.opts.headers.Title);

  calls.length = 0;
  startWorkout(null);
  ref = curWktRef();
  wkt = getWkt(ref.date, ref.wid);
  wkt.exercises.push({name:'Приседания со штангой', sets:[{w:100,r:5,done:true}]});
  saveST();
  ST.cfg.pushWorkoutSummary = false;
  finishWorkout();
  await flushMicrotasks();
  if (calls.some(function(c){ return c.url.indexOf('gymlog-roman-workouts') !== -1; })) throw new Error('should not push when the user disabled it');

  global.fetch = origFetch;
});

await check('computeWrappedStats aggregates the current month/year, and shareWrappedCardImg renders without crashing', function () {
  var ds = todayStr();
  ST.w[ds] = { workouts: [{ id: 777030, name:'Тест', loc:'gym', startTime:Date.now()-3600000, endTime:Date.now(),
    exercises: [{ name:'Жим штанги лёжа', sets:[{w:80,r:5,done:true},{w:80,r:5,done:true}] }] }] };
  saveST();
  var m = computeWrappedStats('month');
  if (m.sessions < 1) throw new Error('should count at least this session in the current month');
  if (m.vol < 800) throw new Error('should sum weight*reps volume, got ' + m.vol);
  var y = computeWrappedStats('year');
  if (y.sessions < 1) throw new Error('should count at least this session in the current year');

  var origCreate = document.createElement.bind(document);
  var canvases = [];
  document.createElement = function(tag){ var el = origCreate(tag); if (tag === 'canvas') canvases.push(el); return el; };
  shareWrappedCardImg('month');
  document.createElement = origCreate;
  if (canvases.length !== 1) throw new Error('should render exactly one canvas, got ' + canvases.length);

  delete ST.w[ds]; saveST();
});

await check('training cycles: build via the day-picker, activate, surface the scheduled day, tag the started workout, and advance the cursor only once that workout finishes', function () {
  ST.templates = [{name:'Push A', loc:'gym', exs:[{name:'Жим штанги лёжа'}]}];
  saveST();

  openCycleBuilder(-1);
  setCycleName('PPL');
  pickCycleDay('tpl', 0);
  pickCycleDay('rest', null);
  if (CYCLE_DRAFT.days.length !== 2) throw new Error('both days should be queued in the draft');
  saveCycleDraft();
  if (!ST.programs.length) throw new Error('saveCycleDraft should persist the new cycle');
  var prog = ST.programs[ST.programs.length-1];
  if (prog.name !== 'PPL' || prog.days.length !== 2) throw new Error('saved cycle should keep its name and days');

  activateProgram(prog.id);
  var cur = programTodayEntry();
  if (!cur || cur.idx !== 0 || cur.entry.type !== 'tpl' || cur.entry.name !== 'Push A') throw new Error('should surface day 0 (Push A) right after activating');
  var html = programTodayHtml();
  if (html.indexOf('Push A') === -1) throw new Error("programTodayHtml should show today's scheduled template");

  startProgramDay();
  var ref = curWktRef();
  if (!ref) throw new Error('startProgramDay should have started a workout');
  var wkt = getWkt(ref.date, ref.wid);
  if (wkt.programId !== prog.id || wkt.programCursor !== 0) throw new Error('the started workout should be tagged with the cycle and day it came from');
  if (wkt.name !== 'Push A') throw new Error('should have started from the matching template');

  wkt.exercises[0].sets[0].done = true;
  finishWorkout();
  if (ST.activeProgram.cursorIdx !== 1) throw new Error('finishing the linked workout should advance the cursor to the next day, got ' + ST.activeProgram.cursorIdx);

  var cur2 = programTodayEntry();
  if (!cur2 || cur2.entry.type !== 'rest') throw new Error('day 1 should now be the rest day');
  skipProgramRestDay();
  if (ST.activeProgram.cursorIdx !== 0) throw new Error('skipping the rest day should wrap the 2-day cycle back to day 0');

  deactivateProgram();
  if (ST.activeProgram !== null) throw new Error('deactivateProgram should clear the active cycle');
  deleteCycle(prog.id);
  domStore['uc-yes'].onclick();
  if (ST.programs.some(function(p){ return p.id === prog.id; })) throw new Error('deleteCycle should remove the cycle once confirmed');

  ST.templates = [];
  saveST();
});

await check('legacy pre-feature data loads without crashing (missing customEx/bw/recentEx/warmup/note)', function () {
  var legacy = { w: {}, cfg: {}, wr: {}, wrMax: {} };
  var ds = dateAdd(today, -100);
  legacy.w[ds] = { workouts: [{ id: 1, name: 'Old', loc: 'gym', startTime: Date.now(), endTime: Date.now() + 1000, exercises: [{ name: 'Приседания со штангой', sets: [{ w: 60, r: 10, done: true }] }] }] };
  global.localStorage.setItem(KEY, JSON.stringify(legacy));
  loadST();
  renderCal();
  var pd = computeProgressData();
  if (!pd) throw new Error('computeProgressData failed on legacy data');
  // restore rich dataset for any later checks
  saveST();
});

console.log('');
console.log('=== ' + passed + ' passed, ' + errors.length + ' failed ===');
errors.forEach(function (e) { console.log(' -', e); });
process.exit(errors.length ? 1 : 0);

})();
