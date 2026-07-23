// ============================================================================
// FlowMind Web — Workflow State Store (Zustand)
// ============================================================================
import { create } from "zustand";
import type {
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  Connection,
} from "@xyflow/react";

// ---------------------------------------------------------------------------
// Undo stack type
// ---------------------------------------------------------------------------
interface UndoEntry {
  nodes: Node[];
  edges: Edge[];
}

// ---------------------------------------------------------------------------
// Store state
// ---------------------------------------------------------------------------
interface WorkflowState {
  // Core workflow data
  workflowId: string | null;
  workspaceId: string | null;
  workflowName: string;
  workflowStatus: string;
  isDirty: boolean;
  isSaving: boolean;

  // ReactFlow state
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;

  // Undo stack
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  maxUndo: number;

  // Dirty tracking for save
  lastSavedNodes: string;
  lastSavedEdges: string;

  // Actions
  setWorkflowId: (id: string) => void;
  setWorkspaceId: (id: string | null) => void;
  setWorkflowName: (name: string) => void;
  setWorkflowStatus: (status: string) => void;
  setIsSaving: (saving: boolean) => void;
  markSaved: () => void;

  // Node/Edge management
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: Node) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  removeNodes: (nodeIds: string[]) => void;
  removeEdges: (edgeIds: string[]) => void;
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;

  // Load from API
  loadWorkflow: (
    workflow: {
      id: string;
      workspaceId: string;
      name: string;
      status: string;
      nodes: Array<{
        id: string;
        workflowId: string;
        type: string;
        label: string;
        config: Record<string, unknown>;
        positionX: number;
        positionY: number;
      }>;
      edges: Array<{
        id: string;
        sourceNodeId: string;
        targetNodeId: string;
        condition: Record<string, unknown> | null;
      }>;
    },
  ) => void;

  // Undo/Redo
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;

  // Helpers
  getNodeVariables: (nodeId: string) => Array<{ name: string; label: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function serializeState(nodes: Node[], edges: Edge[]): string {
  return JSON.stringify({
    nodes: nodes.map((n) => ({ id: n.id, position: n.position, data: n.data })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    })),
  });
}

function toRFNode(
  node: {
    id: string;
    type: string;
    label: string;
    config: Record<string, unknown>;
    positionX: number;
    positionY: number;
  },
): Node {
  return {
    id: node.id,
    type: node.type,
    position: { x: node.positionX, y: node.positionY },
    data: { label: node.label, config: node.config, nodeType: node.type },
  };
}

