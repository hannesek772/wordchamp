import { randomInt, randomUUID } from "node:crypto";
export function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export class Game {
  constructor(pin, onEnd = () => {}) {
    this.pin = pin;
    this.players = new Map();
    this.used = new Set();
    this.status = "lobby";
    this.round = 0;
    this.history = [];
    this.onEnd = onEnd;
    this.touched = Date.now();
  }
  join(nickname, token) {
    this.touched = Date.now();
    if (token && this.players.has(token)) return this.players.get(token);
    nickname = String(nickname ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (!nickname || nickname.length > 24 || /[\p{C}<>]/u.test(nickname))
      throw Error("Använd ett namn med 1–24 vanliga tecken.");
    if (
      [...this.players.values()].some(
        (p) =>
          p.name.toLocaleLowerCase("sv") === nickname.toLocaleLowerCase("sv"),
      )
    )
      throw Error("Namnet används redan. Välj ett annat.");
    if (this.players.size >= 200)
      throw Error("Rummet är fullt (200 deltagare).");
    const p = {
      token: randomUUID(),
      id: randomUUID(),
      name: nickname,
      streak: 0,
      rank: null,
      connected: false,
      question: null,
      queue: [],
    };
    this.players.set(p.token, p);
    return p;
  }
  start(pool, direction) {
    if (this.status === "active")
      throw Error("Avsluta den pågående rundan först.");
    if (!["en-sv", "sv-en", "mixed"].includes(direction))
      throw Error("Ogiltig översättningsriktning.");
    if (pool.length < 30) throw Error("Välj veckor med minst 30 glosor.");
    for (const key of ["english", "swedish"])
      if (new Set(pool.map((v) => v[key].toLowerCase())).size < 4)
        throw Error("Minst fyra olika översättningar behövs.");
    let fresh = shuffle(pool.filter((v) => !this.used.has(v.id)));
    let selected = fresh.slice(0, 30);
    if (selected.length < 30) {
      this.used.clear();
      selected.push(
        ...shuffle(
          pool.filter((v) => !selected.some((x) => x.id === v.id)),
        ).slice(0, 30 - selected.length),
      );
    }
    for (const v of selected) this.used.add(v.id);
    this.words = selected;
    this.pool = pool;
    this.direction = direction;
    this.round++;
    this.status = "active";
    this.winners = [];
    this.stats = new Map();
    this.answerCount = 0;
    this.correctCount = 0;
    this.result = null;
    this.touched = Date.now();
    for (const p of this.players.values())
      Object.assign(p, { streak: 0, rank: null, question: null, queue: [] });
  }
  question(p) {
    if (this.status !== "active" || p.rank) return null;
    if (p.question) return this.publicQuestion(p.question);
    if (!p.queue.length) p.queue = shuffle(this.words);
    const v = p.queue.pop();
    const direction =
      this.direction === "mixed"
        ? randomInt(2)
          ? "en-sv"
          : "sv-en"
        : this.direction;
    const key = direction === "en-sv" ? "swedish" : "english";
    const promptKey = direction === "en-sv" ? "english" : "swedish";
    const accepted = new Set(
      [v[key], ...(key === "swedish" ? v.alternatives.split(/[;|]/) : [])].map(
        (x) => x.trim().toLocaleLowerCase(),
      ),
    );
    // Exclude synonymous entries with the same prompt to avoid ambiguous options.
    for (const x of this.pool)
      if (x[promptKey].toLowerCase() === v[promptKey].toLowerCase())
        accepted.add(x[key].toLocaleLowerCase());
    const wrong = shuffle(
      [...new Set(this.pool.map((x) => x[key]))].filter(
        (x) => !accepted.has(x.toLocaleLowerCase()),
      ),
    ).slice(0, 3);
    if (wrong.length < 3) throw Error("För få entydiga svarsalternativ.");
    const options = shuffle([v[key], ...wrong]);
    p.question = {
      id: randomUUID(),
      wordId: v.id,
      prompt: v[promptKey],
      direction,
      options,
      correct: options.indexOf(v[key]),
    };
    return this.publicQuestion(p.question);
  }
  publicQuestion(q) {
    return {
      id: q.id,
      prompt: q.prompt,
      direction: q.direction,
      options: q.options,
    };
  }
  answer(p, id, choice) {
    if (
      this.status !== "active" ||
      p.rank ||
      !p.question ||
      p.question.id !== id ||
      !Number.isInteger(choice) ||
      choice < 0 ||
      choice > 3
    )
      throw Error("Frågan är inte längre aktiv.");
    this.touched = Date.now();
    const q = p.question;
    const correct = choice === q.correct;
    p.question = null;
    p.streak = correct ? p.streak + 1 : 0;
    this.answerCount++;
    if (correct) this.correctCount++;
    const stat = this.stats.get(q.wordId) || {
      id: q.wordId,
      attempts: 0,
      errors: 0,
    };
    stat.attempts++;
    if (!correct) stat.errors++;
    this.stats.set(q.wordId, stat);
    if (p.streak === 15) {
      p.rank = this.winners.length + 1;
      this.winners.push({ id: p.id, name: p.name, rank: p.rank });
    }
    const result = {
      correct,
      correctIndex: q.correct,
      streak: p.streak,
      rank: p.rank,
    };
    if (this.winners.length >= Math.min(3, this.players.size)) this.end();
    return result;
  }
  end() {
    if (this.status !== "active") throw Error("Ingen runda pågår.");
    this.status = "ended";
    this.result = {
      round: this.round,
      participants: this.players.size,
      answers: this.answerCount,
      correct: this.correctCount,
      percentage: this.answerCount
        ? Math.round((100 * this.correctCount) / this.answerCount)
        : 0,
      winners: this.winners,
      hardest: [...this.stats.values()]
        .map((s) => ({
          ...s,
          ...this.words.find((v) => v.id === s.id),
          rate: s.errors / s.attempts,
        }))
        .sort((a, b) => b.rate - a.rate || b.attempts - a.attempts)
        .slice(0, 5),
    };
    this.history.push(this.result);
    this.onEnd(this);
    return this.result;
  }
  state() {
    return {
      pin: this.pin,
      status: this.status,
      round: this.round,
      participants: this.players.size,
      online: [...this.players.values()].filter((p) => p.connected).length,
      players: [...this.players.values()]
        .map((p) => ({
          id: p.id,
          name: p.name,
          streak: p.streak,
          rank: p.rank,
          connected: p.connected,
        }))
        .sort(
          (a, b) =>
            (a.rank ?? 999) - (b.rank ?? 999) ||
            b.streak - a.streak ||
            a.name.localeCompare(b.name),
        )
        .slice(0, 15),
      result: this.result,
      history: this.history,
    };
  }
}
