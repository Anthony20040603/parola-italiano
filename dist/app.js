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
  var PROGRESS_FORMAT = "parola-progress";
  var PROGRESS_VERSION = 2;
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
    libraryVisibleLimit: LIBRARY_PAGE_SIZE
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
    changeDict: document.getElementById("change-dict"),
    loadingMessage: document.getElementById("loading-message"),
    errorMessage: document.getElementById("error-message"),
    dictName: document.getElementById("dict-name"),
    knownCount: document.getElementById("known-count"),
    countLabel: document.getElementById("count-label"),
    progressBar: document.getElementById("progress-bar"),
    progressLabel: document.getElementById("progress-label"),
    dailySummary: document.getElementById("daily-summary"),
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
    wordPosition: document.getElementById("word-position"),
    currentWord: document.getElementById("current-word"),
    wordHint: document.getElementById("word-hint"),
    speakButton: document.getElementById("speak-button"),
    definitionWrap: document.getElementById("definition-wrap"),
    definition: document.getElementById("definition"),
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
    completeActions: document.getElementById("complete-actions"),
    learnFiveMore: document.getElementById("learn-five-more"),
    reviewMore: document.getElementById("review-more"),
    refreshQueue: document.getElementById("refresh-queue"),
    dictionaryNote: document.getElementById("dictionary-note"),
    settingNew: document.getElementById("setting-new"),
    settingReview: document.getElementById("setting-review"),
    settingRetention: document.getElementById("setting-retention")
  };

  var gradeButtons = Array.prototype.slice.call(document.querySelectorAll("[data-rating]"));

  function showView(viewName) {
    ["importView", "loadingView", "studyView", "errorView"].forEach(function (name) {
      elements[name].hidden = name !== viewName;
    });
    elements.changeDict.hidden = viewName !== "studyView";
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

  function freshDaily(date) {
    return { date: localDateKey(date), newWords: [], reviewCount: 0, extraNew: 0, extraReview: 0 };
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

  function restoreFile() {
    return dbRequest(FILE_STORE, "readonly", function (store) { return store.get(ACTIVE_FILE_KEY); })
      .then(function (record) {
        if (!record || !record.blob) return null;
        return new File([record.blob], record.name, {
          type: "application/octet-stream",
          lastModified: record.lastModified || Date.now()
        });
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
      if (!payload || payload.format !== PROGRESS_FORMAT || [1, 2].indexOf(Number(payload.version)) < 0) {
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
    syncSettingsUI();
    saveProgress();
  }

  function handleProgressFile(file, queueUntilDictionary) {
    if (!file) return;
    parseProgressFile(file).then(function (payload) {
      if (queueUntilDictionary || !state.file || !state.progress) {
        state.pendingProgressImport = payload;
        setImportStatus("已读取进度文件。现在请选择“" + payload.dictionary.name + "”词库，随后会自动恢复。", false);
        return;
      }
      applyImportedProgress(payload);
      showNextWord();
      setProgressStatus("进度已恢复，FSRS 复习日期和两种题型记录已载入。", false);
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

  function importDictionary(file, shouldRemember) {
    if (!file) return;
    if (!/\.mdx$/i.test(file.name)) { showError("请选择扩展名为 .mdx 的词典文件。"); return; }
    if (!window.FSRS) { showError("FSRS 调度组件没有加载成功，请刷新页面后重试。"); return; }
    if (state.completionTimer) {
      clearTimeout(state.completionTimer);
      state.completionTimer = null;
    }
    state.file = file;
    state.fingerprint = fileFingerprint(file);
    state.legacyFingerprint = legacyFileFingerprint(file);
    state.definitionCache = Object.create(null);
    showView("loadingView");

    parseDictionary(file).then(function () { return loadProgress(); }).then(function (progress) {
      var restoreMessage = "";
      var restoreFailed = false;
      state.progress = progress;
      if (state.pendingProgressImport) {
        try {
          applyImportedProgress(state.pendingProgressImport);
          restoreMessage = "进度已恢复，FSRS 状态和题型记录已载入。";
          state.pendingProgressImport = null;
        } catch (error) {
          restoreMessage = error.message;
          restoreFailed = true;
        }
      }
      ensureDaily();
      applyStudyOrder();
      if (shouldRemember) rememberFile(file).catch(function (error) { console.warn("Dictionary could not be remembered", error); });
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
    elements.dictName.textContent = state.file.name.replace(/\.mdx$/i, "");
    elements.countLabel.textContent = "稳定掌握";
    elements.dictionaryNote.textContent = state.dictionaryCapped
      ? "每个词库先读取前 7000 个词条；FSRS 会按到期时间安排复习。"
      : "共读取 " + state.words.length + " 个词条；新词顺序固定，复习由 FSRS 安排。";
    syncSettingsUI();
    showView("studyView");
    setProgressStatus("");
    showNextWord();
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

  function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function extractChineseClue(definition, word) {
    if (!definition || definition === "暂时没有找到这个词的释义。") return "";
    var withoutWord = definition.replace(new RegExp(escapeRegExp(word), "gi"), " ");
    var lines = withoutWord.split(/\n+/).map(function (line) {
      return line.replace(/\s+/g, " ").trim();
    }).filter(function (line) { return /[\u3400-\u9fff]/.test(line); });
    if (!lines.length) return "";
    var clue = lines[0].replace(/^[\s,，;；:：.。·•\-—\d①②③④⑤⑥⑦⑧⑨⑩]+/, "").trim();
    if (clue.length > 180) clue = clue.slice(0, 178).replace(/[，,;；][^，,;；]*$/, "") + "…";
    return clue;
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
      var clue = extractChineseClue(definition, selection.word);
      state.currentDefinition = definition;
      if (!clue) {
        state.currentMode = "meaning";
        state.progress.pending.mode = "meaning";
        saveProgress();
        resetCardUI();
        renderMeaningCard(selection, token);
        elements.wordHint.textContent = "这个词条没有可靠的中文提示，已改为意大利语→中文";
        return;
      }
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
    elements.wordPosition.textContent = "FSRS 今日安排";
    elements.currentWord.textContent = "今日任务完成";
    elements.currentWord.classList.add("completion-title");
    elements.speakButton.hidden = true;
    elements.completeActions.hidden = false;
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

    row.className = "library-progress-row";
    wordCell.className = "library-progress-word";
    word.textContent = entry.word;
    word.lang = "it";
    practice.textContent = libraryPracticeText(entry.record);
    wordCell.appendChild(word);
    wordCell.appendChild(practice);

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
    var file = event.target.files && event.target.files[0];
    if (file) importDictionary(file, true);
    event.target.value = "";
  }

  function handleProgressFileEvent(event) {
    var file = event.target.files && event.target.files[0];
    if (file) handleProgressFile(file, event.target === elements.progressFileInput);
    event.target.value = "";
  }

  elements.fileInput.addEventListener("change", handleFileEvent);
  elements.errorFileInput.addEventListener("change", handleFileEvent);
  elements.progressFileInput.addEventListener("change", handleProgressFileEvent);
  elements.studyProgressFileInput.addEventListener("change", handleProgressFileEvent);
  elements.exportProgress.addEventListener("click", exportProgressFile);
  elements.importProgress.addEventListener("click", function () { elements.studyProgressFileInput.click(); });
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
  elements.changeDict.addEventListener("click", function () {
    if (state.completionTimer) {
      clearTimeout(state.completionTimer);
      state.completionTimer = null;
    }
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
  else restoreFile().then(function (file) {
    if (file) importDictionary(file, false);
    else showView("importView");
  }).catch(function () { showView("importView"); });
});
