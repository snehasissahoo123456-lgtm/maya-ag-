if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/service-worker.js", { scope: "/" })
      .catch(error => console.warn("[Maya PWA] Service worker registration failed:", error));
  });
}
