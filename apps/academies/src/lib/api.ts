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
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    throw new ApiError(payload?.error ?? "No fue posible completar la solicitud", response.status);
  }
  return payload as T;
}

const json = (value: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(value) });

export const api = {
  me: () => request<{ user: User }>("/api/auth/me"),
  login: (username: string, password: string) =>
    request<{ user: User }>("/api/auth/login", json({ username, password })),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  academies: () => request<{ academies: Academy[] }>("/api/academies"),
  createAcademy: (name: string, city: string) =>
    request<{ academy: Academy }>("/api/academies", json({ name, city })),
  users: () => request<{ users: AcademyUser[] }>("/api/users"),
  createUser: (username: string, password: string, academyIds: string[]) =>
    request<{ user: AcademyUser }>("/api/users", json({ username, password, academyIds })),
  updateUser: (id: string, academyIds: string[], active: boolean, password = "") =>
    request<{ updated: boolean }>(`/api/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ academyIds, active, ...(password ? { password } : {}) }),
    }),
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
    const body = new FormData();
    body.set("academyId", academyId);
    body.set("file", file);
    return request<ImportPreview>("/api/import/preview", { method: "POST", body });
  },
  commitImport: (file: File, academyId: string) => {
    const body = new FormData();
    body.set("academyId", academyId);
    body.set("file", file);
    body.set("confirm", "true");
    return request<{ imported: number; skipped: number; invalid: number }>(
      "/api/import/commit",
      { method: "POST", body },
    );
  },
};