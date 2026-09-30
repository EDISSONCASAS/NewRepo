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
let editorCookie = "";
let academyA = "";
let academyB = "";
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
  academyB = secondAcademy.json<{ academy: { id: string } }>().academy.id;

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

  const editor = await call("POST", "/api/users", {
    username: "editor-norte",
    password: "Editor-Local-Test-Password-123!",
    academyIds: [academyA],
    canWrite: true,
  }, adminCookie);
  assert.equal(editor.statusCode, 201);
  assert.equal(editor.json<{ user: { can_write: boolean } }>().user.can_write, true);
  const editorLogin = await call("POST", "/api/auth/login", {
    username: "editor-norte",
    password: "Editor-Local-Test-Password-123!",
  });
  const editorSetCookie = editorLogin.headers["set-cookie"];
  editorCookie = (Array.isArray(editorSetCookie) ? editorSetCookie[0] : editorSetCookie ?? "").split(";")[0]!;
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

test("usuario de carga crea y edita registros solo en sus academias, sin administrar ni borrar", async () => {
  const created = await call("POST", "/api/records", {
    academy_id: academyA, full_name: "Registro del editor",
  }, editorCookie);
  assert.equal(created.statusCode, 201);
  const editorRecord = created.json<{ record: { id: string } }>().record.id;

  const crossAcademyCreate = await call("POST", "/api/records", {
    academy_id: academyB, full_name: "Registro fuera de alcance",
  }, editorCookie);
  assert.equal(crossAcademyCreate.statusCode, 403);

  const crossAcademyUpdate = await call("PUT", `/api/records/${recordInB}`, {
    academy_id: academyA, full_name: "Intento de traslado",
  }, editorCookie);
  assert.equal(crossAcademyUpdate.statusCode, 404);

  const edit = await call("PUT", `/api/records/${editorRecord}`, {
    academy_id: academyA, full_name: "Registro corregido",
  }, editorCookie);
  assert.equal(edit.statusCode, 200);

  const deleteAttempt = await call("DELETE", `/api/records/${editorRecord}`, undefined, editorCookie);
  assert.equal(deleteAttempt.statusCode, 403);
  const userManagement = await call("GET", "/api/users", undefined, editorCookie);
  assert.equal(userManagement.statusCode, 403);
  const academyManagement = await call("POST", "/api/academies", {
    name: "No autorizado",
  }, editorCookie);
  assert.equal(academyManagement.statusCode, 403);

  const boundary = "----paddock-editor-import";
  const payload = [
    `--${boundary}\r\nContent-Disposition: form-data; name="academyId"\r\n\r\n${academyA}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="alumnos.csv"\r\nContent-Type: text/csv\r\n\r\nNOMBRES COMPLETOS\nAlumno Importado\r\n`,
    `--${boundary}--\r\n`,
  ].join("");
  const importPreview = await app.inject({
    method: "POST",
    url: "/api/import/preview",
    headers: {
      cookie: editorCookie,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
  assert.equal(importPreview.statusCode, 200);
  assert.equal(importPreview.json<{ valid: number }>().valid, 1);

  const outsideImport = payload.replace(academyA, academyB);
  const deniedImport = await app.inject({
    method: "POST",
    url: "/api/import/preview",
    headers: {
      cookie: editorCookie,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: outsideImport,
  });
  assert.equal(deniedImport.statusCode, 403);
});

test("logout invalida la cookie de servidor", async () => {
  const logout = await call("POST", "/api/auth/logout", undefined, viewerCookie);
  assert.equal(logout.statusCode, 204);
  const currentUser = await call("GET", "/api/auth/me", undefined, viewerCookie);
  assert.equal(currentUser.statusCode, 401);
});