import { useUploadQueue } from "../../providers/queue";
import { useSession } from "../../providers/session";
import { HistoryScreen } from "../../screens/HistoryScreen";

export default function HistoryTab() {
  const { api, signOut } = useSession();
  const { queue, items } = useUploadQueue();
  return (
    <HistoryScreen
      api={api}
      queue={items}
      online={queue.isOnline}
      needsSignIn={queue.needsSignIn}
      onRetry={(id) => void queue.retry(id)}
      onRemove={(id) => void queue.remove(id)}
      onClearDone={() => void queue.clearDone()}
      onSignOut={() => void signOut()}
    />
  );
}
