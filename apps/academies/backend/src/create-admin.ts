import { resolve } from "node:path";
import { AcademyStore } from "./db.js";
import { hashPassword, isStrongPassword } from "./security.js";

const username = process.env.INITIAL_ADMIN_USERNAME?.trim() ?? "";
const password = process.env.INITIAL_ADMIN_PASSWORD ?? "";
if (!/^[\p{L}\p{N}_.-]{3,100}$/u.test(username)) {
  throw new Error("Define INITIAL_ADMIN_USERNAME con al menos 3 caracteres válidos.");
}
if (!isStrongPassword(password)) {
  throw new Error("Define INITIAL_ADMIN_PASSWORD con al menos 12 caracteres.");
}

const dataDirectory = resolve(process.env.ACADEMIES_DATA_DIR ?? "./data");
const databasePath = resolve(
  process.env.ACADEMIES_DB_PATH ?? `${dataDirectory}/academies.sqlite`,
);
const store = new AcademyStore(databasePath);
try {
  store.createInitialAdmin(username, await hashPassword(password));
  console.log("Administrador inicial creado. Elimina las variables de entorno de bootstrap.");
} finally {
  store.close();
}