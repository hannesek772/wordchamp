import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scryptSync } from "node:crypto";
import { createApp } from "../server.js";
process.env.PUBLIC_URL = "http://127.0.0.1:3100";
process.env.NODE_ENV = "test";
const salt = "b".repeat(32);
const s = createApp({
  dbPath: join(mkdtempSync(join(tmpdir(), "wordchamp-browser-")), "db"),
  secret: "x".repeat(64),
  passwordHash:
    salt + ":" + scryptSync("browser-test-password", salt, 64).toString("hex"),
});
s.http.listen(3100, "127.0.0.1");
