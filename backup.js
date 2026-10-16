import "dotenv/config";
import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
const path = process.env.DB_PATH || "var/wordchamp.sqlite";
if (!existsSync(path)) throw Error("Databasen saknas. Starta appen först.");
mkdirSync("var/backups", { recursive: true, mode: 0o700 });
const destination =
  "var/backups/wordchamp-" +
  new Date().toISOString().replaceAll(":", "-") +
  ".sqlite";
const db = new DatabaseSync(path);
try {
  await backup(db, destination);
  chmodSync(destination, 0o600);
  console.log("Backup skapad: " + destination);
} finally {
  db.close();
}
