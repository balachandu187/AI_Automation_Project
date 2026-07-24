// ============================================================================
// FlowMind Web — Execution Panel
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { useUIStore } from "../stores/uiStore";
import { useWorkflowStore } from "../stores/workflowStore";
import { executions } from "../api/client";
import type { Execution, ExecutionStep } from "../types/api";

// ---------------------------------------------------------------------------
// Status colors
// ---------------------------------------------------------------------------
const STATUS_COLORS: Record<string, string> = {
  pending: "text-gray-400",
  running: "text-blue-400",
  completed: "text-green-400",
  failed: "text-red-400",
  cancelled: "text-amber-400",
  skipped: "text-gray-500",
};

const STATUS_ICONS: Record<string, string> = {
  pending: "○",
  running: "◌",
  completed: "✓",
  failed: "✕",
  cancelled: "⊘",
  skipped: "→",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ExecutionPanel() {
  const executionId = useUIStore((s) => s.executionId);
  const executionStatus = useUIStore((s) => s.executionStatus);
  const setExecutionStatus = useUIStore((s) => s.setExecutionStatus);
  const closePanel = useUIStore((s) => s.closePanel);
  const nodes = useWorkflowStore((s) => s.nodes);

  const [execution, setExecution] = useState<Execution | null>(null);
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Poll execution status ----
  useEffect(() => {
    if (!executionId) return;

    const poll = async () => {
      try {
        const res = await executions.get(executionId);
        const exec = res.data;
        setExecution(exec);
        setSteps(exec.steps || []);

        if (
          exec.status === "completed" ||
          exec.status === "failed" ||
          exec.status === "cancelled"
        ) {
          setExecutionStatus(
            exec.status === "completed"
              ? "completed"
              : exec.status === "cancelled"
                ? "idle"
                : "failed",
          );
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } else {
          setExecutionStatus("running");
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch execution",
        );
      }
    };

    poll(); // immediate first poll
    pollRef.current = setInterval(poll, 2000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [executionId, setExecutionStatus]);

  // ---- Find node label ----
  const getNodeLabel = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      return node
        ? ((node.data as Record<string, string>).label || nodeId)
        : nodeId;
    },
    [nodes],
  );

  // ---- Format timestamp ----
  const formatTime = useCallback((ts: string | null) => {
    if (!ts) return "--";
    return new Date(ts).toLocaleTimeString();
  }, []);

  const isRunning =
    executionStatus === "running" ||
    execution?.status === "pending" ||
    execution?.status === "running";

  return (
    <aside className="w-80 bg-surface-900 border-l border-surface-700 flex-shrink-0 h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-surface-700 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Execution</h3>
          <p className="text-[11px] text-gray-500 font-mono mt-0.5">
            {executionId ? executionId.slice(0, 8) : "..."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Status indicator */}
          <span
            className={`flex items-center gap-1 text-xs ${
              STATUS_COLORS[execution?.status || "pending"]
            }`}
          >
            {isRunning && (
              <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" />
            )}
            {execution?.status || "pending"}
          </span>
          <button
            onClick={closePanel}
            className="text-gray-400 hover:text-white text-xl leading-none transition-colors"
          >
            ×
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="p-3 bg-red-950/50 border border-red-800 rounded-lg text-sm text-red-300 mb-4">
            {error}
          </div>
        )}

        {!execution && !error && (
          <div className="text-center py-12">
            <div className="text-3xl mb-2 opacity-30">
              {isRunning ? "⏳" : "📊"}
            </div>
            <p className="text-sm text-gray-500">
              {isRunning
                ? "Waiting for execution data..."
                : "No execution data yet"}
            </p>
          </div>
        )}

        {steps.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Steps ({steps.length})
            </h4>
            {steps.map((step, idx) => (
              <div
                key={step.id}
                className="border border-surface-700 rounded-lg overflow-hidden"
              >
                {/* Step header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-surface-800">
                  <span
                    className={`text-sm ${
                      STATUS_COLORS[step.status] || "text-gray-400"
                    }`}
                  >
                    {STATUS_ICONS[step.status] || "?"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-200 truncate">
                      {step.nodeLabel || getNodeLabel(step.nodeId)}
                    </p>
                    <p className="text-[10px] text-gray-500">
                      {formatTime(step.startedAt)} — {formatTime(step.completedAt)}
                    </p>
                  </div>
                  <span className="text-[10px] text-gray-500">
                    #{idx + 1}
                  </span>
                </div>

                {/* Step output preview */}
                {(step.output || step.error) && (
                  <div className="px-3 py-2 border-t border-surface-700 bg-surface-900/50">
                    {step.output && (
                      <div>
                        <p className="text-[10px] text-gray-500 mb-1">Output:</p>
                        <pre className="text-[11px] text-gray-300 font-mono whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                          {typeof step.output === "string"
                            ? step.output
                            : JSON.stringify(step.output, null, 2)}
                        </pre>
                      </div>
                    )}
                    {step.error && (
                      <div className="mt-1">
                        <p className="text-[10px] text-red-400 mb-1">Error:</p>
                        <pre className="text-[11px] text-red-300 font-mono whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                          {typeof step.error === "string"
                            ? step.error
                            : (step.error as Record<string, string>).message ||
                              JSON.stringify(step.error, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Overall error */}
        {execution?.errorMessage && (
          <div className="mt-4 p-3 bg-red-950/50 border border-red-800 rounded-lg">
            <p className="text-xs font-medium text-red-300 mb-1">
              Execution Failed
            </p>
            <p className="text-xs text-red-400 font-mono">
              {execution.errorMessage}
            </p>
          </div>
        )}

        {/* Completion summary */}
        {execution?.status === "completed" && (
          <div className="mt-4 p-3 bg-green-950/50 border border-green-800 rounded-lg">
            <p className="text-xs font-medium text-green-300">✓ Completed</p>
            <p className="text-[11px] text-green-400 mt-1">
              Duration:{" "}
              {execution.startedAt && execution.completedAt
                ? `${(
                    (new Date(execution.completedAt).getTime() -
                      new Date(execution.startedAt).getTime()) /
                    1000
                  ).toFixed(1)}s`
                : "N/A"}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
