// ============================================================================
// FlowMind Web — Workflow Toolbar
// ============================================================================
import { useCallback, useState } from "react";
import { useWorkflowStore } from "../stores/workflowStore";
import { useUIStore } from "../stores/uiStore";
import { workflows, nodes, edges } from "../api/client";
import { useNavigate } from "react-router-dom";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-600 text-gray-200",
  active: "bg-green-600 text-green-100",
  paused: "bg-amber-600 text-amber-100",
  archived: "bg-red-600 text-red-100",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function WorkflowToolbar() {
  const navigate = useNavigate();
  const workflowId = useWorkflowStore((s) => s.workflowId);
  const workspaceId = useWorkflowStore((s) => s.workspaceId);
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const workflowStatus = useWorkflowStore((s) => s.workflowStatus);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const isSaving = useWorkflowStore((s) => s.isSaving);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const setIsSaving = useWorkflowStore((s) => s.setIsSaving);
  const markSaved = useWorkflowStore((s) => s.markSaved);
  const rfNodes = useWorkflowStore((s) => s.nodes);
  const rfEdges = useWorkflowStore((s) => s.edges);
  const openExecution = useUIStore((s) => s.openExecution);
  const showToast = useUIStore((s) => s.showToast);

  const [showMenu, setShowMenu] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  // ---- Save ----
  const handleSave = useCallback(async () => {
    if (!workflowId || !workspaceId) return;
    setIsSaving(true);
    try {
      // Update workflow name/status
      await workflows.update(workflowId, {
        name: workflowName,
        status: workflowStatus,
      });

      // Sync nodes: create new ones, update existing ones
      for (const node of rfNodes) {
        const config = (node.data.config as Record<string, unknown>) || {};
        const label = (node.data.label as string) || "Untitled";
        const nodeType = (node.data.nodeType as string) || "action";

        // Check if node has a UUID (persisted) or a temp ID
        if (
          node.id.length === 36 &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(node.id)
        ) {
          // Existing node — update
          try {
            await nodes.update(node.id, {
              label,
              config,
              positionX: node.position.x,
              positionY: node.position.y,
            });
          } catch {
            // Node may not exist on server — try creating
            await nodes.create(workflowId, {
              type: nodeType,
              label,
              config,
              positionX: node.position.x,
              positionY: node.position.y,
            });
          }
        } else {
          // New node — create
          await nodes.create(workflowId, {
            type: nodeType,
            label,
            config,
            positionX: node.position.x,
            positionY: node.position.y,
          });
        }
      }

      // Sync edges: create new ones
      for (const edge of rfEdges) {
        if (
          edge.id.length === 36 &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(edge.id)
        ) {
          // Already has UUID — skip
          continue;
        }
        try {
          await edges.create(workflowId, {
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
          });
        } catch {
          // Edge may already exist or nodes not synced yet
        }
      }

      markSaved();
      showToast("Workflow saved", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to save workflow",
        "error",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    workflowId,
    workspaceId,
    workflowName,
    workflowStatus,
    rfNodes,
    rfEdges,
    setIsSaving,
    markSaved,
    showToast,
  ]);

  // ---- Execute ----
  const handleExecute = useCallback(async () => {
    if (!workflowId) return;
    setIsExecuting(true);
    try {
      const res = await workflows.execute(workflowId);
      openExecution(res.data.executionId);
      showToast("Execution started", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to execute workflow",
        "error",
      );
    } finally {
      setIsExecuting(false);
    }
  }, [workflowId, openExecution, showToast]);

  // ---- Publish ----
  const handlePublish = useCallback(async () => {
    if (!workflowId) return;
    try {
      await workflows.update(workflowId, { status: "active" });
      useWorkflowStore.getState().setWorkflowStatus("active");
      markSaved();
      showToast("Workflow published", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to publish",
        "error",
      );
    }
    setShowMenu(false);
  }, [workflowId, markSaved, showToast]);

  return (
    <header className="h-12 bg-surface-900 border-b border-surface-700 flex items-center justify-between px-4 flex-shrink-0">
      {/* Left: back + name */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/")}
          className="text-gray-400 hover:text-white transition-colors"
          title="Back to Dashboard"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <input
          type="text"
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          className="bg-transparent text-sm font-semibold text-white border-b border-transparent hover:border-surface-600 focus:border-flowmind-500 focus:outline-none px-1 py-0.5 min-w-[150px]"
        />

        {/* Status badge */}
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            STATUS_COLORS[workflowStatus] || STATUS_COLORS.draft
          }`}
        >
          {workflowStatus}
        </span>

        {/* Dirty indicator */}
        {isDirty && (
          <span className="w-2 h-2 rounded-full bg-flowmind-400" title="Unsaved changes" />
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        {/* Save (Ctrl+S) */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          data-save-btn
          className="px-3 py-1.5 bg-surface-800 hover:bg-surface-700 border border-surface-700 text-gray-200 text-xs font-medium rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {isSaving ? (
            <>
              <span className="animate-spin text-xs">⏳</span> Saving...
            </>
          ) : (
            <>
              <span className="text-[10px] text-gray-500 bg-surface-700 px-1 py-0.5 rounded">
                ⌘S
              </span>
              Save
            </>
          )}
        </button>

        {/* Execute */}
        <button
          onClick={handleExecute}
          disabled={isExecuting}
          className="px-3 py-1.5 bg-flowmind-600 hover:bg-flowmind-500 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {isExecuting ? (
            <>
              <span className="animate-spin text-xs">⏳</span> Running...
            </>
          ) : (
            <>
              <span>▶</span> Run
            </>
          )}
        </button>

        {/* More menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="px-2 py-1.5 bg-surface-800 hover:bg-surface-700 border border-surface-700 text-gray-300 text-xs font-medium rounded-md transition-colors"
          >
            ⋯
          </button>
          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1 w-44 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-20 py-1">
                <button
                  onClick={handlePublish}
                  className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-surface-700 transition-colors"
                >
                  🚀 Publish
                </button>
                <button
                  onClick={() => {
                    useUIStore.getState().activePanel === "versions"
                      ? useUIStore.getState().closePanel()
                      : (useUIStore.setState({ activePanel: "versions" }));
                    setShowMenu(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-surface-700 transition-colors"
                >
                  📜 Version History
                </button>
                <div className="border-t border-surface-700 my-1" />
                <button
                  onClick={() => {
                    useUIStore.getState().activePanel === "settings"
                      ? useUIStore.getState().closePanel()
                      : (useUIStore.setState({ activePanel: "settings" }));
                    setShowMenu(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-surface-700 transition-colors"
                >
                  ⚙️ Settings
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
