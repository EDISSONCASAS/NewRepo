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
