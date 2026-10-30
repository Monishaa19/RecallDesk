import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { isSupabaseConfigured } from "./lib/supabase";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import { Spinner } from "./components/ui";
import { AuthPage, SetupRequired } from "./pages/AuthPage";
import { CapturePage } from "./pages/CapturePage";
import { ThoughtsPage } from "./pages/ThoughtsPage";
import { AskPage } from "./pages/AskPage";
import { SummariesPage } from "./pages/SummariesPage";
import { ParkPage } from "./pages/ParkPage";
import { CalendarPage } from "./pages/CalendarPage";
import { MoneyPage } from "./pages/MoneyPage";

function App() {
  const { session, loading } = useAuth();
  if (!isSupabaseConfigured) return <SetupRequired />;
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center text-accent">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!session) return <AuthPage />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CapturePage />} />
        <Route path="thoughts" element={<ThoughtsPage />} />
        <Route path="ask" element={<AskPage />} />
        <Route path="summaries" element={<SummariesPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="money" element={<MoneyPage />} />
        <Route path="park" element={<ParkPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