function toRFEdge(
  edge: {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    condition: Record<string, unknown> | null;
  },
): Edge {
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: edge.condition
      ? (edge.condition as Record<string, string>).label ||
        JSON.stringify(edge.condition)
      : undefined,
    animated: true,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflowId: null,
  workspaceId: null,
  workflowName: "Untitled Workflow",
  workflowStatus: "draft",
  isDirty: false,
  isSaving: false,

  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,

  undoStack: [],
  redoStack: [],
  maxUndo: 50,

  lastSavedNodes: "",
  lastSavedEdges: "",

  // ---- Setters ----
  setWorkflowId: (id) => set({ workflowId: id }),
  setWorkspaceId: (id) => set({ workspaceId: id }),
  setWorkflowName: (name) =>
    set({ workflowName: name, isDirty: true }),
  setWorkflowStatus: (status) => set({ workflowStatus: status }),
  setIsSaving: (saving) => set({ isSaving: saving }),
  markSaved: () => {
    const { nodes, edges } = get();
    set({
      isDirty: false,
      lastSavedNodes: serializeState(nodes, edges),
      lastSavedEdges: serializeState(nodes, edges),
    });
  },

  // ---- Node/Edge management ----
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  onNodesChange: (changes) => {
    set((s) => {
      const nextNodes = applyNodeChanges(changes, s.nodes);
      return { nodes: nextNodes };
    });
    // Track drag-end for undo push
    const hasPositionChange = changes.some((c) => c.type === "position" && c.dragging === false);
    if (hasPositionChange) get().pushUndo();
  },

  onEdgesChange: (changes) => {
    set((s) => {
      const nextEdges = applyEdgeChanges(changes, s.edges);
      return { edges: nextEdges };
    });
  },

  onConnect: (connection) => {
    const { nodes } = get();
    const newEdge: Edge = {
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      animated: true,
      style: { stroke: "#6366f1", strokeWidth: 2 },
    };
    set((s) => ({
      edges: [...s.edges, newEdge],
      isDirty: true,
    }));
    get().pushUndo();
  },

  addNode: (node) => {
    set((s) => ({
      nodes: [...s.nodes, node],
      isDirty: true,
      selectedNodeId: node.id,
    }));
    get().pushUndo();
  },

  updateNodeData: (nodeId, data) => {
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, ...data } }
          : n,
      ),
      isDirty: true,
    }));
  },

  removeNodes: (nodeIds) => {
    set((s) => ({
      nodes: s.nodes.filter((n) => !nodeIds.includes(n.id)),
      edges: s.edges.filter(
        (e) => !nodeIds.includes(e.source) && !nodeIds.includes(e.target),
      ),
      selectedNodeId: nodeIds.includes(s.selectedNodeId ?? "")
        ? null
        : s.selectedNodeId,
      isDirty: true,
    }));
    get().pushUndo();
  },

  removeEdges: (edgeIds) => {
    set((s) => ({
      edges: s.edges.filter((e) => !edgeIds.includes(e.id)),
      isDirty: true,
    }));
    get().pushUndo();
  },

  selectNode: (nodeId) =>
    set({ selectedNodeId: nodeId, selectedEdgeId: null }),
  selectEdge: (edgeId) =>
    set({ selectedEdgeId: edgeId, selectedNodeId: null }),

  // ---- Load from API ----
  loadWorkflow: (workflow) => {
    const nodes = (workflow.nodes || []).map(toRFNode);
    const edges = (workflow.edges || []).map(toRFEdge);
    const saved = serializeState(nodes, edges);
    set({
      workflowId: workflow.id,
      workspaceId: workflow.workspaceId,
      workflowName: workflow.name,
      workflowStatus: workflow.status,
      nodes,
      edges,
      isDirty: false,
      selectedNodeId: null,
      lastSavedNodes: saved,
      lastSavedEdges: saved,
      undoStack: [],
      redoStack: [],
    });
  },

  // ---- Undo/Redo ----
  pushUndo: () => {
    const { nodes, edges, undoStack, maxUndo } = get();
    const snapshot: UndoEntry = {
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
    };
    const next = [...undoStack, snapshot];
    if (next.length > maxUndo) next.shift();
    set({ undoStack: next, redoStack: [], isDirty: true });
  },

  undo: () => {
    const { nodes, edges, undoStack, redoStack } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1]!;
    const current: UndoEntry = {
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
    };
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, current],
      isDirty: true,
    });
  },

  redo: () => {
    const { nodes, edges, undoStack, redoStack } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1]!;
    const current: UndoEntry = {
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
    };
    set({
      nodes: next.nodes,
      edges: next.edges,
      undoStack: [...undoStack, current],
      redoStack: redoStack.slice(0, -1),
      isDirty: true,
    });
  },

  // ---- Variables from upstream nodes ----
  getNodeVariables: (nodeId) => {
    const { nodes, edges } = get();
    const visited = new Set<string>();
    const result: Array<{ name: string; label: string }> = [];

    // Find all upstream nodes by walking edges backwards from nodeId
    function walkUpstream(currentId: string) {
      if (visited.has(currentId)) return;
      visited.add(currentId);
      for (const e of edges) {
        if (e.target === currentId) {
          const srcNode = nodes.find((n) => n.id === e.source);
          if (srcNode) {
            result.push({
              name: srcNode.id,
              label:
                (srcNode.data as Record<string, string>)?.label ||
                srcNode.id,
            });
            walkUpstream(srcNode.id);
          }
        }
      }
    }

    // Add the current node too
    const selfNode = nodes.find((n) => n.id === nodeId);
    if (selfNode) {
      for (const e of edges) {
        if (e.target === nodeId) {
          const srcNode = nodes.find((n) => n.id === e.source);
          if (srcNode) {
            walkUpstream(srcNode.id);
          }
        }
      }
    }

    // Also add trigger payload variables
    result.push({ name: "trigger.payload", label: "Trigger Payload" });
    result.push({ name: "trigger.input", label: "Trigger Input" });

    return result;
  },
}));

// ---------------------------------------------------------------------------
// Simple immutable node/edge change appliers (no immer dependency)
// ---------------------------------------------------------------------------
function applyNodeChanges(changes: NodeChange[], nodes: Node[]): Node[] {
  let next = [...nodes];
  for (const change of changes) {
    if (change.type === "remove") {
      next = next.filter((n) => n.id !== change.id);
    } else if (change.type === "position" && change.position) {
      next = next.map((n) =>
        n.id === change.id && change.position
          ? {
              ...n,
              position: {
                x: change.position.x ?? n.position.x,
                y: change.position.y ?? n.position.y,
              },
            }
          : n,
      );
    } else if (change.type === "dimensions" && change.dimensions) {
      next = next.map((n) =>
        n.id === change.id
          ? { ...n, ...(change.dimensions ? { width: change.dimensions.width, height: change.dimensions.height } : {}) }
          : n,
      );
    }
  }
  return next;
}

function applyEdgeChanges(changes: EdgeChange[], edges: Edge[]): Edge[] {
  let next = [...edges];
  for (const change of changes) {
    if (change.type === "remove") {
      next = next.filter((e) => e.id !== change.id);
    }
  }
  return next;
}
