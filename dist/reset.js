(function () {
  "use strict";

  var DB_NAME = "parola-local-dictionary";
  var clearButton = document.getElementById("clear-local-data");
  var status = document.getElementById("reset-status");
  var returnLink = document.getElementById("return-after-reset");

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle("status-error", Boolean(isError));
    status.hidden = false;
  }

  function removeParolaStorage(storage) {
    try {
      for (var index = storage.length - 1; index >= 0; index -= 1) {
        var key = storage.key(index);
        if (key && key.indexOf("parola-") === 0) storage.removeItem(key);
      }
    } catch (error) {}
  }

  function deleteParolaDatabase() {
    if (!("indexedDB" in window)) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error("数据库仍被其他 Parola 页面占用。请关闭其他 Parola 标签页，然后重试。"));
      }, 10000);
      var request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      request.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(request.error || new Error("Safari 未能删除本地数据库，请重试。"));
      };
    });
  }

  function clearParolaCaches() {
    if (!("caches" in window)) return Promise.resolve();
    return caches.keys().then(function (names) {
      return Promise.all(names.filter(function (name) {
        return String(name).toLocaleLowerCase().indexOf("parola") >= 0;
      }).map(function (name) { return caches.delete(name); }));
    }).catch(function () {});
  }

  clearButton.addEventListener("click", function () {
    clearButton.disabled = true;
    clearButton.textContent = "正在清除……";
    setStatus("正在删除旧词库和学习记录，请不要关闭此页面。", false);
    deleteParolaDatabase().then(function () {
      removeParolaStorage(window.localStorage);
      removeParolaStorage(window.sessionStorage);
      return clearParolaCaches();
    }).then(function () {
      setStatus("本机 Parola 数据已全部清除。现在可以重新导入词库。", false);
      clearButton.hidden = true;
      returnLink.href = "./?reset=" + Date.now();
      returnLink.hidden = false;
    }).catch(function (error) {
      clearButton.disabled = false;
      clearButton.textContent = "重新尝试清除";
      setStatus(error && error.message ? error.message : "清除失败，请关闭其他 Parola 页面后重试。", true);
    });
  });
})();
