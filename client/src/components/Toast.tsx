import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check } from "lucide-react";

type Kind = "success" | "error";
interface ToastItem {
  id: number;
  message: string;
  kind: Kind;
}

const ToastContext = createContext<(message: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const show = useCallback((message: string, kind: Kind = "success") => {
    const id = next.current++;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-8"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="animate-fade-up flex items-center gap-2.5 rounded-full bg-ink px-4 py-2.5 text-sm text-white shadow-lift"
          >
            {t.kind === "success" ? (
              <span className="grid size-5 place-items-center rounded-full bg-white/15">
                <Check className="size-3.5" strokeWidth={2.5} />
              </span>
            ) : (
              <AlertCircle className="size-4 text-red-300" />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
