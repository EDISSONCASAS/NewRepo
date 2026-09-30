import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { AcademyStore } from "../src/db.js";

const webDirectory = mkdtempSync(join(tmpdir(), "paddock-web-"));
mkdirSync(join(webDirectory, "assets"));
writeFileSync(join(webDirectory, "index.html"), "<main>Paddock</main>");
writeFileSync(join(webDirectory, "assets", "app.js"), "console.log('Paddock')");

const store = new AcademyStore(":memory:");
const app = await buildApp({
  store,
  initialAdmin: { username: "admin-test", password: "Long-Local-Test-Password-123!" },
  secureCookies: false,
  staticDirectory: webDirectory,
});

after(async () => {
  await app.close();
  store.close();
  rmSync(webDirectory, { recursive: true, force: true });
});

test("sirve el frontend y mantiene las rutas API como JSON", async () => {
  const home = await app.inject({ method: "GET", url: "/" });
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /Paddock/);

  const appRoute = await app.inject({ method: "GET", url: "/academies" });
  assert.equal(appRoute.statusCode, 200);
  assert.match(appRoute.body, /Paddock/);

  const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
  assert.equal(asset.statusCode, 200);
  assert.match(asset.body, /console\.log/);

  const missingApi = await app.inject({ method: "GET", url: "/api/missing" });
  assert.equal(missingApi.statusCode, 404);
  assert.deepEqual(missingApi.json(), { error: "Ruta no encontrada" });
});

test("rechaza un usuario administrador de bootstrap inválido", async () => {
  const invalidStore = new AcademyStore(":memory:");
  try {
    await assert.rejects(
      buildApp({
        store: invalidStore,
        initialAdmin: { username: "ab", password: "Long-Local-Test-Password-123!" },
      }),
      /usuario administrador debe tener 3 o más caracteres válidos/,
    );
  } finally {
    invalidStore.close();
  }
});
