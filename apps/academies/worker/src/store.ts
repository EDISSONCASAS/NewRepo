import type {
  Academy,
  AcademyUser,
  Env,
  StudentRecord,
  StudentRecordInput,
  User,
} from "./types.js";
import {
  isValidPasswordHash,
  protectPasswordHash,
  isValidStoredPasswordHash,
} from "./security.js";

const STUDENT_COLUMNS = [
  "date",
  "order_number",
  "advisor",
  "document_type",
  "full_name",
  "document_number",
  "procedure",
  "category",
  "payment_method",
  "payment_crc_status",
  "qpl_status",
  "sheet_cost",
  "qpl_cost",
  "amount_due",
  "medical_exam_cost",
  "observations",
] as const;

async function academyExists(db: D1Database, id: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 FROM academies WHERE id = ?").bind(id).first());
}

export async function ensureInitialAdmin(env: Env): Promise<void> {
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  if (Number(count?.count ?? 0) > 0) return;
  const username = env.INITIAL_ADMIN_USERNAME?.trim() ?? "";
  if (!/^[\p{L}\p{N}_.-]{3,100}$/u.test(username)) {
    throw new Error("Configura INITIAL_ADMIN_USERNAME en Cloudflare.");
  }
  const passwordHash = env.INITIAL_ADMIN_PASSWORD_HASH ?? "";
  if (!isValidPasswordHash(passwordHash)) {
    throw new Error("Configura INITIAL_ADMIN_PASSWORD_HASH con el generador local.");
  }
  const pepper = env.PASSWORD_PEPPER ?? "";
  if (new TextEncoder().encode(pepper).byteLength < 32) {
    throw new Error("Configura PASSWORD_PEPPER con al menos 32 bytes aleatorios.");
  }
  const storedPasswordHash = await protectPasswordHash(passwordHash, pepper);
  await env.DB.prepare(`
    INSERT INTO users (id, username, password_hash, role)
    SELECT ?, ?, ?, 'admin'
    WHERE NOT EXISTS (SELECT 1 FROM users)
  `).bind(crypto.randomUUID(), username, storedPasswordHash).run();
  const createdCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  if (Number(createdCount?.count ?? 0) === 0) {
    throw new Error("No se pudo crear el administrador inicial.");
  }
}

export async function getUserByUsername(
  db: D1Database,
  username: string,
): Promise<(User & { password_hash: string }) | undefined> {
  return (await db.prepare(`
    SELECT id, username, password_hash, role, active
    FROM users WHERE username = ? COLLATE NOCASE
  `).bind(username).first<User & { password_hash: string }>()) ?? undefined;
}

export async function replaceUserPasswordHash(
  db: D1Database,
  id: string,
  passwordHash: string,
): Promise<void> {
  if (!isValidStoredPasswordHash(passwordHash)) {
    throw new Error("La contraseña almacenada no tiene un formato válido.");
  }
  await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .bind(passwordHash, id).run();
}

export async function getSession(db: D1Database, tokenHash: string, now: number): Promise<User | undefined> {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  return (await db.prepare(`
    SELECT users.id, users.username, users.role, users.active
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1
  `).bind(tokenHash, now).first<User>()) ?? undefined;
}

export async function createSession(
  db: D1Database,
  tokenHash: string,
  userId: string,
  expiresAt: number,
): Promise<void> {
  await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(tokenHash, userId, expiresAt).run();
}

export async function deleteSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function listAcademies(db: D1Database, user: User): Promise<Academy[]> {
  const result = user.role === "admin"
    ? await db.prepare("SELECT * FROM academies ORDER BY name COLLATE NOCASE").all<Academy>()
    : await db.prepare(`
        SELECT academies.* FROM academies
        JOIN memberships ON memberships.academy_id = academies.id
        WHERE memberships.user_id = ? ORDER BY academies.name COLLATE NOCASE
      `).bind(user.id).all<Academy>();
  return result.results;
}

export async function createAcademy(
  db: D1Database,
  name: string,
  city: string,
): Promise<Academy> {
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO academies (id, name, city) VALUES (?, ?, ?)")
    .bind(id, name, city).run();
  const academy = await db.prepare("SELECT * FROM academies WHERE id = ?").bind(id).first<Academy>();
  if (!academy) throw new Error("No se pudo crear la academia.");
  return academy;
}

