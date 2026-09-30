import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate } from "../src/lib/format";

describe("formatCurrency", () => {
  it("muestra pesos colombianos sin decimales", () => {
    expect(formatCurrency(130000)).toMatch(/130[.\u00a0]?000/);
    expect(formatCurrency(null)).toBe("—");
  });
});

describe("formatDate", () => {
  it("presenta fechas ISO en el calendario colombiano", () => {
    expect(formatDate("2026-09-27")).toMatch(/27/);
    expect(formatDate("2026-09-27")).toMatch(/sep/i);
  });

  it("conserva fechas vacías o desconocidas de forma legible", () => {
    expect(formatDate("")).toBe("Sin fecha");
    expect(formatDate("dato original")).toBe("dato original");
  });
});