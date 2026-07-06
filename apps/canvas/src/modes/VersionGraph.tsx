import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MergePanel } from "../components/MergePanel";
import { NodeActionsPanel } from "../components/NodeActionsPanel";
import { CanvasUiState } from "../state/canvasStore";
import type { ImageProjectNode } from "../state/imageProject";

interface VersionGraphProps {
  uiState: CanvasUiState;
  nodes: ImageProjectNode[];
  onViewNode: (nodeId: string) => void;
  onEditNode: (nodeId: string) => void;
  onRenameNode: (nodeId: string, name: string) => void;
  onHideBranch: (nodeId: string) => void;
  onRestoreBranch: (nodeId: string) => void;
  onCopyBranch: (nodeId: string) => void;
  onDeleteBranch: (nodeId: string) => void;
  onMergeVersions: (nodeIds: string[], prompt: string) => Promise<string>;
}

const graphNodeWidth = 196;
const graphNodeHeight = 166;
const graphPadding = 80;
const graphLevelGap = 150;
const graphLaneGap = 260;

export function VersionGraph({
  uiState,
  nodes,
  onViewNode,
  onEditNode,
  onRenameNode,
  onHideBranch,
  onRestoreBranch,
  onCopyBranch,
  onDeleteBranch,
  onMergeVersions
}: VersionGraphProps) {
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(
    uiState.selectedNodeIds
  );
  const [draftName, setDraftName] = useState("");
  const [mergePrompt, setMergePrompt] = useState("");
  const [mergeStatus, setMergeStatus] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const nextIds = uiState.selectedNodeIds.filter((nodeId) =>
      nodes.some((node) => node.id === nodeId && !node.deleted)
    );
    const nextNode =
      nextIds.length === 1
        ? nodes.find((node) => node.id === nextIds[0])
        : null;

    setSelectedNodeIds(nextIds);
    setDraftName(nextNode?.name ?? "");
  }, [nodes, uiState.selectedNodeIds]);

  const visibleRecords = useMemo(
    () => nodes.filter((node) => !node.deleted),
    [nodes]
  );
  const graphRecords = useMemo(
    () => layoutGraphNodes(visibleRecords),
    [visibleRecords]
  );
  const visibleIds = useMemo(
    () => new Set(visibleRecords.map((node) => node.id)),
    [visibleRecords]
  );
  const selectedRecords = selectedNodeIds
    .map((nodeId) => nodes.find((node) => node.id === nodeId && !node.deleted))
    .filter((node): node is ImageProjectNode => Boolean(node));
  const selectedNode = selectedRecords.length === 1 ? selectedRecords[0] : null;
  const graphSize = useMemo(
    () => ({
      width:
        Math.max(...graphRecords.map((node) => node.position.x), 640) +
        graphNodeWidth +
        graphPadding,
      height:
        Math.max(...graphRecords.map((node) => node.position.y), 560) +
        graphNodeHeight +
        graphPadding
    }),
    [graphRecords]
  );
  const graphEdges = graphRecords.flatMap((node) =>
    node.parentIds.flatMap((parentId) => {
      const parent = graphRecords.find((record) => record.id === parentId);

      if (!parent || !visibleIds.has(parentId)) {
        return [];
      }

      const isMerge = node.parentIds.length > 1;

      return [
        {
          id: `${parentId}-${node.id}`,
          source: parent,
          target: node,
          label: node.edgeLabel,
          isMerge
        }
      ];
    })
  );

  const selectSingleNode = (nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    setSelectedNodeIds([nodeId]);
    setDraftName(node?.name ?? "");
    setMergeStatus(null);
  };

  const toggleNodeSelection = (nodeId: string) => {
    setSelectedNodeIds((ids) => {
      const nextIds = ids.includes(nodeId)
        ? ids.filter((id) => id !== nodeId)
        : [...ids, nodeId];
      const nextNode =
        nextIds.length === 1
          ? nodes.find((item) => item.id === nextIds[0])
          : null;
      setDraftName(nextNode?.name ?? "");
      setMergeStatus(null);
      return nextIds;
    });
  };

  const renameSelectedNode = () => {
    if (!selectedNode || draftName.trim().length === 0) {
      return;
    }

    onRenameNode(selectedNode.id, draftName.trim());
  };

  const confirmDeleteBranch = () => {
    if (!pendingDeleteId) {
      return;
    }

    onDeleteBranch(pendingDeleteId);
    setSelectedNodeIds([]);
    setDraftName("");
    setPendingDeleteId(null);
  };

  const startMerge = async () => {
    if (selectedRecords.length < 2 || mergePrompt.trim().length === 0) {
      return;
    }

    setMergeStatus("已创建生成任务，等待 Codex 接手。");
    const nextNodeId = await onMergeVersions(selectedNodeIds, mergePrompt.trim());
    setSelectedNodeIds([nextNodeId]);
    setDraftName(nodes.find((node) => node.id === nextNodeId)?.name ?? "");
    setMergePrompt("");
    setMergeStatus(`已基于 ${selectedRecords.length} 张图片创建生成任务。`);
  };

  return (
    <div className="version-layout">
      <section className="dag-workspace" aria-label="版本树画布">
        <div
          className="static-dag react-flow"
          style={{ width: graphSize.width, height: graphSize.height }}
        >
          <svg
            className="dag-edge-overlay react-flow__edges"
            width={graphSize.width}
            height={graphSize.height}
            viewBox={`0 0 ${graphSize.width} ${graphSize.height}`}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="dag-arrow"
                markerHeight="8"
                markerWidth="8"
                orient="auto"
                refX="7"
                refY="4"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="#2f6b5e" />
              </marker>
            </defs>
            {graphEdges.map((edge) => {
              const startX = edge.source.position.x + graphNodeWidth / 2;
              const startY = edge.source.position.y + graphNodeHeight;
              const endX = edge.target.position.x + graphNodeWidth / 2;
              const endY = edge.target.position.y;
              const midY = startY + Math.max(48, (endY - startY) / 2);
              const labelX = (startX + endX) / 2;
              const labelY = midY - 8;
              const path = `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`;

              return (
                <g
                  className="react-flow__edge"
                  data-merge={edge.isMerge}
                  key={edge.id}
                >
                  <path
                    className="react-flow__edge-path"
                    d={path}
                    fill="none"
                    markerEnd="url(#dag-arrow)"
                  />
                  <circle
                    className="dag-edge-dot dag-edge-dot-start"
                    cx={startX}
                    cy={startY}
                    r="4"
                  />
                  <circle
                    className="dag-edge-dot dag-edge-dot-end"
                    cx={endX}
                    cy={endY}
                    r="4"
                  />
                  {edge.label ? (
                    <text className="react-flow__edge-text" x={labelX} y={labelY}>
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>

          {graphRecords.map((node) => (
            <button
              key={node.id}
              className="graph-node graph-node-button react-flow__node"
              data-selected={selectedNodeIds.includes(node.id)}
              data-hidden={node.hidden}
              data-kind={node.kind}
              data-group={Boolean(node.referenceImageUrls?.length)}
              style={{ left: node.position.x, top: node.position.y }}
              type="button"
              onClick={(event) => {
                if (event.shiftKey || event.metaKey) {
                  toggleNodeSelection(node.id);
                  return;
                }

                selectSingleNode(node.id);
              }}
            >
              <div className="node-thumb" aria-hidden="true">
                {node.referenceImageUrls?.length ? (
                  <div className="node-thumb-group">
                    {node.referenceImageUrls.slice(0, 4).map((imageUrl) => (
                      <img key={imageUrl} src={imageUrl} alt="" />
                    ))}
                  </div>
                ) : (
                  <img src={node.imageUrl} alt="" />
                )}
              </div>
              <span>{node.name}</span>
            </button>
          ))}
        </div>
      </section>

      <aside className="right-panel version-panel" aria-label="选中节点">
        <NodeActionsPanel
          nodeName={selectedNode?.name ?? null}
          summary={selectedNode?.summary ?? null}
          edgeLabel={selectedNode?.edgeLabel ?? null}
          selectedCount={selectedNodeIds.length}
          draftName={draftName}
          onDraftNameChange={setDraftName}
          onRename={renameSelectedNode}
          onViewVersion={() => selectedNode && onViewNode(selectedNode.id)}
          onEditFromVersion={() => selectedNode && onEditNode(selectedNode.id)}
          onCopyBranch={() => selectedNode && onCopyBranch(selectedNode.id)}
          onRequestDelete={() => selectedNode && setPendingDeleteId(selectedNode.id)}
        />

        {selectedRecords.length > 1 ? (
          <MergePanel
            selectedNodeNames={selectedRecords.map((node) => node.name)}
            mergePrompt={mergePrompt}
            onMergePromptChange={setMergePrompt}
            onStartMerge={startMerge}
          />
        ) : null}

        {mergeStatus ? (
          <div className="submit-status" role="status" aria-live="polite">
            <strong>{mergeStatus}</strong>
            <span>DAG 会记录本次合并使用的全部父节点。</span>
          </div>
        ) : null}
      </aside>

      {pendingDeleteId ? (
        <ConfirmDialog
          title="删除该分支？"
          cancelLabel="取消"
          confirmLabel="级联删除"
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={confirmDeleteBranch}
        >
          该操作会删除当前节点及其所有后续子孙节点。
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function layoutGraphNodes(nodes: ImageProjectNode[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const levelById = new Map<string, number>();

  const getLevel = (node: ImageProjectNode): number => {
    const cached = levelById.get(node.id);

    if (cached !== undefined) {
      return cached;
    }

    const parents = node.parentIds
      .map((parentId) => nodes.find((record) => record.id === parentId))
      .filter((parent): parent is ImageProjectNode => Boolean(parent));
    const level =
      parents.length === 0 ? 0 : Math.max(...parents.map((parent) => getLevel(parent))) + 1;
    levelById.set(node.id, level);
    return level;
  };

  nodes.forEach(getLevel);

  const levels = new Map<number, ImageProjectNode[]>();
  nodes.forEach((node) => {
    const level = levelById.get(node.id) ?? 0;
    const items = levels.get(level) ?? [];
    items.push(node);
    levels.set(level, items);
  });

  return [...levels.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([level, items]) => {
      const sortedItems = [...items].sort((left, right) => {
        const leftParentX = averageParentX(left, nodes, ids);
        const rightParentX = averageParentX(right, nodes, ids);

        if (leftParentX !== rightParentX) {
          return leftParentX - rightParentX;
        }

        return left.name.localeCompare(right.name);
      });
      const totalWidth =
        sortedItems.length * graphNodeWidth +
        Math.max(0, sortedItems.length - 1) * (graphLaneGap - graphNodeWidth);
      const startX = Math.max(graphPadding, 480 - totalWidth / 2);

      return sortedItems.map((node, index) => ({
        ...node,
        position: {
          x: startX + index * graphLaneGap,
          y: graphPadding + level * (graphNodeHeight + graphLevelGap)
        }
      }));
    });
}

function averageParentX(
  node: ImageProjectNode,
  nodes: ImageProjectNode[],
  visibleIds: Set<string>
) {
  const parents = node.parentIds
    .map((parentId) => nodes.find((record) => record.id === parentId))
    .filter(
      (parent): parent is ImageProjectNode =>
        parent !== undefined && visibleIds.has(parent.id)
    );

  if (parents.length === 0) {
    return node.position.x;
  }

  return parents.reduce((sum, parent) => sum + parent.position.x, 0) / parents.length;
}
