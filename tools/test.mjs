import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const appSource = await readFile(new URL("../dist/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
const spellingFunctions = appSource.match(
  /  function normalizeExact[\s\S]*?(?=\n  function recommendRating)/,
);

assert.ok(spellingFunctions, "spelling comparison functions should be present");

const spellingContext = {};
vm.runInNewContext(
  `${spellingFunctions[0]}
  result = [
    compareSpelling("Più", "più"),
    compareSpelling("piu", "più"),
    compareSpelling("perchè", "perché"),
    compareSpelling("pero", "perché")
  ];`,
  spellingContext,
);
assert.deepEqual(Array.from(spellingContext.result), ["exact", "accent", "accent", "wrong"]);

const clueFunctions = appSource.match(
  /  function escapeRegExp[\s\S]*?(?=\n  function compatibilitySample)/,
);
assert.ok(clueFunctions, "Chinese clue analysis functions should be present");
const clueContext = {};
vm.runInNewContext(
  `${clueFunctions[0]}
  result = [
    analyzeChineseClue("S.F.\\n(1) 力, 力气, 体力\\n(2) 力量", "forza"),
    analyzeChineseClue("粗壮 ★★ 结实 ★★ 力量 ★★ 气力\\n----------------", "forza"),
    analyzeChineseClue("andare\\nv.intr. ⑴去；走；行驶 ⑵通向", "andare"),
    analyzeChineseClue("famiglia / casa / focolare\\n三个名词都有家的意思，但用法不同。", "casa"),
    analyzeChineseClue("andare\\nINFINITO\\nPresente: andare\\nPassato: essere andato", "andare")
  ];`,
  clueContext,
);
assert.equal(clueContext.result[0].confidence, "high");
assert.match(clueContext.result[0].clue, /力气/);
assert.equal(clueContext.result[1].clue, "粗壮；结实；力量");
assert.equal(clueContext.result[2].confidence, "high");
assert.equal(clueContext.result[3].confidence, "low");
assert.equal(clueContext.result[4].confidence, "none");

const require = createRequire(import.meta.url);
const FSRS = require("../dist/vendor/ts-fsrs-5.4.2.umd.js");
const scheduler = FSRS.fsrs({
  request_retention: 0.9,
  enable_short_term: true,
  learning_steps: ["10m"],
  relearning_steps: ["10m"],
});
const now = new Date("2026-09-25T00:00:00.000Z");
const emptyCard = FSRS.createEmptyCard(now);
const again = scheduler.next(emptyCard, now, FSRS.Rating.Again).card;
const good = scheduler.next(emptyCard, now, FSRS.Rating.Good).card;
const easy = scheduler.next(emptyCard, now, FSRS.Rating.Easy).card;

assert.equal(again.due.getTime() - now.getTime(), 10 * 60 * 1000);
assert.ok(good.due > again.due, "Good should schedule later than Again");
assert.ok(easy.due > good.due, "Easy should schedule later than Good");

const dateFunctions = appSource.match(
  /  function localDateKey[\s\S]*?(?=\n  function freshDaily)/,
);
const makeupFunction = appSource.match(
  /  function isMakeupDateAllowed[\s\S]*?(?=\n  function checkinDateLabel)/,
);
assert.ok(dateFunctions, "local date helpers should be present");
assert.ok(makeupFunction, "unlimited makeup validation should be present");
const makeupContext = {};
vm.runInNewContext(
  `${dateFunctions[0]}
  function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object || {}, key); }
  ${makeupFunction[0]}
  result = [
    isMakeupDateAllowed("2026-09-01", "2026-09-25", {}),
    isMakeupDateAllowed("2025-01-01", "2026-09-25", { "2025-01-01": { type: "makeup" } }),
    isMakeupDateAllowed("2026-09-25", "2026-09-25", {}),
    isMakeupDateAllowed("2026-09-26", "2026-09-25", {}),
    isMakeupDateAllowed("not-a-date", "2026-09-25", {})
  ];`,
  makeupContext,
);
assert.deepEqual(Array.from(makeupContext.result), [true, false, false, false, false]);

const fsrsScript = html.indexOf('src="vendor/ts-fsrs-5.4.2.umd.js"');
const requireScript = html.indexOf('src="vendor/require.js"');
assert.ok(fsrsScript >= 0 && fsrsScript < requireScript, "FSRS must load before the app bootstrap");
assert.match(html, /data-rating="1"/);
assert.match(html, /id="spelling-form"/);
assert.match(html, /id="open-library-progress"/);
assert.match(html, /id="library-progress-dialog"/);
assert.match(html, /id="word-definitions-dialog"/);
assert.match(html, /id="word-definitions-list"/);
assert.match(html, /id="open-checkin"/);
assert.match(html, /id="completion-celebration"/);
assert.match(html, /id="makeup-date"/);
assert.match(html, /data-quick-rating="4"/);
assert.match(html, /id="learn-five-more"/);
assert.match(html, /id="review-more"/);
assert.match(html, /id="dictionary-manager"/);
assert.match(html, /id="dict-file"[^>]*multiple/);
assert.match(html, /id="reference-dictionaries"/);
assert.match(html, /id="retry-definition"/);
assert.match(html, /id="reload-page"/);
assert.match(html, /class="version-label">v1\.8\.2</);
assert.match(html, /id="dictionary-compatibility"/);
assert.match(appSource, /function renderLibraryProgress\(\)/);
assert.match(appSource, /function openWordDefinitions\(word\)/);
assert.match(appSource, /function wordDefinitionItem\(dictionary, word, token\)/);
assert.match(appSource, /function startMixedExtraSession\(\)/);
assert.match(appSource, /var PROGRESS_VERSION = 4/);
assert.match(appSource, /function applyQuickRating\(rating\)/);
assert.match(appSource, /lastResult = "manual-library"/);
assert.match(appSource, /function rememberDictionarySet\(\)/);
assert.match(appSource, /function restoreDictionarySet\(\)/);
assert.match(appSource, /function ensureDictionaryFile\(dictionary\)/);
assert.match(appSource, /function loadReferenceLookup\(dictionary, options\)/);
assert.match(appSource, /function showReferenceDictionaries\(\)/);
assert.match(appSource, /function ensureDictionaryHash\(dictionary\)/);
assert.match(appSource, /function analyzeChineseClue\(definition, word\)/);
assert.match(appSource, /function scanLearningCompatibility\(dictionary\)/);
assert.match(appSource, /function enqueueMdictTask\(run, options\)/);
assert.match(appSource, /function pumpMdictTaskQueue\(\)/);
assert.match(appSource, /function trimReferenceLookupCache\(currentDictionary\)/);
assert.match(appSource, /function schedulePostStartTasks\(dictionary, shouldRemember\)/);
assert.match(appSource, /words: dictionary\.words \|\| null/);
assert.match(appSource, /function rememberDictionaryMetadata\(\)/);
assert.doesNotMatch(appSource, /function readDictionaryFileRecords\(items\)/);

const queueFunctions = appSource.match(
  /  function cancelledMdictTaskError[\s\S]*?(?=\n  function idleTurn)/,
);
assert.ok(queueFunctions, "global MDict task queue should be present");
const queueContext = {
  Promise,
  setTimeout,
  clearTimeout,
  DEFINITION_TIMEOUT_MS: 1000,
  state: {
    mdictTaskQueue: [],
    mdictTaskActive: null,
    mdictTaskSequence: 0,
    lookup() {},
  },
};
vm.runInNewContext(queueFunctions[0], queueContext);
const queueEvents = [];
let activeTasks = 0;
let maximumActiveTasks = 0;
function queuedTestTask(label, delay, priority) {
  return queueContext.enqueueMdictTask(() => new Promise((resolve) => {
    activeTasks += 1;
    maximumActiveTasks = Math.max(maximumActiveTasks, activeTasks);
    queueEvents.push(`${label}:start`);
    setTimeout(() => {
      queueEvents.push(`${label}:end`);
      activeTasks -= 1;
      resolve(label);
    }, delay);
  }), { priority, timeoutMs: 1000 });
}
const firstQueuedTask = queuedTestTask("first", 15, 10);
const lowQueuedTask = queuedTestTask("low", 1, 10);
const highQueuedTask = queuedTestTask("high", 1, 100);
await Promise.all([firstQueuedTask, lowQueuedTask, highQueuedTask]);
assert.equal(maximumActiveTasks, 1, "only one MDict task may run at a time");
assert.deepEqual(queueEvents, [
  "first:start", "first:end",
  "high:start", "high:end",
  "low:start", "low:end",
]);

console.log("Parola smoke tests passed.");
