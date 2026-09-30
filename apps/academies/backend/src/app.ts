import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyError,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { extname, resolve } from "node:path";
import { AcademyStore, type StudentRecordInput, type User } from "./db.js";
import { previewImport, validateRecord } from "./records.js";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  isStrongPassword,
  verifyPassword,
} from "./security.js";

const SESSION_COOKIE = "paddock_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH = `scrypt$32768$8$1$MDEyMzQ1Njc4OWFiY2RlZg$${Buffer.alloc(64).toString("base64url")}`;

interface AppOptions {
  store?: AcademyStore;
  databasePath?: string;
  initialAdmin?: { username: string; password: string };
  secureCookies?: boolean;
  staticDirectory?: string;
}

interface Upload {
  filename: string;
  academyId: string;
  data: Buffer;
  confirmed: boolean;
}

function bodyObject(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
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
  return { id: user.id, username: user.username, role: user.role };
}

async function readUpload(request: FastifyRequest): Promise<Upload> {
  let academyId = "";
  let filename = "";
  let data: Buffer | undefined;
  let confirmed = false;
  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "file" || data) throw new Error("Adjunta un solo archivo");
      filename = part.filename;
      data = await part.toBuffer();
    } else if (part.fieldname === "academyId" && typeof part.value === "string") {
      academyId = part.value.trim();
    } else if (part.fieldname === "confirm" && part.value === "true") {
      confirmed = true;
    }
  }
  if (!data || !filename) throw new Error("Selecciona un archivo CSV o XLSX");
  if (!academyId) throw new Error("Selecciona la academia de destino");
  return { filename, academyId, data, confirmed };
}

function ensureAcademyIds(store: AcademyStore, ids: string[]): boolean {
  return ids.every((id) => store.academyExists(id));
}

