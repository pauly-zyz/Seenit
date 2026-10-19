import { router, useLocalSearchParams } from "expo-router";

import { useLocation } from "../../providers/location";
import { useSession } from "../../providers/session";
import { MissionDetailScreen } from "../../screens/MissionDetailScreen";

export default function MissionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const { fix } = useLocation();
  return (
    <MissionDetailScreen
      api={api}
      missionId={id}
      fix={fix}
      onStartCapture={() => router.push({ pathname: "/capture/[id]", params: { id } })}
      onVerify={() => router.navigate("/verify")}
    />
  );
}
