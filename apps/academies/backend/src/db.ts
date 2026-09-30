import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export type Role = "admin" | "viewer";

export interface User {
  id: string;
  username: string;
  role: Role;
  active: number;
}

export interface Academy {
  id: string;
  name: string;
  city: string;
  created_at: string;
}

export interface StudentRecordInput {
  academy_id: string;
  date: string;
  order_number: string;
  advisor: string;
  document_type: string;
  full_name: string;
  document_number: string;
  procedure: string;
  category: string;
  payment_method: string;
  payment_crc_status: string;
  qpl_status: string;
  sheet_cost: number | null;
  qpl_cost: number | null;
  amount_due: number | null;
  medical_exam_cost: number | null;
  observations: string;
}

export interface StudentRecord extends StudentRecordInput {
  id: string;
  academy_name: string;
  created_at: string;
}

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

export class AcademyStore {
  readonly db: DatabaseSync;

  constructor(path = "./data/academies.sqlite") {
    const resolvedPath = path === ":memory:" ? path : resolve(path);
    if (resolvedPath !== ":memory:") mkdirSync(dirname(resolvedPath), { recursive: true });
    this.db = new DatabaseSync(resolvedPath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS academies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        city TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS memberships (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        academy_id TEXT NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, academy_id)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS student_records (
        id TEXT PRIMARY KEY,
        academy_id TEXT NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
        date TEXT NOT NULL DEFAULT '',
        order_number TEXT NOT NULL DEFAULT '',
        advisor TEXT NOT NULL DEFAULT '',
        document_type TEXT NOT NULL DEFAULT '',
        full_name TEXT NOT NULL,
        document_number TEXT NOT NULL DEFAULT '',
        procedure TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        payment_method TEXT NOT NULL DEFAULT '',
        payment_crc_status TEXT NOT NULL DEFAULT '',
        qpl_status TEXT NOT NULL DEFAULT '',
        sheet_cost REAL,
        qpl_cost REAL,
        amount_due REAL,
        medical_exam_cost REAL,
        observations TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS student_records_academy_date
        ON student_records(academy_id, date DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    `);
  }

  userCount(): number {
    return Number(this.db.prepare("SELECT COUNT(*) AS count FROM users").get()?.count ?? 0);
  }

  createInitialAdmin(username: string, passwordHash: string): void {
    if (this.userCount() !== 0) throw new Error("El administrador inicial ya fue creado.");
    this.db.prepare(
      "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, 'admin')",
    ).run(randomUUID(), username, passwordHash);
  }

  getUserByUsername(username: string): (User & { password_hash: string }) | undefined {
    return this.db.prepare(
      "SELECT id, username, password_hash, role, active FROM users WHERE username = ? COLLATE NOCASE",
    ).get(username) as (User & { password_hash: string }) | undefined;
  }

  getSession(tokenHash: string, now: number): User | undefined {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    return this.db.prepare(`
      SELECT users.id, users.username, users.role, users.active
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1
    `).get(tokenHash, now) as User | undefined;
  }

  createSession(tokenHash: string, userId: string, expiresAt: number): void {
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(tokenHash, userId, expiresAt);
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  listAcademies(user: User): Academy[] {
    if (user.role === "admin") {
      return this.db.prepare("SELECT * FROM academies ORDER BY name COLLATE NOCASE")
        .all() as unknown as Academy[];
    }
    return this.db.prepare(`
      SELECT academies.* FROM academies
      JOIN memberships ON memberships.academy_id = academies.id
      WHERE memberships.user_id = ? ORDER BY academies.name COLLATE NOCASE
    `).all(user.id) as unknown as Academy[];
  }

  createAcademy(name: string, city: string): Academy {
    const id = randomUUID();
    this.db.prepare("INSERT INTO academies (id, name, city) VALUES (?, ?, ?)").run(id, name, city);
    return this.db.prepare("SELECT * FROM academies WHERE id = ?").get(id) as unknown as Academy;
  }

  academyExists(id: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM academies WHERE id = ?").get(id));
  }

  listUsers(): Array<User & { academy_ids: string[] }> {
    const users = this.db.prepare(
      "SELECT id, username, role, active FROM users WHERE role = 'viewer' ORDER BY username COLLATE NOCASE",
    ).all() as unknown as User[];
    const academyIds = this.db.prepare(
      "SELECT academy_id FROM memberships WHERE user_id = ? ORDER BY academy_id",
    );
    return users.map((user) => ({
      ...user,
      academy_ids: (academyIds.all(user.id) as Array<{ academy_id: string }>).map((row) => row.academy_id),
    }));
  }

  createViewer(username: string, passwordHash: string, academyIds: string[]): User {
    const id = randomUUID();
    this.db.exec("BEGIN");
    try {
      this.db.prepare(
        "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, 'viewer')",
      ).run(id, username, passwordHash);
      const addMembership = this.db.prepare(
        "INSERT INTO memberships (user_id, academy_id) VALUES (?, ?)",
      );
      for (const academyId of academyIds) addMembership.run(id, academyId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.db.prepare("SELECT id, username, role, active FROM users WHERE id = ?")
      .get(id) as unknown as User;
  }

  updateViewer(
    id: string,
    options: { academyIds: string[]; active: boolean; passwordHash?: string },
  ): boolean {
    const existing = this.db.prepare("SELECT id FROM users WHERE id = ? AND role = 'viewer'").get(id);
    if (!existing) return false;
    this.db.exec("BEGIN");
    try {
      this.db.prepare("UPDATE users SET active = ? WHERE id = ?").run(Number(options.active), id);
      this.db.prepare("DELETE FROM memberships WHERE user_id = ?").run(id);
      const addMembership = this.db.prepare(
        "INSERT INTO memberships (user_id, academy_id) VALUES (?, ?)",
      );
      for (const academyId of options.academyIds) addMembership.run(id, academyId);
      if (options.passwordHash) {
        this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
          .run(options.passwordHash, id);
      }
      this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return true;
  }

  listRecords(options: {
    user: User;
    academyId?: string;
    search?: string;
    paymentStatus?: string;
    page: number;
    pageSize: number;
  }): { records: StudentRecord[]; total: number } {
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (options.user.role === "viewer") {
      clauses.push("student_records.academy_id IN (SELECT academy_id FROM memberships WHERE user_id = ?)");
      parameters.push(options.user.id);
    }
    if (options.academyId) {
      clauses.push("student_records.academy_id = ?");
      parameters.push(options.academyId);
    }
    if (options.search) {
      clauses.push("(student_records.full_name LIKE ? OR student_records.document_number LIKE ? OR student_records.order_number LIKE ?)");
      const query = `%${options.search}%`;
      parameters.push(query, query, query);
    }
    if (options.paymentStatus) {
      clauses.push("student_records.payment_crc_status = ?");
      parameters.push(options.paymentStatus);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = Number(this.db.prepare(
      `SELECT COUNT(*) AS count FROM student_records ${where}`,
    ).get(...parameters)?.count ?? 0);
    const records = this.db.prepare(`
      SELECT student_records.*, academies.name AS academy_name
      FROM student_records JOIN academies ON academies.id = student_records.academy_id
      ${where}
      ORDER BY student_records.date DESC, student_records.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...parameters, options.pageSize, (options.page - 1) * options.pageSize) as unknown as StudentRecord[];
    return { records, total };
  }

  getRecord(id: string, user: User): StudentRecord | undefined {
    const scope = user.role === "admin"
      ? "student_records.id = ?"
      : "student_records.id = ? AND student_records.academy_id IN (SELECT academy_id FROM memberships WHERE user_id = ?)";
    const parameters = user.role === "admin" ? [id] : [id, user.id];
    return this.db.prepare(`
      SELECT student_records.*, academies.name AS academy_name
      FROM student_records JOIN academies ON academies.id = student_records.academy_id
      WHERE ${scope}
    `).get(...parameters) as unknown as StudentRecord | undefined;
  }

  createRecord(record: StudentRecordInput): StudentRecord {
    const id = randomUUID();
    const columns = ["id", "academy_id", ...STUDENT_COLUMNS];
    const values = [id, record.academy_id, ...STUDENT_COLUMNS.map((column) => record[column])];
    this.db.prepare(
      `INSERT INTO student_records (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ).run(...values);
    return this.getRecord(id, { id: "", username: "", role: "admin", active: 1 })!;
  }

  updateRecord(id: string, record: StudentRecordInput): boolean {
    const assignments = STUDENT_COLUMNS.map((column) => `${column} = ?`).join(", ");
    const values = STUDENT_COLUMNS.map((column) => record[column]);
    const result = this.db.prepare(
      `UPDATE student_records SET academy_id = ?, ${assignments} WHERE id = ?`,
    ).run(record.academy_id, ...values, id);
    return result.changes > 0;
  }

  deleteRecord(id: string): boolean {
    return this.db.prepare("DELETE FROM student_records WHERE id = ?").run(id).changes > 0;
  }

  hasDuplicate(record: StudentRecordInput): boolean {
    if (record.order_number) {
      return Boolean(this.db.prepare(
        "SELECT 1 FROM student_records WHERE academy_id = ? AND order_number = ?",
      ).get(record.academy_id, record.order_number));
    }
    if (!record.document_number) return false;
    return Boolean(this.db.prepare(`
      SELECT 1 FROM student_records
      WHERE academy_id = ? AND document_number = ? AND procedure = ? AND date = ?
    `).get(record.academy_id, record.document_number, record.procedure, record.date));
  }

  importRecords(records: StudentRecordInput[]): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;
    this.db.exec("BEGIN");
    try {
      for (const record of records) {
        if (this.hasDuplicate(record)) {
          skipped += 1;
        } else {
          this.createRecord(record);
          imported += 1;
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { imported, skipped };
  }

  close(): void {
    this.db.close();
  }
}