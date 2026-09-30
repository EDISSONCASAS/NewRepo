import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import type { AcademyStore, StudentRecordInput } from "./db.js";

const HEADER_FIELDS: Record<string, keyof StudentRecordInput> = {
  FECHA: "date",
  "NUMERO DE ORDEN": "order_number",
  ORDEN: "order_number",
  ASESOR: "advisor",
  "TIPO DE DOCUMENTO": "document_type",
  "TIPO DOCUMENTO": "document_type",
  "NOMBRES COMPLETOS": "full_name",
  "NOMBRE COMPLETO": "full_name",
  "NUMERO DE DOCUMENTO": "document_number",
  DOCUMENTO: "document_number",
  "TIPO DE TRAMITE": "procedure",
  TRAMITE: "procedure",
  CATEGORIA: "category",
  "FORMA DE PAGO ALUMNO": "payment_method",
  "FORMA DE PAGO": "payment_method",
  "ESTADO PAGO CRC": "payment_crc_status",
  "ESTADO DE PAGO CRC": "payment_crc_status",
  QPL: "qpl_status",
  "COSTO LAMINA": "sheet_cost",
  "COSTO QPL": "qpl_cost",
  "VALOR A CONSIGNAR": "amount_due",
  "COSTO EXAM MEDICO": "medical_exam_cost",
  "COSTO EXAMEN MEDICO": "medical_exam_cost",
  OBSERVACION: "observations",
  OBSERVACIONES: "observations",
};

const TEXT_FIELDS = [
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
  "observations",
] as const;

const MONEY_FIELDS = [
  "sheet_cost",
  "qpl_cost",
  "amount_due",
  "medical_exam_cost",
] as const;

export interface ImportRow {
  source_row: number;
  record?: StudentRecordInput;
  error?: string;
  duplicate: boolean;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("es-CO");
}

function readText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function importCell(value: unknown): unknown {
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const cell = value as Record<string, unknown>;
  if ("formula" in cell || "sharedFormula" in cell) return "";
  if (typeof cell.text === "string") return cell.text;
  if (Array.isArray(cell.richText)) {
    return cell.richText.map((part) => {
      if (!part || typeof part !== "object") return "";
      return String((part as Record<string, unknown>).text ?? "");
    }).join("");
  }
  return value;
}

function parseDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Date.UTC(1899, 11, 30) + value * 86_400_000;
    return new Date(milliseconds).toISOString().slice(0, 10);
  }
  const text = readText(value);
  if (!text) return "";
  const isoDate = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    return validDate(year, month, day);
  }
  const localDate = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(text);
  if (!localDate) throw new Error("Fecha no válida");
  const day = Number(localDate[1]);
  const month = Number(localDate[2]);
  const rawYear = Number(localDate[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return validDate(year, month, day);
}

function validDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Fecha no válida");
  }
  return date.toISOString().slice(0, 10);
}

function parseMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  let text = readText(value).replace(/[\s$COP]/gi, "").replace(/[()]/g, "");
  if (!text) return null;
  const negative = text.startsWith("-");
  text = text.replace(/-/g, "");
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSeparator = lastDot > lastComma ? "." : ",";
    const groupSeparator = decimalSeparator === "." ? "," : ".";
    text = text.split(groupSeparator).join("").replace(decimalSeparator, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const separator = lastDot >= 0 ? "." : ",";
    const pieces = text.split(separator);
    const tail = pieces.at(-1) ?? "";
    text = tail.length === 3 && pieces.length > 1
      ? pieces.join("")
      : `${pieces.slice(0, -1).join("")}.${tail}`;
  }
  const amount = Number(text);
  return Number.isFinite(amount) ? (negative ? -1 : 1) * Math.round(amount * 100) / 100 : null;
}

function normalizeInput(value: unknown, academyId: string): StudentRecordInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Formato de registro no válido");
  }
  const input = value as Record<string, unknown>;
  const fullName = readText(input.full_name);
  if (!fullName) throw new Error("El nombre completo es obligatorio");
  const record: StudentRecordInput = {
    academy_id: academyId,
    date: parseDate(input.date),
    order_number: "",
    advisor: "",
    document_type: "",
    full_name: fullName,
    document_number: "",
    procedure: "",
    category: "",
    payment_method: "",
    payment_crc_status: "",
    qpl_status: "",
    sheet_cost: null,
    qpl_cost: null,
    amount_due: null,
    medical_exam_cost: null,
    observations: "",
  };
  for (const field of TEXT_FIELDS) {
    const text = field === "full_name" ? fullName : readText(input[field]);
    if (text.length > 500) throw new Error("Un campo de texto supera el máximo permitido");
    record[field] = text;
  }
  for (const field of MONEY_FIELDS) {
    const money = parseMoney(input[field]);
    if (input[field] !== null && input[field] !== undefined && input[field] !== "" && money === null) {
      throw new Error("Uno de los valores de pago no es numérico");
    }
    record[field] = money;
  }
  return record;
}

export function validateRecord(value: unknown, academyId: string): StudentRecordInput {
  return normalizeInput(value, academyId);
}

function parseRows(rows: unknown[][], academyId: string, store: AcademyStore): ImportRow[] {
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell)));
  if (headerIndex < 0) throw new Error("El archivo no contiene encabezados");
  const headerRow = rows[headerIndex] ?? [];
  const mapping = headerRow.map((header) => HEADER_FIELDS[normalizeHeader(header)]);
  if (!mapping.includes("full_name")) {
    throw new Error("No se encontró la columna NOMBRES COMPLETOS o NOMBRE COMPLETO");
  }
  const seen = new Set<string>();
  const parsed: ImportRow[] = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (!row.some((cell) => readText(cell))) continue;
    const values: Record<string, unknown> = {};
    mapping.forEach((field, columnIndex) => {
      if (field) values[field] = importCell(row[columnIndex]);
    });
    try {
      const record = normalizeInput(values, academyId);
      const signature = record.order_number
        ? `${record.academy_id}|order|${record.order_number}`
        : record.document_number
          ? `${record.academy_id}|${record.document_number}|${record.procedure}|${record.date}`
          : null;
      const duplicate = store.hasDuplicate(record) || Boolean(signature && seen.has(signature));
      if (signature) seen.add(signature);
      parsed.push({ source_row: index + 1, record, duplicate });
    } catch (error) {
      parsed.push({
        source_row: index + 1,
        error: error instanceof Error ? error.message : "Fila no válida",
        duplicate: false,
      });
    }
  }
  return parsed;
}

export async function previewImport(
  data: Buffer,
  filename: string,
  academyId: string,
  store: AcademyStore,
): Promise<ImportRow[]> {
  const extension = filename.toLocaleLowerCase("es-CO").split(".").at(-1);
  let rows: unknown[][];
  if (extension === "csv") {
    rows = parseCsv(data, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as unknown[][];
  } else if (extension === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const workbookBuffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    await workbook.xlsx.load(
      workbookBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("El libro no contiene hojas");
    rows = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values: unknown = row.values;
      if (Array.isArray(values)) rows.push(values.slice(1) as unknown[]);
    });
  } else {
    throw new Error("El archivo debe ser CSV o XLSX");
  }
  return parseRows(rows, academyId, store);
}