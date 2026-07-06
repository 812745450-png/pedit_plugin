const omittedDataUrl = (value: string) => {
  const mime = value.slice(5, value.indexOf(";") === -1 ? 32 : value.indexOf(";"));
  return `[omitted ${mime || "data"} data URL: ${value.length} chars]`;
};

export const compactToolOutput = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.startsWith("data:") ? omittedDataUrl(value) : value;
  }

  if (Array.isArray(value)) {
    return value.map(compactToolOutput);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (key === "codexPrompt" && typeof entry === "string") {
        return [
          key,
          `[omitted codexPrompt: ${entry.length} chars; use task.type, instruction, sourceNodeIds, regions, bounds, and maskPath fields instead]`
        ];
      }

      if (
        (key === "imageUrl" || key === "maskUrl") &&
        typeof entry === "string" &&
        entry.startsWith("data:")
      ) {
        return [key, omittedDataUrl(entry)];
      }

      if (key === "points" && Array.isArray(entry) && entry.length > 20) {
        return [
          key,
          {
            omitted: entry.length - 16,
            first: entry.slice(0, 8).map(compactToolOutput),
            last: entry.slice(-8).map(compactToolOutput)
          }
        ];
      }

      return [key, compactToolOutput(entry)];
    })
  );
};
