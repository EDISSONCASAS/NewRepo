export type Role = "admin" | "viewer";

export interface User {
  id: string;
  username: string;
  role: Role;
}

export interface Academy {
  id: string;
  name: string;
  city: string;
  created_at: string;
}

export interface AcademyUser extends User {
  active: number;
  academy_ids: string[];
}

export interface StudentRecord {
  id: string;
  academy_id: string;
  academy_name: string;
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
  created_at: string;
}

export type RecordDraft = Omit<StudentRecord, "id" | "academy_name" | "created_at"> & {
  id?: string;
};

export interface ImportRow {
  source_row: number;
  record?: RecordDraft;
  error?: string;
  duplicate: boolean;
}

export interface ImportPreview {
  rows: ImportRow[];
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

let workerPasswordProtocol = false;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (response.headers.get("x-paddock-password-protocol") === "pbkdf2-hmac-v1") {
    workerPasswordProtocol = true;
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    throw new ApiError(payload?.error ?? "No fue posible completar la solicitud", response.status);
  }
  return payload as T;
}

const json = (value: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(value) });
const PASSWORD_ITERATIONS = 310_000;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derivePasswordHash(password: string, salt?: string): Promise<string> {
  if (password.length < 12 || new TextEncoder().encode(password).byteLength > 256) {
    throw new ApiError("La contraseña debe tener al menos 12 caracteres", 400);
  }
  const saltBytes = salt ? decodeBase64Url(salt) : crypto.getRandomValues(new Uint8Array(16));
  if (saltBytes.length !== 16) throw new ApiError("No se pudo iniciar la autenticación", 500);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const verifier = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: PASSWORD_ITERATIONS },
    key,
    256,
  ));
  return `pbkdf2$${PASSWORD_ITERATIONS}$SHA-256$${encodeBase64Url(saltBytes)}$${encodeBase64Url(verifier)}`;
}

function csvCell(value: unknown): string {
  let text: string;
  if (value instanceof Date) {
    text = value.toISOString().slice(0, 10);
  } else if (value && typeof value === "object") {
    const cell = value as { formula?: unknown; sharedFormula?: unknown; text?: unknown; richText?: unknown };
    if ("formula" in cell || "sharedFormula" in cell) return "";
    if (typeof cell.text === "string") {
      text = cell.text;
    } else if (Array.isArray(cell.richText)) {
      text = cell.richText.map((part) =>
        part && typeof part === "object" && "text" in part ? String(part.text ?? "") : "",
      ).join("");
    } else {
      text = String(value);
    }
  } else {
    text = value === null || value === undefined ? "" : String(value);
  }
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function csvImportFile(file: File): Promise<File> {
  if (!file.name.toLocaleLowerCase("es-CO").endsWith(".xlsx")) return file;
  try {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const bytes = await file.arrayBuffer();
    await workbook.xlsx.load(bytes as Parameters<typeof workbook.xlsx.load>[0]);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new ApiError("El libro no contiene hojas", 400);
    const rows: string[] = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values: unknown = row.values;
      if (Array.isArray(values)) {
        rows.push((values.slice(1) as unknown[]).map(csvCell).join(","));
      }
    });
    return new File(
      [rows.join("\r\n")],
      file.name.replace(/\.xlsx$/iu, ".csv"),
      { type: "text/csv" },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("No se pudo leer el archivo XLSX en este navegador", 400);
  }
}

export const api = {
  me: () => request<{ user: User }>("/api/auth/me"),
  login: async (username: string, password: string) => {
    let challenge: { salt: string };
    try {
      challenge = await request<{ salt: string }>(
        `/api/auth/challenge?username=${encodeURIComponent(username)}`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        workerPasswordProtocol = false;
        return request<{ user: User }>("/api/auth/login", json({ username, password }));
      }
      throw error;
    }
    const passwordHash = await derivePasswordHash(password, challenge.salt);
    return request<{ user: User }>(
      "/api/auth/login",
      json({ username, passwordProof: passwordHash.split("$").at(-1) }),
    );
  },
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  academies: () => request<{ academies: Academy[] }>("/api/academies"),
  createAcademy: (name: string, city: string) =>
    request<{ academy: Academy }>("/api/academies", json({ name, city })),
  users: () => request<{ users: AcademyUser[] }>("/api/users"),
  createUser: async (username: string, password: string, academyIds: string[]) => {
    const credentials = workerPasswordProtocol
      ? { passwordHash: await derivePasswordHash(password) }
      : { password };
    return request<{ user: AcademyUser }>(
      "/api/users",
      json({ username, ...credentials, academyIds }),
    );
  },
  updateUser: async (id: string, academyIds: string[], active: boolean, password = "") => {
    const credentials = password
      ? workerPasswordProtocol
        ? { passwordHash: await derivePasswordHash(password) }
        : { password }
      : {};
    return request<{ updated: boolean }>(`/api/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ academyIds, active, ...credentials }),
    });
  },
  records: (query: URLSearchParams) =>
    request<{ records: StudentRecord[]; total: number; page: number; page_size: number }>(
      `/api/records?${query.toString()}`,
    ),
  createRecord: (record: RecordDraft) =>
    request<{ record: StudentRecord }>("/api/records", json(record)),
  updateRecord: (record: RecordDraft & { id: string }) =>
    request<{ record: StudentRecord }>(`/api/records/${encodeURIComponent(record.id)}`, {
      method: "PUT",
      body: JSON.stringify(record),
    }),
  deleteRecord: (id: string) =>
    request<void>(`/api/records/${encodeURIComponent(id)}`, { method: "DELETE" }),
  previewImport: (file: File, academyId: string) => {
    return csvImportFile(file).then((importFile) => {
      const body = new FormData();
      body.set("academyId", academyId);
      body.set("file", importFile);
      return request<ImportPreview>("/api/import/preview", { method: "POST", body });
    });
  },
  commitImport: (file: File, academyId: string) => {
    return csvImportFile(file).then((importFile) => {
      const body = new FormData();
      body.set("academyId", academyId);
      body.set("file", importFile);
      body.set("confirm", "true");
      return request<{ imported: number; skipped: number; invalid: number }>(
        "/api/import/commit",
        { method: "POST", body },
      );
    });
  },
};