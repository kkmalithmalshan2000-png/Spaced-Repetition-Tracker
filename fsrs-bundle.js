/* fsrs-bundle.js (original content preserved) */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FSRS = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_W = [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722,
    0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425,
    0.0912, 0.0658, 0.1542,
  ];

  const DEFAULTS = {
    request_retention: 0.9,
    maximum_interval: 365,
    w: DEFAULT_W,
    enable_fuzz: false,
    enable_short_term: true,
  };

  const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

  function toDate(d) {
    if (d instanceof Date) return new Date(d.getTime());
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [y, m, day] = d.split("-").map(Number);
      return new Date(y, m - 1, day);
    }
    return new Date(d);
  }
  function dayNumber(d) {
    const x = toDate(d);
    return Math.floor(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 86400000);
  }
  function dayDiff(from, to) { return dayNumber(to) - dayNumber(from); }
  function addDays(d, n) {
    const x = toDate(d);
    return new Date(x.getFullYear(), x.getMonth(), x.getDate() + n);
  }
  function isoDay(d) {
    const x = toDate(d);
    const p = (n) => String(n).padStart(2, "0");
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  }

  class Scheduler {
    constructor(params = {}) {
      this.p = Object.assign({}, DEFAULTS, params);
      if (!Array.isArray(this.p.w) || this.p.w.length !== 21) this.p.w = DEFAULT_W.slice();
      this.p.request_retention = clamp(this.p.request_retention, 0.7, 0.99);
      this._setDecay();
    }

    _setDecay() {
      this.decay = -this.p.w[20];
      this.factor = Math.pow(0.9, 1 / this.decay) - 1;
    }

    emptyCard() {
      return { stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: null, due: null, intervalDays: 0 };
    }

    retrievability(card, now = new Date()) {
      if (!card || !card.reps || !card.lastReview || !card.stability) return null;
      const t = Math.max(0, dayDiff(card.lastReview, now));
      return Math.pow(1 + (this.factor * t) / card.stability, this.decay);
    }

    nextInterval(S) {
      const r = this.p.request_retention;
      return (S / this.factor) * (Math.pow(r, 1 / this.decay) - 1);
    }

    _initS(g) { return Math.max(this.p.w[g - 1], 0.1); }
    _initD(g) {
      const w = this.p.w;
      return clamp(w[4] - Math.exp(w[5] * (g - 1)) + 1, 1, 10);
    }
    _nextD(D, g) {
      const w = this.p.w;
      const delta = -w[6] * (g - 3);
      const damped = D + (delta * (10 - D)) / 9;
      return clamp(w[7] * this._initD(4) + (1 - w[7]) * damped, 1, 10);
    }
    _recallS(D, S, R, g) {
      const w = this.p.w;
      const hard = g === 2 ? w[15] : 1;
      const easy = g === 4 ? w[16] : 1;
      return S * (1 + Math.exp(w[8]) * (11 - D) * Math.pow(S, -w[9]) *
        (Math.exp(w[10] * (1 - R)) - 1) * hard * easy);
    }
    _forgetS(D, S, R) {
      const w = this.p.w;
      const sf = w[11] * Math.pow(D, -w[12]) * (Math.pow(S + 1, w[13]) - 1) * Math.exp(w[14] * (1 - R));
      return Math.min(sf, S);
    }
    _shortS(S, g) {
      const w = this.p.w;
      let inc = Math.exp(w[17] * (g - 3 + w[18])) * Math.pow(S, -w[19]);
      if (g >= 3) inc = Math.max(inc, 1);
      return S * inc;
    }

    _fuzz(interval, minI, maxI) {
      if (!this.p.enable_fuzz || interval < 2.5) return interval;
      const ranges = [
        { s: 2.5, e: 7, f: 0.15 }, { s: 7, e: 20, f: 0.1 }, { s: 20, e: Infinity, f: 0.05 },
      ];
      let delta = 1;
      for (const r of ranges) delta += r.f * Math.max(Math.min(interval, r.e) - r.s, 0);
      let lo = Math.max(minI, Math.round(interval - delta));
      let hi = Math.min(maxI, Math.round(interval + delta));
      if (lo > hi) lo = hi;
      return Math.floor(Math.random() * (hi - lo + 1)) + lo;
    }

    _scheduleOne(card, g, now) {
      let S, D, R = null;
      const first = !card.reps || !card.stability;
      if (first) {
        S = this._initS(g);
        D = this._initD(g);
      } else {
        const t = Math.max(0, dayDiff(card.lastReview, now));
        R = this.retrievability(card, now);
        D = this._nextD(card.difficulty, g);
        if (t < 1 && this.p.enable_short_term) S = this._shortS(card.stability, g);
        else if (g === 1) S = this._forgetS(card.difficulty, card.stability, R);
        else S = this._recallS(card.difficulty, card.stability, R, g);
      }
      S = clamp(S, 0.1, 36500);
      return { S, D, R, raw: this.nextInterval(S) };
    }

    scheduleAll(card, now = new Date()) {
      const max = this.p.maximum_interval;
      const res = {};
      for (let g = 1; g <= 4; g++) res[g] = this._scheduleOne(card, g, now);

      const lim = (x) => clamp(Math.round(x), 1, max);
      const iv = { 1: 1, 2: lim(res[2].raw), 3: lim(res[3].raw), 4: lim(res[4].raw) };
      iv[2] = Math.min(iv[2], iv[3]);
      iv[3] = Math.max(iv[3], Math.min(iv[2] + 1, max));
      iv[4] = Math.max(iv[4], Math.min(iv[3] + 1, max));

      const out = {};
      for (let g = 1; g <= 4; g++) {
        const interval = g === 1 ? 1 : this._fuzz(iv[g], 1, max);
        const lapse = g === 1 && card.reps > 0 && card.stability > 0;
        out[g] = {
          grade: g,
          intervalDays: interval,
          due: isoDay(addDays(now, interval)),
          card: {
            stability: res[g].S,
            difficulty: res[g].D,
            reps: (card.reps || 0) + 1,
            lapses: (card.lapses || 0) + (lapse ? 1 : 0),
            lastReview: isoDay(now),
            due: isoDay(addDays(now, interval)),
            intervalDays: interval,
          },
          retrievabilityBefore: res[g].R,
        };
      }
      return out;
    }

    review(card, grade, now = new Date()) {
      return this.scheduleAll(card || this.emptyCard(), now)[clamp(Math.round(grade), 1, 4)];
    }

    preview(card, now = new Date()) {
      const all = this.scheduleAll(card || this.emptyCard(), now);
      return { 1: all[1].intervalDays, 2: all[2].intervalDays, 3: all[3].intervalDays, 4: all[4].intervalDays };
    }

    replay(log) {
      let card = this.emptyCard();
      const sorted = [...log].sort((a, b) => toDate(a.date) - toDate(b.date));
      for (const e of sorted) card = this.review(card, e.grade, toDate(e.date)).card;
      return card;
    }
  }

  return { Scheduler, DEFAULT_W, DEFAULTS, util: { dayDiff, addDays, isoDay, toDate } };
});

