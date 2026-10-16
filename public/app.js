const $ = (s) => document.querySelector(s);
const app = $("#app");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let teacher = false,
  tab = "games",
  vocabulary = [],
  games = [],
  selected = null,
  socket = null,
  student = null,
  question = null,
  feedback = null,
  currentState = null,
  search = "",
  weekFilter = "",
  chosenWeeks = new Set(),
  direction = "en-sv",
  answerPending = false;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").style.display = "none"), 5000);
}
async function api(path, method = "GET", data) {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const body = await r.json();
  if (!r.ok) throw Error(body.error || "Något gick fel.");
  return body;
}
function bind(selector, event, fn) {
  const el = $(selector);
  if (el) el.addEventListener(event, fn);
}
function action(fn) {
  return async (e) => {
    try {
      await fn(e);
    } catch (err) {
      toast(err.message);
    }
  };
}
function setHeader() {
  $("#teacher-link").classList.toggle("hidden", teacher);
  $("#logout").classList.toggle("hidden", !teacher);
}
function joinPage() {
  const pin = new URLSearchParams(location.search).get("pin") || "";
  app.innerHTML = `<section class="hero"><div class="hero-copy"><p class="eyebrow"><span class="dot"></span> YOUR NEXT WIN STARTS HERE</p><h1>Small words.<br>Big streaks.<br><em>Be the champ.</em></h1><p class="muted">15 in a row. Can you be the champion?<br>Utmana dig själv, träna glosor och ta dig hela vägen till toppen.</p><div class="pills"><span class="pill"><span>✓</span> Inget konto behövs</span><span class="pill"><span>→</span> Spela tillsammans</span><span class="pill"><span>✦</span> Lär dig på vägen</span></div></div><div class="join-card"><div class="card-icon">→</div><h2>Redo för en utmaning?</h2><p class="muted">Häng med i klassen. Ange koden från din lärare.</p><form id="join-form"><div class="field"><label for="pin">Spelkod</label><input id="pin" name="pin" class="pin-input" placeholder="000000" value="${esc(pin)}" inputmode="numeric" autocomplete="off" pattern="[0-9]{6}" maxlength="6" required aria-describedby="pin-hint"></div><div class="field"><label for="nickname">Ditt smeknamn</label><input id="nickname" name="nickname" placeholder="Vad vill du kallas?" maxlength="24" autocomplete="off" required><p class="help" style="text-align:left">Välj ett smeknamn, inte ditt fullständiga namn.</p></div><p class="error" id="join-error" role="alert"></p><button class="btn full" type="submit">Hoppa in i spelet <span>→</span></button><p class="help" id="pin-hint">6 siffror. 15 rätt i rad. En ny mästare.</p></form></div></section><section class="how"><div class="step"><span class="step-num">01</span><div><h3>Hitta ditt spel</h3><p>Skanna QR-koden eller ange lärarens spelkod.</p></div></div><div class="step"><span class="step-num">02</span><div><h3>Bygg din streak</h3><p>Välj rätt översättning. Ett fel och du börjar om. Ingen tidspress.</p></div></div><div class="step"><span class="step-num">03</span><div><h3>Ta plats på pallen</h3><p>Nå 15 rätt i rad. De tre första tar hem segern!</p></div></div></section>`;
  bind(
    "#join-form",
    "submit",
    action(async (e) => {
      e.preventDefault();
      $("#join-error").textContent = "";
      const button = $("#join-form button");
      button.disabled = true;
      try {
        await join($("#pin").value, $("#nickname").value);
      } catch (err) {
        $("#join-error").textContent = err.message;
        button.disabled = false;
      }
    }),
  );
}
function makeSocket() {
  if (socket) return socket;
  socket = io({ autoConnect: false });
  socket.on("state", (state) => {
    if (student && state.pin === student.pin) {
      currentState = state;
      const p = state.players.find((p) => p.id === student.id);
      if (p) {
        student.streak = p.streak;
        student.rank = p.rank;
      }
      if (state.round !== student.round) {
        student.round = state.round;
        student.streak = 0;
        student.rank = null;
        question = null;
        feedback = null;
        answerPending = false;
      }
      renderStudent();
    } else if (teacher && selected?.pin === state.pin) {
      selected = state;
      renderLive();
    }
  });
  socket.on("question", (q) => {
    question = q;
    feedback = null;
    answerPending = false;
    if (student) renderStudent();
  });
  socket.on("disconnect", () => {
    if (student) updateConnection();
  });
  socket.on("connect", async () => {
    if (student) {
      try {
        const r = await emit("join", {
          pin: student.pin,
          nickname: student.name,
          token: student.token,
        });
        Object.assign(student, r.player, { round: r.state.round });
        currentState = r.state;
        renderStudent();
      } catch (e) {
        toast(e.message);
        leaveStudent();
      }
    } else if (teacher && selected) watch();
    updateConnection();
  });
  socket.on("closed", () => {
    if (student) {
      toast("Läraren har stängt spelrummet.");
      leaveStudent();
    } else if (teacher) {
      selected = null;
      loadTeacher();
    }
  });
  socket.on("replaced", () => {
    toast("Spelet öppnades i en annan flik.");
    leaveStudent();
  });
  return socket;
}
function emit(name, data) {
  return new Promise((resolve, reject) => {
    socket.timeout(8000).emit(name, data, (err, result) => {
      if (err) return reject(Error("Anslutningen avbröts. Försök igen."));
      if (result?.error) return reject(Error(result.error));
      resolve(result);
    });
  });
}
async function connected() {
  makeSocket();
  if (socket.connected) return;
  socket.connect();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("connect", ok);
      reject(Error("Kunde inte ansluta till servern."));
    }, 10000);
    function ok() {
      clearTimeout(timer);
      resolve();
    }
    socket.once("connect", ok);
  });
}
async function join(pin, nickname, token) {
  await connected();
  const r = await emit("join", { pin, nickname, token });
  student = { ...r.player, pin, token: r.token, round: r.state.round };
  currentState = r.state;
  sessionStorage.setItem("wordchamp-player", JSON.stringify(student));
  location.hash = "play";
  renderStudent();
}
function leaveStudent() {
  sessionStorage.removeItem("wordchamp-player");
  student = null;
  question = null;
  feedback = null;
  socket?.disconnect();
  socket = null;
  location.hash = "";
  joinPage();
}
function updateConnection() {
  const e = $("#connection");
  if (e) {
    e.textContent = socket?.connected ? "● Ansluten" : "◌ Återansluter…";
    e.classList.toggle("online", !!socket?.connected);
  }
  document
    .querySelectorAll(".answer")
    .forEach(
      (b) => (b.disabled = !socket?.connected || !!feedback || answerPending),
    );
}
function leaderboard(state) {
  return state.players.length
    ? state.players
        .map(
          (p, i) =>
            `<div class="rank-row ${p.rank ? "winner" : ""}"><span class="rank-number">${p.rank ? ["🥇", "🥈", "🥉"][p.rank - 1] : String(i + 1).padStart(2, "0")}</span><div class="avatar">${esc(p.name.slice(0, 2).toUpperCase())}</div><div><div class="rank-name"><span>${esc(p.name)}</span>${!p.connected ? '<span class="offline">Offline</span>' : ""}</div><div class="track"><div style="width:${(p.streak / 15) * 100}%"></div></div></div><div class="rank-score">${p.streak}<small> / 15</small></div></div>`,
        )
        .join("")
    : '<div class="empty"><span class="big">✦</span>Här börjar nästa vinst.<br>Väntar på att eleverna ansluter.</div>';
}
function results(r) {
  return `<p class="eyebrow">ROUND ${r.round} · KLART</p><h2>Meet the champions.</h2><div class="podium">${[
    2, 1, 3,
  ]
    .map((rank) => {
      const p = r.winners.find((p) => p.rank === rank);
      return `<div class="podium-place ${rank === 1 ? "first" : ""}"><strong>${["🥇", "🥈", "🥉"][rank - 1]}</strong><span>${p ? esc(p.name) : "Ingen placering"}</span></div>`;
    })
    .join(
      "",
    )}</div><div class="metric-grid"><div class="metric"><span class="labelcaps">Deltagare</span><strong>${r.participants}</strong></div><div class="metric"><span class="labelcaps">Rätt svar</span><strong>${r.percentage}%</strong></div><div class="metric"><span class="labelcaps">Besvarade</span><strong>${r.answers}</strong></div></div><h3>Lite mer träning på…</h3>${
    r.hardest.filter((w) => w.errors).length
      ? `<div class="table-scroll"><table><thead><tr><th>Glosa</th><th>Översättning</th><th>Fel / svar</th></tr></thead><tbody>${r.hardest
          .filter((w) => w.errors)
          .map(
            (w) =>
              `<tr><td>${esc(w.english)}</td><td>${esc(w.swedish)}</td><td>${w.errors}/${w.attempts} · ${Math.round(w.rate * 100)}%</td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : '<p class="muted">Inga felaktiga svar registrerade.</p>'
  }`;
}
function renderStudent() {
  if (!student || !currentState) return;
  const s = currentState;
  const me = s.players.find((p) => p.id === student.id);
  if (me) {
    student.streak = me.streak;
    student.rank = me.rank;
  }
  app.innerHTML = `<section class="student"><div class="student-top"><span class="student-name">${esc(student.name)} <span class="pill">${s.pin}</span></span><span id="connection" class="connection"></span></div>${s.status === "ended" ? `<div class="panel">${results(s.result)}<p class="help">Häng kvar! Du är med när läraren startar nästa runda.</p></div>` : s.status === "lobby" || (s.status === "active" && !s.roundPlayerIds.includes(student.id)) ? `<div class="panel"><div class="empty"><span class="big">✦</span><h2>Du är med, ${esc(student.name)}!</h2><p>${s.status === "active" ? "Rundan har redan startat. Du väntar här tills läraren startar nästa runda." : "Vänta här tills läraren trycker på startknappen. Alla börjar samtidigt."}</p><span class="pill">${s.participants} deltagare i rummet</span></div></div>` : student.rank ? `<div class="panel"><div class="empty"><span class="big">${["🥇", "🥈", "🥉"][student.rank - 1]}</span><h2>Du är en champion!</h2><p>Du kom på plats ${student.rank}. Vänta på resten av klassen.</p></div>${leaderboard(s)}</div>` : `<div class="streak-card"><div class="streak-top"><span class="labelcaps">DIN STREAK · RUNDA ${s.round}</span><strong>${student.streak} <span class="muted" style="font-size:14px">/ 15</span></strong></div><div class="segments">${Array.from({ length: 15 }, (_, i) => `<span class="${i < student.streak ? "filled" : ""}"></span>`).join("")}</div></div>${question ? `<div class="question"><span class="labelcaps">${question.direction === "en-sv" ? "ENGELSKA → SVENSKA" : "SVENSKA → ENGELSKA"}</span><h1>${esc(question.prompt)}</h1><p class="muted">Välj rätt översättning</p></div><div class="answers">${question.options.map((o, i) => `<button class="answer ${feedback ? (i === feedback.correctIndex ? "correct" : i === feedback.choice ? "wrong" : "") : ""}" data-choice="${i}" ${feedback || answerPending ? "disabled" : ""}><span>${["A", "B", "C", "D"][i]}</span>${esc(o)}</button>`).join("")}</div><div class="feedback" role="status">${feedback ? `<strong class="${feedback.correct ? "" : "incorrect"}">${feedback.correct ? "Rätt! Snyggt jobbat." : "Inte riktigt. Rätt svar är " + esc(question.options[feedback.correctIndex]) + ". Streaken börjar om."}</strong><button class="btn" id="next">Nästa glosa →</button>` : '<span class="help">Ta din tid. Varje rätt svar tar dig närmare toppen.</span>'}</div>` : '<div class="empty">Hämtar nästa glosa…</div>'}`}</section>`;
  document.querySelectorAll("[data-choice]").forEach((b) =>
    b.addEventListener(
      "click",
      action(async () => {
        if (answerPending || feedback) return;
        answerPending = true;
        updateConnection();
        const choice = Number(b.dataset.choice);
        try {
          const r = await emit("answer", { id: question.id, choice });
          feedback = { ...r, choice };
          student.streak = r.streak;
          student.rank = r.rank;
          renderStudent();
        } catch (e) {
          answerPending = false;
          toast(e.message);
          updateConnection();
        }
      }),
    ),
  );
  bind(
    "#next",
    "click",
    action(async () => {
      await emit("next", {});
    }),
  );
  updateConnection();
}
function loginPage() {
  app.innerHTML = `<section class="login join-card"><div class="card-icon">✦</div><p class="eyebrow">TEACHER SPACE</p><h2>Välkommen tillbaka.</h2><p class="muted">Skapa nästa utmaning för din klass.</p><form id="login"><div class="field"><label for="password">Lärarlösenord</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><p class="error" id="login-error" role="alert"></p><button class="btn full">Logga in →</button></form><p class="help">Elever ansluter på startsidan utan konto.</p></section>`;
  bind("#login", "submit", async (e) => {
    e.preventDefault();
    const b = $("#login button");
    b.disabled = true;
    try {
      await api("/login", "POST", { password: $("#password").value });
      teacher = true;
      setHeader();
      await loadTeacher();
    } catch (e) {
      $("#login-error").textContent = e.message;
      b.disabled = false;
    }
  });
}
async function loadTeacher() {
  [vocabulary, games] = await Promise.all([api("/vocabulary"), api("/games")]);
  if (selected) selected = games.find((g) => g.pin === selected.pin) || null;
  renderTeacher();
}
function renderTeacher() {
  app.innerHTML = `<div class="page-head"><div><p class="eyebrow">LET'S MAKE LEARNING STICK</p><h1>Lärarrummet<span class="accent">.</span></h1><p class="muted">Lite tävling. Mycket lärande.</p></div><span class="pill" id="bank-summary">✦ ${vocabulary.length} glosor · ${new Set(vocabulary.map((v) => v.week)).size} veckor</span></div><nav class="tabs" aria-label="Lärarverktyg">${[
    ["games", "Spelrum"],
    ["vocabulary", "Glosbanken"],
    ["stats", "Statistik"],
  ]
    .map(
      ([id, label]) =>
        `<button class="tab ${tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`,
    )
    .join("")}</nav><section id="teacher-content"></section>`;
  document.querySelectorAll("[data-tab]").forEach((b) =>
    b.addEventListener(
      "click",
      action(async () => {
        tab = b.dataset.tab;
        renderTeacher();
      }),
    ),
  );
  if (tab === "games") renderGames();
  if (tab === "vocabulary") renderVocabulary();
  if (tab === "stats") renderStats().catch((e) => toast(e.message));
}
function renderGames() {
  const content = $("#teacher-content");
  if (!selected) {
    content.innerHTML = `<div class="row between spaced"><div><h2 style="margin-bottom:8px">Nästa champion väntar.</h2><p class="muted">Skapa ett rum och bjud in klassen.</p></div><button class="btn" id="create-game">+ Nytt spelrum</button></div>${games.length ? `<div class="metric-grid">${games.map((g) => `<button class="panel" data-game="${g.pin}" style="text-align:left;color:inherit;cursor:pointer"><span class="labelcaps">${g.status === "active" ? "PÅGÅR" : g.status === "ended" ? "AVSLUTAD RUNDA" : "VÄNTAR"}</span><div class="game-pin" style="font-size:30px">${g.pin}</div><p class="muted">${g.participants} deltagare · Runda ${g.round} →</p></button>`).join("")}</div>` : '<div class="panel empty"><span class="big">→</span><h3>Ett klassrum. En utmaning.</h3>Starta ditt första spelrum. Eleverna behöver bara en PIN.</div>'}`;
    bind(
      "#create-game",
      "click",
      action(async () => {
        selected = await api("/games", "POST");
        games.push(selected);
        renderGames();
        await watch();
      }),
    );
    document.querySelectorAll("[data-game]").forEach((b) =>
      b.addEventListener(
        "click",
        action(async () => {
          selected = games.find((g) => g.pin === b.dataset.game);
          renderGames();
          await watch();
        }),
      ),
    );
    return;
  }
  const weeks = [...new Set(vocabulary.map((v) => v.week))].sort(
    (a, b) => a - b,
  );
  content.innerHTML = `<button class="quiet spaced" id="back-games">← Alla spelrum</button><div class="grid"><aside id="controls"><div class="panel"><div class="row between"><span class="labelcaps">KLASSENS SPELRUM</span><span class="live"><span class="dot"></span> LIVE</span></div><div class="game-pin">${selected.pin}</div><div class="qr-wrap"><img src="/api/games/${selected.pin}/qr" alt="QR-kod för att ansluta till spelrummet"><p>Skanna och hoppa in.<br>Elever kan också öppna<br><strong>${esc(location.host)}</strong><br>och ange spelkoden.</p></div><button class="btn secondary full" id="copy-link">Kopiera inbjudningslänk →</button></div><div class="panel"><h3>Förbered nästa runda</h3><label>Välj veckor</label><div class="row"><button class="quiet" id="all-weeks">Välj alla</button><button class="quiet" id="no-weeks">Rensa</button></div><div class="week-list">${weeks.map((w) => `<label class="week"><input type="checkbox" value="${w}" ${chosenWeeks.has(w) ? "checked" : ""}><span>v. ${w}</span></label>`).join("")}</div><p class="help spaced" id="pool-count" style="text-align:left"></p><div class="field"><label for="direction">Översättningsriktning</label><select id="direction"><option value="en-sv">Engelska → Svenska</option><option value="sv-en">Svenska → Engelska</option><option value="mixed">Blandat</option></select></div><div id="round-buttons"></div><p class="help" style="text-align:left">30 glosor per runda. Nya glosor prioriteras. Eleverna stannar kvar mellan rundorna.</p></div><button class="quiet" id="close-game">Stäng rummet och radera smeknamn</button></aside><div><section class="panel" id="board"></section><section id="round-history"></section></div></div><button class="btn secondary exit-present" id="exit-present">Avsluta helskärm ✕</button>`;
  $("#direction").value = direction;
  bind("#direction", "change", (e) => (direction = e.target.value));
  const updateWeeks = () => {
    document
      .querySelectorAll(".week input")
      .forEach((c) => (c.checked = chosenWeeks.has(Number(c.value))));
    $("#pool-count").textContent =
      `${vocabulary.filter((v) => chosenWeeks.has(v.week)).length} glosor valda · minst 30 behövs`;
  };
  document.querySelectorAll(".week input").forEach((c) =>
    c.addEventListener("change", () => {
      const w = Number(c.value);
      c.checked ? chosenWeeks.add(w) : chosenWeeks.delete(w);
      updateWeeks();
    }),
  );
  bind("#all-weeks", "click", () => {
    chosenWeeks = new Set(weeks);
    updateWeeks();
  });
  bind("#no-weeks", "click", () => {
    chosenWeeks.clear();
    updateWeeks();
  });
  updateWeeks();
  bind("#back-games", "click", () => {
    selected = null;
    document.body.classList.remove("presentation");
    loadTeacher().catch((e) => toast(e.message));
  });
  bind(
    "#copy-link",
    "click",
    action(async () => {
      await navigator.clipboard.writeText(
        `${location.origin}/?pin=${selected.pin}`,
      );
      toast("Inbjudningslänken är kopierad.");
    }),
  );
  bind(
    "#close-game",
    "click",
    action(async () => {
      if (
        !confirm(
          "Stäng rummet? Alla elever kopplas från och deras smeknamn raderas.",
        )
      )
        return;
      await api(`/games/${selected.pin}`, "DELETE");
      selected = null;
      await loadTeacher();
    }),
  );
  bind("#exit-present", "click", exitPresentation);
  renderLive();
}
async function watch() {
  await connected();
  if (selected) {
    const r = await emit("watch", { pin: selected.pin });
    selected = r.state;
    renderLive();
  }
}
function renderLive() {
  if (tab !== "games" || !selected || !$("#board")) return;
  const s = selected;
  $("#board").innerHTML =
    `<div class="leader-head"><div><span class="labelcaps">${s.status === "active" ? "RUNDA " + s.round + " · FÖRST TILL 15" : s.status === "ended" ? "RUNDA " + s.round + " · RESULTAT" : "VÄNTRUM"}</span><h3 style="margin:8px 0 0">${s.status === "ended" ? "Rundan är avslutad" : "Live leaderboard"}</h3></div><button class="icon-btn" id="present" aria-label="Visa i helskärm"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg></button></div>${s.status === "ended" ? results(s.result) : `<div class="row between spaced"><span class="muted" style="font-size:12px">${s.participants} deltagare · ${s.online} online${s.waiting ? ` · ${s.waiting} väntar på nästa runda` : ""}</span><span class="labelcaps">TOPP 15</span></div>${leaderboard(s)}`}<p class="help">15 in a row. Can you be the champion?</p>`;
  const buttons = $("#round-buttons");
  if (buttons) {
    buttons.innerHTML =
      s.status === "active"
        ? '<button class="btn danger full" id="end-round">Avsluta rundan</button>'
        : '<button class="btn full" id="start-round">Starta ' +
          (s.round ? "nästa runda" : "rundan") +
          " →</button>";
    if ($("#start-round")) $("#start-round").disabled = !s.participants;
    bind(
      "#start-round",
      "click",
      action(async (e) => {
        e.target.disabled = true;
        try {
          selected = await api(`/games/${s.pin}/start`, "POST", {
            weeks: [...chosenWeeks],
            direction,
          });
          renderLive();
        } finally {
          if (e.target.isConnected) e.target.disabled = false;
        }
      }),
    );
    bind(
      "#end-round",
      "click",
      action(async () => {
        if (!confirm("Avsluta den pågående rundan?")) return;
        selected = await api(`/games/${s.pin}/end`, "POST");
        renderLive();
      }),
    );
  }
  $("#round-history").innerHTML =
    s.history.length > 1
      ? `<div class="panel"><h3>Tidigare rundor</h3>${s.history
          .slice(0, -1)
          .reverse()
          .map(
            (r) =>
              `<details><summary>Runda ${r.round} · ${r.percentage}% rätt · ${r.participants} deltagare</summary>${results(r)}</details>`,
          )
          .join("")}</div>`
      : "";
  bind(
    "#present",
    "click",
    action(async () => {
      document.body.classList.add("presentation");
      if (document.documentElement.requestFullscreen)
        try {
          await document.documentElement.requestFullscreen();
        } catch {}
    }),
  );
}
function exitPresentation() {
  document.body.classList.remove("presentation");
  if (document.fullscreenElement) document.exitFullscreen();
}
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement)
    document.body.classList.remove("presentation");
});
function renderVocabulary() {
  if ($("#bank-summary"))
    $("#bank-summary").textContent =
      `✦ ${vocabulary.length} glosor · ${new Set(vocabulary.map((v) => v.week)).size} veckor`;
  $("#teacher-content").innerHTML =
    `<div class="row between spaced"><div><h2 style="margin-bottom:8px">Ord att växa med.</h2><p class="muted">Hela glosbanken, alltid skild från rundans 30 glosor.</p></div><div class="row"><button class="btn secondary" id="import">↑ Importera</button><button class="btn" id="add-word">+ Lägg till glosa</button></div></div><div class="panel"><div class="toolbar"><input id="search" placeholder="Sök glosa, översättning eller tema…" aria-label="Sök glosor" value="${esc(search)}"><select id="week-filter" aria-label="Filtrera på vecka"><option value="">Alla veckor</option>${[
      ...new Set(vocabulary.map((v) => v.week)),
    ]
      .sort((a, b) => a - b)
      .map((w) => `<option value="${w}">Vecka ${w}</option>`)
      .join("")}</select></div><div id="word-table"></div></div>`;
  $("#week-filter").value = weekFilter;
  bind("#search", "input", (e) => {
    search = e.target.value;
    renderWordTable();
  });
  bind("#week-filter", "change", (e) => {
    weekFilter = e.target.value;
    renderWordTable();
  });
  bind("#add-word", "click", () => editWord());
  bind("#import", "click", importDialog);
  renderWordTable();
}
function renderWordTable() {
  const list = vocabulary.filter(
    (v) =>
      (!weekFilter || v.week === Number(weekFilter)) &&
      [v.english, v.swedish, v.topic, v.unit, v.alternatives, v.book].some(
        (s) => s.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  $("#word-table").innerHTML =
    `<p class="labelcaps">${list.length} glosor${list.length > 150 ? " · visar de första 150, filtrera för fler" : ""}</p><div class="table-scroll"><table><thead><tr><th>Vecka</th><th>Engelska</th><th>Svenska</th><th>Kapitel / tema</th><th>Redigera</th></tr></thead><tbody>${list
      .slice(0, 150)
      .map(
        (v) =>
          `<tr><td><span class="pill">${v.week}</span></td><td><strong>${esc(v.english)}</strong></td><td>${esc(v.swedish)}${v.alternatives ? `<small>${esc(v.alternatives)}</small>` : ""}</td><td>${esc(v.unit)}<small>${esc(v.topic)} · ${esc(v.book)}</small></td><td><button class="icon-btn" data-edit="${v.id}" aria-label="Redigera ${esc(v.english)}">→</button></td></tr>`,
      )
      .join(
        "",
      )}</tbody></table>${!list.length ? '<p class="empty">Inga glosor matchar sökningen.</p>' : ""}</div>`;
  document
    .querySelectorAll("[data-edit]")
    .forEach((b) =>
      b.addEventListener("click", () =>
        editWord(vocabulary.find((v) => v.id === Number(b.dataset.edit))),
      ),
    );
}
function editWord(v = {}) {
  const d = $("#editor");
  d.innerHTML = `<div class="row between spaced"><h2 style="margin:0">${v.id ? "Redigera glosa" : "Ny glosa"}</h2><button class="icon-btn" id="cancel-editor" aria-label="Stäng">✕</button></div><form id="word-form"><div class="two">${[
    ["english", "Engelska"],
    ["swedish", "Svenska"],
  ]
    .map(
      ([k, l]) =>
        `<div class="field"><label for="f-${k}">${l}</label><input name="${k}" id="f-${k}" value="${esc(v[k])}" maxlength="500" required></div>`,
    )
    .join(
      "",
    )}</div><div class="field"><label for="f-alternatives">Alternativa svenska översättningar (separera med ;)</label><input name="alternatives" id="f-alternatives" value="${esc(v.alternatives)}" maxlength="500"></div><div class="two"><div class="field"><label for="f-week">Vecka</label><input name="week" id="f-week" type="number" min="1" max="53" value="${v.week || 38}" required></div><div class="field"><label for="f-book">Läromedel</label><input name="book" id="f-book" value="${esc(v.book)}" maxlength="500"></div></div>${[
    ["unit", "Kapitel"],
    ["topic", "Tema"],
  ]
    .map(
      ([k, l]) =>
        `<div class="field"><label for="f-${k}">${l}</label><input name="${k}" id="f-${k}" value="${esc(v[k])}" maxlength="500"></div>`,
    )
    .join(
      "",
    )}<p class="error" id="editor-error" role="alert"></p><div class="row between">${v.id ? '<button class="btn danger" type="button" id="delete-word">Radera</button>' : "<span></span>"}<button class="btn">Spara glosa →</button></div></form>`;
  d.showModal();
  bind("#cancel-editor", "click", () => d.close());
  bind("#word-form", "submit", async (e) => {
    e.preventDefault();
    try {
      await api(
        "/vocabulary" + (v.id ? "/" + v.id : ""),
        v.id ? "PUT" : "POST",
        Object.fromEntries(new FormData(e.target)),
      );
      vocabulary = await api("/vocabulary");
      search = $("#search")?.value ?? search;
      d.close();
      renderVocabulary();
      toast("Glosan sparades. Pågående rundor påverkas inte.");
    } catch (e) {
      $("#editor-error").textContent = e.message;
    }
  });
  bind(
    "#delete-word",
    "click",
    action(async () => {
      if (!confirm("Radera glosan permanent?")) return;
      await api("/vocabulary/" + v.id, "DELETE");
      vocabulary = await api("/vocabulary");
      search = $("#search")?.value ?? search;
      d.close();
      renderVocabulary();
    }),
  );
}
function importDialog() {
  const d = $("#editor");
  d.innerHTML = `<div class="row between spaced"><h2 style="margin:0">Importera glosor</h2><button class="icon-btn" id="cancel-editor" aria-label="Stäng">✕</button></div><p class="muted">CSV (UTF-8) eller Excel (.xlsx), högst 5 MB. Första bladet används.</p><p class="muted">Rubriker: <strong>Vecka, Läromedel, Kapitel, Tema, Engelska, Svenska, Alternativa översättningar</strong>. Vecka, Engelska och Svenska krävs. Engelska fältnamn stöds också.</p><p class="help spaced" style="text-align:left">Nya glosor läggs till. Exakta dubbletter hoppas över. Befintliga poster skrivs inte över.</p><form id="import-form"><div class="field"><label for="import-file">Välj fil</label><input id="import-file" type="file" accept=".csv,.xlsx" required></div><p class="error" id="import-error" role="alert"></p><button class="btn full">Importera →</button></form>`;
  d.showModal();
  bind("#cancel-editor", "click", () => d.close());
  bind("#import-form", "submit", async (e) => {
    e.preventDefault();
    const b = $("#import-form button");
    b.disabled = true;
    try {
      const file = $("#import-file").files[0];
      if (file.size > 5 * 1024 * 1024)
        throw Error("Filen får vara högst 5 MB.");
      const format = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";
      let content;
      if (format === "csv") content = await file.text();
      else
        content = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result.split(",")[1]);
          r.onerror = () => rej(Error("Filen kunde inte läsas."));
          r.readAsDataURL(file);
        });
      const r = await api("/import", "POST", { format, content });
      vocabulary = await api("/vocabulary");
      search = $("#search")?.value ?? search;
      d.close();
      renderVocabulary();
      toast(
        `${r.imported} glosor importerades. ${r.total - r.imported} dubbletter hoppades över.`,
      );
    } catch (e) {
      $("#import-error").textContent = e.message;
      b.disabled = false;
    }
  });
}
async function renderStats() {
  const data = await api("/stats");
  if (tab !== "stats") return;
  const total = data.rounds.reduce((a, r) => a + r.answers, 0),
    correct = data.rounds.reduce((a, r) => a + r.correct, 0);
  $("#teacher-content").innerHTML =
    `<h2>Gör nästa runda ännu bättre.</h2><p class="muted">Anonym statistik för glosor och de senaste 100 rundorna. Inga individuella elevresultat sparas.</p><div class="metric-grid"><div class="metric"><span class="labelcaps">Rundor</span><strong>${data.rounds.length}</strong></div><div class="metric"><span class="labelcaps">Svar</span><strong>${total}</strong></div><div class="metric"><span class="labelcaps">Rätt</span><strong>${total ? Math.round((correct / total) * 100) : 0}%</strong></div></div><div class="panel"><h3>Glosor som behöver mer träning</h3>${data.words.length ? `<div class="table-scroll"><table><thead><tr><th>Vecka</th><th>Engelska</th><th>Svenska</th><th>Felprocent</th><th>Svar</th></tr></thead><tbody>${data.words.map((w) => `<tr><td>${w.week}</td><td>${esc(w.english)}</td><td>${esc(w.swedish)}</td><td>${Math.round((w.errors / w.attempts) * 100)}%</td><td>${w.attempts}</td></tr>`).join("")}</tbody></table></div>` : '<p class="empty">Spela en runda för att se klassens glosstatistik.</p>'}</div><div class="panel"><h3>Avslutade rundor</h3><div class="table-scroll"><table><thead><tr><th>Tid</th><th>Deltagare</th><th>Svar</th><th>Rätt</th></tr></thead><tbody>${data.rounds.map((r) => `<tr><td>${esc(new Date(r.ended_at).toLocaleString("sv-SE"))}</td><td>${r.participants}</td><td>${r.answers}</td><td>${r.answers ? Math.round((r.correct / r.answers) * 100) : 0}%</td></tr>`).join("")}</tbody></table></div></div>`;
}
async function route() {
  if (student) {
    renderStudent();
    return;
  }
  if (location.hash === "#teacher") {
    teacher ? await loadTeacher() : loginPage();
  } else joinPage();
}
bind(
  "#logout",
  "click",
  action(async () => {
    await api("/logout", "POST");
    teacher = false;
    selected = null;
    socket?.disconnect();
    socket = null;
    setHeader();
    loginPage();
  }),
);
window.addEventListener("hashchange", () =>
  route().catch((e) => toast(e.message)),
);
(async () => {
  try {
    teacher = (await api("/auth")).teacher;
    setHeader();
    const saved = sessionStorage.getItem("wordchamp-player");
    if (saved && location.hash !== "#teacher") {
      const s = JSON.parse(saved);
      await join(s.pin, s.name, s.token);
    } else await route();
  } catch (e) {
    sessionStorage.removeItem("wordchamp-player");
    toast(e.message);
    joinPage();
  }
})();
