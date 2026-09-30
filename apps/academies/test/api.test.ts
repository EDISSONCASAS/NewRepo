import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("password authentication protocol", () => {
  it("derives a proof from the challenge without sending the raw password", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ salt: "MDEyMzQ1Njc4OWFiY2RlZg" }), {
        headers: { "x-paddock-password-protocol": "pbkdf2-hmac-v1" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: "1", username: "admin", role: "admin" },
      })));
    vi.stubGlobal("fetch", fetchMock);

    await api.login("admin", "A-long-test-password");

    const [, request] = fetchMock.mock.calls[1] as [string, RequestInit];
    const payload = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(payload).toHaveProperty("passwordProof");
    expect(payload).not.toHaveProperty("password");
    expect(payload.passwordProof).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it("sends a derived password hash and the selected data-entry permission when creating a user", async () => {
    const protocolHeader = { "x-paddock-password-protocol": "pbkdf2-hmac-v1" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: "admin-1", username: "admin", role: "admin" },
      }), { headers: protocolHeader }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: {
          id: "viewer-1",
          username: "viewer",
          role: "viewer",
          active: 1,
          can_write: true,
          academy_ids: ["academy-1"],
        },
      }), { status: 201, headers: protocolHeader }));
    vi.stubGlobal("fetch", fetchMock);

    await api.me();
    await api.createUser("viewer", "Another-long-test-password", ["academy-1"], true);

    const [, request] = fetchMock.mock.calls[1] as [string, RequestInit];
    const payload = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(payload).toHaveProperty("passwordHash");
    expect(payload).not.toHaveProperty("password");
    expect(payload.canWrite).toBe(true);
    expect(payload.passwordHash).toMatch(/^pbkdf2\$310000\$SHA-256\$/u);
  });

  it("keeps the existing Node API password contract when the Worker challenge is absent", async () => {
    const password = "Local-test-password-123";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Not found" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: "admin-1", username: "admin", role: "admin" },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: {
          id: "viewer-1",
          username: "viewer",
          role: "viewer",
          active: 1,
          academy_ids: ["academy-1"],
        },
      }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.login("admin", password);
    await api.createUser("viewer", password, ["academy-1"], false);

    const loginRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const createRequest = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(JSON.parse(String(loginRequest.body))).toMatchObject({ password });
    expect(JSON.parse(String(createRequest.body))).toMatchObject({ password });
  });
});

describe("XLSX imports", () => {
  it("converts workbooks to CSV in the browser before calling the API", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Alumnos");
    worksheet.addRow(["NOMBRES COMPLETOS", "NUMERO DE ORDEN", "FECHA", "OBSERVACIONES"]);
    worksheet.addRow(["Alumno", "ORD-01", new Date("2026-09-30T00:00:00.000Z"), 'texto, "citado"']);
    worksheet.getCell("E2").value = { formula: "1+1", result: 2 };
    const bytes = await workbook.xlsx.writeBuffer();
    const file = new File([new Uint8Array(bytes)], "alumnos.xlsx");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      rows: [],
      total: 0,
      valid: 0,
      invalid: 0,
      duplicates: 0,
    })));
    vi.stubGlobal("fetch", fetchMock);

    await api.previewImport(file, "academy-1");

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const upload = (request.body as FormData).get("file") as File;
    expect(upload.name).toBe("alumnos.csv");
    expect(await upload.text()).toContain(
      'Alumno,ORD-01,2026-09-30,"texto, ""citado""",',
    );
    expect(await upload.text()).not.toContain("1+1");
  });
});
