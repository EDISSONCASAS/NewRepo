import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import {
  createAcademy,
  createRecord,
  createSession,
  createViewer,
  canAccessAcademy,
  deleteRecord,
  deleteSession,
  ensureAcademyIds,
  ensureInitialAdmin,
  getRecord,
  getSession,
  getUserByUsername,
  importRecords,
  listAcademies,
  listRecords,
  listUsers,
  replaceUserPasswordHash,
  updateRecord,
  updateViewer,
} from "./store.js";
import {
  createSessionToken,
  hashLoginKey,
  hashToken,
  isValidPasswordHash,
  passwordSalt,
  PASSWORD_ITERATIONS,
  protectPasswordHash,
  SESSION_DURATION_MS,
  verifyPasswordProof,
} from "./security.js";
import { ImportInputError, importableRecords, previewImport } from "./imports.js";
import type { Env, User } from "./types.js";
import { validateRecord } from "../../backend/src/record-validation.js";

const SESSION_COOKIE = "paddock_session";
const LOGIN_WINDOW_MS = 60_000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 400;

type Variables = { user: User };
type AppContext = Context<{ Bindings: Env; Variables: Variables }>;
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const initialAdminSetup = new WeakMap<D1Database, Promise<void>>();

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textField(body: Record<string, unknown>, key: string, max = 200): string {
  const value = body[key];
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function academyIdsField(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) return null;
  return [...new Set(value as string[])];
}

function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    can_write: user.role === "admin" || user.can_write === 1,
  };
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /unique constraint/i.test(error.message);
}

function passwordPepper(env: Env): string {
  const pepper = env.PASSWORD_PEPPER ?? "";
  if (new TextEncoder().encode(pepper).byteLength < 32) {
    throw new Error("Configure PASSWORD_PEPPER with at least 32 random bytes.");
  }
  return pepper;
}

async function ensureAdmin(env: Env): Promise<void> {
  let setup = initialAdminSetup.get(env.DB);
  if (!setup) {
    setup = ensureInitialAdmin(env);
    initialAdminSetup.set(env.DB, setup);
    setup.catch(() => initialAdminSetup.delete(env.DB));
  }
  await setup;
}

app.use("*", async (c, next) => {
  c.header("x-content-type-options", "nosniff");
  c.header("x-frame-options", "DENY");
  c.header("referrer-policy", "no-referrer");
  c.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  await next();
});

app.use("/api/*", bodyLimit({
  maxSize: MAX_FILE_SIZE + 128 * 1024,
  onError: (c) => c.json({ error: "El archivo supera el límite de 5 MB" }, 413),
}));

app.use("/api/*", async (c, next) => {
  c.header("cache-control", "no-store");
  c.header("x-paddock-password-protocol", "pbkdf2-hmac-v1");
  try {
    passwordPepper(c.env);
    await ensureAdmin(c.env);
    await next();
  } catch (error) {
    console.error("Paddock initialization failed", error);
    return c.json({ error: "El servicio aún no está configurado" }, 503);
  }
});

const authenticate = async (
  c: AppContext,
  next: () => Promise<void>,
) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: "Inicia sesión para continuar" }, 401);
  const user = await getSession(c.env.DB, await hashToken(token), Date.now());
  if (!user) {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ error: "La sesión expiró. Inicia sesión de nuevo" }, 401);
  }
  c.set("user", user);
  await next();
};

const requireAdmin = async (
  c: AppContext,
  next: () => Promise<void>,
) => {
  if (c.get("user").role !== "admin") {
    return c.json({ error: "Acción reservada al administrador" }, 403);
  }
  await next();
};

const requireRecordWriter = async (
  c: AppContext,
  next: () => Promise<void>,
) => {
  const user = c.get("user");
  if (user.role !== "admin" && user.can_write !== 1) {
    return c.json({ error: "Acción reservada a usuarios con permiso de carga" }, 403);
  }
  await next();
};

function requireValidAcademyIds(ids: string[] | null): ids is string[] {
  return Boolean(ids?.length);
}

