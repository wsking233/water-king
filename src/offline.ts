import { useEffect, useState } from "react";
let registration: ServiceWorkerRegistration | undefined;
function waitForInstall(worker: ServiceWorker) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => done(new Error("更新准备超时，请稍后再试。")),
      20000,
    );
    const check = () => {
      if (worker.state === "installed" || worker.state === "activated") done();
      else if (worker.state === "redundant")
        done(new Error("新版下载失败，请稍后重试。"));
    };
    function done(error?: Error) {
      clearTimeout(timer);
      worker.removeEventListener("statechange", check);
      error ? reject(error) : resolve();
    }
    worker.addEventListener("statechange", check);
    check();
  });
}
export function useOfflineApp() {
  const [status, setStatus] = useState("正在准备离线使用…"),
    [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD) {
      setStatus("本地预览");
      return;
    }
    if (!("serviceWorker" in navigator)) {
      setStatus("当前浏览器暂不支持离线打开");
      return;
    }
    let disposed = false;
    let cleanup = () => {};
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: "none",
      })
      .then((reg) => {
        registration = reg;
        const watch = () => {
          if (disposed) return;
          if (reg.waiting) setAvailable(true);
          const worker = reg.installing;
          if (worker)
            void waitForInstall(worker)
              .then(() => {
                if (!disposed) {
                  setAvailable(
                    Boolean(reg.waiting && navigator.serviceWorker.controller),
                  );
                }
              })
              .catch(() => {
                if (!disposed && !reg.active)
                  setStatus("离线准备失败，请联网后刷新重试");
              });
        };
        reg.addEventListener("updatefound", watch);
        watch();
        void navigator.serviceWorker.ready.then(() => {
          if (!disposed) setStatus("已准备好，可离线打开和记录");
        });
        let checked = 0;
        const check = () => {
          if (
            !document.hidden &&
            navigator.onLine &&
            Date.now() - checked > 60000
          ) {
            checked = Date.now();
            void reg.update().catch(() => {});
          }
        };
        document.addEventListener("visibilitychange", check);
        cleanup = () => {
          reg.removeEventListener("updatefound", watch);
          document.removeEventListener("visibilitychange", check);
        };
      })
      .catch(() => {
        if (!disposed) setStatus("离线准备失败，联网时仍可正常使用");
      });
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);
  return { status, available };
}
export async function prepareRefresh() {
  // Recovery screens may mount before the normal app registered its worker.
  if (!registration && "serviceWorker" in navigator) registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  if (!registration) return;
  await registration.update();
  if (registration.installing) await waitForInstall(registration.installing);
  const waiting = registration.waiting;
  if (waiting)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => done(new Error("更新暂未完成，请稍后再试。")),
        15000,
      );
      const changed = () => done();
      function done(error?: Error) {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          changed,
        );
        error ? reject(error) : resolve();
      }
      navigator.serviceWorker.addEventListener("controllerchange", changed);
      waiting.postMessage({ type: "ACTIVATE_UPDATE" });
    });
}