/* nexus-fsrs.js glue and fsrs-integration.js follow (original content preserved) */
(function (root) {
  "use strict";
  const { Scheduler, util } = root.FSRS;
  const SETTINGS_KEY = "nexus.fsrs.settings.v1";
  const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
  const RATING_TO_GRADE = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 4 };
  const gradeOf = (r) => RATING_TO_GRADE[r] || 3;
  const defaults = { enabled: true, request_retention: 0.9, maximum_interval: 120, enable_fuzz: false, w: null };
  function load() {
    try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); }
    catch (_) { return Object.assign({}, defaults); }
  }
  let settings = load();
  let sched = build();
  function build() {
    const p = {
      request_retention: settings.request_retention,
      maximum_interval: clamp(Number(settings.maximum_interval) || 120, 30, 3650),
      enable_fuzz: !!settings.enable_fuzz,
    };
    if (Array.isArray(settings.w) && settings.w.length === 21) p.w = settings.w;
    return new Scheduler(p);
  }
  const cardOf = (t) => (t && t.fsrs && t.fsrs.stability > 0 ? t.fsrs : sched.emptyCard());
  const api = {
    settings: () => Object.assign({}, settings),
    setSettings(patch) {
      settings = Object.assign({}, settings, patch);
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
      sched = build();
    },
    sanitize(c) {
      if (!c || typeof c !== "object") return undefined;
      const S = Number(c.stability), D = Number(c.difficulty);
      if (!(S > 0) || !isFinite(S) || !isFinite(D)) return undefined;
      return {
        stability: clamp(S, 0.1, 36500), difficulty: clamp(D, 1, 10),
        reps: Math.max(0, Number(c.reps) || 0), lapses: Math.max(0, Number(c.lapses) || 0),
        lastReview: typeof c.lastReview === "string" ? c.lastReview : null,
        due: typeof c.due === "string" ? c.due : null,
        intervalDays: Math.max(0, Number(c.intervalDays) || 0),
      };
    },
    previewButtons(topic, now = new Date()) {
      const p = sched.preview(cardOf(topic), now);
      const max = sched.p.maximum_interval;
      const easy = Math.min(Math.max(p[4], p[3] + 2), max);
      const veryGood = Math.min(Math.max(Math.round((p[3] + easy) / 2), p[3]), easy);
      return { 1: p[1], 2: p[2], 3: p[3], 4: veryGood, 5: easy };
    },
    review(topic, rating, now = new Date()) {
      const r = sched.review(cardOf(topic), gradeOf(rating), now);
      const days = rating === 4 ? api.previewButtons(topic, now)[4] : r.intervalDays;
      const due = util.isoDay(util.addDays(now, days));
      r.card.intervalDays = days;
      r.card.due = due;
      return { fsrs: r.card, intervalDays: days, due, retrievabilityBefore: r.retrievabilityBefore };
    },
    retrievability(topic, now = new Date()) {
      const c = topic && topic.fsrs;
      return c ? sched.retrievability(c, now) : null;
    },
    migrateTopic(topic, entries) {
      const log = (entries || [])
        .filter((e) => e.rating >= 1 && e.rating <= 5 && /^\d{4}-\d{2}-\d{2}$/.test(e.reviewedAt || ""))
        .map((e) => ({ grade: gradeOf(Number(e.rating)), date: e.reviewedAt }));
      if (log.length) topic.fsrs = sched.replay(log);
      return topic;
    },
    seedFromTopic(topic) {
      const r = topic.lastRating || 3;
      return {
        stability: Math.max(1, topic.intervalDays || 1),
        difficulty: clamp(9.5 - 1.5 * (r - 1), 1, 10),
        reps: topic.reviewCount || 1, lapses: topic.lapses || 0,
        lastReview: topic.lastReviewed || null, due: topic.dueDate || null,
        intervalDays: topic.intervalDays || 0,
      };
    },
  };
  root.NexusFSRS = api;
})(window);