export async function ensureAcademyIds(db: D1Database, ids: string[]): Promise<boolean> {
  for (const id of ids) {
    if (!await academyExists(db, id)) return false;
  }
  return true;
}

export async function listUsers(db: D1Database): Promise<AcademyUser[]> {
  const users = await db.prepare(`
    SELECT id, username, role, active FROM users
    WHERE role = 'viewer' ORDER BY username COLLATE NOCASE
  `).all<User & { active: number }>();
  const memberships = await db.prepare(
    "SELECT user_id, academy_id FROM memberships ORDER BY academy_id",
  ).all<{ user_id: string; academy_id: string }>();
  const academyIds = new Map<string, string[]>();
  for (const row of memberships.results) {
    const ids = academyIds.get(row.user_id) ?? [];
    ids.push(row.academy_id);
    academyIds.set(row.user_id, ids);
  }
  return users.results.map((user) => ({
    ...user,
    active: user.active,
    academy_ids: academyIds.get(user.id) ?? [],
  }));
}

export async function createViewer(
  db: D1Database,
  username: string,
  passwordHash: string,
  academyIds: string[],
): Promise<User> {
  const id = crypto.randomUUID();
  const statements = [
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, 'viewer')",
    ).bind(id, username, passwordHash),
    ...academyIds.map((academyId) => db.prepare(
      "INSERT INTO memberships (user_id, academy_id) VALUES (?, ?)",
    ).bind(id, academyId)),
  ];
  await db.batch(statements);
  const user = await db.prepare(
    "SELECT id, username, role, active FROM users WHERE id = ?",
  ).bind(id).first<User>();
  if (!user) throw new Error("No se pudo crear el usuario.");
  return user;
}

export async function updateViewer(
  db: D1Database,
  id: string,
  options: { academyIds: string[]; active: boolean; passwordHash?: string },
): Promise<boolean> {
  const existing = await db.prepare(
    "SELECT id FROM users WHERE id = ? AND role = 'viewer'",
  ).bind(id).first();
  if (!existing) return false;
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE users SET active = ? WHERE id = ?").bind(Number(options.active), id),
    db.prepare("DELETE FROM memberships WHERE user_id = ?").bind(id),
    ...options.academyIds.map((academyId) => db.prepare(
      "INSERT INTO memberships (user_id, academy_id) VALUES (?, ?)",
    ).bind(id, academyId)),
  ];
  if (options.passwordHash) {
    statements.push(db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .bind(options.passwordHash, id));
  }
  statements.push(db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  await db.batch(statements);
  return true;
}

export interface RecordListOptions {
  user: User;
  academyId?: string;
  search?: string;
  paymentStatus?: string;
  page: number;
  pageSize: number;
}

