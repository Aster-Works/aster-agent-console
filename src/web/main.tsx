import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createHashRouter, Navigate } from "react-router-dom";
import "./index.css";
import { AppShell } from "./app/AppShell";
import { Overview } from "./routes/Overview";
import { SessionReplay } from "./routes/SessionReplay";
import { Activity } from "./routes/Activity";
import { RepoActivity } from "./routes/RepoActivity";
import { RiskRadar } from "./routes/RiskRadar";
import { Agents } from "./routes/Agents";
import { Insights } from "./routes/Insights";
import { Settings } from "./routes/Settings";

// Hash router keeps deep links working when the CLI serves the SPA from a
// static file server (Phase 3) without server-side routing config.
const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: "overview", element: <Overview /> },
      { path: "session-replay", element: <SessionReplay /> },
      { path: "session-replay/:sessionId", element: <SessionReplay /> },
      { path: "activity", element: <Activity /> },
      { path: "repo-activity", element: <RepoActivity /> },
      { path: "risk-radar", element: <RiskRadar /> },
      { path: "agents", element: <Agents /> },
      { path: "insights", element: <Insights /> },
      { path: "settings", element: <Settings /> },
      { path: "*", element: <Navigate to="/overview" replace /> },
    ],
  },
], {
  // Opt into v7 behaviour now to avoid console deprecation warnings.
  future: { v7_relativeSplatPath: true },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} future={{ v7_startTransition: true }} />
  </React.StrictMode>
);
