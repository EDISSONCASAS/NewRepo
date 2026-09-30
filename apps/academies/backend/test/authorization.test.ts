import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { buildApp } from "../src/app.js";
import { AcademyStore } from "../src/db.js";

const store = new AcademyStore(":memory:");
const app = await buildApp({
  store,
  initialAdmin: { username: "admin-test", password: "Long-Local-Test-Password-123!" },
  secureCookies: false,
});
let adminCookie = "";
let viewerCookie = "";
let academyA = "";
let recordInB = "";

async function call(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
  cookie = "",
) {
  return app.inject({
    method,
    url,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    ...(payload ? { payload: JSON.stringify(payload) } : {}),
  });
}

before(async () => {
  const adminLogin = await call("POST", "/api/auth/login", {
    username: "admin-test",
    password: "Long-Local-Test-Password-123!",
  });
  assert.equal(adminLogin.statusCode, 200);
  const adminSetCookie = adminLogin.headers["set-cookie"];
  adminCookie = (Array.isArray(adminSetCookie) ? adminSetCookie[0] : adminSetCookie ?? "").split(";")[0]!;

  const firstAcademy = await call("POST", "/api/academies", { name: "Pista Norte", city: "Bogotá" }, adminCookie);
  const secondAcademy = await call("POST", "/api/academies", { name: "Curva Sur", city: "Cali" }, adminCookie);
  academyA = firstAcademy.json<{ academy: { id: string } }>().academy.id;
  const academyB = secondAcademy.json<{ academy: { id: string } }>().academy.id;

  await call("POST", "/api/records", {
    academy_id: academyA, date: "2026-09-20", full_name: "Alumna Academia Norte",
    order_number: "N-101", document_number: "10000001", procedure: "PRIMERA VEZ",
  }, adminCookie);
  const record = await call("POST", "/api/records", {
    academy_id: academyB, date: "2026-09-20", full_name: "Alumno Academia Sur",
    order_number: "S-202", document_number: "20000002", procedure: "REFRENDACION",
  }, adminCookie);
  recordInB = record.json<{ record: { id: string } }>().record.id;

  const viewer = await call("POST", "/api/users", {
    username: "viewer-norte",
    password: "Viewer-Local-Test-Password-123!",
    academyIds: [academyA],
  }, adminCookie);
  assert.equal(viewer.statusCode, 201);
  assert.equal(viewer.json<{ user: { active: number } }>().user.active, 1);
  const viewerLogin = await call("POST", "/api/auth/login", {
    username: "viewer-norte",
    password: "Viewer-Local-Test-Password-123!",
  });
  const viewerSetCookie = viewerLogin.headers["set-cookie"];
  viewerCookie = (Array.isArray(viewerSetCookie) ? viewerSetCookie[0] : viewerSetCookie ?? "").split(";")[0]!;
});

after(async () => {
  await app.close();
  store.close();
});

test("viewer solo enumera academias asignadas y no puede cruzar IDs", async () => {
  const academies = await call("GET", "/api/academies", undefined, viewerCookie);
  assert.equal(academies.statusCode, 200);
  assert.deepEqual(academies.json<{ academies: Array<{ id: string }> }>().academies.map((academy) => academy.id), [academyA]);

  const records = await call("GET", "/api/records", undefined, viewerCookie);
  assert.equal(records.statusCode, 200);
  assert.equal(records.json<{ total: number }>().total, 1);

  const hiddenRecord = await call("GET", `/api/records/${recordInB}`, undefined, viewerCookie);
  assert.equal(hiddenRecord.statusCode, 404);
});

test("viewer no puede escribir ni administrar usuarios por API directa", async () => {
  const write = await call("POST", "/api/records", {
    academy_id: academyA, full_name: "Escritura prohibida",
  }, viewerCookie);
  assert.equal(write.statusCode, 403);

  const users = await call("GET", "/api/users", undefined, viewerCookie);
  assert.equal(users.statusCode, 403);

  const importPreview = await app.inject({
    method: "POST",
    url: "/api/import/preview",
    headers: { cookie: viewerCookie },
    payload: { academyId: academyA },
  });
  assert.equal(importPreview.statusCode, 403);
});

test("viewer recibe todos sus centros asignados y admin ve ambas academias", async () => {
  const viewerRecords = await call("GET", `/api/records?academyId=${encodeURIComponent(recordInB)}`, undefined, viewerCookie);
  assert.equal(viewerRecords.statusCode, 200);
  assert.equal(viewerRecords.json<{ total: number }>().total, 0);

  const adminRecords = await call("GET", "/api/records", undefined, adminCookie);
  assert.equal(adminRecords.statusCode, 200);
  assert.equal(adminRecords.json<{ total: number }>().total, 2);
});

test("logout invalida la cookie de servidor", async () => {
  const logout = await call("POST", "/api/auth/logout", undefined, viewerCookie);
  assert.equal(logout.statusCode, 204);
  const currentUser = await call("GET", "/api/auth/me", undefined, viewerCookie);
  assert.equal(currentUser.statusCode, 401);
});