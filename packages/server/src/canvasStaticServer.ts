import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import {
  mergeRuntimeCanvasStateFromClient,
  readRuntimeCanvasState,
  resetRuntimeCanvasState,
  upsertRuntimeTask,
  writeRuntimeGenerationResult,
  type RuntimeCanvasState,
  type RuntimeGenerationTask,
  type RuntimeResultInput
} from "./runtime/canvasRuntimeStore.js";
import { exportRuntimeImage } from "./runtime/exportRuntimeImage.js";
import { enrichRuntimeTaskRegionMasks } from "./runtime/regionMask.js";
import { resolveRuntimeAssetPath } from "./runtime/runtimeAssets.js";
import {
  isHandoffChannel,
  readRuntimeBridgeStatus,
  recordRuntimeBridgeTaskRequest
} from "./runtime/bridgeRuntimeStore.js";
import {
  cancelCodexExecTask,
  startCodexExecTaskInBackground
} from "./runtime/codexExecWorker.js";
import {
  createRuntimeProject,
  deleteRuntimeProject,
  openRuntimeProject,
  readRuntimeProjectLibrary,
  renameRuntimeProject,
  saveActiveRuntimeProject
} from "./runtime/projectLibraryStore.js";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

interface CanvasStaticServerOptions {
  distDir: string;
  host: string;
  port: number;
}

const resolveStaticPath = (distDir: string, rawUrl: string | undefined) => {
  const url = new URL(rawUrl ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const requestedPath = resolve(distDir, `.${sep}${relativePath}`);

  if (!requestedPath.startsWith(resolve(distDir))) {
    return join(distDir, "index.html");
  }

  return requestedPath;
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text.length ? (JSON.parse(text) as unknown) : {};
};

const sendJson = (response: ServerResponse, value: unknown, status = 200) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value, null, 2));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const handleApiRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  distDir: string
) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  try {
    if (request.method === "GET" && url.pathname === "/api/project") {
      readRuntimeProjectLibrary();
      sendJson(response, readRuntimeCanvasState());
      return true;
    }

    if (request.method === "PUT" && url.pathname === "/api/project") {
      const project = mergeRuntimeCanvasStateFromClient((await readJsonBody(request)) as RuntimeCanvasState);
      saveActiveRuntimeProject(project);
      sendJson(response, project);
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/reset") {
      const project = resetRuntimeCanvasState();
      saveActiveRuntimeProject(project);
      sendJson(response, project);
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/projects") {
      sendJson(response, readRuntimeProjectLibrary());
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/projects") {
      const body = await readJsonBody(request);
      sendJson(
        response,
        createRuntimeProject(
          isRecord(body) && typeof body.name === "string"
            ? body.name
            : "未命名项目"
        )
      );
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/projects/open") {
      const body = await readJsonBody(request);
      if (!isRecord(body) || typeof body.projectId !== "string") {
        throw new Error("/api/projects/open requires projectId.");
      }

      sendJson(response, openRuntimeProject(body.projectId));
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/projects/rename") {
      const body = await readJsonBody(request);
      if (
        !isRecord(body) ||
        typeof body.name !== "string"
      ) {
        throw new Error("/api/projects/rename requires name.");
      }

      sendJson(
        response,
        renameRuntimeProject(
          typeof body.projectId === "string" ? body.projectId : null,
          body.name
        )
      );
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/projects/delete") {
      const body = await readJsonBody(request);
      if (!isRecord(body) || typeof body.projectId !== "string") {
        throw new Error("/api/projects/delete requires projectId.");
      }

      sendJson(response, deleteRuntimeProject(body.projectId));
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/bridge/status") {
      sendJson(response, readRuntimeBridgeStatus());
      return true;
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/api/bridge/request" || url.pathname === "/api/bridge/wakeup")
    ) {
      const body = await readJsonBody(request);
      sendJson(
        response,
        recordRuntimeBridgeTaskRequest(
          isRecord(body) && typeof body.taskId === "string" ? body.taskId : null,
          isRecord(body) && isHandoffChannel(body.channel)
            ? body.channel
            : "manual_handoff"
        )
      );
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/tasks") {
      const body = await readJsonBody(request);
      if (!isRecord(body) || !isRecord(body.task)) {
        throw new Error("/api/tasks requires a task object.");
      }
      const task = enrichRuntimeTaskRegionMasks(
        readRuntimeCanvasState(),
        body.task as unknown as RuntimeGenerationTask,
        distDir
      );
      const project = upsertRuntimeTask(task);
      saveActiveRuntimeProject(project);
      sendJson(response, project);
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/codex-worker/start") {
      const body = await readJsonBody(request);
      if (!isRecord(body) || typeof body.taskId !== "string") {
        throw new Error("/api/codex-worker/start requires taskId.");
      }

      sendJson(response, startCodexExecTaskInBackground(body.taskId, { canvasDistDir: distDir }));
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/codex-worker/cancel") {
      const body = await readJsonBody(request);
      if (!isRecord(body) || typeof body.taskId !== "string") {
        throw new Error("/api/codex-worker/cancel requires taskId.");
      }

      sendJson(
        response,
        cancelCodexExecTask(
          body.taskId,
          typeof body.reason === "string" ? body.reason : undefined
        )
      );
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/results") {
      const body = await readJsonBody(request);
      const project = writeRuntimeGenerationResult(body as RuntimeResultInput);
      saveActiveRuntimeProject(project);
      sendJson(response, project);
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/export") {
      const body = await readJsonBody(request);
      if (
        !isRecord(body) ||
        typeof body.imageUrl !== "string" ||
        typeof body.filePath !== "string"
      ) {
        throw new Error("/api/export requires imageUrl and filePath.");
      }

      sendJson(
        response,
        await exportRuntimeImage({
          imageUrl: body.imageUrl,
          filePath: body.filePath,
          distDir
        })
      );
      return true;
    }
  } catch (error) {
    sendJson(
      response,
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      400
    );
    return true;
  }

  return false;
};

export const runCanvasStaticServer = ({
  distDir,
  host,
  port
}: CanvasStaticServerOptions) => {
  if (!existsSync(join(distDir, "index.html"))) {
    throw new Error(`Pedit canvas build is missing at ${distDir}. Run pnpm build first.`);
  }

  const server = createServer(async (request, response) => {
    if (await handleApiRequest(request, response, distDir)) {
      return;
    }

    let filePath = resolveStaticPath(distDir, request.url);
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const runtimeAssetPath = url.pathname.startsWith("/runtime-assets/")
      ? resolveRuntimeAssetPath(url.pathname)
      : null;

    if (runtimeAssetPath) {
      filePath = runtimeAssetPath;
    }

    try {
      const fileStat = await stat(filePath);

      if (fileStat.isDirectory() && !runtimeAssetPath) {
        filePath = join(filePath, "index.html");
      }
    } catch {
      if (runtimeAssetPath) {
        response.statusCode = 404;
        response.end("Runtime asset not found.");
        return;
      }
      filePath = join(distDir, "index.html");
    }

    response.setHeader(
      "Content-Type",
      contentTypes[extname(filePath)] ?? "application/octet-stream"
    );
    createReadStream(filePath).pipe(response);
  });

  server.listen(port, host, () => {
    process.stderr.write(`Pedit canvas listening on http://${host}:${port}\n`);
  });
};
