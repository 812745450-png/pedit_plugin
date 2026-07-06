import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { argv, stdin } from "node:process";
import { runCanvasStaticServer } from "./canvasStaticServer.js";
import { loadPeditServerConfig } from "./config.js";
import { runMcpServer } from "./mcpServer.js";
import { compactToolOutput } from "./tools/compactOutput.js";
import { invokePeditTool, type PeditToolName } from "./tools/registry.js";

export * from "./config.js";
export * from "./canvasStaticServer.js";
export * from "./storage/assetStore.js";
export * from "./storage/projectStore.js";
export * from "./mock/mockGenerator.js";
export * from "./mcpServer.js";
export * from "./tools/createPendingTask.js";
export * from "./tools/claimNextTask.js";
export * from "./tools/exportCurrentImage.js";
export * from "./tools/getCanvasState.js";
export * from "./tools/openCanvas.js";
export * from "./tools/registry.js";
export * from "./tools/runLocalFastPath.js";
export * from "./tools/status.js";
export * from "./tools/writeGenerationResult.js";

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8").trim();
};

const parseInput = async () => {
  const inputPathIndex = argv.indexOf("--input");

  if (inputPathIndex !== -1) {
    const inputPath = argv[inputPathIndex + 1];

    if (!inputPath) {
      throw new Error("--input requires a JSON file path.");
    }

    return JSON.parse(await readFile(resolve(inputPath), "utf8")) as unknown;
  }

  const stdinText = await readStdin();
  return stdinText.length > 0 ? (JSON.parse(stdinText) as unknown) : {};
};

const readOptionValue = (args: string[], optionName: string) => {
  const optionIndex = args.indexOf(optionName);

  if (optionIndex === -1) {
    return undefined;
  }

  const value = args[optionIndex + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
};

export const parseServeCanvasOptions = (args: string[] = [...argv]) => {
  const host = readOptionValue(args, "--host") ?? "127.0.0.1";
  const rawPort = readOptionValue(args, "--port") ?? "5173";
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("--port must be a positive integer.");
  }

  return { host, port };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const summarizeCliOutput = (output: unknown): unknown => {
  if (!isRecord(output)) {
    return output;
  }

  const project = isRecord(output.project) ? output.project : output;
  const nodes = Array.isArray(project.nodes) ? project.nodes : undefined;
  const tasks = Array.isArray(project.tasks) ? project.tasks : undefined;

  if (!nodes && !tasks) {
    return output;
  }

  const currentNode =
    nodes && typeof project.currentNodeId === "string"
      ? nodes.find(
          (node): node is Record<string, unknown> =>
            isRecord(node) && node.id === project.currentNodeId
        )
      : undefined;

  return {
    toolName: output.toolName,
    ok: output.ok,
    mode: project.mode,
    currentNodeId: project.currentNodeId,
    nodeCount: nodes?.length ?? 0,
    taskCount: tasks?.length ?? 0,
    claimedTask: isRecord(output.claimedTask)
      ? {
          id: output.claimedTask.id,
          status: output.claimedTask.status,
          type: output.claimedTask.type,
          instruction: output.claimedTask.instruction
        }
      : output.claimedTask,
    currentNode: currentNode
      ? {
          id: currentNode.id,
          name: currentNode.name,
          kind: currentNode.kind,
          parentIds: currentNode.parentIds,
          createdByTaskId: currentNode.createdByTaskId,
          hasImageUrl: typeof currentNode.imageUrl === "string",
          imageUrlChars:
            typeof currentNode.imageUrl === "string"
              ? currentNode.imageUrl.length
              : undefined
        }
      : null,
    tasks: tasks?.map((task) =>
      isRecord(task)
        ? {
            id: task.id,
            status: task.status,
            type: task.type,
            resultNodeId: task.resultNodeId,
            error: task.error,
            updatedAt: task.updatedAt
          }
        : task
    )
  };
};

const runCli = async () => {
  const rawToolName = argv[2];

  if (!rawToolName) {
    runMcpServer();
    return;
  }

  if (rawToolName === "--serve-canvas") {
    const { host, port } = parseServeCanvasOptions();

    runCanvasStaticServer({
      distDir: resolve("apps/canvas/dist"),
      host,
      port
    });
    return;
  }

  if (rawToolName === "--help") {
    const config = loadPeditServerConfig();
    console.log(
      JSON.stringify(
        {
          usage: "node dist/index.js <pedit_tool_name> [--input input.json]",
          canvasUrl: config.canvasUrl
        },
        null,
        2
      )
    );
    return;
  }

  const toolName = rawToolName as PeditToolName;
  const input = await parseInput();
  console.log(
    JSON.stringify(
      compactToolOutput(summarizeCliOutput(invokePeditTool(toolName, input))),
      null,
      2
    )
  );
};

if (argv[1] && fileURLToPath(import.meta.url) === resolve(argv[1])) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