async function applyLoginLimit(db: D1Database, ip: string, purpose: string): Promise<boolean> {
  const now = Date.now();
  await db.prepare("DELETE FROM login_attempts WHERE window_start <= ?")
    .bind(now - LOGIN_WINDOW_MS).run();
  const key = await hashLoginKey(`${purpose}:${ip.slice(0, 200)}`);
  await db.prepare(`
    INSERT INTO login_attempts (ip_key, window_start, attempts)
    VALUES (?, ?, 1)
    ON CONFLICT(ip_key) DO UPDATE SET
      attempts = CASE WHEN login_attempts.window_start <= ? THEN 1 ELSE login_attempts.attempts + 1 END,
      window_start = CASE WHEN login_attempts.window_start <= ? THEN excluded.window_start ELSE login_attempts.window_start END
  `).bind(key, now, now - LOGIN_WINDOW_MS, now - LOGIN_WINDOW_MS).run();
  const attempt = await db.prepare(
    "SELECT attempts FROM login_attempts WHERE ip_key = ?",
  ).bind(key).first<{ attempts: number }>();
  return Number(attempt?.attempts ?? 0) <= MAX_LOGIN_ATTEMPTS;
}

async function clearLoginLimit(db: D1Database, ip: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE ip_key = ?")
    .bind(await hashLoginKey(`login:${ip.slice(0, 200)}`)).run();
}

async function readUpload(request: Request): Promise<{
  filename: string;
  academyId: string;
  data: Uint8Array;
  confirmed: boolean;
}> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ImportInputError("No se pudo leer el archivo enviado");
  }
  const file = form.get("file");
  const academyId = form.get("academyId");
  if (!(file instanceof File) || !file.name) throw new ImportInputError("Selecciona un archivo CSV o XLSX");
  if (file.size > MAX_FILE_SIZE) throw new ImportInputError("El archivo supera el límite de 5 MB");
  if (typeof academyId !== "string" || !academyId.trim()) {
    throw new ImportInputError("Selecciona la academia de destino");
  }
  return {
    filename: file.name,
    academyId: academyId.trim(),
    data: new Uint8Array(await file.arrayBuffer()),
    confirmed: form.get("confirm") === "true",
  };
}

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.get("/api/auth/challenge", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!await applyLoginLimit(c.env.DB, ip, "challenge")) {
    return c.json({ error: "Demasiadas solicitudes. Espera un minuto antes de volver a intentar." }, 429);
  }
  const username = c.req.query("username")?.trim().slice(0, 100) ?? "";
  const user = username ? await getUserByUsername(c.env.DB, username) : undefined;
  return c.json({
    salt: passwordSalt(user?.password_hash),
    iterations: PASSWORD_ITERATIONS,
    algorithm: "PBKDF2-SHA-256",
  });
});

app.post("/api/auth/login", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!await applyLoginLimit(c.env.DB, ip, "login")) {
    return c.json({ error: "Demasiados intentos. Espera un minuto antes de volver a intentar." }, 429);
  }
  const body = jsonObject(await c.req.json().catch(() => null));
  const username = body ? textField(body, "username", 100) : "";
  const proof = body && typeof body.passwordProof === "string" ? body.passwordProof : "";
  const user = username ? await getUserByUsername(c.env.DB, username) : undefined;
  const pepper = passwordPepper(c.env);
  const valid = await verifyPasswordProof(proof, user?.password_hash, pepper);
  if (!user || !user.active || !valid) {
    return c.json({ error: "Usuario o contraseña incorrectos" }, 401);
  }
  if (user.password_hash.startsWith("pbkdf2$")) {
    await replaceUserPasswordHash(
      c.env.DB,
      user.id,
      await protectPasswordHash(user.password_hash, pepper),
    );
  }
  await clearLoginLimit(c.env.DB, ip);
  const token = createSessionToken();
  await createSession(
    c.env.DB,
    await hashToken(token),
    user.id,
    Date.now() + SESSION_DURATION_MS,
  );
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    maxAge: SESSION_DURATION_MS / 1000,
  });
  return c.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", authenticate, async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSession(c.env.DB, await hashToken(token));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.body(null, 204);
});

app.get("/api/auth/me", authenticate, (c) => c.json({ user: publicUser(c.get("user")) }));