export async function buildApp(options: AppOptions = {}) {
  const store = options.store ?? new AcademyStore(options.databasePath);
  if (store.userCount() === 0) {
    if (!options.initialAdmin) {
      throw new Error("Crea el primer administrador antes de iniciar el servidor.");
    }
    if (!/^[\p{L}\p{N}_.-]{3,100}$/u.test(options.initialAdmin.username)) {
      throw new Error("El usuario administrador debe tener 3 o más caracteres válidos.");
    }
    if (!isStrongPassword(options.initialAdmin.password)) {
      throw new Error("La contraseña del administrador debe tener al menos 12 caracteres.");
    }
    store.createInitialAdmin(
      options.initialAdmin.username,
      await hashPassword(options.initialAdmin.password),
    );
  }

  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  app.decorateRequest("academyUser", null);
  await app.register(cookie);
  if (options.staticDirectory) {
    await app.register(fastifyStatic, {
      root: resolve(options.staticDirectory),
      prefix: "/",
      wildcard: false,
    });
  }
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2 },
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    return payload;
  });

  app.decorate("academyStore", store);
  app.addHook("onClose", async () => {
    if (!options.store) store.close();
  });

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      await reply.code(401).send({ error: "Inicia sesión para continuar" });
      return;
    }
    const user = store.getSession(hashSessionToken(token), Date.now());
    if (!user) {
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      await reply.code(401).send({ error: "La sesión expiró. Inicia sesión de nuevo" });
      return;
    }
    request.academyUser = user;
  };

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.academyUser?.role !== "admin") {
      await reply.code(403).send({ error: "Acción reservada al administrador" });
    }
  };

  app.get("/api/health", async () => ({ status: "ok" }));

  app.post("/api/auth/login", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = bodyObject(request.body);
    const username = body ? textField(body, "username", 100) : "";
    const password = body && typeof body.password === "string" ? body.password : "";
    const user = username ? store.getUserByUsername(username) : undefined;
    const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!user || !user.active || !valid) {
      return reply.code(401).send({ error: "Usuario o contraseña incorrectos" });
    }
    const token = createSessionToken();
    store.createSession(hashSessionToken(token), user.id, Date.now() + SESSION_DURATION_MS);
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      secure: options.secureCookies ?? process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: SESSION_DURATION_MS / 1000,
    });
    return { user: publicUser(user) };
  });

  app.post("/api/auth/logout", { preHandler: authenticate }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) store.deleteSession(hashSessionToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/api/auth/me", { preHandler: authenticate }, async (request) => ({
    user: publicUser(request.academyUser!),
  }));

  app.get("/api/academies", { preHandler: authenticate }, async (request) => ({
    academies: store.listAcademies(request.academyUser!),
  }));

  app.post("/api/academies", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const body = bodyObject(request.body);
    const name = body ? textField(body, "name", 120) : "";
    const city = body ? textField(body, "city", 120) : "";
    if (!name) return reply.code(400).send({ error: "El nombre de la academia es obligatorio" });
    return reply.code(201).send({ academy: store.createAcademy(name, city) });
  });

  app.get("/api/users", {
    preHandler: [authenticate, requireAdmin],
  }, async () => ({ users: store.listUsers() }));

  app.post("/api/users", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const body = bodyObject(request.body);
    if (!body) return reply.code(400).send({ error: "Datos no válidos" });
    const username = textField(body, "username", 100);
    const password = typeof body.password === "string" ? body.password : "";
    const academyIds = academyIdsField(body.academyIds);
    if (!/^[\p{L}\p{N}_.-]{3,100}$/u.test(username)) {
      return reply.code(400).send({ error: "El usuario debe tener 3 o más caracteres válidos" });
    }
    if (!isStrongPassword(password)) {
      return reply.code(400).send({ error: "La contraseña debe tener al menos 12 caracteres" });
    }
    if (!academyIds?.length || !ensureAcademyIds(store, academyIds)) {
      return reply.code(400).send({ error: "Asigna al menos una academia válida" });
    }
    try {
      const user = store.createViewer(username, await hashPassword(password), academyIds);
      return reply.code(201).send({ user: { ...publicUser(user), active: user.active, academy_ids: academyIds } });
    } catch {
      return reply.code(409).send({ error: "Ese nombre de usuario ya está en uso" });
    }
  });

  app.patch<{ Params: { id: string } }>("/api/users/:id", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const body = bodyObject(request.body);
    if (!body) return reply.code(400).send({ error: "Datos no válidos" });
    const academyIds = academyIdsField(body.academyIds);
    const active = typeof body.active === "boolean" ? body.active : null;
    const password = typeof body.password === "string" ? body.password : "";
    if (!academyIds || !ensureAcademyIds(store, academyIds) || active === null) {
      return reply.code(400).send({ error: "Indica el estado y las academias válidas" });
    }
    if (password && !isStrongPassword(password)) {
      return reply.code(400).send({ error: "La contraseña debe tener al menos 12 caracteres" });
    }
    const passwordHash = password ? await hashPassword(password) : undefined;
    if (!store.updateViewer(request.params.id, { academyIds, active, passwordHash })) {
      return reply.code(404).send({ error: "Usuario no encontrado" });
    }
    return { updated: true };
  });

  app.get<{
    Querystring: {
      academyId?: string;
      search?: string;
      paymentStatus?: string;
      page?: string;
      pageSize?: string;
    };
  }>("/api/records", { preHandler: authenticate }, async (request) => {
    const page = Math.max(1, Math.floor(Number(request.query.page) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(request.query.pageSize) || 50)));
    const result = store.listRecords({
      user: request.academyUser!,
      academyId: request.query.academyId,
      search: request.query.search?.trim().slice(0, 120),
      paymentStatus: request.query.paymentStatus,
      page,
      pageSize,
    });
    return { ...result, page, page_size: pageSize };
  });

  app.get<{ Params: { id: string } }>("/api/records/:id", {
    preHandler: authenticate,
  }, async (request, reply) => {
    const record = store.getRecord(request.params.id, request.academyUser!);
    if (!record) return reply.code(404).send({ error: "Registro no encontrado" });
    return { record };
  });

  app.post("/api/records", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const body = bodyObject(request.body);
    if (!body) return reply.code(400).send({ error: "Datos no válidos" });
    const academyId = typeof body.academy_id === "string" ? body.academy_id : "";
    if (!store.academyExists(academyId)) {
      return reply.code(400).send({ error: "Selecciona una academia válida" });
    }
    try {
      const record = store.createRecord(validateRecord(body, academyId));
      return reply.code(201).send({ record });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Registro no válido" });
    }
  });

  app.put<{ Params: { id: string } }>("/api/records/:id", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const body = bodyObject(request.body);
    if (!body) return reply.code(400).send({ error: "Datos no válidos" });
    const academyId = typeof body.academy_id === "string" ? body.academy_id : "";
    if (!store.academyExists(academyId)) {
      return reply.code(400).send({ error: "Selecciona una academia válida" });
    }
    try {
      const record = validateRecord(body, academyId);
      if (!store.updateRecord(request.params.id, record)) {
        return reply.code(404).send({ error: "Registro no encontrado" });
      }
      return { record: store.getRecord(request.params.id, request.academyUser!) };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Registro no válido" });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/records/:id", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    if (!store.deleteRecord(request.params.id)) {
      return reply.code(404).send({ error: "Registro no encontrado" });
    }
    return reply.code(204).send();
  });

  app.post("/api/import/preview", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    try {
      const upload = await readUpload(request);
      if (!store.academyExists(upload.academyId)) {
        return reply.code(400).send({ error: "Selecciona una academia válida" });
      }
      const rows = await previewImport(upload.data, upload.filename, upload.academyId, store);
      return {
        rows,
        total: rows.length,
        valid: rows.filter((row) => row.record && !row.duplicate).length,
        invalid: rows.filter((row) => row.error).length,
        duplicates: rows.filter((row) => row.duplicate).length,
      };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "No se pudo leer el archivo" });
    }
  });

  app.post("/api/import/commit", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    try {
      const upload = await readUpload(request);
      if (!store.academyExists(upload.academyId)) {
        return reply.code(400).send({ error: "Selecciona una academia válida" });
      }
      if (!upload.confirmed) {
        return reply.code(400).send({ error: "Confirma la importación después de revisar la vista previa" });
      }
      const rows = await previewImport(upload.data, upload.filename, upload.academyId, store);
      const validRecords: StudentRecordInput[] = rows
        .filter((row) => row.record && !row.duplicate)
        .map((row) => row.record!);
      const result = store.importRecords(validRecords);
      return { ...result, invalid: rows.filter((row) => row.error).length };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "No se pudo importar el archivo" });
    }
  });

  if (options.staticDirectory) {
    const serveFrontend = async (request: FastifyRequest, reply: FastifyReply) => {
      const pathname = request.url.split("?")[0] ?? "/";
      if (pathname === "/api" || pathname.startsWith("/api/")) {
        return reply.code(404).send({ error: "Ruta no encontrada" });
      }
      if (pathname === "/" || !extname(pathname)) {
        return reply.sendFile("index.html");
      }
      return reply.sendFile(pathname.slice(1));
    };
    app.get("/*", serveFrontend);
  }

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.statusCode === 413) {
      return reply.code(413).send({ error: "El archivo supera el límite de 5 MB" });
    }
    return reply.code(error.statusCode ?? 500).send({
      error: error.statusCode && error.statusCode < 500
        ? error.message
        : "Ocurrió un error inesperado",
    });
  });

  return app;
}
