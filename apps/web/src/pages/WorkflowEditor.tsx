import { useCallback, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const initialNodes: Node[] = [
  {
    id: "trigger-1",
    type: "default",
    position: { x: 300, y: 100 },
    data: { label: "🔔 Webhook Trigger" },
    style: {
      background: "#1e293b",
      color: "#e2e8f0",
      border: "1px solid #6366f1",
      borderRadius: "8px",
      padding: "12px 20px",
      fontSize: "14px",
      fontWeight: 500,
    },
  },
  {
    id: "ai-1",
    type: "default",
    position: { x: 300, y: 250 },
    data: { label: "🤖 AI: Analyze Input" },
    style: {
      background: "#1e293b",
      color: "#e2e8f0",
      border: "1px solid #818cf8",
      borderRadius: "8px",
      padding: "12px 20px",
      fontSize: "14px",
      fontWeight: 500,
    },
  },
  {
    id: "action-1",
    type: "default",
    position: { x: 300, y: 400 },
    data: { label: "✉️ Send Email" },
    style: {
      background: "#1e293b",
      color: "#e2e8f0",
      border: "1px solid #334155",
      borderRadius: "8px",
      padding: "12px 20px",
      fontSize: "14px",
      fontWeight: 500,
    },
  },
];

const initialEdges: Edge[] = [
  { id: "e-trigger-ai", source: "trigger-1", target: "ai-1", animated: true, style: { stroke: "#6366f1" } },
  { id: "e-ai-action", source: "ai-1", target: "action-1", animated: true, style: { stroke: "#818cf8" } },
];

export default function WorkflowEditor() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  return (
    <div className="h-[calc(100vh-56px)] flex">
      {/* Node Palette */}
      <aside className="w-56 bg-surface-900 border-r border-surface-700 p-4 flex-shrink-0">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Triggers</h2>
        <div className="space-y-1 mb-6">
          {["Webhook", "Schedule", "Manual"].map((t) => (
            <div
              key={t}
              draggable
              className="px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-300 cursor-grab hover:border-flowmind-500 hover:text-white transition-colors"
            >
              {t}
            </div>
          ))}
        </div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">AI Nodes</h2>
        <div className="space-y-1 mb-6">
          {["LLM Call", "AI Router", "AI Extract", "AI Agent"].map((t) => (
            <div
              key={t}
              draggable
              className="px-3 py-2 bg-surface-800 border border-flowmind-800 rounded-md text-sm text-gray-300 cursor-grab hover:border-flowmind-500 hover:text-white transition-colors"
            >
              {t}
            </div>
          ))}
        </div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Actions</h2>
        <div className="space-y-1">
          {["HTTP Request", "Send Email", "Slack Message", "Delay", "Code"].map((t) => (
            <div
              key={t}
              draggable
              className="px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-300 cursor-grab hover:border-flowmind-500 hover:text-white transition-colors"
            >
              {t}
            </div>
          ))}
        </div>
      </aside>

      {/* Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          fitView
          attributionPosition="bottom-left"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#334155" />
          <Controls className="!bg-surface-800 !border-surface-700 !rounded-lg" />
          <MiniMap
            nodeColor="#6366f1"
            maskColor="rgba(2, 6, 23, 0.7)"
            className="!bg-surface-800 !border-surface-700"
          />
        </ReactFlow>
      </div>

      {/* Config Panel */}
      {selectedNode && (
        <aside className="w-72 bg-surface-900 border-l border-surface-700 p-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Node Config</h3>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-gray-400 hover:text-white text-lg leading-none"
            >
              ×
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-2">ID</p>
          <p className="text-sm text-gray-300 font-mono mb-4">{selectedNode.id}</p>
          <p className="text-xs text-gray-500 mb-2">Label</p>
          <p className="text-sm text-gray-300">{selectedNode.data.label}</p>
          <div className="mt-6 p-3 bg-surface-800 border border-surface-700 rounded-lg">
            <p className="text-xs text-gray-400">Configuration options will appear here based on node type.</p>
          </div>
        </aside>
      )}
    </div>
  );
}
