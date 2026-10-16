import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../game.js";
import { csvEntries, openDatabase } from "../db.js";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const words = csvEntries(
  readFileSync(new URL("../data/vocabulary.csv", import.meta.url), "utf8"),
).map((v, i) => ({ ...v, id: i + 1 }));
function answer(g, p, correct = true) {
  const q = g.question(p);
  return g.answer(
    p,
    q.id,
    correct ? p.question.correct : (p.question.correct + 1) % 4,
  );
}
test("authoritative 750-entry database is seeded once and survives reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "wordchamp-db-"));
  try {
    let { db } = openDatabase(join(dir, "db"));
    assert.equal(db.prepare("SELECT count(*) n FROM vocabulary").get().n, 750);
    const first = db.prepare("SELECT * FROM vocabulary WHERE id=1").get();
    assert.equal(first.english, "school");
    assert.equal(first.swedish, "skola");
    db.prepare(
      "UPDATE vocabulary SET alternatives='skolbyggnad' WHERE id=1",
    ).run();
    db.close();
    ({ db } = openDatabase(join(dir, "db")));
    assert.equal(db.prepare("SELECT count(*) n FROM vocabulary").get().n, 750);
    assert.equal(
      db.prepare("SELECT alternatives FROM vocabulary WHERE id=1").get()
        .alternatives,
      "skolbyggnad",
    );
    db.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test("server validates answers, resets streak and rejects replay/tampering", () => {
  const g = new Game("123456");
  const p = g.join("Nova");
  g.start(words, "mixed");
  assert.equal(answer(g, p).streak, 1);
  assert.equal(answer(g, p).streak, 2);
  assert.equal(answer(g, p, false).streak, 0);
  const q = g.question(p);
  assert.equal("correct" in q, false);
  assert.throws(() => g.answer(p, q.id, 99));
  g.answer(p, q.id, p.question.correct);
  assert.throws(() => g.answer(p, q.id, 0));
  assert.throws(() => g.answer(p, "forged", 0));
});
test("three simultaneous finishers get unique ordered ranks and end automatically", () => {
  const g = new Game("123456");
  const players = ["A", "B", "C", "D"].map((n) => g.join(n));
  g.start(words, "en-sv");
  for (let i = 0; i < 14; i++) for (const p of players) answer(g, p);
  for (const p of players.slice(0, 3)) answer(g, p);
  assert.deepEqual(
    g.winners.map((w) => w.rank),
    [1, 2, 3],
  );
  assert.equal(g.status, "ended");
  assert.equal(g.result.answers, 59);
  assert.throws(() => answer(g, players[3]));
});
test("one or two participants finish without waiting for three", () => {
  for (const n of [1, 2]) {
    const g = new Game("123456");
    const ps = Array.from({ length: n }, (_, i) => g.join("P" + i));
    g.start(words, "sv-en");
    for (const p of ps) for (let i = 0; i < 15; i++) answer(g, p);
    assert.equal(g.status, "ended");
    assert.equal(g.result.winners.length, n);
  }
});
test("duplicate nicknames rejected, token resumes, late joiners and next rounds work", () => {
  const g = new Game("123456");
  const p = g.join("Nova");
  assert.throws(() => g.join("nova"));
  assert.equal(g.join("", p.token), p);
  g.start(words, "mixed");
  answer(g, p);
  const late = g.join("Alex");
  assert.equal(g.question(late), null);
  assert.throws(() => g.answer(late, "forged", 0));
  assert.equal(g.join("", p.token), p);
  assert.ok(g.question(p));
  g.end();
  g.start(words, "sv-en");
  assert.equal(p.streak, 0);
  assert.equal(p.rank, null);
  assert.equal(g.players.size, 2);
  assert.equal(g.round, 2);
  assert.equal(g.question(p).direction, "sv-en");
  assert.ok(g.question(late));
});
test("round vocabulary prioritizes unused words, then reuses exhausted pool", () => {
  const g = new Game("123456");
  const pool = words.slice(0, 65);
  g.start(pool, "en-sv");
  const first = g.words.map((w) => w.id);
  g.end();
  g.start(pool, "en-sv");
  const second = g.words.map((w) => w.id);
  assert.equal(second.filter((id) => first.includes(id)).length, 0);
  g.end();
  g.start(pool, "en-sv");
  assert.equal(g.words.length, 30);
  assert.equal(new Set(g.words.map((w) => w.id)).size, 30);
  assert.equal(
    g.words.filter((w) => ![...first, ...second].includes(w.id)).length,
    5,
  );
});
test("minimum pool and direction validation", () => {
  const g = new Game("123456");
  assert.throws(() => g.start(words.slice(0, 25), "en-sv"));
  assert.throws(() => g.start(words, "invalid"));
});

test("waiting before start and late arrivals cannot change the winner threshold", () => {
  const g = new Game("123456");
  const p = g.join("Ready");
  assert.equal(g.question(p), null);
  assert.throws(() => g.answer(p, "forged", 0));
  g.start(words, "en-sv");
  const late = g.join("Waiting");
  assert.equal(g.question(late), null);
  for (let i = 0; i < 15; i++) answer(g, p);
  assert.equal(g.status, "ended");
  assert.equal(g.result.participants, 1);
  g.start(words, "en-sv");
  assert.ok(g.question(late));
  assert.equal(g.roundPlayers.size, 2);
});
