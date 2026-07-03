import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useAppStore } from "./store";

/**
 * Persistent app shell: fixed 240px sidebar, fixed 56px top bar, fluid main.
 * Sidebar and top bar never scroll; only the main content area does, so long
 * file paths and command text can never push the chrome around.
 */
export function AppShell() {
  // Auto-detect the local collector on startup: if it has real activity, show
  // it (live) instead of demo, and stream updates. Falls back to demo offline.
  useEffect(() => {
    void useAppStore.getState().loadLive();
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-ink">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