(function () {
  "use strict";
  if (!window.NexusFSRS) { console.warn("NexusFSRS missing; FSRS not active"); return; }
  const N = window.NexusFSRS;

  const CARDS_KEY = "nexus.fsrs.cards.v1";
  const readCards = () => { try { return JSON.parse(localStorage.getItem(CARDS_KEY) || "{}") || {}; } catch (_) { return {}; } };
  function persistCards() {
    const stored = readCards(), out = {}, ids = new Set(state.topics.map((t) => t.id));
    for (const id of ids) if (stored[id]) out[id] = stored[id];
    for (const t of state.topics) {
      if (t.fsrs) out[t.id] = t.fsrs;
      else if (!(t.reviewCount > 0)) delete out[t.id];
    }
    try { localStorage.setItem(CARDS_KEY, JSON.stringify(out)); } catch (_) {}
  }
  const baseSave = save;
  save = function () { persistCards(); return baseSave.apply(this, arguments); };

  const prevInterval = interval;
  interval = function (rating, previous) {
    if (!N.settings().enabled) return prevInterval(rating, previous);
    const t = reviewTopicId ? getTopic(reviewTopicId) : null;
    if (!t) return prevInterval(rating, previous);
    return N.previewButtons(t)[Number(rating)] || prevInterval(rating, previous);
  };

  const origSave = saveReview;
  saveReview = function (rating) {
    const t = getTopic(reviewTopicId);
    const r = Number(rating === undefined ? selectedReviewRating : rating);
    const pending = t && r >= 1 && r <= 5 ? N.review(t, r, new Date()) : null;
    const before = t ? t.reviewCount : 0;
    if (rating === undefined) origSave(); else origSave(rating);
    if (pending && t.reviewCount > before) {
      const customDue = document.getElementById("reviewCustomDue")?.value || "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(customDue)) pending.fsrs.due = customDue;
      t.fsrs = pending.fsrs;
      save();
    }
  };

  function ensureMigrated() {
    const stored = readCards();
    for (const t of state.topics) if (!t.fsrs && stored[t.id]) t.fsrs = N.sanitize(stored[t.id]);
    const byTopic = new Map();
    for (const h of state.history) {
      if (!byTopic.has(h.topicId)) byTopic.set(h.topicId, []);
      byTopic.get(h.topicId).push(h);
    }
    let changed = false;
    for (const t of state.topics) {
      if (t.fsrs || !(t.reviewCount > 0)) continue;
      const hs = byTopic.get(t.id);
      if (hs && hs.length) N.migrateTopic(t, hs);
      if (!t.fsrs) t.fsrs = N.seedFromTopic(t);
      changed = true;
    }
    if (changed) save();
  }

  function decorateTopics() {
    document.querySelectorAll("#topicGrid .topic-card").forEach((card) => {
      const id = card.querySelector("[data-id]")?.dataset.id;
      const t = id && getTopic(id);
      const R = t ? N.retrievability(t) : null;
      const box = card.querySelector(".topic-details");
      if (R != null && box && !box.querySelector(".fsrs-r"))
        box.insertAdjacentHTML("beforeend", `<span class="fsrs-r">Recall now: ${Math.round(R * 100)}%</span>`);
    });
  }
  const baseRenderTopics = renderTopics;
  renderTopics = function () { baseRenderTopics(); decorateTopics(); };
  const baseRenderAll = renderAll;
  renderAll = function () { ensureMigrated(); baseRenderAll(); };

  /* ========== AUDIT PATCHES (applying small runtime fixes for import/restore, timer sanitization, and due-date reconciliation) ========== */

  (function applyAuditPatches() {
    // Helper: safe date validation using the app's validDate if available, otherwise fallback.
    const isValidDate = window.validDate || function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s)); };

    // Source-of-truth rule (documented in code):
    // - topic.fsrs.due is the FSRS-calculated due date (memory state).
    // - topic.dueDate is an optional user-managed override. If present and valid, the app uses it for display and queue ordering.
    // - When neither exists, the topic is 'new'. Import/export preserves both fields.

    function getTopicDueDate(t) {
      if (!t) return '';
      if (isValidDate(t.dueDate)) return t.dueDate;
      if (t.fsrs && typeof t.fsrs.due === 'string' && isValidDate(t.fsrs.due)) return t.fsrs.due;
      return '';
    }

    // Override status() to use consistent due-date reconciliation
    if (typeof window.status === 'function') {
      window.status = function (topic) {
        const due = getTopicDueDate(topic);
        const hasReviewed = !!topic.lastReviewed;
        if (!hasReviewed && !due) return 'new';
        if (!due) return 'new';
        if (due < today()) return 'overdue';
        if (due === today()) return 'due';
        return 'upcoming';
      };
    }

    // Override any code paths that rely directly on topic.dueDate for queue generation by patching renderUpcomingQueue.
    if (typeof window.renderUpcomingQueue === 'function') {
      const origRenderUpcomingQueue = window.renderUpcomingQueue;
      window.renderUpcomingQueue = function () {
        const limit = plusDays(today(), 7);
        const items = activeTopics().filter(t => {
          const d = getTopicDueDate(t);
          return isValidDate(d) && d > today() && d <= limit;
        }).sort((a, b) => {
          const da = getTopicDueDate(a) || '9999';
          const db = getTopicDueDate(b) || '9999';
          return da.localeCompare(db) || naturalCompare(a.name, b.name);
        }).slice(0, 7);
        document.getElementById('upcomingCount').textContent = `${items.length} scheduled`;
        document.getElementById('upcomingQueue').innerHTML = items.length ? items.map(t => {
          const d = subjectDisplay(t), days = dayDiff(today(), getTopicDueDate(t));
          return `<div class="due-item upcoming-row"><div style="min-width:0"><div class="due-title">${esc(t.name)}</div><div class="due-meta"><small>${esc(d.subject)} · ${fmtDate(getTopicDueDate(t))}</small></div></div><div class="upcoming-date"><strong>${fmtDate(getTopicDueDate(t))}</strong><span>${days} day${days===1?'':'s'}</span></div></div>`;
        }).join('') : `<div class="hub-empty">No topics scheduled in the next 7 days.</div>`;
      };
    }

    // Replace importBackup with a safer, atomic restore implementation.
    // This function runs after the main script, so normalizeState and STORAGE_KEY are available.
    window.importBackup = async function (file) {
      const MSG_PREFIX = 'Could not import this backup.';
      if (!file) return;
      try {
        const text = await file.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch (e) { alert(`${MSG_PREFIX} Invalid JSON: ${e.message || e}`); return; }
        const raw = parsed?.state || parsed;

        // Basic structural validation before normalization.
        function basicValidate(obj) {
          if (!obj || typeof obj !== 'object') throw new Error('Backup root must be an object.');
          if (!Array.isArray(obj.topics)) throw new Error('Missing required "topics" array.');
          if (!Array.isArray(obj.subjects)) throw new Error('Missing required "subjects" array.');
          if (!Array.isArray(obj.history)) throw new Error('Missing required "history" array.');
        }
        basicValidate(raw);

        // Prevent extremely large payloads that would freeze the browser.
        const MAX_TOPICS = 100000;
        const MAX_HISTORY = 200000;
        if ((raw.topics || []).length > MAX_TOPICS) throw new Error(`Too many topics (${raw.topics.length}). Limit is ${MAX_TOPICS}.`);
        if ((raw.history || []).length > MAX_HISTORY) throw new Error(`Too many history entries (${raw.history.length}). Limit is ${MAX_HISTORY}.`);

        // Normalize using the app's existing normalizer (may throw for invalid data).
        let candidate;
        try { candidate = normalizeState(raw); } catch (e) { throw new Error(`Normalization failed: ${e.message || e}`); }

        // Deeper validation: unique IDs, date fields, references.
        function deepValidate(stateObj) {
          const ids = new Set();
          (stateObj.streams || []).forEach(s => { if (!s.id || !s.name) throw new Error('Each stream must have id and name.'); if (ids.has(s.id)) throw new Error('Duplicate stream id: ' + s.id); ids.add(s.id); });
          const subjIds = new Set();
          (stateObj.subjects || []).forEach(s => { if (!s.id || !s.name) throw new Error('Each subject must have id and name.'); if (subjIds.has(s.id)) throw new Error('Duplicate subject id: ' + s.id); subjIds.add(s.id); });
          const topicIds = new Set();
          (stateObj.topics || []).forEach(t => {
            if (!t.id || !t.name) throw new Error('Each topic must have id and name.');
            if (topicIds.has(t.id)) throw new Error('Duplicate topic id: ' + t.id);
            topicIds.add(t.id);
            if (t.subjectId && !subjIds.has(String(t.subjectId))) throw new Error('Topic references unknown subjectId: ' + t.id + ' -> ' + t.subjectId);
            if (t.createdAt && !isValidDate(t.createdAt)) throw new Error('Invalid topic.createdAt for ' + t.id + ': ' + t.createdAt);
            if (t.lastReviewed && !isValidDate(t.lastReviewed)) throw new Error('Invalid topic.lastReviewed for ' + t.id + ': ' + t.lastReviewed);
            if (t.dueDate && !isValidDate(t.dueDate)) throw new Error('Invalid topic.dueDate for ' + t.id + ': ' + t.dueDate);
            if (typeof t.intervalDays !== 'undefined' && (Number.isNaN(Number(t.intervalDays)) || Number(t.intervalDays) < 0 || Number(t.intervalDays) > 36500)) throw new Error('Invalid topic.intervalDays for ' + t.id);
            if (t.fsrs) {
              const s = N.sanitize ? N.sanitize(t.fsrs) : null;
              if (!s) throw new Error('Invalid FSRS state on topic ' + t.id);
            }
          });
          (stateObj.history || []).forEach(h => {
            if (!h.id) throw new Error('History entry missing id.');
            if (!h.topicId || !topicIds.has(String(h.topicId))) throw new Error('History references unknown topicId: ' + h.topicId);
            if (!isValidDate(h.reviewedAt)) throw new Error('Invalid history.reviewedAt on ' + h.id + ': ' + h.reviewedAt);
            if (!(Number(h.rating) >= 1 && Number(h.rating) <= 5)) throw new Error('Invalid history.rating on ' + h.id + ': ' + h.rating);
          });
        }
        deepValidate(candidate);

        // Ask for explicit confirmation before replacing data.
        if (!confirm(`Import ${candidate.topics.length} topics, ${candidate.history.length} history records, and ${candidate.exams.length} exams? This will replace the current local data.`)) {
          return;
        }

        // Prepare FSRS cards map for persisted FSRS storage (if present).
        const cardsOut = {};
        for (const t of (candidate.topics || [])) {
          if (t.fsrs) {
            try { const s = N.sanitize ? N.sanitize(t.fsrs) : t.fsrs; if (s) cardsOut[t.id] = s; }
            catch (_) { /* ignore, validation already checked above */ }
          }
        }

        // Staged, atomic write to localStorage keys. Roll back on any failure.
        const KEY_STATE = STORAGE_KEY || 'recall.study.tracker.v1';
        const KEY_CARDS = CARDS_KEY || 'nexus.fsrs.cards.v1';
        const oldState = localStorage.getItem(KEY_STATE);
        const oldCards = localStorage.getItem(KEY_CARDS);
        try {
          localStorage.setItem(KEY_STATE, JSON.stringify(candidate));
          localStorage.setItem(KEY_CARDS, JSON.stringify(cardsOut));
        } catch (e) {
          // Rollback
          try { if (oldState === null) localStorage.removeItem(KEY_STATE); else localStorage.setItem(KEY_STATE, oldState); } catch (_) {}
          try { if (oldCards === null) localStorage.removeItem(KEY_CARDS); else localStorage.setItem(KEY_CARDS, oldCards); } catch (_) {}
          alert(`${MSG_PREFIX} Storage write failed: ${e && e.message ? e.message : e}`);
          return;
        }

        // Commit to in-memory state only after storage succeeded.
        try {
          window.startUndo && startUndo('Backup imported.');
          state = candidate;
          // Ensure FSRS migration state is consistent.
          if (window.NexusFSRS && Array.isArray(state.topics)) {
            for (const t of state.topics) if (t.fsrs) t.fsrs = (N.sanitize ? N.sanitize(t.fsrs) : t.fsrs);
          }
          // Re-render and notify.
          save && save();
          renderAll && renderAll();
          switchView && switchView('overview');
          notify && notify('Backup restored. Undo is available briefly.', true);
        } catch (e) {
          // On unexpected runtime error, rollback storage and in-memory.
          try { if (oldState === null) localStorage.removeItem(KEY_STATE); else localStorage.setItem(KEY_STATE, oldState); } catch (_) {}
          try { if (oldCards === null) localStorage.removeItem(KEY_CARDS); else localStorage.setItem(KEY_CARDS, oldCards); } catch (_) {}
          alert(`${MSG_PREFIX} An internal error occurred: ${e && e.message ? e.message : e}`);
          return;
        } finally {
          // Clear file input if present
          try { document.getElementById('importFile').value = ''; } catch (_) {}
        }

      } catch (err) {
        alert(`Could not import this backup. ${err && err.message ? err.message : err}`);
        try { document.getElementById('importFile').value = ''; } catch (_) {}
      }
    };

    // Sanitize loadFeatureState to ensure timer timestamps are sane
    if (typeof window.loadFeatureState === 'function') {
      const origLoadFeatureState = window.loadFeatureState;
      window.loadFeatureState = function () {
        try {
          const fs = origLoadFeatureState();
          const maxAgeDays = 365; // allow long-running sessions but guard against corrupted timestamps
          const now = Date.now();
          if (fs.focusStartedAt) {
            const s = Date.parse(fs.focusStartedAt);
            if (!isFinite(s) || s > now + 60000 || s < now - maxAgeDays * 86400000) { fs.focusStartedAt = null; fs.focusPausedAt = null; }
          }
          if (fs.focusPausedAt) {
            const p = Date.parse(fs.focusPausedAt);
            if (!isFinite(p) || (fs.focusStartedAt && p < Date.parse(fs.focusStartedAt))) { fs.focusPausedAt = null; }
          }
          return fs;
        } catch (e) { console.warn('loadFeatureState sanitization failed', e); return origLoadFeatureState(); }
      };
    }

    // Utility: safe append to study logs to avoid duplication
    window.nexusSafeLogStudySession = function (entry) {
      try {
        const key = 'recall.study.features.v1';
        const raw = localStorage.getItem(key);
        const fsState = raw ? JSON.parse(raw) : null;
        if (!fsState) return false;
        fsState.studyLogs = Array.isArray(fsState.studyLogs) ? fsState.studyLogs : [];
        const last = fsState.studyLogs[fsState.studyLogs.length - 1];
        // If the same topic on the same date and minutes equal, skip.
        if (last && last.date === entry.date && last.topicId === entry.topicId && last.minutes === entry.minutes) return false;
        fsState.studyLogs.push(entry);
        localStorage.setItem(key, JSON.stringify(fsState));
        if (window.NexusSetFeatureState) { window.NexusSetFeatureState(fsState); }
        return true;
      } catch (e) { console.warn('safeLogStudySession error', e); return false; }
    };

    // Expose a small self-test suite (disabled by default) to run quick checks in the browser console.
    window.__nexus_audit_tests = {
      validateBackupSample: function (jsonText) {
        try { const parsed = JSON.parse(jsonText); const raw = parsed?.state || parsed; if (!raw) throw new Error('No state'); normalizeState(raw); return { ok: true, message: 'Normalization succeeded' }; }
        catch (e) { return { ok: false, message: String(e) }; }
      }
    };

  })();

  // Remaining fsrs-integration initialization carried on earlier
  const PANEL = `<section class="panel" style="margin-top:15px"><div class="panel-head"><div><h3>Review schedule · FSRS-6</h3><p>Intervals are predicted from each topic's memory stability and di[...]`;
  const oldPanel = [...document.querySelectorAll("#view-setup .panel")].find((p) => p.querySelector("h3")?.textContent.trim() === "Review schedule");
  if (oldPanel) { oldPanel.outerHTML = PANEL; wireSettings(); }
  document.querySelectorAll("#helpDialog .help-content p").forEach((p) => {
    p.innerHTML = p.innerHTML
      .replace("Rating 1 resets to one day; higher ratings progressively increase the interval. The maximum interval is 120 days.",
        "Intervals are calculated by the FSRS-6 algorithm from your rating, the topic's stability and difficulty, and your desired retention. Rating 1 resets to one day. The maximum interval is 1[...]"
      )
      .replace("an FSRS-inspired optional schedule heuristic, ", "");
  });

  ensureMigrated();
  renderAll();
})();
