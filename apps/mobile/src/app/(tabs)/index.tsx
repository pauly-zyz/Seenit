import { router } from "expo-router";

import { useTier } from "../../hooks/useTier";
import { useLocation } from "../../providers/location";
import { useSession } from "../../providers/session";
import { MissionsScreen } from "../../screens/MissionsScreen";

export default function MissionsTab() {
  const { api } = useSession();
  const { fix, permission } = useLocation();
  const tier = useTier();
  return (
    <MissionsScreen
      api={api}
      tier={tier}
      fix={fix}
      permission={permission}
      onOpenMission={(id) => router.push({ pathname: "/mission/[id]", params: { id } })}
      onVerify={() => router.navigate("/verify")}
    />
  );
}
