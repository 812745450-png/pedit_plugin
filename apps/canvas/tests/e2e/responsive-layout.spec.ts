import { expect, test } from "@playwright/test";
import { setupBridgeApi } from "./bridge";

test("small screens keep the canvas workspace layout", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await setupBridgeApi(page);
  await page.goto("/");
  await page.locator(".detail-layout").waitFor({ state: "visible" });

  const metrics = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>(".app");
    const topbar = document.querySelector<HTMLElement>(".topbar");
    const layout = document.querySelector<HTMLElement>(".detail-layout");
    const stage = document.querySelector<HTMLElement>(".stage[data-stage='detail']");
    const panel = document.querySelector<HTMLElement>(".panel");

    if (!app || !topbar || !layout || !stage || !panel) {
      throw new Error("Canvas workspace layout was not rendered.");
    }

    const appRect = app.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();

    return {
      appWidth: appRect.width,
      scrollWidth: document.documentElement.scrollWidth,
      topbarColumns: getComputedStyle(topbar).gridTemplateColumns,
      detailColumns: getComputedStyle(layout).gridTemplateColumns,
      panelLeft: panelRect.left,
      panelTop: panelRect.top,
      stageRight: stageRect.right,
      stageTop: stageRect.top
    };
  });

  expect(metrics.appWidth).toBeGreaterThanOrEqual(920);
  expect(metrics.scrollWidth).toBeGreaterThanOrEqual(920);
  expect(metrics.topbarColumns.split(" ")).toHaveLength(3);
  expect(metrics.detailColumns.split(" ")).toHaveLength(2);
  expect(metrics.panelLeft).toBeGreaterThanOrEqual(metrics.stageRight - 1);
  expect(Math.abs(metrics.panelTop - metrics.stageTop)).toBeLessThan(1);
});
