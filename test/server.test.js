import { test } from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io } from "socket.io-client";
import ExcelJS from "exceljs";
import { createApp } from "../server.js";
const password = "test-only-password-123";
const salt = "a".repeat(32);
function emit(s, event, data) {
  return new Promise((resolve, reject) =>
    s.timeout(3000).emit(event, data, (e, r) => (e ? reject(e) : resolve(r))),
  );
}
function connect(url, cookie) {
  return new Promise((resolve, reject) => {
    const s = io(url, {
      transports: ["websocket"],
      ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}),
    });
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });
}
test("real HTTP + Socket.IO: auth, QR, imports, multiplayer, reconnect, privacy, persistence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wordchamp-api-"));
  const server = createApp({
    dbPath: join(dir, "db"),
    secret: "s".repeat(64),
    passwordHash: salt + ":" + scryptSync(password, salt, 64).toString("hex"),
  });
  await new Promise((r) => server.http.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.http.address().port}`;
  const sockets = [];
  let cookie;
  async function req(path, method = "GET", body, auth = true) {
    const r = await fetch(url + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(auth && cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json(), headers: r.headers };
  }
  try {
    assert.equal((await req("/vocabulary")).status, 401);
    assert.equal((await req("/games", "POST")).status, 401);
    assert.equal(
      (await req("/login", "POST", { password: "bad" })).status,
      401,
    );
    const login = await req("/login", "POST", { password });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal((await req("/vocabulary")).data.length, 750);
    const imp = await req("/import", "POST", {
      format: "csv",
      content: "Vecka,Engelska,Svenska\n38,school,skola\n",
    });
    assert.equal(imp.data.imported, 1); // differing metadata is a distinct entry
    const again = await req("/import", "POST", {
      format: "csv",
      content: "Vecka,Engelska,Svenska\n38,school,skola\n",
    });
    assert.equal(again.data.imported, 0);
    const bad = await req("/import", "POST", {
      format: "csv",
      content: "Vecka,Engelska,Svenska\n38,test,test\n0,bad,bad\n",
    });
    assert.equal(bad.status, 400);
    assert.equal((await req("/vocabulary")).data.length, 751);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Glosor");
    sheet.addRows([
      ["Vecka", "Engelska", "Svenska", "Kapitel"],
      [38, "file test", "filtest", "Test"],
    ]);
    const x = await req("/import", "POST", {
      format: "xlsx",
      content: Buffer.from(await wb.xlsx.writeBuffer()).toString("base64"),
    });
    assert.equal(x.data.imported, 1);
    const inserted = (
      await req("/vocabulary", "POST", {
        week: 38,
        english: "edit test",
        swedish: "redigera",
        alternatives: "ändra",
        unit: "Unit",
        topic: "Topic",
        book: "Book",
      })
    ).data.id;
    assert.equal(
      (
        await req("/vocabulary/" + inserted, "PUT", {
          week: 39,
          english: "edited",
          swedish: "ändrad",
        })
      ).status,
      200,
    );
    assert.equal((await req("/vocabulary/" + inserted, "DELETE")).status, 200);
    const state = (await req("/games", "POST")).data;
    const g = server.games.get(state.pin);
    assert.equal(
      (
        await req(`/games/${state.pin}/start`, "POST", {
          weeks: [38, 39],
          direction: "en-sv",
        })
      ).status,
      400,
    );
    const qr = await fetch(url + `/api/games/${state.pin}/qr`, {
      headers: { Cookie: cookie },
    });
    assert.match(await qr.text(), /<svg/);
    const clients = await Promise.all([0, 1, 2].map(() => connect(url)));
    sockets.push(...clients);
    const joins = [];
    for (let i = 0; i < 3; i++)
      joins.push(
        await emit(clients[i], "join", { pin: state.pin, nickname: "P" + i }),
      );
    assert.ok((await emit(clients[0], "watch", { pin: state.pin })).error);
    assert.equal(
      (
        await req(
          `/games/${state.pin}/start`,
          "POST",
          { weeks: [38, 39], direction: "en-sv" },
          false,
        )
      ).status,
      401,
    );
    assert.ok(
      (
        await emit(await connectTracked(), "join", {
          pin: state.pin,
          nickname: "p0",
        })
      ).error,
    );
    async function connectTracked() {
      const s = await connect(url);
      sockets.push(s);
      return s;
    }
    const teacher = await connect(url, cookie);
    sockets.push(teacher);
    assert.ok((await emit(teacher, "watch", { pin: state.pin })).state);
    let broadcasts = 0;
    teacher.on("state", () => broadcasts++);
    const qs = [null, null, null];
    clients.forEach((s, i) => s.on("question", (q) => (qs[i] = q)));
    assert.equal(
      (
        await req(`/games/${state.pin}/start`, "POST", {
          weeks: [38, 39],
          direction: "en-sv",
        })
      ).status,
      200,
    );
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(qs.every(Boolean));
    assert.ok(qs.every((q) => !("correct" in q)));
    assert.equal(new Set(qs.map((q) => q.id)).size, 3);
    const p0 = g.players.get(joins[0].token);
    const first = qs[0];
    const a = await emit(clients[0], "answer", {
      id: first.id,
      choice: p0.question.correct,
    });
    assert.equal(a.streak, 1);
    assert.ok(
      (await emit(clients[0], "answer", { id: first.id, choice: 0 })).error,
    );
    const token = joins[0].token;
    clients[0].disconnect();
    clients[0] = await connectTracked();
    clients[0].on("question", (q) => (qs[0] = q));
    const resumed = await emit(clients[0], "join", {
      pin: state.pin,
      nickname: "",
      token,
    });
    assert.equal(resumed.player.streak, 1);
    assert.equal(g.players.size, 3);
    for (let step = 0; step < 15; step++)
      for (let i = 0; i < 3; i++) {
        const p = g.players.get(joins[i].token);
        if (p.rank) continue;
        if (!p.question) await emit(clients[i], "next", {});
        const q = p.question;
        const r = await emit(clients[i], "answer", {
          id: q.id,
          choice: q.correct,
        });
        assert.equal(r.correct, true);
      }
    assert.equal(g.status, "ended");
    assert.deepEqual(
      g.winners.map((p) => p.rank),
      [1, 2, 3],
    );
    assert.ok(broadcasts > 10);
    const stats = (await req("/stats")).data;
    assert.equal(stats.rounds.length, 1);
    assert.equal(stats.rounds[0].answers, 45);
    assert.ok(stats.words.length > 0);
    assert.ok(!JSON.stringify(stats).includes("P0"));
    await req(`/games/${state.pin}/start`, "POST", {
      weeks: [38, 39],
      direction: "mixed",
    });
    assert.equal(g.players.size, 3);
    assert.equal(g.players.get(token).streak, 0);
    const late = await connectTracked();
    assert.ok(
      (await emit(late, "join", { pin: state.pin, nickname: "Late" })).token,
    );
    assert.equal(g.players.size, 4);
    await req(`/games/${state.pin}/end`, "POST");
    assert.equal(g.status, "ended");
    await req("/logout", "POST");
    assert.ok((await emit(teacher, "watch", { pin: state.pin })).error);
    assert.equal((await req("/vocabulary")).status, 401);
  } finally {
    for (const s of sockets) s.disconnect();
    await server.close();
    rmSync(dir, { recursive: true });
  }
});

test("Render-style password and public origin support secure login and origin checks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wordchamp-render-"));
  const server = createApp({
    dbPath: join(dir, "db"),
    secret: "r".repeat(64),
    password: "render-test-password",
    publicUrl: "https://wordchamp-test.onrender.com/",
  });
  await new Promise((r) => server.http.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.http.address().port}`;
  try {
    const good = await fetch(base + "/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://wordchamp-test.onrender.com",
      },
      body: JSON.stringify({ password: "render-test-password" }),
    });
    assert.equal(good.status, 200);
    const bad = await fetch(base + "/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://other.example",
      },
      body: JSON.stringify({ password: "render-test-password" }),
    });
    assert.equal(bad.status, 403);
    const wrong = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" }),
    });
    assert.equal(wrong.status, 401);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true });
  }
  assert.throws(
    () => createApp({ secret: "r".repeat(64), password: "short" }),
    /12–1024/,
  );
});
