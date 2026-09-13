import { describe, expect, it, vi } from "vitest";
import { getOcrEngine, ocrEngineNote, ocrImage, setOcrEngine, type OcrResult } from "./ocr";

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "user-token" } } }),
    },
  },
}));

const tesseract: OcrResult = {
  text: "TESSA FACTURA 1.00",
  confidence: 70,
  rotation: 90,
  engine: "tesseract",
};

describe("ocrImage", () => {
  it("returns Vision text when /api/ocr succeeds", async () => {
    const fallback = vi.fn(async () => tesseract);
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("/api/ocr");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer user-token");
      return Response.json({ text: "VISION FACTURA", confidence: 88 });
    };
    const result = await ocrImage("data:image/jpeg;base64,abc", { fetchImpl, fallback });
    expect(result).toEqual({
      text: "VISION FACTURA",
      confidence: 88,
      rotation: 0,
      engine: "vision",
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back to Tesseract when Vision returns 503", async () => {
    const fallback = vi.fn(async () => tesseract);
    const fetchImpl: typeof fetch = async () =>
      Response.json({ error: "Vision OCR is not configured" }, { status: 503 });
    const result = await ocrImage("data:image/jpeg;base64,abc", { fetchImpl, fallback });
    expect(result).toEqual(tesseract);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("falls back to Tesseract when Vision fetch throws", async () => {
    const fallback = vi.fn(async () => tesseract);
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    const result = await ocrImage("data:image/jpeg;base64,abc", { fetchImpl, fallback });
    expect(result.engine).toBe("tesseract");
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("Vision-only does not call Tesseract when /api/ocr succeeds", async () => {
    const fallback = vi.fn(async () => tesseract);
    const fetchImpl: typeof fetch = async () => Response.json({ text: "VISION ONLY", confidence: 91 });
    const result = await ocrImage("data:image/jpeg;base64,abc", {
      engine: "vision",
      fetchImpl,
      fallback,
    });
    expect(result.engine).toBe("vision");
    expect(result.text).toBe("VISION ONLY");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("Vision-only throws and does not call Tesseract when /api/ocr fails", async () => {
    const fallback = vi.fn(async () => tesseract);
    const fetchImpl: typeof fetch = async () =>
      Response.json({ error: "Vision OCR is not configured" }, { status: 503 });
    await expect(
      ocrImage("data:image/jpeg;base64,abc", { engine: "vision", fetchImpl, fallback }),
    ).rejects.toThrow("Vision OCR is not configured");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("Tesseract-only does not call /api/ocr", async () => {
    const fallback = vi.fn(async () => tesseract);
    const fetchImpl = vi.fn(async () => Response.json({ text: "VISION", confidence: 99 }));
    const result = await ocrImage("data:image/jpeg;base64,abc", {
      engine: "tesseract",
      fetchImpl,
      fallback,
    });
    expect(result).toEqual(tesseract);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
  });
});

describe("getOcrEngine / setOcrEngine", () => {
  it("defaults to vision and persists the selected engine", () => {
    localStorage.removeItem("berrify.ocrEngine");
    expect(getOcrEngine()).toBe("vision");
    setOcrEngine("tesseract");
    expect(localStorage.getItem("berrify.ocrEngine")).toBe("tesseract");
    expect(getOcrEngine()).toBe("tesseract");
    setOcrEngine("vision");
    expect(getOcrEngine()).toBe("vision");
  });
});

describe("ocrEngineNote", () => {
  it("names Vision vs Tesseract rotation", () => {
    expect(
      ocrEngineNote({ text: "a", confidence: 1, rotation: 0, engine: "vision" }),
    ).toBe("Vision OCR");
    expect(
      ocrEngineNote({ text: "a", confidence: 1, rotation: 90, engine: "tesseract" }),
    ).toBe("Tesseract OCR rotation 90°");
  });
});

