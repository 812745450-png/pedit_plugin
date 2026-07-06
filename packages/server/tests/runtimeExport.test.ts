import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportRuntimeImage } from "../src/runtime/exportRuntimeImage.js";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("runtime image export", () => {
  it("writes data URL images to the requested local path", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "pedit-export-"));
    const filePath = join(tempRoot, "nested", "result.png");

    const result = await exportRuntimeImage({
      imageUrl: "data:image/png;base64,aW1hZ2U=",
      filePath,
      distDir: tempRoot
    });

    expect(result).toEqual({ ok: true, filePath });
    expect(await readFile(filePath, "utf8")).toBe("image");
  });
});
