import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { AcademyStore } from "../src/db.js";
import { previewImport, validateRecord } from "../src/records.js";

test("la importación CSV normaliza encabezados, fechas y pesos colombianos", async () => {
  const store = new AcademyStore(":memory:");
  try {
    const academy = store.createAcademy("Academia Demo", "Bogotá");
    const csv = Buffer.from(
      "FECHA,NUMERO DE ORDEN,TIPO DE DOCUMENTO,NOMBRES COMPLETOS,NUMERO DE DOCUMENTO,TIPO DE TRAMITE,CATEGORIA,ESTADO PAGO CRC,VALOR A CONSIGNAR,COSTO EXAM. MEDICO\n" +
      "27/09/26,ORD-45,CC,Andrea Prueba,123456,PRIMERA VEZ,A2,PAGA,130.000,170.000\n",
    );
    const rows = await previewImport(csv, "alumnos.csv", academy.id, store);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.error, undefined);
    assert.equal(rows[0]?.record?.date, "2026-09-27");
    assert.equal(rows[0]?.record?.amount_due, 130000);
    assert.equal(rows[0]?.record?.medical_exam_cost, 170000);
    assert.equal(rows[0]?.duplicate, false);

    store.importRecords([rows[0]!.record!]);
    const duplicateRows = await previewImport(csv, "alumnos.csv", academy.id, store);
    assert.equal(duplicateRows[0]?.duplicate, true);
  } finally {
    store.close();
  }
});

test("la validación rechaza nombres vacíos y montos no numéricos", () => {
  assert.throws(() => validateRecord({ full_name: "   " }, "academy-1"), /nombre completo/i);
  assert.throws(() => validateRecord({ full_name: "Alumno", amount_due: "no es dinero" }, "academy-1"), /pago no es numérico/i);
});

test("la importación XLSX ignora fórmulas en lugar de importar resultados calculados", async () => {
  const store = new AcademyStore(":memory:");
  try {
    const academy = store.createAcademy("Academia XLSX", "Cali");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Alumnos");
    worksheet.addRow(["NOMBRES COMPLETOS", "VALOR A CONSIGNAR"]);
    worksheet.addRow(["Alumna Fórmula", { formula: "1000+1", result: 1001 }]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const rows = await previewImport(bytes, "alumnos.xlsx", academy.id, store);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.record?.full_name, "Alumna Fórmula");
    assert.equal(rows[0]?.record?.amount_due, null);
    assert.equal(rows[0]?.error, undefined);
  } finally {
    store.close();
  }
});