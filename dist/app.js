define("mdict-parseXml", function () {
  return function parseXml(source) {
    return new DOMParser().parseFromString(source, "text/xml");
  };
});

require(["mdict-parser"], function (MParser) {
  "use strict";

  var MAX_WORDS = 7000;
  var DB_NAME = "parola-local-dictionary";
  var DB_VERSION = 1;
  var STORE_NAME = "files";
  var ACTIVE_FILE_KEY = "active";
  var PROGRESS_FORMAT = "parola-progress";
  var PROGRESS_VERSION = 1;
  var SHUFFLE_ALGORITHM = "mulberry32-fisher-yates-v1";

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
    dictionaryCapped: false
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
    progressBar: document.getElementById("progress-bar"),
    progressLabel: document.getElementById("progress-label"),
    wordPosition: document.getElementById("word-position"),
    currentWord: document.getElementById("current-word"),
    wordHint: document.getElementById("word-hint"),
    speakButton: document.getElementById("speak-button"),
    definitionWrap: document.getElementById("definition-wrap"),
    definition: document.getElementById("definition"),
    revealActions: document.getElementById("reveal-actions"),
    gradeActions: document.getElementById("grade-actions"),
    revealButton: document.getElementById("reveal-button"),
    againButton: document.getElementById("again-button"),
    knownButton: document.getElementById("known-button"),
    dictionaryNote: document.getElementById("dictionary-note")
  };

  function showView(viewName) {
    ["importView", "loadingView", "studyView", "errorView"].forEach(function (name) {
      elements[name].hidden = name !== viewName;
    });
    elements.changeDict.hidden = viewName !== "studyView";
  }

  function progressKey() {
    return "parola-progress:" + state.fingerprint;
  }

  function freshProgress() {
    return {
      shuffleSeed: createShuffleSeed(),
      shuffleAlgorithm: SHUFFLE_ALGORITHM,
      cursor: 0,
      reviewed: 0,
      known: {},
      learning: {},
      retry: [],
      pendingWord: ""
    };
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

  function applyStudyOrder() {
    state.progress.shuffleSeed = normalizeSeed(state.progress.shuffleSeed);
    state.progress.shuffleAlgorithm = SHUFFLE_ALGORITHM;
    state.words = shuffledWords(state.sourceWords, state.progress.shuffleSeed);
  }

  function loadProgress() {
    try {
      var raw = localStorage.getItem(progressKey());
      if (!raw && state.legacyFingerprint) {
        raw = localStorage.getItem("parola-progress:" + state.legacyFingerprint);
      }
      var saved = raw ? JSON.parse(raw) : freshProgress();
      var progress = Object.assign(freshProgress(), saved);
      progress.shuffleSeed = normalizeSeed(progress.shuffleSeed);
      progress.shuffleAlgorithm = SHUFFLE_ALGORITHM;
      return progress;
    } catch (error) {
      return freshProgress();
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(progressKey(), JSON.stringify(state.progress));
    } catch (error) {
      console.warn("Progress could not be saved", error);
    }
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
    var json = JSON.stringify(progressFilePayload(), null, 2);
    var blob = new Blob([json], { type: "application/json;charset=utf-8" });
    var link = document.createElement("a");
    var date = new Date().toISOString().slice(0, 10);
    var dictionaryName = state.file.name.replace(/\.mdx$/i, "").replace(/[\\/:*?\"<>|]+/g, "-");
    link.href = URL.createObjectURL(blob);
    link.download = "Parola-进度-" + dictionaryName + "-" + date + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(link.href);
    }, 1000);
    setProgressStatus("进度文件已导出，包含固定乱序种子 " + state.progress.shuffleSeed + "。", false);
  }

  function parseProgressFile(file) {
    return file.text().then(function (text) {
      var payload;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new Error("这不是有效的 JSON 进度文件。");
      }
      if (!payload || payload.format !== PROGRESS_FORMAT || payload.version !== PROGRESS_VERSION) {
        throw new Error("这不是受支持的 Parola 进度文件。");
      }
      if (!payload.dictionary || !payload.progress) {
        throw new Error("进度文件缺少词库或学习记录。");
      }
      return payload;
    });
  }

  function dictionaryMatches(payload) {
    var dictionary = payload.dictionary || {};
    if (dictionary.fingerprint) return dictionary.fingerprint === state.fingerprint;
    return dictionary.name === state.file.name && Number(dictionary.size) === state.file.size;
  }

  function sanitizeWordMap(value, availableWords) {
    var result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    Object.keys(value).forEach(function (word) {
      if (availableWords.has(word)) result[word] = true;
    });
    return result;
  }

  function sanitizeProgress(value) {
    var availableWords = new Set(state.sourceWords);
    var progress = freshProgress();
    progress.shuffleSeed = normalizeSeed(value.shuffleSeed);
    progress.shuffleAlgorithm = SHUFFLE_ALGORITHM;
    progress.cursor = Math.max(0, Math.floor(Number(value.cursor) || 0));
    progress.reviewed = Math.max(0, Math.floor(Number(value.reviewed) || 0));
    progress.known = sanitizeWordMap(value.known, availableWords);
    progress.learning = sanitizeWordMap(value.learning, availableWords);
    progress.retry = Array.isArray(value.retry)
      ? value.retry
          .filter(function (item) {
            return item && availableWords.has(item.word) && Number.isFinite(Number(item.due));
          })
          .slice(-200)
          .map(function (item) {
            return { word: item.word, due: Math.max(0, Math.floor(Number(item.due))) };
          })
      : [];
    progress.pendingWord = availableWords.has(value.pendingWord) ? value.pendingWord : "";
    return progress;
  }

  function applyImportedProgress(payload) {
    if (!dictionaryMatches(payload)) {
      throw new Error(
        "进度文件属于“" + (payload.dictionary.name || "另一个词库") + "”，请导入对应的 MDX 文件。"
      );
    }
    state.progress = sanitizeProgress(payload.progress);
    applyStudyOrder();
    saveProgress();
  }

  function handleProgressFile(file, queueUntilDictionary) {
    if (!file) return;
    parseProgressFile(file)
      .then(function (payload) {
        if (queueUntilDictionary || !state.file || !state.progress) {
          state.pendingProgressImport = payload;
          setImportStatus(
            "已读取进度文件。现在请选择“" + payload.dictionary.name + "”词库，随后会自动恢复。",
            false
          );
          return;
        }
        applyImportedProgress(payload);
        showNextWord();
        setProgressStatus(
          "进度已恢复；后续顺序使用文件中的固定种子 " + state.progress.shuffleSeed + "。",
          false
        );
      })
      .catch(function (error) {
        if (state.file && state.progress) setProgressStatus(error.message, true);
        else setImportStatus(error.message, true);
      });
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!("indexedDB" in window)) {
        reject(new Error("当前浏览器不支持本地词库存储"));
        return;
      }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  function dbRequest(mode, action) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(STORE_NAME, mode);
        var store = transaction.objectStore(STORE_NAME);
        var request = action(store);
        request.onsuccess = function () {
          resolve(request.result);
        };
        request.onerror = function () {
          reject(request.error);
        };
        transaction.oncomplete = function () {
          db.close();
        };
      });
    });
  }

  function rememberFile(file) {
    return dbRequest("readwrite", function (store) {
      return store.put(
        {
          blob: file,
          name: file.name,
          size: file.size,
          lastModified: file.lastModified || 0
        },
        ACTIVE_FILE_KEY
      );
    });
  }

  function restoreFile() {
    return dbRequest("readonly", function (store) {
      return store.get(ACTIVE_FILE_KEY);
    }).then(function (record) {
      if (!record || !record.blob) return null;
      return new File([record.blob], record.name, {
        type: "application/octet-stream",
        lastModified: record.lastModified || Date.now()
      });
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
    return MParser([file])
      .then(function (resources) {
        if (!resources.mdx) throw new Error("没有找到可用的 MDX 内容");
        return resources.mdx;
      })
      .then(function (lookup) {
        state.lookup = lookup;
        elements.loadingMessage.textContent = "正在准备学习词条……";
        return lookup({ phrase: "", max: MAX_WORDS });
      })
      .then(function (entries) {
        state.dictionaryCapped = entries.length >= MAX_WORDS;
        state.sourceWords = uniqueStudyWords(entries);
        if (!state.sourceWords.length) {
          throw new Error("没有识别到适合学习的意大利语词条");
        }
      });
  }

  function fileFingerprint(file) {
    return [file.name, file.size].join(":");
  }

  function legacyFileFingerprint(file) {
    return [file.name, file.size, file.lastModified || 0].join(":");
  }

  function importDictionary(file, shouldRemember) {
    if (!file) return;
    if (!/\.mdx$/i.test(file.name)) {
      showError("请选择扩展名为 .mdx 的词典文件。");
      return;
    }

    state.file = file;
    state.fingerprint = fileFingerprint(file);
    state.legacyFingerprint = legacyFileFingerprint(file);
    showView("loadingView");

    parseDictionary(file)
      .then(function () {
        var restoreMessage = "";
        var restoreFailed = false;
        state.progress = loadProgress();
        if (state.pendingProgressImport) {
          try {
            applyImportedProgress(state.pendingProgressImport);
            restoreMessage =
              "进度已恢复；后续顺序使用文件中的固定种子 " + state.progress.shuffleSeed + "。";
            state.pendingProgressImport = null;
          } catch (error) {
            applyStudyOrder();
            restoreMessage = error.message;
            restoreFailed = true;
          }
        } else {
          applyStudyOrder();
        }
        if (shouldRemember) {
          rememberFile(file).catch(function (error) {
            console.warn("Dictionary could not be remembered", error);
          });
        }
        startStudy();
        if (restoreMessage) setProgressStatus(restoreMessage, restoreFailed);
      })
      .catch(function (error) {
        console.error(error);
        showError(
          "无法解析这个词库。它可能使用了加密、特殊压缩格式，或不是标准的 MDict 2.0 文件。"
        );
      });
  }

  function showError(message) {
    elements.errorMessage.textContent = message;
    showView("errorView");
  }

  function startStudy() {
    var cleanName = state.file.name.replace(/\.mdx$/i, "");
    elements.dictName.textContent = cleanName;
    elements.dictionaryNote.textContent = state.dictionaryCapped
      ? "简单版每个词库先读取前 7000 个词条。"
      : "共读取 " + state.words.length + " 个可学习词条，学习顺序已固定乱序。";
    showView("studyView");
    setProgressStatus("");
    showNextWord();
  }

  function takeDueRetry() {
    var retry = state.progress.retry || [];
    var index = retry.findIndex(function (item) {
      return item.due <= state.progress.reviewed;
    });
    if (index < 0) return "";
    return retry.splice(index, 1)[0].word;
  }

  function showNextWord() {
    var pendingWord = state.progress.pendingWord;
    var retryWord = pendingWord ? "" : takeDueRetry();
    var index = state.progress.cursor % state.words.length;
    state.currentWord = pendingWord || retryWord || state.words[index];
    if (!pendingWord && !retryWord) state.progress.cursor = (index + 1) % state.words.length;
    state.progress.pendingWord = state.currentWord;

    elements.currentWord.textContent = state.currentWord;
    elements.wordHint.textContent = "先想一想它的意思";
    elements.definition.textContent = "正在查找释义……";
    elements.definitionWrap.hidden = true;
    elements.revealActions.hidden = false;
    elements.gradeActions.hidden = true;
    updateStats();
    saveProgress();
  }

  function updateStats() {
    var known = Object.keys(state.progress.known || {}).length;
    var touched = new Set(
      Object.keys(state.progress.known || {}).concat(Object.keys(state.progress.learning || {}))
    ).size;
    var total = state.words.length;
    var percent = total ? Math.min(100, (touched / total) * 100) : 0;
    elements.knownCount.textContent = known;
    elements.progressLabel.textContent = touched + " / " + total;
    elements.progressBar.style.width = percent.toFixed(2) + "%";
    elements.wordPosition.textContent = "已学习 " + touched + " 个";
  }

  function definitionToText(definitions) {
    var html = (definitions || []).join("<hr>");
    if (!html) return "这个词条没有可显示的释义。";
    var doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, noscript, iframe, object, embed").forEach(function (node) {
      node.remove();
    });
    doc.querySelectorAll("br, p, div, li, hr").forEach(function (node) {
      node.appendChild(doc.createTextNode("\n"));
    });
    return (doc.body.textContent || "")
      .replace(/\u0000/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function revealDefinition() {
    elements.revealActions.hidden = true;
    elements.gradeActions.hidden = false;
    elements.definitionWrap.hidden = false;
    elements.wordHint.textContent = "";
    state.lookup(state.currentWord)
      .then(function (definitions) {
        elements.definition.textContent = definitionToText(definitions);
      })
      .catch(function (error) {
        console.error(error);
        elements.definition.textContent = "暂时没有找到这个词的释义。";
      });
  }

  function markWord(isKnown) {
    var word = state.currentWord;
    state.progress.reviewed += 1;
    state.progress.pendingWord = "";
    if (isKnown) {
      state.progress.known[word] = true;
      delete state.progress.learning[word];
    } else {
      state.progress.learning[word] = true;
      delete state.progress.known[word];
      state.progress.retry.push({ word: word, due: state.progress.reviewed + 4 });
      if (state.progress.retry.length > 200) state.progress.retry.shift();
    }
    saveProgress();
    showNextWord();
  }

  function speakCurrentWord() {
    if (!("speechSynthesis" in window) || !state.currentWord) {
      elements.wordHint.textContent = "当前浏览器不支持语音朗读";
      return;
    }
    window.speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(state.currentWord);
    utterance.lang = "it-IT";
    utterance.rate = 0.86;
    var italianVoice = window.speechSynthesis
      .getVoices()
      .find(function (voice) {
        return /^it([-_]|$)/i.test(voice.lang);
      });
    if (italianVoice) utterance.voice = italianVoice;
    window.speechSynthesis.speak(utterance);
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
  elements.importProgress.addEventListener("click", function () {
    elements.studyProgressFileInput.click();
  });
  elements.changeDict.addEventListener("click", function () {
    showView("importView");
    elements.fileInput.focus();
  });
  elements.revealButton.addEventListener("click", revealDefinition);
  elements.againButton.addEventListener("click", function () {
    markWord(false);
  });
  elements.knownButton.addEventListener("click", function () {
    markWord(true);
  });
  elements.speakButton.addEventListener("click", speakCurrentWord);

  showView("loadingView");
  elements.loadingMessage.textContent = "正在检查上次使用的词库……";
  restoreFile()
    .then(function (file) {
      if (file) importDictionary(file, false);
      else showView("importView");
    })
    .catch(function () {
      showView("importView");
    });
});
