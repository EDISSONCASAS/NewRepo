import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import type { AcademyStore } from "./db.js";
import { parseImportRows, validateRecord, type ImportRow } from "./record-validation.js";

export { validateRecord };
export type { ImportRow };

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
  return parseImportRows(rows, academyId, (record) => Promise.resolve(store.hasDuplicate(record)));
}
