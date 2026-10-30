import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { CalendarCheck, CalendarDays, Feather, Library, Lock, LogOut, MessageCircle, Wallet } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { ThoughtDialog } from "./ThoughtDialog";
import { Logo } from "./ui";

const NAV = [
  { to: "/", label: "Capture", icon: Feather, end: true },
  { to: "/thoughts", label: "My Thoughts", short: "Thoughts", icon: Library },
  { to: "/ask", label: "Ask RecallDesk", short: "Ask", icon: MessageCircle },
  { to: "/calendar", label: "Calendar", icon: CalendarCheck },
  { to: "/money", label: "Money", icon: Wallet },
  { to: "/summaries", label: "Summaries", short: "Recap", icon: CalendarDays },
  { to: "/park", label: "Park it", short: "Park", icon: Lock },
];

function ConfigBanner() {
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    api
      .health()
      .then((h) => setMissing([...(!h.database ? ["database"] : []), ...(!h.ai ? ["AI"] : [])]))
      .catch(() => setMissing(["server"]));
  }, []);
  if (!missing.length) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 md:pl-68">
      {missing.includes("server")
        ? "The RecallDesk API server isn't reachable. Start it with `npm run dev`."
        : `The ${missing.join(" and ")} ${missing.length > 1 ? "connections aren't" : "connection isn't"} configured on the server. See the README's setup steps.`}
    </div>
  );
}

export function Layout() {
  const { session, signOut } = useAuth();
  const email = session?.user.email ?? "";
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-dvh">
      <ConfigBanner />
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-line bg-canvas px-4 py-6 md:flex">
        <div className="flex items-center gap-2.5 px-2">
          <Logo />
          <span className="font-serif text-[22px] tracking-tight">RecallDesk</span>
        </div>
        <nav className="mt-10 space-y-1" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                  isActive ? "bg-surface font-medium text-ink shadow-card ring-1 ring-line" : "text-muted hover:bg-subtle hover:text-ink"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`size-[18px] ${isActive ? "text-accent" : ""}`} strokeWidth={1.75} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-line px-2 pt-4">
          <p className="truncate text-xs text-faint" title={email}>{email}</p>
          <button onClick={signOut} className="mt-2 inline-flex items-center gap-2 text-sm text-muted hover:text-ink cursor-pointer">
            <LogOut className="size-4" strokeWidth={1.75} /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <Logo className="size-7" />
          <span className="font-serif text-xl tracking-tight">RecallDesk</span>
        </div>
        <button onClick={signOut} className="btn-ghost p-2" aria-label="Sign out">
          <LogOut className="size-4" />
        </button>
      </header>

      <main className="pb-24 md:pb-0 md:pl-64">
        <Outlet />
      </main>

      {/* Mobile tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-7 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {NAV.map(({ to, label, short, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 py-2.5 text-[10px] ${isActive ? "text-accent font-medium" : "text-muted"}`
            }
          >
            <Icon className="size-5" strokeWidth={1.75} />
            {short ?? label}
          </NavLink>
        ))}
      </nav>

      <ThoughtDialog />
    </div>
  );
}
