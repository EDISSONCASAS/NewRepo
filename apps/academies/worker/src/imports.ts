import { parse as parseCsv } from "csv-parse/sync";
import { parseImportRows } from "../../backend/src/record-validation.js";
import type { ImportRow, StudentRecordInput } from "./types.js";
import {
  duplicateRecordKey,
  findExistingDocumentKeys,
  findExistingOrderNumbers,
} from "./store.js";

const MAX_IMPORT_ROWS = 400;

export class ImportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportInputError";
  }
}

export async function previewImport(
  db: D1Database,
  data: Uint8Array,
  filename: string,
  academyId: string,
): Promise<ImportRow[]> {
  const extension = filename.toLocaleLowerCase("es-CO").split(".").at(-1);
  let parsedRows: ImportRow[];
  try {
    if (extension !== "csv") {
      throw new Error("El archivo debe ser CSV; convierte los XLSX en el navegador antes de subirlos");
    }
    const rows = parseCsv(new TextDecoder().decode(data), {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as unknown[][];
    parsedRows = await parseImportRows(rows, academyId, async () => false);
  } catch (error) {
    throw new ImportInputError(error instanceof Error ? error.message : "No se pudo leer el archivo");
  }

  if (parsedRows.length > MAX_IMPORT_ROWS) {
    throw new ImportInputError(`El archivo supera el límite de ${MAX_IMPORT_ROWS} registros por importación.`);
  }
  const records = parsedRows.flatMap((row) => row.record ? [row.record] : []);
  const orderNumbers = [...new Set(records.flatMap((record) =>
    record.order_number ? [record.order_number] : [],
  ))];
  const documentKeys = [...new Map(records.flatMap((record) => {
    if (!record.order_number && record.document_number) {
      const key = duplicateRecordKey(record)!;
      return [[key, {
        documentNumber: record.document_number,
        procedure: record.procedure,
        date: record.date,
      }] as const];
    }
    return [];
  })).values()];
  const [existingOrders, existingDocuments] = await Promise.all([
    findExistingOrderNumbers(db, academyId, orderNumbers),
    findExistingDocumentKeys(db, academyId, documentKeys),
  ]);
  for (const row of parsedRows) {
    if (!row.record || row.duplicate) continue;
    const key = duplicateRecordKey(row.record);
    if (!key) continue;
    row.duplicate = row.record.order_number
      ? existingOrders.has(row.record.order_number)
      : existingDocuments.has(key);
  }
  return parsedRows;
}

export function importableRecords(rows: ImportRow[]): StudentRecordInput[] {
  return rows.flatMap((row) => row.record && !row.duplicate ? [row.record] : []);
}
