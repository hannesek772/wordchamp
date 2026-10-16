import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse } from "csv-parse/sync";
export function validateEntry(v) {
  const out = {};
  for (const k of [
    "english",
    "swedish",
    "alternatives",
    "unit",
    "topic",
    "book",
  ]) {
    out[k] = String(v[k] ?? "").trim();
    if (out[k].length > 500) throw Error("Textfält får vara högst 500 tecken.");
  }
  out.week = Number(v.week);
  if (
    !Number.isInteger(out.week) ||
    out.week < 1 ||
    out.week > 53 ||
    !out.english ||
    !out.swedish
  )
    throw Error("Ange engelska, svenska och vecka 1–53.");
  return out;
}
export function csvEntries(text) {
  const rows = parse(text, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  return rows.map((r) =>
    validateEntry({
      week: r.Vecka ?? r.week,
      english: r.Engelska ?? r.english,
      swedish: r.Svenska ?? r.swedish,
      alternatives: r["Alternativa översättningar"] ?? r.alternatives,
      unit: r.Kapitel ?? r.unit,
      topic: r.Tema ?? r.topic,
      book: r["Läromedel"] ?? r.book,
    }),
  );
}
export function openDatabase(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS vocabulary(id INTEGER PRIMARY KEY, week INTEGER NOT NULL,english TEXT NOT NULL,swedish TEXT NOT NULL,alternatives TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT '',topic TEXT NOT NULL DEFAULT '',book TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE IF NOT EXISTS word_stats(vocabulary_id INTEGER PRIMARY KEY REFERENCES vocabulary(id) ON DELETE CASCADE,attempts INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS rounds(id INTEGER PRIMARY KEY,ended_at TEXT NOT NULL,participants INTEGER NOT NULL,answers INTEGER NOT NULL,correct INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS auth_sessions(sid TEXT PRIMARY KEY,data TEXT NOT NULL,expires INTEGER NOT NULL);`);
  const insert = db.prepare(
    "INSERT INTO vocabulary(week,english,swedish,alternatives,unit,topic,book) VALUES(@week,@english,@swedish,@alternatives,@unit,@topic,@book)",
  );
  function importEntries(entries) {
    if (!entries.length || entries.length > 10000)
      throw Error("Importera mellan 1 och 10 000 glosor.");
    const clean = entries.map(validateEntry);
    let count = 0;
    db.exec("BEGIN");
    try {
      const exists = db.prepare(
        "SELECT id FROM vocabulary WHERE week=? AND english=? AND swedish=? AND unit=? AND topic=? AND book=? AND alternatives=?",
      );
      for (const v of clean)
        if (
          !exists.get(
            v.week,
            v.english,
            v.swedish,
            v.unit,
            v.topic,
            v.book,
            v.alternatives,
          )
        ) {
          insert.run(v);
          count++;
        }
      db.exec("COMMIT");
      return count;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  if (!db.prepare("SELECT value FROM metadata WHERE key='seeded'").get()) {
    importEntries(
      csvEntries(
        readFileSync(new URL("./data/vocabulary.csv", import.meta.url), "utf8"),
      ),
    );
    db.prepare("INSERT INTO metadata VALUES('seeded','1')").run();
  }
  return { db, importEntries, insert };
}
