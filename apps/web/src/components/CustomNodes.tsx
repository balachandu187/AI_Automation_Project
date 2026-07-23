// ============================================================================
// FlowMind Web — Custom ReactFlow Node Types
// ============================================================================
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

// ---------------------------------------------------------------------------
// Shared base style
// ---------------------------------------------------------------------------
const baseNode =
  "px-4 py-3 rounded-lg border text-sm font-medium min-w-[160px] shadow-lg backdrop-blur-sm";
const handleStyle =
  "!w-3 !h-3 !border-2 !border-surface-700 !bg-flowmind-400";

// ---------------------------------------------------------------------------
// Trigger Node — Webhook, Schedule, Manual triggers
// ---------------------------------------------------------------------------
function TriggerNodeComponent({ data, selected }: NodeProps) {
  return (
    <div
      className={`${baseNode} bg-emerald-950/80 border-emerald-600 text-emerald-100 ${
        selected ? "ring-2 ring-emerald-400" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">⚡</span>
        <span>{data.label as string}</span>
      </div>
      <div className="text-xs text-emerald-400/70 mt-1 font-mono">
        {(data.config as Record<string, string>)?.triggerType || "trigger"}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className={`${handleStyle} !bg-emerald-500`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action Node — HTTP requests, emails, Slack, etc.
// ---------------------------------------------------------------------------
function ActionNodeComponent({ data, selected }: NodeProps) {
  return (
    <div
      className={`${baseNode} bg-blue-950/80 border-blue-600 text-blue-100 ${
        selected ? "ring-2 ring-blue-400" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">⚙️</span>
        <span>{data.label as string}</span>
      </div>
      <div className="text-xs text-blue-400/70 mt-1 font-mono">
        {(data.config as Record<string, string>)?.method || "action"}
      </div>
      <Handle
        type="target"
        position={Position.Top}
        className={`${handleStyle} !bg-blue-500`}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className={`${handleStyle} !bg-blue-500`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Condition Node — if/else branching
// ---------------------------------------------------------------------------
function ConditionNodeComponent({ data, selected }: NodeProps) {
  return (
    <div
      className={`${baseNode} bg-amber-950/80 border-amber-600 text-amber-100 ${
        selected ? "ring-2 ring-amber-400" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">🔀</span>
        <span>{data.label as string}</span>
      </div>
      <div className="text-xs text-amber-400/70 mt-1 font-mono">
        {(data.config as Record<string, string>)?.operator || "if"}
      </div>
      <Handle
        type="target"
        position={Position.Top}
        className={`${handleStyle} !bg-amber-500`}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        className={`${handleStyle} !bg-green-500`}
        style={{ left: "30%" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        className={`${handleStyle} !bg-red-500`}
        style={{ left: "70%" }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Agent Node — LLM calls, AI extraction, routing
// ---------------------------------------------------------------------------
function AIAgentNodeComponent({ data, selected }: NodeProps) {
  return (
    <div
      className={`${baseNode} bg-purple-950/80 border-purple-500 text-purple-100 ${
        selected ? "ring-2 ring-purple-400" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">🤖</span>
        <span>{data.label as string}</span>
      </div>
      <div className="text-xs text-purple-400/70 mt-1 font-mono">
        {(data.config as Record<string, string>)?.model || "AI"}
      </div>
      <Handle
        type="target"
        position={Position.Top}
        className={`${handleStyle} !bg-purple-500`}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className={`${handleStyle} !bg-purple-500`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approval Node — Human-in-the-loop
// ---------------------------------------------------------------------------
function ApprovalNodeComponent({ data, selected }: NodeProps) {
  return (
    <div
      className={`${baseNode} bg-rose-950/80 border-rose-600 text-rose-100 ${
        selected ? "ring-2 ring-rose-400" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">👤</span>
        <span>{data.label as string}</span>
      </div>
      <div className="text-xs text-rose-400/70 mt-1 font-mono">
        approval
      </div>
      <Handle
        type="target"
        position={Position.Top}
        className={`${handleStyle} !bg-rose-500`}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="approved"
        className={`${handleStyle} !bg-green-500`}
        style={{ left: "30%" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="rejected"
        className={`${handleStyle} !bg-red-500`}
        style={{ left: "70%" }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export const nodeTypes = {
  trigger: memo(TriggerNodeComponent),
  action: memo(ActionNodeComponent),
  condition: memo(ConditionNodeComponent),
  ai_agent: memo(AIAgentNodeComponent),
  approval: memo(ApprovalNodeComponent),
};
