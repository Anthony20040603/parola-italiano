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

const fsrsScript = html.indexOf('src="vendor/ts-fsrs-5.4.2.umd.js"');
const requireScript = html.indexOf('src="vendor/require.js"');
assert.ok(fsrsScript >= 0 && fsrsScript < requireScript, "FSRS must load before the app bootstrap");
assert.match(html, /data-rating="1"/);
assert.match(html, /id="spelling-form"/);
assert.match(html, /id="open-library-progress"/);
assert.match(html, /id="library-progress-dialog"/);
assert.match(html, /id="learn-five-more"/);
assert.match(html, /id="review-more"/);
assert.match(html, /id="dictionary-manager"/);
assert.match(html, /id="dict-file"[^>]*multiple/);
assert.match(html, /id="reference-dictionaries"/);
assert.match(html, /id="dictionary-compatibility"/);
assert.match(appSource, /function renderLibraryProgress\(\)/);
assert.match(appSource, /function startMixedExtraSession\(\)/);
assert.match(appSource, /var PROGRESS_VERSION = 3/);
assert.match(appSource, /function rememberDictionarySet\(\)/);
assert.match(appSource, /function restoreDictionarySet\(\)/);
assert.match(appSource, /function loadReferenceLookup\(dictionary\)/);
assert.match(appSource, /function showReferenceDictionaries\(\)/);
assert.match(appSource, /function ensureDictionaryHash\(dictionary\)/);
assert.match(appSource, /function analyzeChineseClue\(definition, word\)/);
assert.match(appSource, /function scanLearningCompatibility\(dictionary\)/);

console.log("Parola smoke tests passed.");
