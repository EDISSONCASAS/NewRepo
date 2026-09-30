import { pbkdf2, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const iterations = 310_000;
const encodeBase64Url = (bytes) => bytes.toString("base64url");

function readHiddenPassword() {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
      reject(new Error("Ejecuta el generador en una terminal interactiva."));
      return;
    }
    process.stderr.write("Contraseña inicial (mínimo 12 caracteres): ");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let password = "";
    const finish = (error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(password);
    };
    const onData = (data) => {
      for (const character of data.toString("utf8")) {
        if (character === "\u0003") return finish(new Error("Operación cancelada."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") {
          password = password.slice(0, -1);
        } else {
          password += character;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

const password = await readHiddenPassword();
if (password.length < 12 || Buffer.byteLength(password, "utf8") > 256) {
  throw new Error("La contraseña debe tener entre 12 y 256 bytes.");
}
const salt = randomBytes(16);
const verifier = await promisify(pbkdf2)(password, salt, iterations, 32, "sha256");
process.stdout.write(
  `pbkdf2$${iterations}$SHA-256$${encodeBase64Url(salt)}$${encodeBase64Url(verifier)}\n`,
);
