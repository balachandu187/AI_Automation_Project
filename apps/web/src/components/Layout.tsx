import { Outlet, Link, useLocation } from "react-router-dom";

const navItems = [
  { label: "Dashboard", path: "/" },
  { label: "Workflows", path: "/workflows" },
];

export default function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-surface-700 bg-surface-900">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold text-flowmind-400">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-flowmind-500">
              <rect width="28" height="28" rx="6" fill="currentColor" />
              <path
                d="M8 10.5C8 9.11929 9.11929 8 10.5 8H14L20 14L14 20H10.5C9.11929 20 8 18.8807 8 17.5V10.5Z"
                fill="white"
              />
              <circle cx="13" cy="14" r="2" fill="currentColor" />
            </svg>
            FlowMind
          </Link>
          <nav className="flex items-center gap-4">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`text-sm transition-colors ${
                  location.pathname === item.path
                    ? "text-flowmind-400 font-medium"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
