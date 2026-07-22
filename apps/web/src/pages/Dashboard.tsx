import { Link } from "react-router-dom";

export default function Dashboard() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 mt-1">Manage your workflow automations</p>
        </div>
        <Link
          to="/workflows/new"
          className="px-4 py-2 bg-flowmind-600 hover:bg-flowmind-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + New Workflow
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {[
          { label: "Active Workflows", value: "0", color: "text-green-400" },
          { label: "Executions Today", value: "0", color: "text-blue-400" },
          { label: "Success Rate", value: "--", color: "text-flowmind-400" },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-800 border border-surface-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm">{stat.label}</p>
            <p className={`text-3xl font-bold mt-2 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-surface-800 border border-surface-700 rounded-xl p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-surface-700 flex items-center justify-center mx-auto mb-4">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-flowmind-400">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Create your first workflow</h2>
        <p className="text-gray-400 mb-6 max-w-md mx-auto">
          Automate repetitive tasks with AI-powered workflows. Connect your apps, add logic, and let FlowMind handle the rest.
        </p>
        <Link
          to="/workflows/new"
          className="inline-flex px-6 py-3 bg-flowmind-600 hover:bg-flowmind-500 text-white rounded-lg font-medium transition-colors"
        >
          Get Started
        </Link>
      </div>
    </div>
  );
}
