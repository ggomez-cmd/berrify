import { describe, expect, it } from "vitest";
import { filterVisionBottleObjects, parseVisionAnnotateResponse } from "./empty-bottle-vision";

function bottle(name: string, score: number, x: number, w = 0.06, h = 0.4) {
  return {
    name,
    score,
    boundingPoly: {
      normalizedVertices: [
        { x, y: 0.3 },
        { x: x + w, y: 0.3 },
        { x: x + w, y: 0.3 + h },
        { x, y: 0.3 + h },
      ],
    },
  };
}

describe("Vision bottle boxes", () => {
  it("keeps bottle-like objects left to right and drops carton-sized noise", () => {
    const boxes = filterVisionBottleObjects([
      bottle("Carton", 0.99, 0.05, 0.5, 0.5),
      bottle("Bottle", 0.91, 0.7),
      bottle("Wine bottle", 0.88, 0.2),
      bottle("Beer bottle", 0.81, 0.45),
      bottle("Bottle", 0.2, 0.1),
      bottle("Wine bottle", 0.86, 0.2),
      {
        name: "Bottle",
        score: 0.95,
        boundingPoly: {
          normalizedVertices: [
            { x: 0.01, y: 0.01 },
            { x: 0.02, y: 0.01 },
            { x: 0.02, y: 0.02 },
            { x: 0.01, y: 0.02 },
          ],
        },
      },
    ]);
    expect(boxes.map((box) => box.name)).toEqual(["Wine bottle", "Beer bottle", "Bottle"]);
    expect(boxes[0]?.x).toBeLessThan(boxes[1]?.x ?? 1);
  });

  it("reads objects and OCR text from an annotate payload", () => {
    const parsed = parseVisionAnnotateResponse({
      responses: [
        {
          localizedObjectAnnotations: [bottle("Bottle", 0.9, 0.2)],
          fullTextAnnotation: { text: "Averna\nGrey Goose" },
        },
      ],
    });
    expect(parsed.ocrText).toContain("Averna");
    expect(filterVisionBottleObjects(parsed.objects)).toHaveLength(1);
  });
});
