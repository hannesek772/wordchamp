import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import readline from "node:readline";
function save(password, generated = false) {
  if (password.length < 12) throw Error("Använd minst 12 tecken.");
  const salt = randomBytes(16).toString("hex");
  const hash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  let text = existsSync(".env")
    ? readFileSync(".env", "utf8")
    : readFileSync(".env.example", "utf8");
  const values = { TEACHER_PASSWORD_HASH: hash };
  if (!/^SESSION_SECRET=.+$/m.test(text))
    values.SESSION_SECRET = randomBytes(48).toString("hex");
  for (const [key, value] of Object.entries(values)) {
    const re = new RegExp("^" + key + "=.*$", "m");
    text = re.test(text)
      ? text.replace(re, `${key}=${value}`)
      : text + `\n${key}=${value}\n`;
  }
  writeFileSync(".env", text, { mode: 0o600 });
  if (generated) {
    mkdirSync("var", { recursive: true });
    writeFileSync("var/teacher-password.txt", password + "\n", { mode: 0o600 });
    console.log(
      "Local credentials created. Password stored in ignored var/teacher-password.txt. Use npm run configure to choose your own password.",
    );
  } else console.log("Lärarlösenordet har sparats i .env som en säker hash.");
}
if (process.argv.includes("--local")) {
  if (existsSync(".env"))
    console.log(".env already exists; keeping existing configuration.");
  else save(randomBytes(24).toString("base64url"), true);
} else {
  if (!process.stdin.isTTY) {
    console.error(
      "Run npm run configure in an interactive terminal, or use --local for a generated development password.",
    );
    process.exit(1);
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question(
    "Välj lärarlösenord (minst 12 tecken, inmatningen döljs): ",
    (password) => {
      rl.close();
      try {
        save(password);
      } catch (e) {
        console.error(e.message);
        process.exitCode = 1;
      }
    },
  );
  rl._writeToOutput = () => {};
}
