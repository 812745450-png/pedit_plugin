---
name: pedit
description: Use when the user invokes @Pedit/@pedit, asks to open or use the Pedit plugin, discusses the Pedit canvas, or works on the Pedit MCP/image-editing workflow.
---

# Pedit

Pedit is under development as a Codex plugin for visual editing workflows.

If the user invokes `@Pedit` / `@pedit`, says they want to use Pedit, or asks to open the plugin, immediately open the canvas in the Codex sidebar:

1. Call `pedit_open_canvas`.
2. Open the returned `canvasUrl` in the Codex sidebar in-app browser.
3. Tell the user the canvas is open and ready.

Do not merely describe the URL or ask the user to run a command unless the tool or Codex sidebar browser surface is unavailable.

The current plugin validates installation, manifest discovery, this usage skill, a local MCP bridge, and a browser canvas that hands image generation tasks to Codex.

When the user asks to open or operate the Pedit canvas, use the `pedit_open_canvas` MCP tool first. It starts the local canvas web app and returns the URL, normally `http://127.0.0.1:5173`. Then open that URL in the Codex sidebar in-app browser and operate the canvas there.

Available MCP tools include:

- `pedit_status`
- `pedit_open_canvas`
- `pedit_get_canvas_state`
- `pedit_create_pending_task`
- `pedit_claim_next_task`
- `pedit_run_local_fast_path`
- `pedit_write_generation_result`
- `pedit_export_current_image`

Canvas editing workflow:

1. Open the canvas with `pedit_open_canvas`.
2. Let the user create image tasks in the canvas. The canvas writes pending tasks to the shared runtime state.
3. Use `pedit_get_canvas_state` to read `pendingTasks`.
4. Call `pedit_claim_next_task` before invoking image generation. This marks the task `running` so the canvas truthfully tells the user Codex has claimed and is processing the task.
5. Choose the workflow from the task shape. If `regions` is empty or missing, this is a whole-image edit instruction: do not create a synthetic selection or hand-built local mask as the primary workflow. Claim the task, inspect the source image, and use image2 on the full source image while preserving identity, composition, dimensions, lighting, and unrelated details. If `regions` exists and `selectionSemantics` is `strict_local`, then call `pedit_run_local_fast_path` immediately after claiming. If it returns `ok=true`, the result has already been written back with original dimensions and no image2 call is needed. If it returns `unsupported`, continue with the normal image2 path.
6. For selected-region `region_edit` tasks that need image2, inspect the claimed task's `selectionSemantics` and region geometry before image generation. The canvas records lasso points as percentages of the full source image plus a `bounds` bbox, and the runtime server attempts to add a same-size RGBA PNG `maskPath` for each region. For `strict_local` edits, prefer `maskPath` as a hard precision mask: transparent pixels are the editable area and opaque pixels must be preserved. For `contextual_inpaint` edits such as object/clothing removal, treat the mask/polygon as the primary problem anchor, not a hard final boundary; use surrounding context and a narrow transition area when needed to keep lighting, shadows, texture direction, and physical structure coherent. Treat polygon/bbox as canonical selection data and audit fallback. The runtime may set `maskStatus` to `skipped_too_large` or `skipped_unsupported_source`; this is a graceful fallback, not a task failure. Do not infer the target object from vague text such as "this eye"; use the mask and geometry to identify the exact target.
7. If the claimed task includes `referenceImages`, read `task.referenceImages[].imageUrl` and use those files as reference inputs. Do not rely on reference image file names alone.
8. Use Codex image editing capability to create the result image for the claimed task when the local fast path is unsupported or insufficient. The prompt must respect the task semantics: strict-local color/detail tasks should preserve outside pixels as tightly as possible, while contextual inpaint/removal tasks must prioritize a coherent whole image over a visible mask edge.
9. Treat raw image2 output as an intermediate preview only. If you upscale, composite, crop, blend, post-process, or quality-repair the image, show or inspect the final candidate before writing it back. The exact image written to Pedit must be the same final image you present as the accepted result.
10. Before writing a generated result, compare it against the edit target. Do not write results that are blurrier, more painterly, lower fidelity, differently cropped, differently lit, or that changed unrelated regions. Regenerate or fail the task with a truthful error instead.
11. Write the result back with `pedit_write_generation_result`, including `taskId`, `imageUrl`, `name`, `summary`, and `edgeLabel`.
12. The canvas will poll the runtime state, show the result image, and connect it into the DAG.

Do not create recurring heartbeat/automation watchers for Pedit unless the user explicitly asks for continuous monitoring. The normal flow is user action in the canvas creates a pending task, then Codex claims and processes that task when the user asks Codex to continue or when a native plugin event bridge is available.

If a current Codex session has loaded the Pedit skill but not the native `pedit_*` MCP tools, use the Pedit server's stdio MCP/CLI path as a fallback for the current turn, and tell the user that a new Codex thread may be needed for native tool namespace exposure after plugin manifest changes.

Describe the remaining limitation accurately: the Codex plugin details page currently surfaces Pedit as an MCP server and skill. The visual canvas is launched through `pedit_open_canvas` and opened in the browser, not as a first-class embedded plugin app card.
