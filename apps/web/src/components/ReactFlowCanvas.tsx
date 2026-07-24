// ============================================================================
// FlowMind Web — ReactFlow Canvas
// ============================================================================
import { useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type Node,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type ReactFlowInstance,
  SelectionMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useWorkflowStore } from "../stores/workflowStore";
import { useUIStore } from "../stores/uiStore";
import { nodeTypes } from "./CustomNodes";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ReactFlowCanvas() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const selectEdge = useWorkflowStore((s) => s.selectEdge);
  const addNode = useWorkflowStore((s) => s.addNode);
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);
  const openConfig = useUIStore((s) => s.openConfig);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);

  // ---- Drop handler: add node from palette ----
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/reactflow-node");
      if (!raw) return;

      const paletteItem = JSON.parse(raw) as {
        type: string;
        label: string;
        defaultConfig: Record<string, unknown>;
      };

      const position = rfInstanceRef.current!.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: paletteItem.type,
        position,
        data: {
          label: paletteItem.label,
          nodeType: paletteItem.type,
          config: structuredClone(paletteItem.defaultConfig),
        },
      };

      addNode(newNode);
    },
    [addNode],
  );

  // ---- Node click → select & open config ----
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectNode(node.id);
      openConfig();
    },
    [selectNode, openConfig],
  );

  // ---- Edge click → select ----
  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      selectEdge(edge.id);
    },
    [selectEdge],
  );

  // ---- Pane click → deselect ----
  const onPaneClick = useCallback(() => {
    selectNode(null);
    selectEdge(null);
  }, [selectNode, selectEdge]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Ctrl+S → save (handled by toolbar)
      if (isCtrlOrCmd && e.key === "s") {
        e.preventDefault();
        // Toolbar handles this via its own listener
        return;
      }

      // Ctrl+Z → undo
      if (isCtrlOrCmd && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl+Shift+Z or Ctrl+Y → redo
      if (
        (isCtrlOrCmd && e.shiftKey && e.key === "z") ||
        (isCtrlOrCmd && e.key === "y")
      ) {
        e.preventDefault();
        redo();
        return;
      }

      // Delete/Backspace → delete selected
      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't delete if user is in an input
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

        const selectedNodes = useWorkflowStore.getState().nodes.filter(
          (n) => n.selected,
        );
        const selectedEdges = useWorkflowStore.getState().edges.filter(
          (e) => e.selected,
        );

        if (selectedNodes.length > 0) {
          e.preventDefault();
          removeNodes(selectedNodes.map((n) => n.id));
        }
        if (selectedEdges.length > 0) {
          e.preventDefault();
          removeEdges(selectedEdges.map((e) => e.id));
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, removeNodes, removeEdges]);

  // ---- Ctrl+S listener on toolbar button ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        // Dispatch click on save button
        const saveBtn = document.querySelector(
          '[data-save-btn]',
        ) as HTMLButtonElement;
        saveBtn?.click();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex-1 relative" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        ref={rfInstanceRef as unknown as React.Ref<HTMLDivElement>}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        selectionMode={SelectionMode.Partial}
        deleteKeyCode={["Delete", "Backspace"]}
        multiSelectionKeyCode="Shift"
        attributionPosition="bottom-left"
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: "#6366f1", strokeWidth: 2 },
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="#334155"
        />
        <Controls className="!bg-surface-800 !border-surface-700 !rounded-lg !shadow-xl [&>button]:!bg-surface-800 [&>button]:!border-surface-700 [&>button]:!text-gray-400 [&>button:hover]:!bg-surface-700 [&>button:hover]:!text-white" />
        <MiniMap
          nodeColor={(node) => {
            const type = (node.data as Record<string, string>)?.nodeType;
            if (type === "trigger") return "#10b981";
            if (type === "action") return "#3b82f6";
            if (type === "condition") return "#f59e0b";
            if (type === "ai_agent") return "#8b5cf6";
            if (type === "approval") return "#f43f5e";
            return "#6366f1";
          }}
          maskColor="rgba(2, 6, 23, 0.8)"
          className="!bg-surface-800 !border-surface-700 !rounded-lg !shadow-xl"
          style={{ width: 160, height: 120 }}
        />
      </ReactFlow>

      {/* Undo/Redo toolbar at bottom-right of canvas */}
      <div className="absolute bottom-4 left-4 flex gap-1 z-10">
        <button
          onClick={undo}
          className="px-2.5 py-1.5 bg-surface-800 border border-surface-700 rounded-md text-xs text-gray-400 hover:text-white hover:bg-surface-700 transition-colors shadow-lg"
          title="Undo (Ctrl+Z)"
        >
          ↩
        </button>
        <button
          onClick={redo}
          className="px-2.5 py-1.5 bg-surface-800 border border-surface-700 rounded-md text-xs text-gray-400 hover:text-white hover:bg-surface-700 transition-colors shadow-lg"
          title="Redo (Ctrl+Shift+Z)"
        >
          ↪
        </button>
      </div>
    </div>
  );
}
