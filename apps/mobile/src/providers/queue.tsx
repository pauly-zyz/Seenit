import * as Network from "expo-network";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { deleteFile, uploadFile } from "../lib/files";
import { queueStore } from "../lib/storage";
import { UploadQueue, type QueueDeps } from "../lib/upload-queue";
import { useSession } from "./session";

const realNow = () => Date.now();

const QueueContext = createContext<UploadQueue | null>(null);

/** One upload queue for the app, wired to connectivity, app foreground and the session. */
export function UploadQueueProvider({
  children,
  deps,
}: {
  children: React.ReactNode;
  /** Tests override native pieces. */
  deps?: Partial<QueueDeps>;
}) {
  const { api, status } = useSession();
  // One queue per session API (the API instance is stable for the app's lifetime).
  const [queue] = useState(
    () =>
      new UploadQueue({
        store: queueStore,
        api,
        uploadFile,
        deleteFile,
        now: realNow,
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        ...deps,
      }),
  );

  useEffect(() => {
    void queue.init();
    const online = (s: { isConnected?: boolean; isInternetReachable?: boolean }) =>
      queue.setOnline(s.isConnected !== false && s.isInternetReachable !== false);
    Network.getNetworkStateAsync().then(online, () => undefined);
    const net = Network.addNetworkStateListener(online);
    const app = AppState.addEventListener("change", (s) => s === "active" && queue.kick());
    return () => {
      net.remove();
      app.remove();
    };
  }, [queue]);

  useEffect(() => {
    if (status === "signedIn") queue.resume();
  }, [status, queue]);

  return <QueueContext.Provider value={queue}>{children}</QueueContext.Provider>;
}

export function useUploadQueue() {
  const queue = useContext(QueueContext);
  if (!queue) throw new Error("useUploadQueue must be used inside UploadQueueProvider");
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  return { queue, items };
}
