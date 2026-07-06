import type { PeditId } from "./ids.js";
import type { PeditNode } from "./graph.js";
import type { PeditTask } from "./tasks.js";

export interface PeditProject {
  id: PeditId;
  name: string;
  nodes: PeditNode[];
  tasks: PeditTask[];
  createdAt: string;
  updatedAt: string;
}

export const createEmptyProject = (id: PeditId, name: string, now: string): PeditProject => ({
  id,
  name,
  nodes: [],
  tasks: [],
  createdAt: now,
  updatedAt: now
});
