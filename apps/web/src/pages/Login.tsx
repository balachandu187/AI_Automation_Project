// ============================================================================
// FlowMind Web — Login Page
// ============================================================================
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { setUserId } from "../api/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      // Auth stub: simulate login using X-User-Id header
      // In production, this would POST to /api/v1/auth/login
      const userId = localStorage.getItem("flowmind_user_id");
      if (!userId) {
        // Generate a demo user ID for the stub
        const demoId = "00000000-0000-0000-0000-000000000001";
        setUserId(demoId);
      }
      navigate("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Login failed",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-2xl font-bold text-flowmind-400 mb-2">
            <svg
              width="32"
              height="32"
              viewBox="0 0 28 28"
              fill="none"
              className="text-flowmind-500"
            >
              <rect width="28" height="28" rx="6" fill="currentColor" />
              <path
                d="M8 10.5C8 9.11929 9.11929 8 10.5 8H14L20 14L14 20H10.5C9.11929 20 8 18.8807 8 17.5V10.5Z"
                fill="white"
              />
              <circle cx="13" cy="14" r="2" fill="currentColor" />
            </svg>
            FlowMind
          </div>
          <p className="text-gray-400 text-sm">Sign in to your account</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-950/50 border border-red-800 rounded-lg text-sm text-red-300 text-center">
            {error}
          </div>
        )}

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-surface-800 border border-surface-700 rounded-xl p-6 space-y-4"
        >
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-flowmind-500 transition-colors"
              placeholder="you@company.com"
              required
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:outline-none focus:border-flowmind-500 transition-colors"
              placeholder="••••••••"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-flowmind-600 hover:bg-flowmind-500 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <p className="text-center text-xs text-gray-500 mt-6">
          FlowMind — AI-First Workflow Automation
        </p>
      </div>
    </div>
  );
}
