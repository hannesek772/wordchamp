import "dotenv/config";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  scryptSync,
  timingSafeEqual,
  randomInt,
  randomBytes,
} from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import QRCode from "qrcode";
import { openDatabase, csvEntries, validateEntry } from "./db.js";
import { Game } from "./game.js";
export function createApp(config = {}) {
  const secret = config.secret ?? process.env.SESSION_SECRET;
  let passwordHash = config.passwordHash ?? process.env.TEACHER_PASSWORD_HASH;
  const plainPassword = config.password ?? process.env.TEACHER_PASSWORD;
  if (config.password !== undefined || (!passwordHash && plainPassword)) {
    if (plainPassword.length < 12 || plainPassword.length > 1024)
      throw Error("TEACHER_PASSWORD must contain 12–1024 characters.");
    const salt = randomBytes(16).toString("hex");
    passwordHash = `${salt}:${scryptSync(plainPassword, salt, 64).toString("hex")}`;
  }
  const publicUrl = (
    config.publicUrl ??
    process.env.PUBLIC_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    ""
  ).replace(/\/$/, "");
  if (
    !secret ||
    secret.length < 32 ||
    !/^([a-f0-9]{32}):([a-f0-9]{128})$/.test(passwordHash ?? "")
  )
    throw Error(
      "Configure SESSION_SECRET (32+ characters) and TEACHER_PASSWORD_HASH (or TEACHER_PASSWORD) in the environment. See README.md.",
    );
  const production = process.env.NODE_ENV === "production";
  const { db, importEntries, insert } = openDatabase(
    config.dbPath ?? process.env.DB_PATH ?? "var/wordchamp.sqlite",
  );
  const app = express();
  const http = createServer(app);
  const games = new Map();
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'"],
          "connect-src": ["'self'", "ws:", "wss:"],
          "img-src": ["'self'", "data:"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "8mb" }));
  class Store extends session.Store {
    get(sid, cb) {
      try {
        const r = db
          .prepare("SELECT data FROM auth_sessions WHERE sid=? AND expires>?")
          .get(sid, Date.now());
        cb(null, r ? JSON.parse(r.data) : null);
      } catch (e) {
        cb(e);
      }
    }
    set(sid, data, cb = () => {}) {
      try {
        db.prepare("INSERT OR REPLACE INTO auth_sessions VALUES(?,?,?)").run(
          sid,
          JSON.stringify(data),
          Date.now() + 8 * 3600000,
        );
        cb();
      } catch (e) {
        cb(e);
      }
    }
    destroy(sid, cb = () => {}) {
      try {
        db.prepare("DELETE FROM auth_sessions WHERE sid=?").run(sid);
        cb();
      } catch (e) {
        cb(e);
      }
    }
  }
  const sessions = session({
    secret,
    store: new Store(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: production,
      maxAge: 8 * 3600000,
    },
  });
  app.use(sessions);
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const expected = publicUrl || `${req.protocol}://${req.headers.host}`;
    return origin === expected;
  }
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method) && !sameOrigin(req))
      return res.status(403).json({ error: "Otillåtet ursprung." });
    next();
  });
  const auth = (req, res, next) =>
    req.session.teacher
      ? next()
      : res.status(401).json({ error: "Logga in som lärare." });
  const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res)).catch(next);
  app.get("/api/auth", (req, res) =>
    res.json({ teacher: !!req.session.teacher }),
  );
  app.post(
    "/api/login",
    rateLimit({
      windowMs: 15 * 60000,
      limit: 15,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: {
        error: "För många inloggningsförsök. Försök igen om 15 minuter.",
      },
    }),
    (req, res, next) => {
      const password = String(req.body.password ?? "");
      const [salt, hash] = passwordHash.split(":");
      if (
        password.length > 1024 ||
        !timingSafeEqual(
          scryptSync(password, salt, 64),
          Buffer.from(hash, "hex"),
        )
      )
        return res.status(401).json({ error: "Fel lösenord." });
      req.session.regenerate((e) => {
        if (e) return next(e);
        req.session.teacher = true;
        req.session.save((e) => (e ? next(e) : res.json({ ok: true })));
      });
    },
  );
  app.post("/api/logout", auth, (req, res) =>
    req.session.destroy(() => res.json({ ok: true })),
  );
  app.get("/api/vocabulary", auth, (req, res) =>
    res.json(db.prepare("SELECT * FROM vocabulary ORDER BY week,id").all()),
  );
  app.post(
    "/api/vocabulary",
    auth,
    wrap((req, res) => {
      const v = validateEntry(req.body);
      res.json({ id: Number(insert.run(v).lastInsertRowid) });
    }),
  );
  app.put(
    "/api/vocabulary/:id",
    auth,
    wrap((req, res) => {
      const v = validateEntry(req.body);
      const r = db
        .prepare(
          "UPDATE vocabulary SET week=@week,english=@english,swedish=@swedish,alternatives=@alternatives,unit=@unit,topic=@topic,book=@book WHERE id=@id",
        )
        .run({ ...v, id: Number(req.params.id) });
      if (!r.changes) throw Error("Glosan saknas.");
      res.json({ ok: true });
    }),
  );
  app.delete("/api/vocabulary/:id", auth, (req, res) => {
    db.prepare("DELETE FROM vocabulary WHERE id=?").run(Number(req.params.id));
    res.json({ ok: true });
  });
  app.post(
    "/api/import",
    auth,
    wrap(async (req, res) => {
      let entries;
      if (req.body.format === "xlsx") {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(
          Buffer.from(String(req.body.content), "base64"),
        );
        const sheet = workbook.worksheets[0];
        if (!sheet) throw Error("Arbetsboken saknar blad.");
        const headers = sheet.getRow(1).values.slice(1).map(String);
        const rows = [];
        if (sheet.rowCount > 10001) throw Error("Högst 10 000 rader.");
        sheet.eachRow((row, n) => {
          if (n === 1) return;
          const r = {};
          headers.forEach((h, i) => (r[h] = row.getCell(i + 1).text));
          rows.push(r);
        });
        // Reuse exactly the same CSV header mapping and validation for Excel.
        const lines = [headers, ...rows.map((r) => headers.map((h) => r[h]))]
          .map((row) =>
            row
              .map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"')
              .join(","),
          )
          .join("\n");
        entries = csvEntries(lines);
      } else if (req.body.format === "csv")
        entries = csvEntries(String(req.body.content));
      else throw Error("Välj CSV eller XLSX.");
      res.json({ imported: importEntries(entries), total: entries.length });
    }),
  );
  app.get("/api/stats", auth, (req, res) =>
    res.json({
      rounds: db
        .prepare("SELECT * FROM rounds ORDER BY id DESC LIMIT 100")
        .all(),
      words: db
        .prepare(
          "SELECT v.*,s.attempts,s.errors FROM word_stats s JOIN vocabulary v ON v.id=s.vocabulary_id WHERE s.attempts>0 ORDER BY 1.0*s.errors/s.attempts DESC,s.attempts DESC LIMIT 20",
        )
        .all(),
    }),
  );
  function persisted(game) {
    const r = game.result;
    db.exec("BEGIN");
    try {
      db.prepare(
        "INSERT INTO rounds(ended_at,participants,answers,correct) VALUES(?,?,?,?)",
      ).run(new Date().toISOString(), r.participants, r.answers, r.correct);
      const q = db.prepare(
        "INSERT INTO word_stats VALUES(?,?,?) ON CONFLICT(vocabulary_id) DO UPDATE SET attempts=attempts+excluded.attempts,errors=errors+excluded.errors",
      );
      for (const s of game.stats.values())
        if (db.prepare("SELECT id FROM vocabulary WHERE id=?").get(s.id))
          q.run(s.id, s.attempts, s.errors);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  app.get("/api/games", auth, (req, res) =>
    res.json([...games.values()].map((g) => g.state())),
  );
  app.post("/api/games", auth, (req, res) => {
    if (games.size >= 100)
      return res.status(400).json({ error: "Stäng ett äldre rum först." });
    let pin;
    do {
      pin = String(randomInt(100000, 1000000));
    } while (games.has(pin));
    const game = new Game(pin, persisted);
    games.set(pin, game);
    res.json(game.state());
  });
  const getGame = (req) => {
    const g = games.get(req.params.pin);
    if (!g) throw Error("Spelrummet finns inte eller har stängts.");
    return g;
  };
  app.get(
    "/api/games/:pin/qr",
    auth,
    wrap(async (req, res) => {
      const g = getGame(req);
      const base = publicUrl || `${req.protocol}://${req.headers.host}`;
      res.type("svg").send(
        await QRCode.toString(`${base}/?pin=${g.pin}`, {
          type: "svg",
          margin: 2,
        }),
      );
    }),
  );
  app.post(
    "/api/games/:pin/start",
    auth,
    wrap((req, res) => {
      const g = getGame(req);
      const weeks = req.body.weeks;
      if (!Array.isArray(weeks) || !weeks.length || weeks.length > 53)
        throw Error("Välj minst en vecka.");
      const pool = db
        .prepare(
          `SELECT * FROM vocabulary WHERE week IN (${weeks.map(() => "?").join(",")})`,
        )
        .all(...weeks.map(Number));
      g.start(pool, req.body.direction);
      broadcast(g);
      for (const s of io.sockets.sockets.values())
        if (s.data.pin === g.pin && s.data.token) sendQuestion(s, g);
      res.json(g.state());
    }),
  );
  app.post(
    "/api/games/:pin/end",
    auth,
    wrap((req, res) => {
      const g = getGame(req);
      g.end();
      broadcast(g);
      res.json(g.state());
    }),
  );
  app.delete(
    "/api/games/:pin",
    auth,
    wrap((req, res) => {
      const g = getGame(req);
      if (g.status === "active") g.end();
      io.to(g.pin).emit("closed");
      io.in(g.pin).socketsLeave(g.pin);
      games.delete(g.pin);
      res.json({ ok: true });
    }),
  );
  app.get("/health", (_, res) => res.json({ ok: true }));
  app.use(express.static(resolve("public")));
  app.use((err, req, res, next) => {
    console.error("Request failed:", err.message);
    res.status(400).json({
      error: err.message.includes("SQLITE")
        ? "Databasåtgärden misslyckades."
        : err.message,
    });
  });
  const io = new Server(http, {
    maxHttpBufferSize: 10000,
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      const expected = publicUrl || `http://${req.headers.host}`;
      cb(null, !origin || origin === expected);
    },
  });
  io.engine.use(sessions);
  function broadcast(g) {
    io.to(g.pin).emit("state", g.state());
  }
  function sendQuestion(socket, g) {
    const p = g.players.get(socket.data.token);
    if (p) socket.emit("question", g.question(p));
  }
  io.on("connection", (socket) => {
    let count = 0;
    const timer = setInterval(() => (count = 0), 10000);
    timer.unref();
    const handle = (name, fn) =>
      socket.on(name, async (data = {}, ack = () => {}) => {
        if (typeof ack !== "function") return;
        try {
          if (++count > 60)
            throw Error("För många förfrågningar. Vänta en stund.");
          await fn(data, ack);
        } catch (e) {
          ack({ error: e.message });
        }
      });
    handle("watch", async ({ pin }, ack) => {
      await new Promise((resolve, reject) =>
        socket.request.session.reload((e) =>
          e ? reject(Error("Logga in igen.")) : resolve(),
        ),
      );
      if (!socket.request.session.teacher) throw Error("Logga in som lärare.");
      const g = games.get(String(pin));
      if (!g) throw Error("Rummet saknas.");
      socket.join(g.pin);
      ack({ state: g.state() });
    });
    handle("join", ({ pin, nickname, token }, ack) => {
      if (socket.data.token) throw Error("Du är redan ansluten.");
      const g = games.get(String(pin));
      if (!g) throw Error("Ingen match med denna PIN.");
      const p = g.join(nickname, token);
      socket.data.pin = g.pin;
      socket.data.token = p.token;
      p.connected = true;
      socket.join(g.pin);
      // One active browser per resume token.
      for (const other of io.sockets.sockets.values())
        if (other.id !== socket.id && other.data.token === p.token) {
          other.emit("replaced");
          other.disconnect(true);
        }
      ack({
        token: p.token,
        player: { id: p.id, name: p.name, streak: p.streak, rank: p.rank },
        state: g.state(),
      });
      broadcast(g);
      sendQuestion(socket, g);
    });
    handle("next", (_, ack) => {
      const g = games.get(socket.data.pin);
      if (!g) throw Error("Anslut till ett rum först.");
      sendQuestion(socket, g);
      ack({ ok: true });
    });
    handle("answer", ({ id, choice }, ack) => {
      const g = games.get(socket.data.pin);
      const p = g?.players.get(socket.data.token);
      if (!p) throw Error("Anslut till ett rum först.");
      const result = g.answer(p, id, choice);
      ack(result);
      broadcast(g);
    });
    socket.on("disconnect", () => {
      clearInterval(timer);
      const g = games.get(socket.data.pin);
      const p = g?.players.get(socket.data.token);
      if (p) {
        p.connected = [...io.sockets.sockets.values()].some(
          (s) => s.data.token === p.token,
        );
        broadcast(g);
      }
    });
  });
  const cleanup = setInterval(() => {
    db.prepare("DELETE FROM auth_sessions WHERE expires<?").run(Date.now());
    for (const [pin, g] of games)
      if (Date.now() - g.touched > 8 * 3600000) {
        io.to(pin).emit("closed");
        io.in(pin).socketsLeave(pin);
        games.delete(pin);
      }
  }, 60000);
  cleanup.unref();
  return {
    app,
    http,
    io,
    db,
    games,
    close: () =>
      new Promise((resolve) => {
        clearInterval(cleanup);
        io.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const { http } = createApp();
    http.listen(
      Number(process.env.PORT) || 3000,
      process.env.HOST || "0.0.0.0",
      () =>
        console.log(
          "WordChamp listening on port " + (process.env.PORT || 3000),
        ),
    );
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
