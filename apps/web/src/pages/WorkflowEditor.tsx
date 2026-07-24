// ============================================================================
// FlowMind Web — Workflow Editor Page
// ============================================================================
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import { useWorkflowStore } from "../stores/workflowStore";
import { useUIStore } from "../stores/uiStore";
import { workflows } from "../api/client";
import ReactFlowCanvas from "../components/ReactFlowCanvas";
import NodePalette from "../components/NodePalette";
import NodeConfigPanel from "../components/NodeConfigPanel";
import WorkflowToolbar from "../components/WorkflowToolbar";
import ExecutionPanel from "../components/ExecutionPanel";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function WorkflowEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const setWorkflowId = useWorkflowStore((s) => s.setWorkflowId);
  const setWorkspaceId = useWorkflowStore((s) => s.setWorkspaceId);
  const activePanel = useUIStore((s) => s.activePanel);
  const toast = useUIStore((s) => s.toast);
  const clearToast = useUIStore((s) => s.clearToast);
  const workflowName = useWorkflowStore((s) => s.workflowName);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Load workflow data ----
  useEffect(() => {
    if (!id || id === "new") {
      // New workflow — start empty
      setWorkflowId("new");
      setWorkspaceId("");
      return;
    }

    async function fetchWorkflow() {
      setLoading(true);
      setError(null);
      try {
        const res = await workflows.get(id!);
        const wf = res.data;
        loadWorkflow({
          id: wf.id,
          workspaceId: wf.workspaceId,
          name: wf.name,
          status: wf.status,
          nodes: wf.nodes || [],
          edges: wf.edges || [],
        });
        setWorkspaceId(wf.workspaceId);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load workflow",
        );
      } finally {
        setLoading(false);
      }
    }

    fetchWorkflow();
  }, [id, loadWorkflow, setWorkflowId, setWorkspaceId]);

  // ---- Toast auto-dismiss ----
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(clearToast, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast, clearToast]);

  // ---- Loading state ----
  if (loading) {
    return (
      <div className="h-[calc(100vh-56px)] flex items-center justify-center bg-surface-950">
        <div className="text-center">
          <div className="animate-spin inline-block w-8 h-8 border-2 border-flowmind-400 border-t-transparent rounded-full mb-3" />
          <p className="text-gray-400 text-sm">Loading workflow...</p>
        </div>
      </div>
    );
  }

  // ---- Error state ----
  if (error) {
    return (
      <div className="h-[calc(100vh-56px)] flex items-center justify-center bg-surface-950">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-3">⚠️</div>
          <h2 className="text-lg font-semibold text-white mb-2">
            Failed to load workflow
          </h2>
          <p className="text-sm text-gray-400 mb-4">{error}</p>
          <button
            onClick={() => navigate("/")}
            className="px-4 py-2 bg-flowmind-600 hover:bg-flowmind-500 text-white rounded-lg text-sm transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="h-[calc(100vh-56px)] flex flex-col bg-surface-950">
        {/* Toolbar */}
        <WorkflowToolbar />

        {/* Main area: Palette | Canvas | Config/Execution */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Palette */}
          <NodePalette />

          {/* Center: Canvas */}
          <ReactFlowCanvas />

          {/* Right: Config or Execution panel */}
          {activePanel === "config" && <NodeConfigPanel />}
          {activePanel === "execution" && <ExecutionPanel />}
        </div>

        {/* Toast notification */}
        {toast && (
          <div
            className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-xl text-sm font-medium z-50 transition-all animate-in slide-in-from-right ${
              toast.type === "success"
                ? "bg-green-900/90 border border-green-700 text-green-200"
                : toast.type === "error"
                  ? "bg-red-900/90 border border-red-700 text-red-200"
                  : "bg-surface-800 border border-surface-700 text-gray-200"
            }`}
          >
            {toast.message}
          </div>
        )}
      </div>
    </ReactFlowProvider>
  );
}
