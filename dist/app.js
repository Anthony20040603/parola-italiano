define("mdict-parseXml", function () {
  return function parseXml(source) {
    return new DOMParser().parseFromString(source, "text/xml");
  };
});

require(["mdict-parser"], function (MParser) {
  "use strict";

  var MAX_WORDS = 7000;
  var DB_NAME = "parola-local-dictionary";
  var DB_VERSION = 2;
  var FILE_STORE = "files";
  var PROGRESS_STORE = "progress";
  var ACTIVE_FILE_KEY = "active";
  var DICTIONARY_SET_KEY = "dictionary-set";
  var DICTIONARY_FILE_PREFIX = "dictionary:";
  var PROGRESS_FORMAT = "parola-progress";
  var PROGRESS_VERSION = 4;
  var SHUFFLE_ALGORITHM = "mulberry32-fisher-yates-v1";
  var FSRS_ALGORITHM = "FSRS-6";
  var FSRS_LIBRARY_VERSION = "5.4.2";
  var COMPANION_DELAY_MS = 10 * 60 * 1000;
  var MAX_REVIEW_LOGS = 50000;
  var LIBRARY_PAGE_SIZE = 120;
  var DEFAULT_SETTINGS = {
    dailyNew: 20,
    dailyReview: 80,
    requestRetention: 0.9,
    maximumInterval: 3650
  };

  var state = {
    file: null,
    fingerprint: "",
    legacyFingerprint: "",
    lookup: null,
    dictionaries: [],
    learningDictionaryId: "",
    referenceDictionaries: [],
    referenceRenderToken: 0,
    compatibilityByFingerprint: Object.create(null),
    compatibilityScanToken: 0,
    sourceWords: [],
    words: [],
    progress: null,
    pendingProgressImport: null,
    currentWord: "",
    currentMode: "meaning",
    currentDefinition: "",
    currentDefinitionPromise: null,
    currentAnswerResult: "",
    currentStartedAt: 0,
    cardToken: 0,
    dictionaryCapped: false,
    definitionCache: Object.create(null),
    saveChain: Promise.resolve(),
    completed: false,
    completionTimer: null,
    libraryVisibleLimit: LIBRARY_PAGE_SIZE,
    quickRatingWord: ""
  };

  var elements = {
    importView: document.getElementById("import-view"),
    loadingView: document.getElementById("loading-view"),
    studyView: document.getElementById("study-view"),
    errorView: document.getElementById("error-view"),
    fileInput: document.getElementById("dict-file"),
    errorFileInput: document.getElementById("dict-file-error"),
    progressFileInput: document.getElementById("progress-file"),
    studyProgressFileInput: document.getElementById("study-progress-file"),
    exportProgress: document.getElementById("export-progress"),
    importProgress: document.getElementById("import-progress"),
    importStatus: document.getElementById("import-status"),
    progressStatus: document.getElementById("progress-status"),
    dictionaryManager: document.getElementById("dictionary-manager"),
    dictionaryManagerCount: document.getElementById("dictionary-manager-count"),
    dictionaryManagerList: document.getElementById("dictionary-manager-list"),
    startDictionarySet: document.getElementById("start-dictionary-set"),
    changeDict: document.getElementById("change-dict"),
    loadingMessage: document.getElementById("loading-message"),
    errorMessage: document.getElementById("error-message"),
    dictName: document.getElementById("dict-name"),
    knownCount: document.getElementById("known-count"),
    countLabel: document.getElementById("count-label"),
    progressBar: document.getElementById("progress-bar"),
    progressLabel: document.getElementById("progress-label"),
    dailySummary: document.getElementById("daily-summary"),
    openCheckin: document.getElementById("open-checkin"),
    checkinStreak: document.getElementById("checkin-streak"),
    checkinDialog: document.getElementById("checkin-dialog"),
    closeCheckin: document.getElementById("close-checkin"),
    checkinOverview: document.getElementById("checkin-overview"),
    checkinHistory: document.getElementById("checkin-history"),
    makeupActions: document.getElementById("makeup-actions"),
    makeupDate: document.getElementById("makeup-date"),
    makeupSubmit: document.getElementById("makeup-submit"),
    makeupStatus: document.getElementById("makeup-status"),
    openLibraryProgress: document.getElementById("open-library-progress"),
    libraryProgressDialog: document.getElementById("library-progress-dialog"),
    closeLibraryProgress: document.getElementById("close-library-progress"),
    libraryProgressOverview: document.getElementById("library-progress-overview"),
    libraryProgressSearch: document.getElementById("library-progress-search"),
    libraryProgressFilter: document.getElementById("library-progress-filter"),
    libraryProgressSort: document.getElementById("library-progress-sort"),
    libraryProgressResult: document.getElementById("library-progress-result"),
    libraryProgressList: document.getElementById("library-progress-list"),
    libraryProgressEmpty: document.getElementById("library-progress-empty"),
    libraryProgressMore: document.getElementById("library-progress-more"),
    quickRatingDialog: document.getElementById("quick-rating-dialog"),
    closeQuickRating: document.getElementById("close-quick-rating"),
    quickRatingTitle: document.getElementById("quick-rating-title"),
    quickRatingNote: document.getElementById("quick-rating-note"),
    quickRatingStatus: document.getElementById("quick-rating-status"),
    wordPosition: document.getElementById("word-position"),
    currentWord: document.getElementById("current-word"),
    wordHint: document.getElementById("word-hint"),
    speakButton: document.getElementById("speak-button"),
    definitionWrap: document.getElementById("definition-wrap"),
    definition: document.getElementById("definition"),
    referenceDictionaries: document.getElementById("reference-dictionaries"),
    referenceDictionaryCount: document.getElementById("reference-dictionary-count"),
    referenceDictionaryList: document.getElementById("reference-dictionary-list"),
    revealActions: document.getElementById("reveal-actions"),
    gradeActions: document.getElementById("grade-actions"),
    revealButton: document.getElementById("reveal-button"),
    spellingForm: document.getElementById("spelling-form"),
    spellingInput: document.getElementById("spelling-input"),
    spellingCheck: document.getElementById("spelling-check"),
    spellingGiveUp: document.getElementById("spelling-give-up"),
    spellingFeedback: document.getElementById("spelling-feedback"),
    spellingFeedbackText: document.getElementById("spelling-feedback-text"),
    spellingAnswer: document.getElementById("spelling-answer"),
    completionCelebration: document.getElementById("completion-celebration"),
    completionCheckinMessage: document.getElementById("completion-checkin-message"),
    completionStreakMessage: document.getElementById("completion-streak-message"),
    completeActions: document.getElementById("complete-actions"),
    learnFiveMore: document.getElementById("learn-five-more"),
    reviewMore: document.getElementById("review-more"),
    refreshQueue: document.getElementById("refresh-queue"),
    dictionaryNote: document.getElementById("dictionary-note"),
    dictionaryCompatibility: document.getElementById("dictionary-compatibility"),
    settingNew: document.getElementById("setting-new"),
    settingReview: document.getElementById("setting-review"),
    settingRetention: document.getElementById("setting-retention")
  };

  var gradeButtons = Array.prototype.slice.call(document.querySelectorAll("[data-rating]"));
  var quickRatingButtons = Array.prototype.slice.call(document.querySelectorAll("[data-quick-rating]"));

  function showView(viewName) {
    ["importView", "loadingView", "studyView", "errorView"].forEach(function (name) {
      elements[name].hidden = name !== viewName;
    });
    elements.changeDict.hidden = viewName !== "studyView";
  }

  function dictionaryDisplayName(fileOrDictionary) {
    return String((fileOrDictionary && fileOrDictionary.name) || "未命名词库").replace(/\.mdx$/i, "");
  }

  function formatFileSize(size) {
    var megabytes = Number(size || 0) / 1048576;
    return megabytes < 1 ? Math.max(1, Math.round(Number(size || 0) / 1024)) + " KB" : megabytes.toFixed(megabytes >= 10 ? 0 : 1) + " MB";
  }

  function dictionaryDescriptor(file, options) {
    var source = options || {};
    return {
      id: fileFingerprint(file),
      name: file.name,
      size: file.size,
      lastModified: file.lastModified || 0,
      file: file,
      referenceEnabled: source.referenceEnabled !== false,
      lookup: null,
      lookupPromise: null,
      definitionCache: Object.create(null),
      hash: source.hash || "",
      compatibility: source.compatibility || null
    };
  }

  function dictionaryById(id) {
    return state.dictionaries.find(function (dictionary) { return dictionary.id === id; }) || null;
  }

  function refreshReferenceDictionaries() {
    state.referenceDictionaries = state.dictionaries.filter(function (dictionary) {
      return dictionary.id !== state.learningDictionaryId && dictionary.referenceEnabled !== false;
    });
  }

  function updateDictionaryManagerRoles() {
    Array.prototype.slice.call(elements.dictionaryManagerList.querySelectorAll("[data-dictionary-id]")).forEach(function (row) {
      var id = row.dataset.dictionaryId;
      var dictionary = dictionaryById(id);
      var isLearning = id === state.learningDictionaryId;
      var badge = row.querySelector("[data-role-badge]");
      var reference = row.querySelector("[data-reference-toggle]");
      row.classList.toggle("is-learning", isLearning);
      badge.textContent = isLearning ? "学习词库" : dictionary && dictionary.referenceEnabled !== false ? "参考词库" : "已停用";
      if (reference) {
        reference.disabled = isLearning;
        reference.checked = isLearning || Boolean(dictionary && dictionary.referenceEnabled !== false);
      }
    });
  }

  function renderDictionaryManager() {
    elements.dictionaryManager.hidden = state.dictionaries.length === 0;
    elements.dictionaryManagerCount.textContent = state.dictionaries.length ? state.dictionaries.length + " 部" : "";
    elements.dictionaryManagerList.textContent = "";
    if (!state.dictionaries.length) return;
    if (!dictionaryById(state.learningDictionaryId)) state.learningDictionaryId = state.dictionaries[0].id;

    var fragment = document.createDocumentFragment();
    state.dictionaries.forEach(function (dictionary) {
      var row = document.createElement("div");
      var main = document.createElement("label");
      var radio = document.createElement("input");
      var text = document.createElement("span");
      var name = document.createElement("strong");
      var meta = document.createElement("small");
      var controls = document.createElement("label");
      var reference = document.createElement("input");
      var badge = document.createElement("span");

      row.className = "dictionary-manager-row";
      row.dataset.dictionaryId = dictionary.id;
      main.className = "dictionary-manager-main";
      radio.type = "radio";
      radio.name = "learning-dictionary";
      radio.value = dictionary.id;
      radio.checked = dictionary.id === state.learningDictionaryId;
      name.textContent = dictionaryDisplayName(dictionary);
      meta.textContent = formatFileSize(dictionary.size) + (dictionary.compatibility
        ? " · 拼写提示约 " + dictionary.compatibility.usablePercent + "% 可用"
        : "");
      text.appendChild(name);
      text.appendChild(meta);
      main.appendChild(radio);
      main.appendChild(text);

      controls.className = "dictionary-reference-toggle";
      reference.type = "checkbox";
      reference.dataset.referenceToggle = "";
      reference.checked = dictionary.referenceEnabled !== false;
      badge.dataset.roleBadge = "";
      controls.appendChild(reference);
      controls.appendChild(badge);
      row.appendChild(main);
      row.appendChild(controls);

      radio.addEventListener("change", function () {
        if (!radio.checked) return;
        state.learningDictionaryId = dictionary.id;
        dictionary.referenceEnabled = true;
        updateDictionaryManagerRoles();
      });
      reference.addEventListener("change", function () {
        dictionary.referenceEnabled = reference.checked;
        updateDictionaryManagerRoles();
      });
      fragment.appendChild(row);
    });
    elements.dictionaryManagerList.appendChild(fragment);
    updateDictionaryManagerRoles();
  }

  function bytesToHex(bytes) {
    return Array.prototype.map.call(new Uint8Array(bytes), function (value) { return value.toString(16).padStart(2, "0"); }).join("");
  }

  function ensureDictionaryHash(dictionary) {
    if (dictionary.hash) return Promise.resolve(dictionary.hash);
    if (!window.crypto || !window.crypto.subtle || !dictionary.file.arrayBuffer) return Promise.resolve("");
    return dictionary.file.arrayBuffer().then(function (buffer) {
      return window.crypto.subtle.digest("SHA-256", buffer);
    }).then(function (digest) {
      dictionary.hash = bytesToHex(digest);
      return dictionary.hash;
    }).catch(function (error) {
      console.warn("Dictionary hash could not be calculated", error);
      return "";
    });
  }

  function addDictionaryFiles(files) {
    var candidates = Array.prototype.slice.call(files || []).filter(function (file) { return /\.mdx$/i.test(file.name); });
    var invalid = Math.max(0, Number(files && files.length) - candidates.length);
    if (!candidates.length) {
      setImportStatus("没有找到可用的 MDX 文件。", true);
      return Promise.resolve(0);
    }
    setImportStatus("正在检查 " + candidates.length + " 个文件并识别重复词库……", false);
    return Promise.all(state.dictionaries.map(ensureDictionaryHash)).then(function () {
      var added = 0;
      var duplicate = 0;
      var chain = Promise.resolve();
      candidates.forEach(function (file) {
        chain = chain.then(function () {
          var id = fileFingerprint(file);
          if (dictionaryById(id)) { duplicate += 1; return; }
          var dictionary = dictionaryDescriptor(file);
          return ensureDictionaryHash(dictionary).then(function (hash) {
            var sameContent = hash && state.dictionaries.some(function (existing) { return existing.hash === hash; });
            if (sameContent) { duplicate += 1; return; }
            state.dictionaries.push(dictionary);
            if (!state.learningDictionaryId) state.learningDictionaryId = id;
            added += 1;
          });
        });
      });
      return chain.then(function () {
        renderDictionaryManager();
        setImportStatus("已加入 " + added + " 部词库" + (duplicate ? "，识别并跳过 " + duplicate + " 部重复词库" : "") + (invalid ? "，另有 " + invalid + " 个无效文件" : "") + "。", false);
        return added;
      });
    });
  }

  function progressKey() {
    return "parola-progress:" + state.fingerprint;
  }

  function createShuffleSeed() {
    if (window.crypto && window.crypto.getRandomValues) {
      var values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      return values[0] || 1;
    }
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0 || 1;
  }

  function normalizeSeed(value) {
    var seed = Number(value);
    if (!Number.isFinite(seed)) return createShuffleSeed();
    return seed >>> 0 || 1;
  }

  function mulberry32(seed) {
    return function () {
      var value = (seed += 0x6d2b79f5);
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffledWords(words, seed) {
    var result = words.slice();
    var random = mulberry32(normalizeSeed(seed));
    for (var index = result.length - 1; index > 0; index -= 1) {
      var target = Math.floor(random() * (index + 1));
      var temporary = result[index];
      result[index] = result[target];
      result[target] = temporary;
    }
    return result;
  }

  function localDateKey(date) {
    var value = date || new Date();
    var shifted = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 10);
  }

  function dateFromLocalKey(key) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    if (!match) return null;
    var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
    return localDateKey(date) === key ? date : null;
  }

  function shiftLocalDateKey(key, days) {
    var date = dateFromLocalKey(key);
    if (!date) return "";
    date.setDate(date.getDate() + Number(days || 0));
    return localDateKey(date);
  }

  function freshDaily(date) {
    return { date: localDateKey(date), newWords: [], reviewCount: 0, extraNew: 0, extraReview: 0 };
  }

  function freshCheckins() {
    return { dates: {}, lastCelebratedDate: "" };
  }

  function freshProgress() {
    return {
      schemaVersion: PROGRESS_VERSION,
      shuffleSeed: createShuffleSeed(),
      shuffleAlgorithm: SHUFFLE_ALGORITHM,
      cursor: 0,
      reviewed: 0,
      cards: {},
      reviewLog: [],
      studyQueue: [],
      pending: null,
      daily: freshDaily(),
      checkins: freshCheckins(),
      settings: Object.assign({}, DEFAULT_SETTINGS),
      scheduler: {
        algorithm: FSRS_ALGORITHM,
        library: "ts-fsrs",
        libraryVersion: FSRS_LIBRARY_VERSION
      }
    };
  }

  function applyStudyOrder() {
    state.progress.shuffleSeed = normalizeSeed(state.progress.shuffleSeed);
    state.progress.shuffleAlgorithm = SHUFFLE_ALGORITHM;
    state.words = shuffledWords(state.sourceWords, state.progress.shuffleSeed);
  }

  function clampInteger(value, minimum, maximum, fallback) {
    var number = Math.floor(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function sanitizeSettings(value) {
    var source = value || {};
    return {
      dailyNew: clampInteger(source.dailyNew, 0, 200, DEFAULT_SETTINGS.dailyNew),
      dailyReview: clampInteger(source.dailyReview, 0, 1000, DEFAULT_SETTINGS.dailyReview),
      requestRetention: Math.min(0.97, Math.max(0.8, Number(source.requestRetention) || 0.9)),
      maximumInterval: clampInteger(source.maximumInterval, 30, 36500, 3650)
    };
  }

  function createScheduler(settings) {
    if (!window.FSRS) throw new Error("FSRS 调度组件没有成功加载。");
    var options = sanitizeSettings(settings);
    return window.FSRS.fsrs({
      request_retention: options.requestRetention,
      maximum_interval: options.maximumInterval,
      enable_fuzz: true,
      enable_short_term: true,
      learning_steps: ["10m"],
      relearning_steps: ["10m"]
    });
  }

  function validDate(value, fallback) {
    var date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date(fallback || Date.now()) : date;
  }

  function serializeCard(card) {
    return {
      due: validDate(card.due).toISOString(),
      stability: Number(card.stability) || 0,
      difficulty: Number(card.difficulty) || 0,
      elapsed_days: Number(card.elapsed_days) || 0,
      scheduled_days: Number(card.scheduled_days) || 0,
      reps: Math.max(0, Math.floor(Number(card.reps) || 0)),
      lapses: Math.max(0, Math.floor(Number(card.lapses) || 0)),
      learning_steps: Math.max(0, Math.floor(Number(card.learning_steps) || 0)),
      state: clampInteger(card.state, 0, 3, window.FSRS.State.New),
      last_review: card.last_review ? validDate(card.last_review).toISOString() : null
    };
  }

  function hydrateCard(card, fallbackDate) {
    if (!card || typeof card !== "object") {
      return window.FSRS.createEmptyCard(fallbackDate || new Date());
    }
    return {
      due: validDate(card.due, fallbackDate),
      stability: Math.max(0, Number(card.stability) || 0),
      difficulty: Math.max(0, Number(card.difficulty) || 0),
      elapsed_days: Number(card.elapsed_days) || 0,
      scheduled_days: Number(card.scheduled_days) || 0,
      reps: Math.max(0, Math.floor(Number(card.reps) || 0)),
      lapses: Math.max(0, Math.floor(Number(card.lapses) || 0)),
      learning_steps: Math.max(0, Math.floor(Number(card.learning_steps) || 0)),
      state: clampInteger(card.state, 0, 3, window.FSRS.State.New),
      last_review: card.last_review ? validDate(card.last_review) : undefined
    };
  }

  function freshModeState() {
    return {
      lastMode: "",
      nextMode: "meaning",
      forceMode: "",
      meaningPassed: false,
      spellingPassed: false
    };
  }

  function freshWordStats() {
    return {
      meaningAttempts: 0,
      meaningFailures: 0,
      spellingAttempts: 0,
      spellingFailures: 0,
      accentWarnings: 0
    };
  }

  function freshRecord(now) {
    return {
      fsrs: serializeCard(window.FSRS.createEmptyCard(now || new Date())),
      mode: freshModeState(),
      stats: freshWordStats(),
      lastRating: 0,
      lastResult: "new"
    };
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function getRecord(word) {
    return hasOwn(state.progress.cards, word) ? state.progress.cards[word] : null;
  }

  function sanitizeRecord(value, now) {
    var record = freshRecord(now);
    var source = value && typeof value === "object" ? value : {};
    var mode = source.mode || {};
    var stats = source.stats || {};
    record.fsrs = serializeCard(hydrateCard(source.fsrs, now));
    record.mode = {
      lastMode: mode.lastMode === "spelling" ? "spelling" : mode.lastMode === "meaning" ? "meaning" : "",
      nextMode: mode.nextMode === "spelling" ? "spelling" : "meaning",
      forceMode: mode.forceMode === "spelling" ? "spelling" : mode.forceMode === "meaning" ? "meaning" : "",
      meaningPassed: Boolean(mode.meaningPassed),
      spellingPassed: Boolean(mode.spellingPassed)
    };
    record.stats = {
      meaningAttempts: clampInteger(stats.meaningAttempts, 0, 1000000, 0),
      meaningFailures: clampInteger(stats.meaningFailures, 0, 1000000, 0),
      spellingAttempts: clampInteger(stats.spellingAttempts, 0, 1000000, 0),
      spellingFailures: clampInteger(stats.spellingFailures, 0, 1000000, 0),
      accentWarnings: clampInteger(stats.accentWarnings, 0, 1000000, 0)
    };
    record.lastRating = clampInteger(source.lastRating, 0, 4, 0);
    record.lastResult = typeof source.lastResult === "string" ? source.lastResult.slice(0, 32) : "";
    return record;
  }

  function chooseMode(record) {
    var mode = record.mode || freshModeState();
    if (mode.forceMode) return mode.forceMode;
    if (!mode.meaningPassed) return "meaning";
    if (!mode.spellingPassed) return "spelling";
    return mode.lastMode === "meaning" ? "spelling" : "meaning";
  }

  function migrateLegacyProgress(saved) {
    var now = new Date();
    var progress = freshProgress();
    var availableWords = new Set(state.sourceWords);
    progress.shuffleSeed = normalizeSeed(saved && saved.shuffleSeed);
    progress.cursor = Math.max(0, Math.floor(Number(saved && saved.cursor) || 0));
    progress.reviewed = Math.max(0, Math.floor(Number(saved && saved.reviewed) || 0));
    var scheduler = createScheduler(progress.settings);

    Object.keys((saved && saved.known) || {}).forEach(function (word) {
      if (!availableWords.has(word)) return;
      var record = freshRecord(now);
      record.fsrs = serializeCard(scheduler.next(hydrateCard(record.fsrs), now, window.FSRS.Rating.Good).card);
      record.mode.meaningPassed = true;
      record.mode.lastMode = "meaning";
      record.mode.nextMode = "spelling";
      record.stats.meaningAttempts = 1;
      record.lastRating = window.FSRS.Rating.Good;
      record.lastResult = "migrated-known";
      progress.cards[word] = record;
    });

    Object.keys((saved && saved.learning) || {}).forEach(function (word) {
      if (!availableWords.has(word)) return;
      var record = freshRecord(now);
      record.fsrs = serializeCard(scheduler.next(hydrateCard(record.fsrs), now, window.FSRS.Rating.Again).card);
      record.mode.lastMode = "meaning";
      record.mode.nextMode = "meaning";
      record.mode.forceMode = "meaning";
      record.stats.meaningAttempts = 1;
      record.stats.meaningFailures = 1;
      record.lastRating = window.FSRS.Rating.Again;
      record.lastResult = "migrated-learning";
      progress.cards[word] = record;
    });

    var pendingWord = saved && saved.pendingWord;
    if (availableWords.has(pendingWord)) {
      if (!hasOwn(progress.cards, pendingWord)) progress.cards[pendingWord] = freshRecord(now);
      progress.pending = { word: pendingWord, mode: chooseMode(progress.cards[pendingWord]) };
    }
    progress.migratedFrom = 1;
    return progress;
  }

  function sanitizeCheckins(value, now) {
    var source = value && typeof value === "object" ? value : {};
    var datesSource = source.dates && typeof source.dates === "object" ? source.dates : {};
    var today = localDateKey(now || new Date());
    var checkins = freshCheckins();
    Object.keys(datesSource).sort().forEach(function (key) {
      if (!dateFromLocalKey(key) || key > today) return;
      var entry = datesSource[key] && typeof datesSource[key] === "object" ? datesSource[key] : {};
      checkins.dates[key] = {
        type: entry.type === "makeup" ? "makeup" : "earned",
        at: typeof entry.at === "string" ? entry.at : key + "T12:00:00"
      };
    });
    checkins.lastCelebratedDate = hasOwn(checkins.dates, source.lastCelebratedDate) ? source.lastCelebratedDate : "";
    return checkins;
  }

  function normalizeProgress(saved) {
    if (!saved || typeof saved !== "object" || !saved.cards || Number(saved.schemaVersion) < 2) {
      return migrateLegacyProgress(saved || {});
    }
    var now = new Date();
    var progress = freshProgress();
    var availableWords = new Set(state.sourceWords);
    progress.shuffleSeed = normalizeSeed(saved.shuffleSeed);
    progress.cursor = Math.max(0, Math.floor(Number(saved.cursor) || 0));
    progress.reviewed = Math.max(0, Math.floor(Number(saved.reviewed) || 0));
    progress.settings = sanitizeSettings(saved.settings);
    progress.checkins = sanitizeCheckins(saved.checkins, now);
    Object.keys(saved.cards).forEach(function (word) {
      if (availableWords.has(word)) progress.cards[word] = sanitizeRecord(saved.cards[word], now);
    });
    progress.reviewLog = Array.isArray(saved.reviewLog)
      ? saved.reviewLog.slice(-MAX_REVIEW_LOGS).filter(function (entry) {
          return entry && availableWords.has(entry.w) && typeof entry.t === "string";
        })
      : [];
    var sameDay = saved.daily && saved.daily.date === localDateKey(now);
    progress.daily = sameDay
      ? {
          date: saved.daily.date,
          newWords: Array.isArray(saved.daily.newWords)
            ? saved.daily.newWords.filter(function (word) { return availableWords.has(word); })
            : [],
          reviewCount: Math.max(0, Math.floor(Number(saved.daily.reviewCount) || 0)),
          extraNew: clampInteger(saved.daily.extraNew, 0, 1000, 0),
          extraReview: clampInteger(saved.daily.extraReview, 0, 5000, 0)
        }
      : freshDaily(now);
    progress.studyQueue = sameDay && Array.isArray(saved.studyQueue)
      ? saved.studyQueue.slice(0, 100).map(function (item) {
          if (item && item.type === "new") return { type: "new" };
          if (item && item.type === "review" && availableWords.has(item.word) && hasOwn(progress.cards, item.word)) {
            return { type: "review", word: item.word };
          }
          return null;
        }).filter(Boolean)
      : [];
    if (saved.pending && availableWords.has(saved.pending.word)) {
      if (!hasOwn(progress.cards, saved.pending.word)) progress.cards[saved.pending.word] = freshRecord(now);
      progress.pending = {
        word: saved.pending.word,
        mode: saved.pending.mode === "spelling" ? "spelling" : "meaning"
      };
    }
    progress.scheduler = {
      algorithm: FSRS_ALGORITHM,
      library: "ts-fsrs",
      libraryVersion: FSRS_LIBRARY_VERSION
    };
    return progress;
  }

  function ensureDaily() {
    var today = localDateKey(new Date());
    if (!state.progress.daily || state.progress.daily.date !== today) {
      state.progress.daily = freshDaily();
      state.progress.studyQueue = [];
    }
  }

  function calculateCheckinStats(checkins, todayKey) {
    var dates = checkins && checkins.dates ? checkins.dates : {};
    var anchor = hasOwn(dates, todayKey) ? todayKey : shiftLocalDateKey(todayKey, -1);
    var current = 0;
    var cursor = anchor;
    while (cursor && hasOwn(dates, cursor)) {
      current += 1;
      cursor = shiftLocalDateKey(cursor, -1);
    }
    var longest = 0;
    var run = 0;
    var previous = "";
    Object.keys(dates).sort().forEach(function (key) {
      run = previous && shiftLocalDateKey(previous, 1) === key ? run + 1 : 1;
      longest = Math.max(longest, run);
      previous = key;
    });
    return {
      current: current,
      longest: longest,
      total: Object.keys(dates).length,
      todayChecked: hasOwn(dates, todayKey)
    };
  }

  function hasStudyActivityToday() {
    if (!state.progress) return false;
    var today = localDateKey(new Date());
    if (state.progress.daily && state.progress.daily.date === today
      && ((state.progress.daily.newWords || []).length || Number(state.progress.daily.reviewCount) > 0)) return true;
    return (state.progress.reviewLog || []).some(function (entry) {
      return entry && localDateKey(validDate(entry.t)) === today;
    });
  }

  function recordTodayCheckin() {
    if (!state.progress || !hasStudyActivityToday()) return false;
    if (!state.progress.checkins) state.progress.checkins = freshCheckins();
    var today = localDateKey(new Date());
    if (hasOwn(state.progress.checkins.dates, today)) return false;
    state.progress.checkins.dates[today] = { type: "earned", at: new Date().toISOString() };
    state.progress.checkins.lastCelebratedDate = today;
    return true;
  }

  function availableMakeupDates(todayKey) {
    var dates = state.progress && state.progress.checkins ? state.progress.checkins.dates : {};
    return [-2, -1].map(function (offset) { return shiftLocalDateKey(todayKey, offset); })
      .filter(function (key) { return key && !hasOwn(dates, key); });
  }

  function isMakeupDateAllowed(key, todayKey, dates) {
    return Boolean(dateFromLocalKey(key)) && key < todayKey && !hasOwn(dates, key);
  }

  function checkinDateLabel(key) {
    var date = dateFromLocalKey(key);
    return date ? date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", weekday: "short" }) : key;
  }

  function updateCheckinEntry() {
    if (!state.progress) return;
    if (!state.progress.checkins) state.progress.checkins = freshCheckins();
    var stats = calculateCheckinStats(state.progress.checkins, localDateKey(new Date()));
    elements.checkinStreak.textContent = "连续打卡 " + stats.current + " 天";
  }

  function appendCheckinMetric(fragment, value, label) {
    var item = document.createElement("div");
    var strong = document.createElement("strong");
    var span = document.createElement("span");
    strong.textContent = value;
    span.textContent = label;
    item.appendChild(strong);
    item.appendChild(span);
    fragment.appendChild(item);
  }

  function renderCheckinDialog() {
    if (!state.progress) return;
    if (!state.progress.checkins) state.progress.checkins = freshCheckins();
    var today = localDateKey(new Date());
    var stats = calculateCheckinStats(state.progress.checkins, today);
    elements.checkinOverview.textContent = "";
    var overview = document.createDocumentFragment();
    appendCheckinMetric(overview, stats.current + " 天", "当前连续");
    appendCheckinMetric(overview, stats.longest + " 天", "最长连续");
    appendCheckinMetric(overview, stats.total + " 天", "累计打卡");
    elements.checkinOverview.appendChild(overview);

    elements.checkinHistory.textContent = "";
    var history = document.createDocumentFragment();
    for (var offset = -13; offset <= 0; offset += 1) {
      var key = shiftLocalDateKey(today, offset);
      var entry = state.progress.checkins.dates[key];
      var item = document.createElement("div");
      var day = document.createElement("strong");
      var mark = document.createElement("span");
      item.className = "checkin-day" + (entry ? " is-checked" : " is-missed") + (entry && entry.type === "makeup" ? " is-makeup" : "") + (offset === 0 ? " is-today" : "");
      day.textContent = checkinDateLabel(key);
      mark.textContent = entry ? entry.type === "makeup" ? "补" : "✓" : "—";
      item.title = entry ? (entry.type === "makeup" ? "补打卡" : "完成学习") : "未打卡";
      item.appendChild(mark);
      item.appendChild(day);
      history.appendChild(item);
    }
    elements.checkinHistory.appendChild(history);

    elements.makeupActions.textContent = "";
    var missing = availableMakeupDates(today);
    if (!missing.length) {
      var complete = document.createElement("span");
      complete.className = "makeup-complete";
      complete.textContent = "最近两天均已有打卡记录";
      elements.makeupActions.appendChild(complete);
    } else {
      missing.forEach(function (key) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "utility-button makeup-button";
        button.textContent = "补记 " + checkinDateLabel(key);
        button.addEventListener("click", function () { applyMakeupCheckin(key); });
        elements.makeupActions.appendChild(button);
      });
    }
    var latestMakeupDate = shiftLocalDateKey(today, -1);
    elements.makeupDate.max = latestMakeupDate;
    if (!elements.makeupDate.value || elements.makeupDate.value >= today) elements.makeupDate.value = latestMakeupDate;
    updateCheckinEntry();
  }

  function applyMakeupCheckin(key) {
    var today = localDateKey(new Date());
    if (!dateFromLocalKey(key) || key >= today) {
      elements.makeupStatus.textContent = "请选择今天以前的有效日期。";
      elements.makeupStatus.classList.add("status-error");
      elements.makeupStatus.hidden = false;
      return;
    }
    if (!isMakeupDateAllowed(key, today, state.progress.checkins.dates)) {
      elements.makeupStatus.textContent = checkinDateLabel(key) + " 已经有打卡记录，不需要重复补记。";
      elements.makeupStatus.classList.add("status-error");
      elements.makeupStatus.hidden = false;
      return;
    }
    state.progress.checkins.dates[key] = { type: "makeup", at: new Date().toISOString() };
    saveProgress();
    renderCheckinDialog();
    elements.makeupStatus.textContent = "已补记 " + checkinDateLabel(key) + "。学习量与 FSRS 记录没有改变。";
    elements.makeupStatus.classList.remove("status-error");
    elements.makeupStatus.hidden = false;
  }

  function openCheckinDialog() {
    elements.makeupStatus.hidden = true;
    renderCheckinDialog();
    if (typeof elements.checkinDialog.showModal === "function") {
      if (!elements.checkinDialog.open) elements.checkinDialog.showModal();
    } else {
      elements.checkinDialog.setAttribute("open", "");
    }
  }

  function closeCheckinDialog() {
    if (typeof elements.checkinDialog.close === "function") elements.checkinDialog.close();
    else elements.checkinDialog.removeAttribute("open");
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!("indexedDB" in window)) {
        reject(new Error("当前浏览器不支持本地词库存储"));
        return;
      }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(FILE_STORE)) request.result.createObjectStore(FILE_STORE);
        if (!request.result.objectStoreNames.contains(PROGRESS_STORE)) request.result.createObjectStore(PROGRESS_STORE);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function dbRequest(storeName, mode, action) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(storeName, mode);
        var store = transaction.objectStore(storeName);
        var request = action(store);
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
        transaction.oncomplete = function () { db.close(); };
        transaction.onerror = function () { db.close(); };
      });
    });
  }

  function rememberFile(file) {
    return dbRequest(FILE_STORE, "readwrite", function (store) {
      return store.put(
        { blob: file, name: file.name, size: file.size, lastModified: file.lastModified || 0 },
        ACTIVE_FILE_KEY
      );
    });
  }

  function dictionaryFileRecord(dictionary) {
    return {
      blob: dictionary.file,
      name: dictionary.name,
      size: dictionary.size,
      lastModified: dictionary.lastModified || 0,
      hash: dictionary.hash || ""
    };
  }

  function rememberDictionarySet() {
    var learning = dictionaryById(state.learningDictionaryId);
    if (!learning) return Promise.reject(new Error("请先选择学习词库。"));
    refreshReferenceDictionaries();
    var fileWrites = state.dictionaries.map(function (dictionary) {
      return dbRequest(FILE_STORE, "readwrite", function (store) {
        return store.put(dictionaryFileRecord(dictionary), DICTIONARY_FILE_PREFIX + dictionary.id);
      });
    });
    return Promise.all(fileWrites).then(function () {
      return dbRequest(FILE_STORE, "readwrite", function (store) {
        return store.put({
          version: 1,
          learningId: state.learningDictionaryId,
          dictionaries: state.dictionaries.map(function (dictionary) {
            return {
              id: dictionary.id,
              referenceEnabled: dictionary.referenceEnabled !== false,
              hash: dictionary.hash || "",
              compatibility: dictionary.compatibility || null
            };
          }),
          updatedAt: new Date().toISOString()
        }, DICTIONARY_SET_KEY);
      });
    }).then(function () { return rememberFile(learning.file); });
  }

  function fileFromRecord(record) {
    if (!record || !record.blob) return null;
    return new File([record.blob], record.name, {
      type: "application/octet-stream",
      lastModified: record.lastModified || Date.now()
    });
  }

  function restoreDictionarySet() {
    return dbRequest(FILE_STORE, "readonly", function (store) { return store.get(DICTIONARY_SET_KEY); })
      .catch(function () { return null; })
      .then(function (config) {
        if (!config || !Array.isArray(config.dictionaries) || !config.dictionaries.length) return null;
        return Promise.all(config.dictionaries.map(function (item) {
          return dbRequest(FILE_STORE, "readonly", function (store) {
            return store.get(DICTIONARY_FILE_PREFIX + item.id);
          }).catch(function () { return null; }).then(function (record) {
            var file = fileFromRecord(record);
            return file ? dictionaryDescriptor(file, {
              referenceEnabled: item.referenceEnabled !== false,
              hash: item.hash || (record && record.hash) || "",
              compatibility: item.compatibility || null
            }) : null;
          });
        })).then(function (dictionaries) {
          var available = dictionaries.filter(Boolean);
          if (!available.length) return null;
          return {
            dictionaries: available,
            learningId: available.some(function (dictionary) { return dictionary.id === config.learningId; })
              ? config.learningId
              : available[0].id
          };
        });
      });
  }

  function restoreFile() {
    return dbRequest(FILE_STORE, "readonly", function (store) { return store.get(ACTIVE_FILE_KEY); })
      .then(function (record) {
        return fileFromRecord(record);
      });
  }

  function loadProgress() {
    return dbRequest(PROGRESS_STORE, "readonly", function (store) { return store.get(state.fingerprint); })
      .catch(function () { return null; })
      .then(function (stored) {
        var saved = stored && stored.progress;
        if (!saved) {
          try {
            var raw = localStorage.getItem(progressKey());
            if (!raw && state.legacyFingerprint) {
              raw = localStorage.getItem("parola-progress:" + state.legacyFingerprint);
            }
            saved = raw ? JSON.parse(raw) : null;
          } catch (error) {
            saved = null;
          }
        }
        return normalizeProgress(saved);
      });
  }

  function saveProgress() {
    if (!state.progress || !state.fingerprint) return;
    var snapshot;
    var serialized;
    try {
      serialized = JSON.stringify(state.progress);
      snapshot = JSON.parse(serialized);
      if (serialized.length < 1500000) localStorage.setItem(progressKey(), serialized);
    } catch (error) {
      console.warn("Progress could not be serialized", error);
      return;
    }
    state.saveChain = state.saveChain.catch(function () {}).then(function () {
      return dbRequest(PROGRESS_STORE, "readwrite", function (store) {
        return store.put({ progress: snapshot, updatedAt: new Date().toISOString() }, state.fingerprint);
      });
    }).catch(function (error) {
      console.warn("Progress could not be saved to IndexedDB", error);
    });
  }

  function setImportStatus(message, isError) {
    elements.importStatus.textContent = message || "";
    elements.importStatus.classList.toggle("status-error", Boolean(isError));
    elements.importStatus.hidden = !message;
  }

  function setProgressStatus(message, isError) {
    elements.progressStatus.textContent = message || "";
    elements.progressStatus.classList.toggle("status-error", Boolean(isError));
    elements.progressStatus.hidden = !message;
  }

  function progressFilePayload() {
    return {
      format: PROGRESS_FORMAT,
      version: PROGRESS_VERSION,
      exportedAt: new Date().toISOString(),
      dictionary: {
        name: state.file.name,
        size: state.file.size,
        fingerprint: state.fingerprint,
        wordCount: state.sourceWords.length
      },
      references: state.referenceDictionaries.map(function (dictionary, index) {
        return {
          name: dictionary.name,
          size: dictionary.size,
          fingerprint: dictionary.id,
          hash: dictionary.hash || "",
          order: index
        };
      }),
      progress: state.progress
    };
  }

  function exportProgressFile() {
    if (!state.file || !state.progress) return;
    saveProgress();
    var blob = new Blob([JSON.stringify(progressFilePayload(), null, 2)], { type: "application/json;charset=utf-8" });
    var link = document.createElement("a");
    var date = localDateKey(new Date());
    var dictionaryName = state.file.name.replace(/\.mdx$/i, "").replace(/[\\/:*?\"<>|]+/g, "-");
    var objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = "Parola-进度-" + dictionaryName + "-" + date + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
    setProgressStatus("进度文件已导出，包含 FSRS 状态、复习记录和固定乱序种子。", false);
  }

  function parseProgressFile(file) {
    return file.text().then(function (text) {
      var payload;
      try { payload = JSON.parse(text); }
      catch (error) { throw new Error("这不是有效的 JSON 进度文件。"); }
      if (!payload || payload.format !== PROGRESS_FORMAT || [1, 2, 3, 4].indexOf(Number(payload.version)) < 0) {
        throw new Error("这不是受支持的 Parola 进度文件。");
      }
      if (!payload.dictionary || !payload.progress) throw new Error("进度文件缺少词库或学习记录。");
      return payload;
    });
  }

  function dictionaryMatches(payload) {
    var dictionary = payload.dictionary || {};
    if (dictionary.fingerprint) return dictionary.fingerprint === state.fingerprint;
    return dictionary.name === state.file.name && Number(dictionary.size) === state.file.size;
  }

  function applyImportedProgress(payload) {
    if (!dictionaryMatches(payload)) {
      throw new Error("进度文件属于“" + (payload.dictionary.name || "另一个词库") + "”，请导入对应的 MDX 文件。");
    }
    state.progress = normalizeProgress(payload.progress);
    ensureDaily();
    applyStudyOrder();
    var missingReferences = applyImportedReferencePreferences(payload);
    syncSettingsUI();
    saveProgress();
    return missingReferences;
  }

  function applyImportedReferencePreferences(payload) {
    if (!Array.isArray(payload && payload.references)) return [];
    var missing = [];
    var ordered = [];
    payload.references.slice().sort(function (a, b) { return Number(a.order) - Number(b.order); }).forEach(function (reference) {
      var match = state.dictionaries.find(function (dictionary) {
        return dictionary.id === reference.fingerprint || (dictionary.name === reference.name && dictionary.size === Number(reference.size));
      });
      if (!match) { missing.push(reference.name || "未命名词库"); return; }
      match.referenceEnabled = true;
      if (match.id !== state.learningDictionaryId && ordered.indexOf(match) < 0) ordered.push(match);
    });
    state.dictionaries.forEach(function (dictionary) {
      if (dictionary.id !== state.learningDictionaryId && ordered.indexOf(dictionary) < 0) ordered.push(dictionary);
    });
    var learning = dictionaryById(state.learningDictionaryId);
    state.dictionaries = (learning ? [learning] : []).concat(ordered);
    refreshReferenceDictionaries();
    renderDictionaryManager();
    return missing;
  }

  function handleProgressFile(file, queueUntilDictionary) {
    if (!file) return;
    parseProgressFile(file).then(function (payload) {
      if (queueUntilDictionary || !state.file || !state.progress) {
        state.pendingProgressImport = payload;
        setImportStatus("已读取进度文件。现在请选择“" + payload.dictionary.name + "”词库，随后会自动恢复。", false);
        return;
      }
      var missingReferences = applyImportedProgress(payload);
      showNextWord();
      setProgressStatus("进度已恢复，FSRS 复习日期和两种题型记录已载入。" + (missingReferences.length ? " 尚缺少 " + missingReferences.length + " 部参考词典，可稍后导入。" : ""), false);
    }).catch(function (error) {
      if (state.file && state.progress) setProgressStatus(error.message, true);
      else setImportStatus(error.message, true);
    });
  }

  function cleanWord(value) {
    return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
  }

  function isStudyWord(word) {
    if (!word || word.length > 72 || word.charAt(0) === "_") return false;
    if (/[\u3400-\u9fff]/.test(word)) return false;
    return /^[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ'’ -]+$/u.test(word) && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(word);
  }

  function uniqueStudyWords(entries) {
    var seen = new Set();
    var words = [];
    entries.forEach(function (entry) {
      var word = cleanWord(entry);
      var key = word.toLocaleLowerCase("it-IT");
      if (isStudyWord(word) && !seen.has(key)) {
        seen.add(key);
        words.push(word);
      }
    });
    return words;
  }

  function parseDictionary(file) {
    elements.loadingMessage.textContent = "正在读取词典结构……";
    return MParser([file]).then(function (resources) {
      if (!resources.mdx) throw new Error("没有找到可用的 MDX 内容");
      return resources.mdx;
    }).then(function (lookup) {
      state.lookup = lookup;
      elements.loadingMessage.textContent = "正在准备学习词条……";
      return lookup({ phrase: "", max: MAX_WORDS });
    }).then(function (entries) {
      state.dictionaryCapped = entries.length >= MAX_WORDS;
      state.sourceWords = uniqueStudyWords(entries);
      if (!state.sourceWords.length) throw new Error("没有识别到适合学习的意大利语词条");
    });
  }

  function fileFingerprint(file) { return [file.name, file.size].join(":"); }
  function legacyFileFingerprint(file) { return [file.name, file.size, file.lastModified || 0].join(":"); }

  function importDictionary(fileOrDictionary, shouldRemember) {
    if (!fileOrDictionary) return;
    var dictionary = fileOrDictionary.file ? fileOrDictionary : dictionaryDescriptor(fileOrDictionary);
    var file = dictionary.file;
    if (!/\.mdx$/i.test(file.name)) { showError("请选择扩展名为 .mdx 的词典文件。"); return; }
    if (!window.FSRS) { showError("FSRS 调度组件没有加载成功，请刷新页面后重试。"); return; }
    if (state.completionTimer) {
      clearTimeout(state.completionTimer);
      state.completionTimer = null;
    }
    if (!dictionaryById(dictionary.id)) state.dictionaries.push(dictionary);
    state.learningDictionaryId = dictionary.id;
    dictionary.referenceEnabled = true;
    refreshReferenceDictionaries();
    state.file = file;
    state.fingerprint = dictionary.id;
    state.legacyFingerprint = legacyFileFingerprint(file);
    state.definitionCache = Object.create(null);
    showView("loadingView");

    parseDictionary(file).then(function () { return loadProgress(); }).then(function (progress) {
      var restoreMessage = "";
      var restoreFailed = false;
      state.progress = progress;
      if (state.pendingProgressImport) {
        try {
          var missingReferences = applyImportedProgress(state.pendingProgressImport);
          restoreMessage = "进度已恢复，FSRS 状态和题型记录已载入。" + (missingReferences.length ? " 尚缺少 " + missingReferences.length + " 部参考词典。" : "");
          state.pendingProgressImport = null;
        } catch (error) {
          restoreMessage = error.message;
          restoreFailed = true;
        }
      }
      ensureDaily();
      applyStudyOrder();
      if (shouldRemember) rememberDictionarySet().catch(function (error) { console.warn("Dictionary set could not be remembered", error); });
      startStudy();
      saveProgress();
      if (restoreMessage) setProgressStatus(restoreMessage, restoreFailed);
    }).catch(function (error) {
      console.error(error);
      showError(error && /FSRS/.test(error.message) ? error.message : "无法解析这个词库。它可能使用了加密、特殊压缩格式，或不是标准的 MDict 2.0 文件。");
    });
  }

  function showError(message) { elements.errorMessage.textContent = message; showView("errorView"); }

  function syncSettingsUI() {
    if (!state.progress) return;
    elements.settingNew.value = state.progress.settings.dailyNew;
    elements.settingReview.value = state.progress.settings.dailyReview;
    elements.settingRetention.value = Math.round(state.progress.settings.requestRetention * 100);
  }

  function startStudy() {
    refreshReferenceDictionaries();
    elements.dictName.textContent = state.file.name.replace(/\.mdx$/i, "");
    elements.countLabel.textContent = "稳定掌握";
    elements.dictionaryNote.textContent = (state.dictionaryCapped
      ? "每个词库先读取前 7000 个词条；FSRS 会按到期时间安排复习。"
      : "共读取 " + state.words.length + " 个词条；新词顺序固定，复习由 FSRS 安排。")
      + (state.referenceDictionaries.length ? " 已启用 " + state.referenceDictionaries.length + " 部参考词典。" : "");
    elements.dictionaryCompatibility.hidden = true;
    renderDictionaryManager();
    syncSettingsUI();
    showView("studyView");
    setProgressStatus("");
    showNextWord();
    scanLearningCompatibility(dictionaryById(state.learningDictionaryId)).catch(function (error) {
      console.warn("Dictionary compatibility scan failed", error);
      elements.dictionaryCompatibility.textContent = "暂时无法完成拼写提示兼容率抽样；学习功能不受影响。";
      elements.dictionaryCompatibility.classList.add("status-error");
      elements.dictionaryCompatibility.hidden = false;
    });
    Promise.all(state.dictionaries.map(ensureDictionaryHash)).then(function () {
      return rememberDictionarySet();
    }).catch(function () {});
  }

  function cardIsDue(record, now) { return validDate(record.fsrs.due).getTime() <= now.getTime(); }

  function dueRecords(now) {
    return Object.keys(state.progress.cards).map(function (word) {
      return { word: word, record: state.progress.cards[word] };
    }).filter(function (item) { return cardIsDue(item.record, now); }).sort(function (a, b) {
      var stateA = Number(a.record.fsrs.state);
      var stateB = Number(b.record.fsrs.state);
      var urgentA = stateA === window.FSRS.State.Learning || stateA === window.FSRS.State.Relearning ? 0 : 1;
      var urgentB = stateB === window.FSRS.State.Learning || stateB === window.FSRS.State.Relearning ? 0 : 1;
      if (urgentA !== urgentB) return urgentA - urgentB;
      return validDate(a.record.fsrs.due).getTime() - validDate(b.record.fsrs.due).getTime();
    });
  }

  function nextUnseenWord(now) {
    while (state.progress.cursor < state.words.length) {
      var word = state.words[state.progress.cursor];
      state.progress.cursor += 1;
      if (!hasOwn(state.progress.cards, word)) {
        state.progress.cards[word] = freshRecord(now);
        if (state.progress.daily.newWords.indexOf(word) < 0) state.progress.daily.newWords.push(word);
        return { word: word, record: state.progress.cards[word] };
      }
    }
    return null;
  }

  function dailyNewLimit() {
    return state.progress.settings.dailyNew + Math.max(0, Number(state.progress.daily.extraNew) || 0);
  }

  function dailyReviewLimit() {
    return state.progress.settings.dailyReview + Math.max(0, Number(state.progress.daily.extraReview) || 0);
  }

  function removeQueuedReview(word) {
    var index = state.progress.studyQueue.findIndex(function (item) {
      return item.type === "review" && item.word === word;
    });
    if (index >= 0) state.progress.studyQueue.splice(index, 1);
  }

  function nextQueuedCard(now) {
    while (state.progress.studyQueue.length) {
      var item = state.progress.studyQueue.shift();
      if (item.type === "new") {
        var unseen = nextUnseenWord(now);
        if (unseen) return { word: unseen.word, record: unseen.record, mode: "meaning" };
      } else if (item.type === "review") {
        var record = getRecord(item.word);
        if (record && Number(record.fsrs.reps) > 0) {
          return { word: item.word, record: record, mode: chooseMode(record) };
        }
      }
    }
    return null;
  }

  function selectNextCard(now) {
    ensureDaily();
    var pending = state.progress.pending;
    if (pending && hasOwn(state.progress.cards, pending.word)) {
      return { word: pending.word, record: state.progress.cards[pending.word], mode: pending.mode === "spelling" ? "spelling" : "meaning" };
    }
    var due = dueRecords(now);
    if (due.length) {
      var urgent = due.find(function (item) {
        var cardState = Number(item.record.fsrs.state);
        return cardState === window.FSRS.State.Learning || cardState === window.FSRS.State.Relearning;
      });
      if (urgent) {
        removeQueuedReview(urgent.word);
        return { word: urgent.word, record: urgent.record, mode: chooseMode(urgent.record) };
      }
    }
    if (state.progress.studyQueue.length) {
      var queued = nextQueuedCard(now);
      if (queued) return queued;
    }
    if (due.length) {
      if (state.progress.daily.reviewCount < dailyReviewLimit()) {
        var selectedDue = due[0];
        return { word: selectedDue.word, record: selectedDue.record, mode: chooseMode(selectedDue.record) };
      }
    }
    if (state.progress.daily.newWords.length < dailyNewLimit()) {
      var unseen = nextUnseenWord(now);
      if (unseen) return { word: unseen.word, record: unseen.record, mode: "meaning" };
    }
    return null;
  }

  function resetCardUI() {
    state.currentDefinition = "";
    state.currentAnswerResult = "";
    elements.currentWord.classList.remove("spelling-prompt", "completion-title");
    elements.definitionWrap.hidden = true;
    elements.revealActions.hidden = true;
    elements.gradeActions.hidden = true;
    elements.spellingForm.hidden = true;
    elements.spellingFeedback.hidden = true;
    elements.completeActions.hidden = true;
    elements.speakButton.hidden = false;
    elements.spellingInput.disabled = false;
    elements.spellingInput.value = "";
    elements.spellingFeedback.className = "spelling-feedback";
    elements.spellingFeedbackText.textContent = "";
    elements.spellingAnswer.textContent = "";
    elements.completionCelebration.hidden = true;
    state.referenceRenderToken += 1;
    elements.referenceDictionaries.open = false;
    elements.referenceDictionaries.hidden = true;
    elements.referenceDictionaryList.textContent = "";
    gradeButtons.forEach(function (button) { button.classList.remove("recommended"); });
  }

  function definitionToText(definitions) {
    var html = (definitions || []).join("<hr>");
    if (!html) return "这个词条没有可显示的释义。";
    var doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, noscript, iframe, object, embed").forEach(function (node) { node.remove(); });
    doc.querySelectorAll("br, p, div, li, hr").forEach(function (node) { node.appendChild(doc.createTextNode("\n")); });
    return (doc.body.textContent || "").replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function getDefinition(word) {
    if (hasOwn(state.definitionCache, word)) return Promise.resolve(state.definitionCache[word]);
    return state.lookup(word).then(function (definitions) {
      var text = definitionToText(definitions);
      state.definitionCache[word] = text;
      return text;
    }).catch(function (error) {
      console.error(error);
      return "暂时没有找到这个词的释义。";
    });
  }

  function loadReferenceLookup(dictionary) {
    if (dictionary.lookup) return Promise.resolve(dictionary.lookup);
    if (dictionary.lookupPromise) return dictionary.lookupPromise;
    dictionary.lookupPromise = MParser([dictionary.file]).then(function (resources) {
      if (!resources.mdx) throw new Error("没有找到可用的 MDX 内容");
      dictionary.lookup = resources.mdx;
      return dictionary.lookup;
    }).catch(function (error) {
      dictionary.lookupPromise = null;
      throw error;
    });
    return dictionary.lookupPromise;
  }

  function getReferenceDefinition(dictionary, word) {
    var key = normalizeExact(word);
    if (hasOwn(dictionary.definitionCache, key)) return Promise.resolve(dictionary.definitionCache[key]);
    return loadReferenceLookup(dictionary).then(function (lookup) { return lookup(word); }).then(function (definitions) {
      var text = definitions && definitions.length ? definitionToText(definitions) : "这部词典没有收录当前单词。";
      dictionary.definitionCache[key] = text;
      return text;
    });
  }

  function referenceDictionaryRow(dictionary, word, token) {
    var details = document.createElement("details");
    var summary = document.createElement("summary");
    var name = document.createElement("strong");
    var status = document.createElement("small");
    var content = document.createElement("div");
    var loaded = false;

    details.className = "reference-dictionary-item";
    name.textContent = dictionaryDisplayName(dictionary);
    status.textContent = "点击读取";
    content.className = "reference-dictionary-content";
    content.textContent = "正在等待展开……";
    summary.appendChild(name);
    summary.appendChild(status);
    details.appendChild(summary);
    details.appendChild(content);
    details.addEventListener("toggle", function () {
      if (!details.open || loaded) return;
      loaded = true;
      status.textContent = "正在读取";
      content.textContent = "正在读取这部词典……";
      getReferenceDefinition(dictionary, word).then(function (definition) {
        if (token !== state.referenceRenderToken || word !== state.currentWord) return;
        content.textContent = definition;
        status.textContent = definition === "这部词典没有收录当前单词。" ? "未收录" : "已找到";
      }).catch(function (error) {
        if (token !== state.referenceRenderToken || word !== state.currentWord) return;
        console.error(error);
        content.textContent = "暂时无法读取这部词典。";
        status.textContent = "读取失败";
      });
    });
    return details;
  }

  function showReferenceDictionaries() {
    refreshReferenceDictionaries();
    elements.referenceDictionaryList.textContent = "";
    if (!state.referenceDictionaries.length || !state.currentWord) {
      elements.referenceDictionaries.hidden = true;
      return;
    }
    var token = state.referenceRenderToken;
    var fragment = document.createDocumentFragment();
    state.referenceDictionaries.forEach(function (dictionary) {
      fragment.appendChild(referenceDictionaryRow(dictionary, state.currentWord, token));
    });
    elements.referenceDictionaryList.appendChild(fragment);
    elements.referenceDictionaryCount.textContent = state.referenceDictionaries.length + " 部参考词典";
    elements.referenceDictionaries.hidden = false;
  }

  function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function detectWordClass(definition) {
    var prefix = String(definition || "").slice(0, 500);
    if (/\b(?:V\.\s*(?:TR|INTR|RIFL)|v\.\s*(?:tr|intr)|\[v\.\])/i.test(prefix)) return "动词";
    if (/\b(?:S\.[MF]|s\.[mf]|\[n\.\])/i.test(prefix)) return "名词";
    if (/\b(?:AGG|agg\.|\[adj\.\])/i.test(prefix)) return "形容词";
    if (/\b(?:AVV|avv\.|\[adv\.\])/i.test(prefix)) return "副词";
    return "";
  }

  function cleanChineseClue(line, word) {
    var value = String(line || "").replace(new RegExp(escapeRegExp(word), "gi"), " ");
    var firstChinese = value.search(/[\u3400-\u9fff]/);
    if (firstChinese >= 0) value = value.slice(firstChinese);
    value = value.replace(/[◣◆▎★]+/g, " ").replace(/\s+/g, " ").trim();
    value = value.replace(/^(?:意汉|汉意|同义词|词典)\s*/i, "").trim();
    if (value.length > 72) {
      value = value.slice(0, 72).replace(/[，,;；][^，,;；]*$/, "").trim() + "…";
    }
    return value;
  }

  function analyzeChineseClue(definition, word) {
    var empty = { clue: "", confidence: "none", reason: "没有中文释义", wordClass: "" };
    if (!definition || definition === "暂时没有找到这个词的释义。" || definition === "这个词条没有可显示的释义。") return empty;
    var text = String(definition).replace(/\u0000/g, "");
    var lines = text.split(/\n+/).map(function (line) { return line.replace(/\s+/g, " ").trim(); }).filter(Boolean);
    var wordClass = detectWordClass(text);
    var firstLines = lines.slice(0, 4).join(" ");
    if (/^[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ'’ -]+(?:\s*\/\s*[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ'’ -]+){1,}/u.test(firstLines)) {
      return { clue: "", confidence: "low", reason: "词条同时辨析多个意大利语近义词", wordClass: wordClass };
    }

    var summary = lines.find(function (line) { return /★★/.test(line) && /[\u3400-\u9fff]/.test(line); });
    if (summary) {
      var summaryParts = summary.split(/★★+/).map(function (part) { return cleanChineseClue(part, word); })
        .filter(function (part) { return /[\u3400-\u9fff]/.test(part) && !/词典/.test(part); }).slice(0, 3);
      if (summaryParts.length) return { clue: summaryParts.join("；"), confidence: "high", reason: "词条开头有简明中文摘要", wordClass: wordClass };
    }

    var numbered = lines.find(function (line) {
      return /^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\s*)?(?:[（(]?\d+[）).、]|[①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽])/.test(line)
        && /[\u3400-\u9fff]/.test(line);
    });
    if (numbered) {
      var numberedClue = cleanChineseClue(numbered, word);
      if (numberedClue) return { clue: numberedClue, confidence: "high", reason: "提取第一个正式中文义项", wordClass: wordClass };
    }

    var tagged = lines.find(function (line) {
      return /(?:\[(?:n|v|adj|adv)\.\]|\b(?:s\.[mf]|v\.(?:tr|intr)|agg\.|avv\.)\b)/i.test(line)
        && /[\u3400-\u9fff]/.test(line);
    });
    if (tagged) {
      var taggedClue = cleanChineseClue(tagged, word);
      if (taggedClue) return { clue: taggedClue, confidence: "high", reason: "词性行包含简明中文释义", wordClass: wordClass };
    }

    var fallback = lines.find(function (line) {
      if (!/[\u3400-\u9fff]/.test(line) || /(?:词典|例句|TEMPI|Clicca|点击)/i.test(line)) return false;
      var latinCount = (line.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
      return line.length <= 120 && latinCount <= 24 && !/^▎/.test(line);
    });
    if (fallback) {
      var fallbackClue = cleanChineseClue(fallback, word);
      if (fallbackClue) return { clue: fallbackClue, confidence: "medium", reason: "使用首个较短中文释义", wordClass: wordClass };
    }
    var hasChinese = /[\u3400-\u9fff]/.test(text);
    return { clue: "", confidence: hasChinese ? "low" : "none", reason: hasChinese ? "只有长篇说明或例句，无法生成可靠提示" : "没有中文释义", wordClass: wordClass };
  }

  function extractChineseClue(definition, word) {
    var analysis = analyzeChineseClue(definition, word);
    return analysis.confidence === "high" || analysis.confidence === "medium" ? analysis.clue : "";
  }

  function compatibilitySample(words, maximum) {
    if (words.length <= maximum) return words.slice();
    var sample = [];
    var step = words.length / maximum;
    for (var index = 0; index < maximum; index += 1) sample.push(words[Math.floor(index * step)]);
    return sample;
  }

  function showCompatibilityResult(dictionary) {
    var result = dictionary && dictionary.compatibility;
    if (!result) return;
    elements.dictionaryCompatibility.hidden = false;
    elements.dictionaryCompatibility.classList.toggle("status-error", result.usablePercent < 40);
    elements.dictionaryCompatibility.textContent = "拼写提示抽样：约 " + result.usablePercent + "% 可用（抽查 " + result.sampleSize
      + " 个词条）" + (result.usablePercent < 40 ? "。这部词典更适合作为参考词库，无法生成提示的单词会自动改用意大利语→中文。" : "。低可靠词条会自动改用意大利语→中文。");
  }

  function scanLearningCompatibility(dictionary) {
    if (!dictionary || !state.lookup || !state.sourceWords.length) return Promise.resolve(null);
    if (dictionary.compatibility) {
      state.compatibilityByFingerprint[dictionary.id] = dictionary.compatibility;
      showCompatibilityResult(dictionary);
      return Promise.resolve(dictionary.compatibility);
    }
    var token = ++state.compatibilityScanToken;
    var fingerprint = dictionary.id;
    var lookup = state.lookup;
    var words = compatibilitySample(state.sourceWords, 120);
    var counts = { high: 0, medium: 0, low: 0, none: 0 };
    var position = 0;
    elements.dictionaryCompatibility.hidden = false;
    elements.dictionaryCompatibility.classList.remove("status-error");
    elements.dictionaryCompatibility.textContent = "正在抽样检查这部词库能否生成可靠的中文拼写提示……";

    function nextBatch() {
      if (token !== state.compatibilityScanToken || fingerprint !== state.fingerprint) return Promise.resolve(null);
      var batch = words.slice(position, position + 8);
      position += batch.length;
      if (!batch.length) {
        var usable = counts.high + counts.medium;
        var result = {
          sampleSize: words.length,
          usablePercent: words.length ? Math.round(usable * 100 / words.length) : 0,
          high: counts.high,
          medium: counts.medium,
          low: counts.low,
          none: counts.none,
          scannedAt: new Date().toISOString()
        };
        dictionary.compatibility = result;
        state.compatibilityByFingerprint[dictionary.id] = result;
        showCompatibilityResult(dictionary);
        renderDictionaryManager();
        rememberDictionarySet().catch(function () {});
        return result;
      }
      return Promise.all(batch.map(function (word) {
        return lookup(word).then(function (definitions) {
          var analysis = analyzeChineseClue(definitionToText(definitions), word);
          counts[hasOwn(counts, analysis.confidence) ? analysis.confidence : "none"] += 1;
        }).catch(function () { counts.none += 1; });
      })).then(nextBatch);
    }
    return nextBatch();
  }

  function spellingPattern(word) {
    return Array.from(word).map(function (character) {
      if (/\s/.test(character)) return "\u00a0\u00a0 ";
      if (/[\-'’]/.test(character)) return character;
      return "_";
    }).join(" ");
  }

  function renderMeaningCard(selection, token) {
    elements.wordPosition.textContent = (selection.record.fsrs.reps ? "复习" : "新词") + " · 看意大利语想中文";
    elements.currentWord.textContent = selection.word;
    elements.wordHint.textContent = "先想一想它的中文意思";
    elements.revealActions.hidden = false;
    elements.speakButton.hidden = false;
    state.currentDefinitionPromise.then(function (definition) {
      if (token === state.cardToken) state.currentDefinition = definition;
    });
  }

  function renderSpellingCard(selection, token) {
    elements.wordPosition.textContent = "复习 · 看中文拼意大利语";
    elements.currentWord.textContent = "正在准备中文提示……";
    elements.currentWord.classList.add("spelling-prompt");
    elements.wordHint.textContent = spellingPattern(selection.word);
    elements.speakButton.hidden = true;
    state.currentDefinitionPromise.then(function (definition) {
      if (token !== state.cardToken) return;
      var clueAnalysis = analyzeChineseClue(definition, selection.word);
      var clue = clueAnalysis.confidence === "high" || clueAnalysis.confidence === "medium" ? clueAnalysis.clue : "";
      state.currentDefinition = definition;
      if (!clue) {
        state.currentMode = "meaning";
        state.progress.pending.mode = "meaning";
        saveProgress();
        resetCardUI();
        renderMeaningCard(selection, token);
        elements.wordHint.textContent = clueAnalysis.reason + "，已改为意大利语→中文";
        return;
      }
      elements.wordPosition.textContent = "复习 · 看中文拼意大利语" + (clueAnalysis.wordClass ? " · " + clueAnalysis.wordClass : "");
      elements.currentWord.textContent = clue;
      elements.wordHint.textContent = spellingPattern(selection.word);
      elements.spellingInput.placeholder = "输入 " + Array.from(selection.word).filter(function (c) {
        return /[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]/.test(c);
      }).length + " 个字母";
      elements.spellingForm.hidden = false;
    });
  }

  function showNextWord() {
    if (!state.progress) return;
    if (state.completionTimer) {
      clearTimeout(state.completionTimer);
      state.completionTimer = null;
    }
    resetCardUI();
    ensureDaily();
    var now = new Date();
    var selection = selectNextCard(now);
    updateStats();
    if (!selection) { renderCompletion(now); saveProgress(); return; }
    state.completed = false;
    state.currentWord = selection.word;
    state.currentMode = selection.mode;
    state.currentStartedAt = Date.now();
    state.progress.pending = { word: selection.word, mode: selection.mode };
    state.cardToken += 1;
    var token = state.cardToken;
    state.currentDefinitionPromise = getDefinition(selection.word);
    if (selection.mode === "spelling") renderSpellingCard(selection, token);
    else renderMeaningCard(selection, token);
    updateStats();
    saveProgress();
  }

  function renderCompletion(now) {
    state.completed = true;
    state.currentWord = "";
    state.progress.pending = null;
    var newlyChecked = recordTodayCheckin();
    var checkinStats = calculateCheckinStats(state.progress.checkins, localDateKey(now));
    elements.wordPosition.textContent = checkinStats.todayChecked ? "今日学习" : "FSRS 今日安排";
    elements.currentWord.textContent = checkinStats.todayChecked ? "恭喜，今日学习完成！" : "今日任务完成";
    elements.currentWord.classList.add("completion-title");
    elements.speakButton.hidden = true;
    elements.completeActions.hidden = false;
    elements.completionCelebration.hidden = !checkinStats.todayChecked;
    elements.completionCheckinMessage.textContent = newlyChecked ? "今天已成功打卡" : "今天已经打过卡";
    elements.completionStreakMessage.textContent = "连续学习 " + checkinStats.current + " 天 · 累计 " + checkinStats.total + " 天";
    updateCheckinEntry();
    var due = dueRecords(now);
    var future = Object.keys(state.progress.cards).map(function (word) {
      return validDate(state.progress.cards[word].fsrs.due);
    }).filter(function (date) { return date.getTime() > now.getTime(); }).sort(function (a, b) { return a - b; });
    if (due.length) elements.wordHint.textContent = "已达到今日复习目标，仍有 " + due.length + " 个到期词；可在学习设置中提高复习数。";
    else if (future.length) elements.wordHint.textContent = "下一项复习将在 " + formatDue(future[0], now) + "。";
    else if (state.progress.cursor >= state.words.length) elements.wordHint.textContent = "当前词库已经全部进入学习计划。";
    else elements.wordHint.textContent = "新词和复习目标都完成了，明天继续。";
    if (!due.length && future.length) {
      var delay = Math.max(250, future[0].getTime() - now.getTime() + 250);
      state.completionTimer = setTimeout(showNextWord, Math.min(delay, 6 * 60 * 60 * 1000));
    }
  }

  function countDue(now) {
    var pendingWord = state.progress.pending && state.progress.pending.word;
    return dueRecords(now || new Date()).filter(function (item) {
      return item.word !== pendingWord;
    }).length;
  }

  function updateStats() {
    if (!state.progress) return;
    var records = Object.keys(state.progress.cards).map(function (word) { return state.progress.cards[word]; });
    var stable = records.filter(function (record) {
      return Number(record.fsrs.state) === window.FSRS.State.Review && Number(record.fsrs.stability) >= 30;
    }).length;
    var touched = records.length;
    var total = state.words.length;
    var percent = total ? Math.min(100, (touched / total) * 100) : 0;
    elements.knownCount.textContent = stable;
    elements.progressLabel.textContent = touched + " / " + total;
    elements.progressBar.style.width = percent.toFixed(2) + "%";
    elements.dailySummary.textContent = "今日新词 " + state.progress.daily.newWords.length + " / " + dailyNewLimit() + " · 复习 " + state.progress.daily.reviewCount + " / " + dailyReviewLimit() + " · 当前到期 " + countDue(new Date());
    updateCheckinEntry();
  }

  function optionalReviewWords(count, now) {
    var todayWords = new Set(state.progress.daily.newWords || []);
    var candidates = Object.keys(state.progress.cards).map(function (word) {
      return { word: word, record: state.progress.cards[word] };
    }).filter(function (item) {
      return Number(item.record.fsrs.reps) > 0 && (!state.progress.pending || state.progress.pending.word !== item.word);
    });
    candidates.sort(function (a, b) {
      var dueA = cardIsDue(a.record, now) ? 0 : 1;
      var dueB = cardIsDue(b.record, now) ? 0 : 1;
      var ratingA = Number(a.record.lastRating) || 5;
      var ratingB = Number(b.record.lastRating) || 5;
      var failuresA = (Number(a.record.stats.meaningFailures) || 0) + (Number(a.record.stats.spellingFailures) || 0);
      var failuresB = (Number(b.record.stats.meaningFailures) || 0) + (Number(b.record.stats.spellingFailures) || 0);
      var stabilityA = Number(a.record.fsrs.stability) || 0;
      var stabilityB = Number(b.record.fsrs.stability) || 0;
      var lastA = a.record.fsrs.last_review ? validDate(a.record.fsrs.last_review).getTime() : 0;
      var lastB = b.record.fsrs.last_review ? validDate(b.record.fsrs.last_review).getTime() : 0;
      return dueA - dueB || ratingA - ratingB || failuresB - failuresA || stabilityA - stabilityB || lastA - lastB;
    });
    var older = candidates.filter(function (item) { return !todayWords.has(item.word); });
    var recent = candidates.filter(function (item) { return todayWords.has(item.word); });
    return older.concat(recent).slice(0, count).map(function (item) { return item.word; });
  }

  function unseenWordCount() {
    return state.words.reduce(function (count, word) {
      return count + (hasOwn(state.progress.cards, word) ? 0 : 1);
    }, 0);
  }

  function startMixedExtraSession() {
    ensureDaily();
    var newCount = Math.min(5, unseenWordCount());
    if (!newCount) {
      setProgressStatus("当前词库已经没有尚未学习的新词。", true);
      return;
    }
    var reviewWords = optionalReviewWords(newCount, new Date());
    var queue = [];
    for (var index = 0; index < newCount; index += 1) {
      queue.push({ type: "new" });
      if (reviewWords[index]) queue.push({ type: "review", word: reviewWords[index] });
    }
    state.progress.daily.extraNew += newCount;
    state.progress.daily.extraReview += reviewWords.length;
    state.progress.studyQueue = state.progress.studyQueue.concat(queue);
    saveProgress();
    setProgressStatus(
      "已加入 " + newCount + " 个新词，并穿插 " + reviewWords.length + " 个较薄弱旧词。额外额度只在今天有效。",
      false
    );
    showNextWord();
  }

  function startReviewExtraSession() {
    ensureDaily();
    var reviewWords = optionalReviewWords(10, new Date());
    if (!reviewWords.length) {
      setProgressStatus("目前还没有可以复习的旧词；先完成一些新词后再来。", true);
      return;
    }
    state.progress.daily.extraReview += reviewWords.length;
    state.progress.studyQueue = state.progress.studyQueue.concat(reviewWords.map(function (word) {
      return { type: "review", word: word };
    }));
    saveProgress();
    setProgressStatus("已加入 " + reviewWords.length + " 个较薄弱旧词；到期、曾答错和稳定度较低的词会优先。", false);
    showNextWord();
  }

  function libraryStatus(word, record, now) {
    if (!record) return { key: "unseen", label: "未学习", rank: 0 };
    if (state.progress.pending && state.progress.pending.word === word) {
      return { key: "learning", label: "当前学习", rank: 2 };
    }
    var cardState = Number(record.fsrs.state);
    if (cardIsDue(record, now) && cardState !== window.FSRS.State.New) {
      return { key: "due", label: "现在到期", rank: 1 };
    }
    if (cardState === window.FSRS.State.Learning) {
      return { key: "learning", label: "学习中", rank: 2 };
    }
    if (cardState === window.FSRS.State.Relearning) {
      return { key: "learning", label: "重新学习", rank: 1 };
    }
    if (cardState === window.FSRS.State.New || Number(record.fsrs.reps) === 0) {
      return { key: "learning", label: "新词", rank: 2 };
    }
    if (cardState === window.FSRS.State.Review && Number(record.fsrs.stability) >= 30) {
      return { key: "mastered", label: "稳定掌握", rank: 4 };
    }
    return { key: "reviewing", label: "复习中", rank: 3 };
  }

  function libraryEntries(now) {
    return state.words.map(function (word, index) {
      var record = getRecord(word);
      return {
        word: word,
        index: index,
        record: record,
        status: libraryStatus(word, record, now),
        due: record ? validDate(record.fsrs.due) : null
      };
    });
  }

  function renderLibraryOverview(entries) {
    var started = entries.filter(function (entry) { return Boolean(entry.record); }).length;
    var due = entries.filter(function (entry) { return entry.status.key === "due"; }).length;
    var mastered = entries.filter(function (entry) { return entry.status.key === "mastered"; }).length;
    var values = [
      { value: entries.length, label: "词库总数" },
      { value: started, label: "已经开始" },
      { value: due, label: "现在到期" },
      { value: mastered, label: "稳定掌握" }
    ];
    elements.libraryProgressOverview.textContent = "";
    var fragment = document.createDocumentFragment();
    values.forEach(function (item) {
      var box = document.createElement("div");
      var number = document.createElement("strong");
      var label = document.createElement("span");
      box.className = "library-overview-item";
      number.textContent = item.value;
      label.textContent = item.label;
      box.appendChild(number);
      box.appendChild(label);
      fragment.appendChild(box);
    });
    elements.libraryProgressOverview.appendChild(fragment);
  }

  function libraryDueText(entry, now) {
    if (!entry.record) return { primary: "尚未安排", secondary: "" };
    if (state.progress.pending && state.progress.pending.word === entry.word) {
      return { primary: "当前卡片", secondary: "完成评分后安排" };
    }
    var absoluteOptions = {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    };
    if (entry.due.getFullYear() !== now.getFullYear()) absoluteOptions.year = "numeric";
    return {
      primary: entry.due.getTime() <= now.getTime() ? "现在到期" : formatDue(entry.due, now),
      secondary: entry.due.toLocaleString("zh-CN", absoluteOptions)
    };
  }

  function libraryPracticeText(record) {
    if (!record) return "尚无练习记录";
    var stats = record.stats || freshWordStats();
    var parts = ["释义 " + stats.meaningAttempts + " 次", "拼写 " + stats.spellingAttempts + " 次"];
    var failures = stats.meaningFailures + stats.spellingFailures;
    if (failures) parts.push("答错 " + failures + " 次");
    if (stats.accentWarnings) parts.push("重音提示 " + stats.accentWarnings + " 次");
    return parts.join(" · ");
  }

  function appendLibraryRow(fragment, entry, now) {
    var row = document.createElement("div");
    var wordCell = document.createElement("div");
    var word = document.createElement("strong");
    var practice = document.createElement("small");
    var status = document.createElement("span");
    var rating = document.createElement("span");
    var dueCell = document.createElement("div");
    var duePrimary = document.createElement("strong");
    var dueSecondary = document.createElement("small");
    var dueText = libraryDueText(entry, now);
    var quickRate = document.createElement("button");

    row.className = "library-progress-row";
    wordCell.className = "library-progress-word";
    word.textContent = entry.word;
    word.lang = "it";
    practice.textContent = libraryPracticeText(entry.record);
    quickRate.type = "button";
    quickRate.className = "library-quick-rate";
    quickRate.textContent = state.progress.pending && state.progress.pending.word === entry.word ? "正在学习" : "直接评分";
    quickRate.disabled = state.progress.pending && state.progress.pending.word === entry.word;
    quickRate.addEventListener("click", function () { openQuickRating(entry.word); });
    wordCell.appendChild(word);
    wordCell.appendChild(practice);
    wordCell.appendChild(quickRate);

    status.className = "library-status-badge status-" + entry.status.key;
    status.textContent = entry.status.label;
    rating.className = "library-progress-rating";
    rating.textContent = entry.record && entry.record.lastRating ? ratingName(entry.record.lastRating) : "—";

    dueCell.className = "library-progress-due";
    duePrimary.textContent = dueText.primary;
    dueSecondary.textContent = dueText.secondary;
    dueCell.appendChild(duePrimary);
    if (dueText.secondary) dueCell.appendChild(dueSecondary);

    row.appendChild(wordCell);
    row.appendChild(status);
    row.appendChild(rating);
    row.appendChild(dueCell);
    fragment.appendChild(row);
  }

  function renderLibraryProgress() {
    if (!state.progress) return;
    var now = new Date();
    var entries = libraryEntries(now);
    renderLibraryOverview(entries);
    var query = elements.libraryProgressSearch.value.trim().toLocaleLowerCase("it-IT");
    var filter = elements.libraryProgressFilter.value;
    var sort = elements.libraryProgressSort.value;
    var filtered = entries.filter(function (entry) {
      if (query && entry.word.toLocaleLowerCase("it-IT").indexOf(query) < 0) return false;
      return filter === "all" || entry.status.key === filter;
    });

    if (sort === "due") {
      filtered.sort(function (a, b) {
        var dueA = a.due ? a.due.getTime() : Number.POSITIVE_INFINITY;
        var dueB = b.due ? b.due.getTime() : Number.POSITIVE_INFINITY;
        return dueA - dueB || a.index - b.index;
      });
    } else if (sort === "weak") {
      filtered.sort(function (a, b) {
        var ratingA = a.record ? Number(a.record.lastRating) || 0 : 0;
        var ratingB = b.record ? Number(b.record.lastRating) || 0 : 0;
        var stabilityA = a.record ? Number(a.record.fsrs.stability) || 0 : 0;
        var stabilityB = b.record ? Number(b.record.fsrs.stability) || 0 : 0;
        return a.status.rank - b.status.rank || ratingA - ratingB || stabilityA - stabilityB || a.index - b.index;
      });
    } else if (sort === "word") {
      filtered.sort(function (a, b) { return a.word.localeCompare(b.word, "it-IT"); });
    }

    var visible = filtered.slice(0, state.libraryVisibleLimit);
    elements.libraryProgressList.textContent = "";
    var fragment = document.createDocumentFragment();
    visible.forEach(function (entry) { appendLibraryRow(fragment, entry, now); });
    elements.libraryProgressList.appendChild(fragment);
    elements.libraryProgressResult.textContent = "共 " + filtered.length + " 个单词" + (filtered.length > visible.length ? "，当前显示 " + visible.length + " 个" : "");
    elements.libraryProgressEmpty.hidden = filtered.length > 0;
    elements.libraryProgressMore.hidden = visible.length >= filtered.length;
  }

  function openLibraryProgress() {
    state.libraryVisibleLimit = LIBRARY_PAGE_SIZE;
    renderLibraryProgress();
    if (typeof elements.libraryProgressDialog.showModal === "function") {
      if (!elements.libraryProgressDialog.open) elements.libraryProgressDialog.showModal();
    } else {
      elements.libraryProgressDialog.setAttribute("open", "");
    }
    setTimeout(function () { elements.libraryProgressSearch.focus(); }, 0);
  }

  function closeLibraryProgress() {
    if (typeof elements.libraryProgressDialog.close === "function") elements.libraryProgressDialog.close();
    else elements.libraryProgressDialog.removeAttribute("open");
  }

  function openQuickRating(word) {
    if (!word || state.progress.pending && state.progress.pending.word === word) return;
    state.quickRatingWord = word;
    elements.quickRatingTitle.textContent = word;
    elements.quickRatingStatus.hidden = true;
    elements.quickRatingNote.textContent = "这会作为一次“看意大利语记中文”的学习记录，并由 FSRS 安排下次复习。";
    if (typeof elements.quickRatingDialog.showModal === "function") {
      if (!elements.quickRatingDialog.open) elements.quickRatingDialog.showModal();
    } else {
      elements.quickRatingDialog.setAttribute("open", "");
    }
  }

  function closeQuickRating() {
    state.quickRatingWord = "";
    if (typeof elements.quickRatingDialog.close === "function") elements.quickRatingDialog.close();
    else elements.quickRatingDialog.removeAttribute("open");
  }

  function resetLibraryList() {
    state.libraryVisibleLimit = LIBRARY_PAGE_SIZE;
    renderLibraryProgress();
  }

  function revealDefinition() {
    elements.revealActions.hidden = true;
    elements.gradeActions.hidden = false;
    elements.definitionWrap.hidden = false;
    elements.definition.textContent = "正在查找释义……";
    elements.wordHint.textContent = "请按实际回忆情况评分";
    showReferenceDictionaries();
    var token = state.cardToken;
    state.currentDefinitionPromise.then(function (definition) {
      if (token !== state.cardToken) return;
      state.currentDefinition = definition;
      elements.definition.textContent = definition;
    });
  }

  function normalizeExact(value) {
    return String(value || "").normalize("NFC").toLocaleLowerCase("it-IT").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  }

  function normalizeWithoutAccents(value) {
    return normalizeExact(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function compareSpelling(answer, expected) {
    var exactAnswer = normalizeExact(answer);
    var exactExpected = normalizeExact(expected);
    if (exactAnswer === exactExpected) return "exact";
    if (exactAnswer && normalizeWithoutAccents(exactAnswer) === normalizeWithoutAccents(exactExpected)) return "accent";
    return "wrong";
  }

  function recommendRating(rating) {
    gradeButtons.forEach(function (button) {
      button.classList.toggle("recommended", Number(button.dataset.rating) === rating);
    });
  }

  function finishSpelling(answer, gaveUp) {
    if (!gaveUp && !String(answer || "").trim()) {
      elements.spellingFeedbackText.textContent = "请先输入答案，或者选择“不知道”。";
      elements.spellingAnswer.textContent = "";
      elements.spellingFeedback.className = "spelling-feedback is-wrong";
      elements.spellingFeedback.hidden = false;
      return;
    }
    var result = gaveUp ? "wrong" : compareSpelling(answer, state.currentWord);
    state.currentAnswerResult = result;
    elements.spellingInput.disabled = true;
    elements.spellingForm.hidden = true;
    elements.spellingFeedback.hidden = false;
    elements.spellingAnswer.textContent = state.currentWord;
    elements.speakButton.hidden = false;
    elements.definitionWrap.hidden = false;
    elements.definition.textContent = state.currentDefinition || "";
    showReferenceDictionaries();
    elements.gradeActions.hidden = false;
    if (result === "exact") {
      elements.spellingFeedbackText.textContent = "拼写正确";
      elements.spellingFeedback.className = "spelling-feedback is-correct";
      elements.wordHint.textContent = "请按回忆时的实际难度评分";
    } else if (result === "accent") {
      elements.spellingFeedbackText.textContent = "基本正确，只需注意重音符号";
      elements.spellingFeedback.className = "spelling-feedback is-accent";
      elements.wordHint.textContent = "重音问题不算错误；正确写法如下";
      recommendRating(window.FSRS.Rating.Good);
    } else {
      elements.spellingFeedbackText.textContent = gaveUp ? "已显示答案" : "拼写还不正确";
      elements.spellingFeedback.className = "spelling-feedback is-wrong";
      elements.wordHint.textContent = "建议选择“忘了”；如果只是手滑，可以按实际情况评分";
      recommendRating(window.FSRS.Rating.Again);
    }
  }

  function updateModeAfterRating(record, mode, rating) {
    var passed = rating !== window.FSRS.Rating.Again;
    record.mode.lastMode = mode;
    if (mode === "meaning") {
      record.stats.meaningAttempts += 1;
      if (!passed) record.stats.meaningFailures += 1;
      if (passed) record.mode.meaningPassed = true;
    } else {
      record.stats.spellingAttempts += 1;
      if (state.currentAnswerResult === "wrong") record.stats.spellingFailures += 1;
      if (state.currentAnswerResult === "accent") record.stats.accentWarnings += 1;
      if (passed) record.mode.spellingPassed = true;
    }
    if (!passed) {
      record.mode.forceMode = mode;
      record.mode.nextMode = mode;
    } else {
      record.mode.forceMode = "";
      record.mode.nextMode = !record.mode.meaningPassed ? "meaning" : !record.mode.spellingPassed ? "spelling" : mode === "meaning" ? "spelling" : "meaning";
    }
  }

  function formatDue(due, now) {
    var current = now || new Date();
    var date = validDate(due);
    var difference = date.getTime() - current.getTime();
    if (difference <= 60000) return "1 分钟内";
    if (difference < 3600000) return Math.max(1, Math.round(difference / 60000)) + " 分钟后";
    if (localDateKey(date) === localDateKey(current)) return "今天 " + date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    var tomorrow = new Date(current);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (localDateKey(date) === localDateKey(tomorrow)) return "明天";
    return Math.max(1, Math.round(difference / 86400000)) + " 天后";
  }

  function ratingName(rating) { return ({ 1: "忘了", 2: "勉强想起", 3: "正常想起", 4: "非常熟练" })[rating] || ""; }

  function applyQuickRating(rating) {
    var word = state.quickRatingWord;
    if (!word || !state.progress || rating < 1 || rating > 4) return;
    ensureDaily();
    var now = new Date();
    var record = getRecord(word);
    if (!record) {
      record = freshRecord(now);
      state.progress.cards[word] = record;
      if (state.progress.daily.newWords.indexOf(word) < 0) state.progress.daily.newWords.push(word);
    }
    var previousCard = hydrateCard(record.fsrs, now);
    var wasReview = previousCard.reps > 0;
    updateModeAfterRating(record, "meaning", rating);
    var nextCard = createScheduler(state.progress.settings).next(previousCard, now, rating).card;
    if (rating !== window.FSRS.Rating.Again && record.mode.meaningPassed && !record.mode.spellingPassed) {
      var companionDue = new Date(now.getTime() + COMPANION_DELAY_MS);
      if (validDate(nextCard.due).getTime() > companionDue.getTime()) {
        nextCard.due = companionDue;
        nextCard.scheduled_days = 0;
      }
    }
    record.fsrs = serializeCard(nextCard);
    record.lastRating = rating;
    record.lastResult = "manual-library";
    state.progress.reviewed += 1;
    if (wasReview) state.progress.daily.reviewCount += 1;
    state.progress.reviewLog.push({
      w: word,
      t: now.toISOString(),
      m: "meaning",
      g: rating,
      r: record.lastResult,
      ms: 0,
      due: record.fsrs.due,
      s: Number(record.fsrs.stability.toFixed(6)),
      d: Number(record.fsrs.difficulty.toFixed(6))
    });
    if (state.progress.reviewLog.length > MAX_REVIEW_LOGS) state.progress.reviewLog.splice(0, state.progress.reviewLog.length - MAX_REVIEW_LOGS);
    saveProgress();
    setProgressStatus("已在词库中将“" + word + "”标记为“" + ratingName(rating) + "”，下次预计 " + formatDue(record.fsrs.due, now) + "。", false);
    updateStats();
    renderLibraryProgress();
    closeQuickRating();
  }

  function rateCurrent(rating) {
    if (!state.currentWord || elements.gradeActions.hidden) return;
    var now = new Date();
    var word = state.currentWord;
    var record = getRecord(word);
    if (!record) return;
    var previousCard = hydrateCard(record.fsrs, now);
    var wasReview = previousCard.reps > 0;
    updateModeAfterRating(record, state.currentMode, rating);
    var nextCard = createScheduler(state.progress.settings).next(previousCard, now, rating).card;
    if (rating !== window.FSRS.Rating.Again && record.mode.meaningPassed && !record.mode.spellingPassed) {
      var companionDue = new Date(now.getTime() + COMPANION_DELAY_MS);
      if (validDate(nextCard.due).getTime() > companionDue.getTime()) {
        nextCard.due = companionDue;
        nextCard.scheduled_days = 0;
      }
    }
    record.fsrs = serializeCard(nextCard);
    record.lastRating = rating;
    record.lastResult = state.currentMode === "spelling" ? state.currentAnswerResult || "unknown" : "self-rated";
    state.progress.reviewed += 1;
    if (wasReview) state.progress.daily.reviewCount += 1;
    state.progress.reviewLog.push({
      w: word,
      t: now.toISOString(),
      m: state.currentMode,
      g: rating,
      r: record.lastResult,
      ms: Math.max(0, Date.now() - state.currentStartedAt),
      due: record.fsrs.due,
      s: Number(record.fsrs.stability.toFixed(6)),
      d: Number(record.fsrs.difficulty.toFixed(6))
    });
    if (state.progress.reviewLog.length > MAX_REVIEW_LOGS) state.progress.reviewLog.splice(0, state.progress.reviewLog.length - MAX_REVIEW_LOGS);
    state.progress.pending = null;
    saveProgress();
    setProgressStatus("已记录“" + ratingName(rating) + "”，下次预计 " + formatDue(record.fsrs.due, now) + "。", false);
    showNextWord();
  }

  function speakCurrentWord() {
    if (!("speechSynthesis" in window) || !state.currentWord) { elements.wordHint.textContent = "当前浏览器不支持语音朗读"; return; }
    window.speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(state.currentWord);
    utterance.lang = "it-IT";
    utterance.rate = 0.86;
    var italianVoice = window.speechSynthesis.getVoices().find(function (voice) { return /^it([-_]|$)/i.test(voice.lang); });
    if (italianVoice) utterance.voice = italianVoice;
    window.speechSynthesis.speak(utterance);
  }

  function applySettings() {
    if (!state.progress) return;
    state.progress.settings = sanitizeSettings({
      dailyNew: elements.settingNew.value,
      dailyReview: elements.settingReview.value,
      requestRetention: Number(elements.settingRetention.value) / 100,
      maximumInterval: state.progress.settings.maximumInterval
    });
    syncSettingsUI();
    saveProgress();
    updateStats();
    if (state.completed) showNextWord();
  }

  function handleFileEvent(event) {
    var files = event.target.files;
    if (files && files.length) {
      addDictionaryFiles(files).catch(function (error) {
        console.error(error);
        setImportStatus("检查词库时发生错误，请重新选择文件。", true);
      });
      showView("importView");
    }
    event.target.value = "";
  }

  function handleProgressFileEvent(event) {
    var file = event.target.files && event.target.files[0];
    if (file) handleProgressFile(file, event.target === elements.progressFileInput);
    event.target.value = "";
  }

  elements.fileInput.addEventListener("change", handleFileEvent);
  elements.errorFileInput.addEventListener("change", handleFileEvent);
  elements.startDictionarySet.addEventListener("click", function () {
    var learning = dictionaryById(state.learningDictionaryId);
    if (!learning) { setImportStatus("请先导入并选择一部学习词库。", true); return; }
    refreshReferenceDictionaries();
    importDictionary(learning, true);
  });
  elements.progressFileInput.addEventListener("change", handleProgressFileEvent);
  elements.studyProgressFileInput.addEventListener("change", handleProgressFileEvent);
  elements.exportProgress.addEventListener("click", exportProgressFile);
  elements.importProgress.addEventListener("click", function () { elements.studyProgressFileInput.click(); });
  elements.openCheckin.addEventListener("click", openCheckinDialog);
  elements.closeCheckin.addEventListener("click", closeCheckinDialog);
  elements.checkinDialog.addEventListener("click", function (event) {
    if (event.target === elements.checkinDialog) closeCheckinDialog();
  });
  elements.makeupSubmit.addEventListener("click", function () { applyMakeupCheckin(elements.makeupDate.value); });
  elements.openLibraryProgress.addEventListener("click", openLibraryProgress);
  elements.closeLibraryProgress.addEventListener("click", closeLibraryProgress);
  elements.libraryProgressDialog.addEventListener("click", function (event) {
    if (event.target === elements.libraryProgressDialog) closeLibraryProgress();
  });
  elements.libraryProgressSearch.addEventListener("input", resetLibraryList);
  elements.libraryProgressFilter.addEventListener("change", resetLibraryList);
  elements.libraryProgressSort.addEventListener("change", resetLibraryList);
  elements.libraryProgressMore.addEventListener("click", function () {
    state.libraryVisibleLimit += LIBRARY_PAGE_SIZE;
    renderLibraryProgress();
  });
  elements.closeQuickRating.addEventListener("click", closeQuickRating);
  elements.quickRatingDialog.addEventListener("click", function (event) {
    if (event.target === elements.quickRatingDialog) closeQuickRating();
  });
  quickRatingButtons.forEach(function (button) {
    button.addEventListener("click", function () { applyQuickRating(Number(button.dataset.quickRating)); });
  });
  elements.changeDict.addEventListener("click", function () {
    if (state.completionTimer) {
      clearTimeout(state.completionTimer);
      state.completionTimer = null;
    }
    renderDictionaryManager();
    showView("importView");
    elements.fileInput.focus();
  });
  elements.revealButton.addEventListener("click", revealDefinition);
  elements.spellingCheck.addEventListener("click", function () { finishSpelling(elements.spellingInput.value, false); });
  elements.spellingGiveUp.addEventListener("click", function () { finishSpelling("", true); });
  elements.spellingInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") { event.preventDefault(); finishSpelling(elements.spellingInput.value, false); }
  });
  gradeButtons.forEach(function (button) {
    button.addEventListener("click", function () { rateCurrent(Number(button.dataset.rating)); });
  });
  elements.speakButton.addEventListener("click", speakCurrentWord);
  elements.learnFiveMore.addEventListener("click", startMixedExtraSession);
  elements.reviewMore.addEventListener("click", startReviewExtraSession);
  elements.refreshQueue.addEventListener("click", showNextWord);
  elements.settingNew.addEventListener("change", applySettings);
  elements.settingReview.addEventListener("change", applySettings);
  elements.settingRetention.addEventListener("change", applySettings);

  showView("loadingView");
  elements.loadingMessage.textContent = "正在检查上次使用的词库……";
  if (!window.FSRS) showError("FSRS 调度组件没有加载成功，请刷新页面后重试。");
  else restoreDictionarySet().then(function (restored) {
    if (restored) {
      state.dictionaries = restored.dictionaries;
      state.learningDictionaryId = restored.learningId;
      refreshReferenceDictionaries();
      renderDictionaryManager();
      importDictionary(dictionaryById(state.learningDictionaryId), false);
      return null;
    }
    return restoreFile().then(function (file) {
      if (file) importDictionary(file, true);
      else showView("importView");
    });
  }).catch(function () { showView("importView"); });
});