app.get("/api/academies", authenticate, async (c) => {
  return c.json({ academies: await listAcademies(c.env.DB, c.get("user")) });
});

app.post("/api/academies", authenticate, requireAdmin, async (c) => {
  const body = jsonObject(await c.req.json().catch(() => null));
  const name = body ? textField(body, "name", 120) : "";
  const city = body ? textField(body, "city", 120) : "";
  if (!name) return c.json({ error: "El nombre de la academia es obligatorio" }, 400);
  return c.json({ academy: await createAcademy(c.env.DB, name, city) }, 201);
});

app.get("/api/users", authenticate, requireAdmin, async (c) => {
  return c.json({ users: await listUsers(c.env.DB) });
});

app.post("/api/users", authenticate, requireAdmin, async (c) => {
  const body = jsonObject(await c.req.json().catch(() => null));
  if (!body) return c.json({ error: "Datos no válidos" }, 400);
  const username = textField(body, "username", 100);
  const passwordHash = typeof body.passwordHash === "string" ? body.passwordHash : "";
  const academyIds = academyIdsField(body.academyIds);
  const canWrite = body.canWrite === true;
  if (!/^[\p{L}\p{N}_.-]{3,100}$/u.test(username)) {
    return c.json({ error: "El usuario debe tener 3 o más caracteres válidos" }, 400);
  }
  if (!isValidPasswordHash(passwordHash)) {
    return c.json({ error: "La contraseña no tiene un formato válido" }, 400);
  }
  if (!requireValidAcademyIds(academyIds) ||
      !await ensureAcademyIds(c.env.DB, academyIds)) {
    return c.json({ error: "Asigna al menos una academia válida" }, 400);
  }
  try {
    const pepper = passwordPepper(c.env);
    const user = await createViewer(
      c.env.DB,
      username,
      await protectPasswordHash(passwordHash, pepper),
      academyIds,
      canWrite,
    );
    return c.json({
      user: { ...publicUser(user), active: user.active, academy_ids: academyIds },
    }, 201);
  } catch (error) {
    if (isUniqueConstraint(error)) return c.json({ error: "Ese usuario ya existe" }, 409);
    throw error;
  }
});

app.patch("/api/users/:id", authenticate, requireAdmin, async (c) => {
  const body = jsonObject(await c.req.json().catch(() => null));
  const academyIds = academyIdsField(body?.academyIds);
  if (!body || !academyIds || typeof body.active !== "boolean") {
    return c.json({ error: "Datos no válidos" }, 400);
  }
  if (!await ensureAcademyIds(c.env.DB, academyIds)) {
    return c.json({ error: "Selecciona academias válidas" }, 400);
  }
  const passwordHash = typeof body.passwordHash === "string" ? body.passwordHash : "";
  const canWrite = body.canWrite === true;
  if (passwordHash && !isValidPasswordHash(passwordHash)) {
    return c.json({ error: "La contraseña no tiene un formato válido" }, 400);
  }
  const pepper = passwordPepper(c.env);
  const updated = await updateViewer(c.env.DB, c.req.param("id") ?? "", {
    academyIds,
    active: body.active,
    canWrite,
    ...(passwordHash
      ? { passwordHash: await protectPasswordHash(passwordHash, pepper) }
      : {}),
  });
  if (!updated) return c.json({ error: "Usuario no encontrado" }, 404);
  return c.json({ updated: true });
});

app.get("/api/records", authenticate, async (c) => {
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(c.req.query("pageSize")) || 50)));
  const result = await listRecords(c.env.DB, {
    user: c.get("user"),
    academyId: c.req.query("academyId"),
    search: c.req.query("search")?.trim().slice(0, 120),
    paymentStatus: c.req.query("paymentStatus"),
    page,
    pageSize,
  });
  return c.json({ ...result, page, page_size: pageSize });
});

app.get("/api/records/:id", authenticate, async (c) => {
  const record = await getRecord(c.env.DB, c.req.param("id") ?? "", c.get("user"));
  if (!record) return c.json({ error: "Registro no encontrado" }, 404);
  return c.json({ record });
});

