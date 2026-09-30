import { resolve } from "node:path";
import { buildApp } from "./app.js";

const dataDirectory = resolve(process.env.ACADEMIES_DATA_DIR ?? "./data");
const databasePath = resolve(
  process.env.ACADEMIES_DB_PATH ?? `${dataDirectory}/academies.sqlite`,
);
const adminUsername = process.env.INITIAL_ADMIN_USERNAME;
const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;

if ((adminUsername === undefined) !== (adminPassword === undefined)) {
  throw new Error("Define INITIAL_ADMIN_USERNAME e INITIAL_ADMIN_PASSWORD juntos.");
}

const app = await buildApp({
  databasePath,
  secureCookies: process.env.NODE_ENV === "production",
  staticDirectory: process.env.ACADEMIES_WEB_DIR,
  ...(adminUsername !== undefined && adminPassword !== undefined
    ? { initialAdmin: { username: adminUsername.trim(), password: adminPassword } }
    : {}),
});
const port = Number(process.env.PORT ?? 5181);
const host = process.env.HOST ?? "127.0.0.1";

try {
  await app.listen({ port, host });
  console.log(`Paddock API disponible en http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}