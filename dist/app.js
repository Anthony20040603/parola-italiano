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

  var state = {
    file: null,
    fingerprint: "",
    lookup: null,
    words: [],
    progress: null,
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
      cursor: 0,
      reviewed: 0,
      known: {},
      learning: {},
      retry: [],
      pendingWord: ""
    };
  }

  function loadProgress() {
    try {
      var raw = localStorage.getItem(progressKey());
      var saved = raw ? JSON.parse(raw) : freshProgress();
      return Object.assign(freshProgress(), saved);
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
        state.words = uniqueStudyWords(entries);
        if (!state.words.length) {
          throw new Error("没有识别到适合学习的意大利语词条");
        }
      });
  }

  function fileFingerprint(file) {
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
    showView("loadingView");

    parseDictionary(file)
      .then(function () {
        state.progress = loadProgress();
        if (shouldRemember) {
          rememberFile(file).catch(function (error) {
            console.warn("Dictionary could not be remembered", error);
          });
        }
        startStudy();
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
      : "共读取 " + state.words.length + " 个可学习词条。";
    showView("studyView");
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

  elements.fileInput.addEventListener("change", handleFileEvent);
  elements.errorFileInput.addEventListener("change", handleFileEvent);
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