export async function listRecords(
  db: D1Database,
  options: RecordListOptions,
): Promise<{ records: StudentRecord[]; total: number }> {
  const clauses: string[] = [];
  const parameters: Array<string | number> = [];
  if (options.user.role === "viewer") {
    clauses.push(
      "student_records.academy_id IN (SELECT academy_id FROM memberships WHERE user_id = ?)",
    );
    parameters.push(options.user.id);
  }
  if (options.academyId) {
    clauses.push("student_records.academy_id = ?");
    parameters.push(options.academyId);
  }
  if (options.search) {
    clauses.push(
      "(student_records.full_name LIKE ? OR student_records.document_number LIKE ? OR student_records.order_number LIKE ?)",
    );
    const query = `%${options.search}%`;
    parameters.push(query, query, query);
  }
  if (options.paymentStatus) {
    clauses.push("student_records.payment_crc_status = ?");
    parameters.push(options.paymentStatus);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await db.prepare(
    `SELECT COUNT(*) AS count FROM student_records ${where}`,
  ).bind(...parameters).first<{ count: number }>();
  const records = await db.prepare(`
    SELECT student_records.*, academies.name AS academy_name
    FROM student_records JOIN academies ON academies.id = student_records.academy_id
    ${where}
    ORDER BY student_records.date DESC, student_records.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...parameters, options.pageSize, (options.page - 1) * options.pageSize)
    .all<StudentRecord>();
  return { records: records.results, total: Number(total?.count ?? 0) };
}

export async function getRecord(
  db: D1Database,
  id: string,
  user: User,
): Promise<StudentRecord | undefined> {
  const scope = user.role === "admin"
    ? "student_records.id = ?"
    : "student_records.id = ? AND student_records.academy_id IN (SELECT academy_id FROM memberships WHERE user_id = ?)";
  const statement = user.role === "admin"
    ? db.prepare(`
        SELECT student_records.*, academies.name AS academy_name
        FROM student_records JOIN academies ON academies.id = student_records.academy_id
        WHERE ${scope}
      `).bind(id)
    : db.prepare(`
        SELECT student_records.*, academies.name AS academy_name
        FROM student_records JOIN academies ON academies.id = student_records.academy_id
        WHERE ${scope}
      `).bind(id, user.id);
  return (await statement.first<StudentRecord>()) ?? undefined;
}

export async function createRecord(
  db: D1Database,
  record: StudentRecordInput,
): Promise<StudentRecord> {
  const id = crypto.randomUUID();
  const columns = ["id", "academy_id", ...STUDENT_COLUMNS];
  const values = [id, record.academy_id, ...STUDENT_COLUMNS.map((column) => record[column])];
  await db.prepare(
    `INSERT INTO student_records (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  ).bind(...values).run();
  const created = await getRecord(db, id, {
    id: "",
    username: "",
    role: "admin",
    active: 1,
  });
  if (!created) throw new Error("No se pudo crear el registro.");
  return created;
}

export async function updateRecord(
  db: D1Database,
  id: string,
  record: StudentRecordInput,
): Promise<boolean> {
  const assignments = STUDENT_COLUMNS.map((column) => `${column} = ?`).join(", ");
  const values = STUDENT_COLUMNS.map((column) => record[column]);
  const result = await db.prepare(
    `UPDATE student_records SET academy_id = ?, ${assignments} WHERE id = ?`,
  ).bind(record.academy_id, ...values, id).run();
  return result.meta.changes > 0;
}

export async function deleteRecord(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM student_records WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}

export async function findExistingOrderNumbers(
  db: D1Database,
  academyId: string,
  orderNumbers: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let start = 0; start < orderNumbers.length; start += 90) {
    const chunk = orderNumbers.slice(start, start + 90);
    const rows = await db.prepare(
      `SELECT order_number FROM student_records WHERE academy_id = ? AND order_number IN (${chunk.map(() => "?").join(", ")})`,
    ).bind(academyId, ...chunk).all<{ order_number: string }>();
    for (const row of rows.results) existing.add(row.order_number);
  }
  return existing;
}

export async function findExistingDocumentKeys(
  db: D1Database,
  academyId: string,
  keys: Array<{ documentNumber: string; procedure: string; date: string }>,
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let start = 0; start < keys.length; start += 25) {
    const chunk = keys.slice(start, start + 25);
    const clauses = chunk.map(() => "(document_number = ? AND procedure = ? AND date = ?)").join(" OR ");
    const values = chunk.flatMap((key) => [key.documentNumber, key.procedure, key.date]);
    const rows = await db.prepare(`
      SELECT document_number, procedure, date FROM student_records
      WHERE academy_id = ? AND (${clauses})
    `).bind(academyId, ...values).all<{
      document_number: string;
      procedure: string;
      date: string;
    }>();
    for (const row of rows.results) {
      existing.add(`${row.document_number}|${row.procedure}|${row.date}`);
    }
  }
  return existing;
}

export function duplicateRecordKey(record: StudentRecordInput): string | undefined {
  if (record.order_number) return `order|${record.order_number}`;
  if (record.document_number) {
    return `${record.document_number}|${record.procedure}|${record.date}`;
  }
  return undefined;
}

export async function importRecords(
  db: D1Database,
  records: StudentRecordInput[],
): Promise<{ imported: number; skipped: number }> {
  if (records.length > 400) throw new Error("Importa máximo 400 registros por archivo.");
  const statements = records.map((record) => {
    const id = crypto.randomUUID();
    const columns = ["id", "academy_id", ...STUDENT_COLUMNS];
    const values = [id, record.academy_id, ...STUDENT_COLUMNS.map((column) => record[column])];
    return db.prepare(
      `INSERT INTO student_records (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ).bind(...values);
  });
  if (statements.length) await db.batch(statements);
  return { imported: records.length, skipped: 0 };
}

export async function validateAcademyIds(db: D1Database, ids: string[]): Promise<boolean> {
  return ensureAcademyIds(db, ids);
}
