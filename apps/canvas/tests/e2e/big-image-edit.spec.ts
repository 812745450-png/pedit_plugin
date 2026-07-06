import { expect, test } from "@playwright/test";
import { setupBridgeApi, writeCodexResult } from "./bridge";

test("big image edit lasso workflow", async ({ page }) => {
  await setupBridgeApi(page);
  await page.goto("/");

  await page.getByRole("button", { name: "打开示例节点" }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();

  const lasso = page.getByLabel("套索圈选画布");
  const box = await lasso.boundingBox();

  expect(box).not.toBeNull();

  if (!box) {
    return;
  }

  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 140);
  await page.mouse.move(box.x + 220, box.y + 300);
  await page.mouse.up();

  const instruction = page.getByPlaceholder(
    "描述这个区域要如何修改"
  );
  await expect(instruction).toBeVisible();

  const startEdit = page.getByRole("button", { name: "开始优化" });
  await expect(startEdit).toBeDisabled();

  await instruction.fill("Remove the background distraction");
  await expect(startEdit).toBeEnabled();

  await page.getByRole("button", { name: "删除区域" }).click();
  await expect(instruction).toHaveCount(0);
  await expect(startEdit).toBeDisabled();
});

test("creates two real edited image versions from the portrait", async ({ page }) => {
  const bridge = await setupBridgeApi(page);
  await page.goto("/");

  await page.getByRole("button", { name: "打开示例节点" }).click();
  await createLassoEdit(page, "Warm the portrait and recover soft highlights");
  await writeCodexResult(
    page,
    bridge.tasks.at(-1)?.id ?? "",
    "codex-edit-1",
    "Warm portrait edit",
    "Warm highlights"
  );

  await expect(
    page.getByLabel("图片预览").getByText("Warm portrait edit")
  ).toBeVisible();

  await createLassoEdit(page, "Add a gentle cinematic glow to the foreground");
  await writeCodexResult(
    page,
    bridge.tasks.at(-1)?.id ?? "",
    "codex-edit-2",
    "Portrait edit 2",
    "Foreground glow"
  );

  await expect(
    page.getByLabel("图片预览").getByText("Portrait edit 2")
  ).toBeVisible();

  const editNodes = bridge.nodes.filter(
    (node) =>
      node.kind === "edit" &&
      node.imageUrl.startsWith("data:image/svg+xml") &&
      node.parentIds.length === 1
  );

  expect(editNodes).toHaveLength(2);
});

async function createLassoEdit(page: import("@playwright/test").Page, prompt: string) {
  await page.getByRole("button", { name: "编辑", exact: true }).click();

  const lasso = page.getByLabel("套索圈选画布");
  const box = await lasso.boundingBox();

  expect(box).not.toBeNull();

  if (!box) {
    return;
  }

  await page.mouse.move(box.x + 140, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 180);
  await page.mouse.move(box.x + 360, box.y + 420);
  await page.mouse.move(box.x + 180, box.y + 380);
  await page.mouse.up();

  await page
    .getByPlaceholder("描述这个区域要如何修改")
    .fill(prompt);
  await page.getByRole("button", { name: "开始优化" }).click();
}
