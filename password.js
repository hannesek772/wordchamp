import { scryptSync, randomBytes } from "node:crypto";
import readline from "node:readline";
if (!process.stdin.isTTY) {
  console.error("Run in an interactive terminal.");
  process.exit(1);
}
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
rl.question(
  "Teacher password (at least 12 characters; input hidden): ",
  (password) => {
    rl.close();
    if (password.length < 12) {
      console.error("Use at least 12 characters.");
      process.exit(1);
    }
    const salt = randomBytes(16).toString("hex");
    console.log(
      `TEACHER_PASSWORD_HASH=${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    );
  },
);
rl._writeToOutput = () => {};
