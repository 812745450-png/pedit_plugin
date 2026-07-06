import { describe, expect, it } from "vitest";
import { validateUniqueIds } from "../src/validation";

describe("validation helpers", () => {
  it("emits duplicate id issues from duplicate ids", () => {
    const issues = validateUniqueIds([{ id: "a" }, { id: "b" }, { id: "a" }]);

    expect(issues).toEqual([
      {
        code: "duplicate_id",
        id: "a",
        message: "Duplicate id a."
      }
    ]);
  });
});
