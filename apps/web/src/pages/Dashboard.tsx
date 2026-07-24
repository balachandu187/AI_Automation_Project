// ============================================================================
// FlowMind Web — Dashboard Page
// ============================================================================
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { workflows, workspaces } from "../api/client";
import type { Workflow } from "../types/api";

// ---------------------------------------------------------------------------
// Status colors
// ---------------------------------------------------------------------------
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-600/20 text-gray-400 border-gray-600",
  active: "bg-green-600/20 text-green-400 border-green-600",
  paused: "bg-amber-600/20 text-amber-400 border-amber-600",
  archived: "bg-red-600/20 text-red-400 border-red-600",
};

const STATUS_ICONS: Record<string, string> = {
  draft: "📝",
  active: "✅",
  paused: "⏸️",
  archived: "📦",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const navigate = useNavigate();
  const [wfList, setWfList] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsId, setWsId] = useState<string | null>(null);

  // ---- Fetch workspace and workflows ----
  useEffect(() => {
    async function load() {
      try {
        // Get or create workspace
        const wsResult = await workspaces.list(1, 5);
        const wss = wsResult.data;

        let activeWsId = wss[0]?.id;
        if (!activeWsId) {
          // Create default workspace
          const newWs = await workspaces.create({
            name: "Default Workspace",
            slug: `default-${Date.now()}`,
          });
          activeWsId = newWs.data.id;
        }

        setWsId(activeWsId);

        // Fetch workflows
        const wfResult = await workflows.list(activeWsId);
        setWfList(wfResult.data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load workflows",
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  // ---- Computed stats ----
  const activeWorkflows = wfList.filter((w) => w.status === "active").length;
  const totalExecutions = wfList.reduce(
    (sum, w) => (w.lastExecution ? sum + 1 : sum),
    0,
  );
  const draftCount = wfList.filter((w) => w.status === "draft").length;

  // ---- Create new workflow ----
  const handleCreate = async () => {
    if (!wsId) return;
    try {
      const res = await workflows.create(wsId, {
        name: "New Workflow",
        triggerType: "manual",
        triggerConfig: {},
      });
      navigate(`/workflows/${res.data.id}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create workflow",
      );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 mt-1">
            Manage your workflow automations
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-flowmind-600 hover:bg-flowmind-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <span className="text-lg leading-none">+</span>
          New Workflow
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm">Active Workflows</p>
          <p className="text-3xl font-bold mt-2 text-green-400">
            {activeWorkflows}
          </p>
        </div>
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm">Recent Executions</p>
          <p className="text-3xl font-bold mt-2 text-blue-400">
            {totalExecutions}
          </p>
        </div>
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm">Drafts</p>
          <p className="text-3xl font-bold mt-2 text-flowmind-400">
            {draftCount}
          </p>
        </div>
      </div>

      {/* Workflow list */}
      {loading && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-12 text-center">
          <div className="animate-spin inline-block w-8 h-8 border-2 border-flowmind-400 border-t-transparent rounded-full mb-3" />
          <p className="text-gray-400 text-sm">Loading workflows...</p>
        </div>
      )}

      {error && (
        <div className="bg-surface-800 border border-red-800 rounded-xl p-6">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && wfList.length === 0 && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-surface-700 flex items-center justify-center mx-auto mb-4">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-flowmind-400"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">
            Create your first workflow
          </h2>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            Automate repetitive tasks with AI-powered workflows. Connect your
            apps, add logic, and let FlowMind handle the rest.
          </p>
          <button
            onClick={handleCreate}
            className="inline-flex px-6 py-3 bg-flowmind-600 hover:bg-flowmind-500 text-white rounded-lg font-medium transition-colors"
          >
            Get Started
          </button>
        </div>
      )}

      {!loading && !error && wfList.length > 0 && (
        <div className="bg-surface-800 border border-surface-700 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-surface-700 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            <div className="col-span-4">Name</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Trigger</div>
            <div className="col-span-2">Last Execution</div>
            <div className="col-span-2 text-right">Updated</div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-surface-700">
            {wfList.map((wf) => (
              <Link
                key={wf.id}
                to={`/workflows/${wf.id}`}
                className="grid grid-cols-12 gap-4 px-6 py-4 hover:bg-surface-700/50 transition-colors items-center"
              >
                <div className="col-span-4">
                  <p className="text-sm font-medium text-white">
                    {wf.name}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {wf.description || "No description"}
                  </p>
                </div>
                <div className="col-span-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                      STATUS_COLORS[wf.status] || STATUS_COLORS.draft
                    }`}
                  >
                    <span>{STATUS_ICONS[wf.status] || "📝"}</span>
                    {wf.status}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-sm text-gray-300">
                    {wf.triggerType}
                  </span>
                </div>
                <div className="col-span-2">
                  {wf.lastExecution ? (
                    <span
                      className={`text-xs ${
                        wf.lastExecution.status === "completed"
                          ? "text-green-400"
                          : wf.lastExecution.status === "failed"
                            ? "text-red-400"
                            : "text-gray-400"
                      }`}
                    >
                      {wf.lastExecution.status} —{" "}
                      {wf.lastExecution.startedAt
                        ? new Date(
                            wf.lastExecution.startedAt,
                          ).toLocaleDateString()
                        : "N/A"}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-500">
                      Never executed
                    </span>
                  )}
                </div>
                <div className="col-span-2 text-right text-xs text-gray-500">
                  {new Date(wf.updatedAt).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
