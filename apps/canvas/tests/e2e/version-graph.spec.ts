import { expect, test } from "@playwright/test";
import { setupBridgeApi, writeCodexResult } from "./bridge";

test("version graph exposes management and merge entries", async ({ page }) => {
  await setupBridgeApi(page);
  await page.goto("/");

  await page.getByRole("button", { name: "打开示例节点" }).click();
  await page.getByRole("button", { name: "图片管理", exact: true }).click();

  await expect(
    page.getByLabel("版本树画布")
  ).toBeVisible();

  const graph = page.locator(".react-flow");
  await graph.getByText("Root 图片组", { exact: true }).click();
  await expect(page.getByRole("button", { name: "查看大图" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "从此编辑" })
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "重命名" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "复制分支" })).toBeEnabled();

  await page.getByRole("button", { name: "级联删除" }).click();
  await expect(page.getByRole("dialog", { name: "删除该分支？" })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();

  await page.keyboard.down("Shift");
  await graph.getByText("人物抱猫方案", { exact: true }).click();
  await page.keyboard.up("Shift");

  await expect(page.getByLabel("合并选中版本")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始合并" })).toBeDisabled();
  await page
    .getByPlaceholder("描述这些图片应该如何组合生成，例如：让人物自然抱着小猫坐在客厅看电视")
    .fill("Place the cat into the portrait as a polished travel postcard");
  await expect(page.getByRole("button", { name: "开始合并" })).toBeEnabled();
});

test("creates a composite DAG node from the portrait edit and cat image", async ({
  page
}) => {
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
  await createLassoEdit(page, "Add a subtle foreground glow");
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

  await page.getByRole("button", { name: "图片管理", exact: true }).click();
  const graph = page.locator(".react-flow");
  await graph.getByText("Portrait edit 2", { exact: true }).click();
  await page.keyboard.down("Shift");
  await graph.getByText("封面构图", { exact: true }).click();
  await page.keyboard.up("Shift");

  await page
    .getByPlaceholder("描述这些图片应该如何组合生成，例如：让人物自然抱着小猫坐在客厅看电视")
    .fill("Composite the cat into the portrait with matching warm light");
  await page.getByRole("button", { name: "开始合并" }).click();
  await writeCodexResult(
    page,
    bridge.tasks.at(-1)?.id ?? "",
    "codex-composite-1",
    "Portrait + cat composite",
    "Composite cat into portrait"
  );

  await expect(
    page.getByLabel("图片预览").getByText("Portrait + cat composite")
  ).toBeVisible();

  const composite = bridge.nodes.find(
    (node) =>
      node.kind === "composite" &&
      node.parentIds.length === 2 &&
      node.imageUrl.startsWith("data:image/svg+xml")
  );

  expect(composite).toBeTruthy();
});

async function createLassoEdit(page: import("@playwright/test").Page, prompt: string) {
  await page.getByRole("button", { name: "编辑", exact: true }).click();

  const lasso = page.getByLabel("套索圈选画布");
  const box = await lasso.boundingBox();

  expect(box).not.toBeNull();

  if (!box) {
    return;
  }

  await page.mouse.move(box.x + 150, box.y + 170);
  await page.mouse.down();
  await page.mouse.move(box.x + 430, box.y + 190);
  await page.mouse.move(box.x + 360, box.y + 430);
  await page.mouse.move(box.x + 180, box.y + 390);
  await page.mouse.up();

  await page
    .getByPlaceholder("描述这个区域要如何修改")
    .fill(prompt);
  await page.getByRole("button", { name: "开始优化" }).click();
}
