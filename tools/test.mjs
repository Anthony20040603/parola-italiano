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
assert.match(appSource, /function renderLibraryProgress\(\)/);

console.log("Parola smoke tests passed.");
