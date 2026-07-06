// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompareSlider } from "../src/components/CompareSlider";
import { BigImageView } from "../src/modes/BigImageView";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("big image view comparison", () => {
  it("shows the fallback optimization summary when no summary is available", () => {
    render(
      <BigImageView
        currentNodeId="node-root"
        optimizationSummary=""
        onModeChange={() => undefined}
      />
    );

    expect(screen.getByText("暂无优化描述")).toBeTruthy();
  });

  it("defaults to the current image without a comparison slider", () => {
    render(<CompareSlider beforeLabel="Original" afterLabel="Optimized" />);

    expect(screen.getByLabelText("当前图片")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("switches from current image to slider and side-by-side comparison", async () => {
    render(
      <BigImageView
        currentNodeId="node-root"
        onModeChange={() => undefined}
      />
    );

    expect(screen.getByLabelText("当前图片")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "滑杆" }));

    expect(screen.getByLabelText("修改前后滑杆对比")).toBeTruthy();
    expect(
      screen.getByRole<HTMLInputElement>("slider", { name: "对比位置" }).value
    ).toBe("50");

    await userEvent.click(screen.getByRole("button", { name: "并排" }));

    expect(screen.getByLabelText("左右并排对比")).toBeTruthy();
    expect(screen.getByRole("button", { name: "并排" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
  });

  it("exports the current image without throwing", async () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(
      <BigImageView
        currentNodeId="node-root"
        afterImageUrl="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E"
        onModeChange={() => undefined}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: "导出当前图片" })
    );

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
