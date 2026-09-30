import type { Academy, Role, StudentRecord, StudentRecordInput, User } from "../../backend/src/record-types.js";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  INITIAL_ADMIN_USERNAME?: string;
  INITIAL_ADMIN_PASSWORD_HASH?: string;
  PASSWORD_PEPPER?: string;
}

export type { Academy, Role, StudentRecord, StudentRecordInput, User };

export interface AcademyUser extends User {
  active: number;
  academy_ids: string[];
}

export interface ImportRow {
  source_row: number;
  record?: StudentRecordInput;
  error?: string;
  duplicate: boolean;
}
