import { api } from "./api";

/**
 * Loads the PayPal JavaScript SDK (Checkout buttons) on demand. Only the public client ID is
 * used here; it comes from the server so there's nothing extra to configure in the browser.
 */

export interface PayPalButtonsInstance {
  render(container: HTMLElement): Promise<void>;
  close(): Promise<void>;
  isEligible(): boolean;
}

export interface PayPalNamespace {
  Buttons(options: {
    style?: Record<string, unknown>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onCancel?: () => void;
    onError?: (err: unknown) => void;
  }): PayPalButtonsInstance;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

let loaded: { currency: string; promise: Promise<PayPalNamespace> } | null = null;

export function loadPayPal(currency: string): Promise<PayPalNamespace> {
  if (loaded?.currency === currency) return loaded.promise;
  // The SDK is loaded for one currency at a time; swap it if a different one is needed.
  document.getElementById("paypal-sdk")?.remove();
  delete window.paypal;

  const promise = (async () => {
    const cfg = await api.paypalConfig();
    if (!cfg.enabled || !cfg.clientId) throw new Error("PayPal isn't connected on the server yet.");
    const qs = new URLSearchParams({ "client-id": cfg.clientId, currency, intent: "capture", components: "buttons" });
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.id = "paypal-sdk";
      script.src = `https://www.paypal.com/sdk/js?${qs}`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Couldn't load PayPal. Check your connection and try again."));
      document.head.appendChild(script);
    });
    if (!window.paypal) throw new Error("Couldn't load PayPal.");
    return window.paypal;
  })();
  loaded = { currency, promise };
  promise.catch(() => {
    if (loaded?.promise === promise) loaded = null;
  });
  return promise;
}