app.post("/api/records", authenticate, requireRecordWriter, async (c) => {
  const body = jsonObject(await c.req.json().catch(() => null));
  if (!body) return c.json({ error: "Datos no válidos" }, 400);
  const academyId = typeof body.academy_id === "string" ? body.academy_id : "";
  if (!await ensureAcademyIds(c.env.DB, [academyId])) {
    return c.json({ error: "Selecciona una academia válida" }, 400);
  }
  if (!await canAccessAcademy(c.env.DB, c.get("user"), academyId)) {
    return c.json({ error: "No tienes permiso para esta academia" }, 403);
  }
  try {
    const record = await createRecord(c.env.DB, validateRecord(body, academyId));
    return c.json({ record }, 201);
  } catch (error) {
    if (error instanceof Error && /no es numérico|obligatorio|no válida|Formato|supera/i.test(error.message)) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

app.put("/api/records/:id", authenticate, requireRecordWriter, async (c) => {
  const body = jsonObject(await c.req.json().catch(() => null));
  if (!body) return c.json({ error: "Datos no válidos" }, 400);
  const academyId = typeof body.academy_id === "string" ? body.academy_id : "";
  if (!await ensureAcademyIds(c.env.DB, [academyId])) {
    return c.json({ error: "Selecciona una academia válida" }, 400);
  }
  if (!await getRecord(c.env.DB, c.req.param("id") ?? "", c.get("user"))) {
    return c.json({ error: "Registro no encontrado" }, 404);
  }
  if (!await canAccessAcademy(c.env.DB, c.get("user"), academyId)) {
    return c.json({ error: "No tienes permiso para esta academia" }, 403);
  }
  try {
    const record = validateRecord(body, academyId);
    if (!await updateRecord(c.env.DB, c.req.param("id") ?? "", record)) {
      return c.json({ error: "Registro no encontrado" }, 404);
    }
    return c.json({
      record: await getRecord(c.env.DB, c.req.param("id") ?? "", c.get("user")),
    });
  } catch (error) {
    if (error instanceof Error && /no es numérico|obligatorio|no válida|Formato|supera/i.test(error.message)) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

app.delete("/api/records/:id", authenticate, requireAdmin, async (c) => {
  if (!await deleteRecord(c.env.DB, c.req.param("id") ?? "")) {
    return c.json({ error: "Registro no encontrado" }, 404);
  }
  return c.body(null, 204);
});

async function uploadRows(c: AppContext) {
  const upload = await readUpload(c.req.raw);
  if (!await ensureAcademyIds(c.env.DB, [upload.academyId])) {
    throw new ImportInputError("Selecciona una academia válida");
  }
  if (!await canAccessAcademy(c.env.DB, c.get("user"), upload.academyId)) {
    throw new ImportInputError("No tienes permiso para esta academia");
  }
  const rows = await previewImport(c.env.DB, upload.data, upload.filename, upload.academyId);
  return { upload, rows };
}

app.post("/api/import/preview", authenticate, requireRecordWriter, async (c) => {
  try {
    const { rows } = await uploadRows(c);
    return c.json({
      rows,
      total: rows.length,
      valid: rows.filter((row) => row.record && !row.duplicate).length,
      invalid: rows.filter((row) => row.error).length,
      duplicates: rows.filter((row) => row.duplicate).length,
    });
  } catch (error) {
    if (error instanceof ImportInputError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

app.post("/api/import/commit", authenticate, requireRecordWriter, async (c) => {
  try {
    const { upload, rows } = await uploadRows(c);
    if (!upload.confirmed) {
      return c.json({ error: "Confirma la importación después de revisar la vista previa" }, 400);
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return c.json({ error: `El archivo supera el límite de ${MAX_IMPORT_ROWS} registros por importación.` }, 400);
    }
    const result = await importRecords(c.env.DB, importableRecords(rows));
    return c.json({ ...result, invalid: rows.filter((row) => row.error).length });
  } catch (error) {
    if (error instanceof ImportInputError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

app.notFound((c) => {
  if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
    return c.json({ error: "Ruta no encontrada" }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  console.error("Paddock request failed", error);
  return c.json({ error: "Ocurrió un error inesperado" }, 500);
});

export default app;
