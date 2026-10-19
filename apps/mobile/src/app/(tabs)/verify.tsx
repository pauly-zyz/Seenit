import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "../../providers/session";
import { VerificationScreen } from "../../screens/VerificationScreen";
import { colors } from "../../theme";

export default function VerifyTab() {
  const { api } = useSession();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.paper }}>
      <VerificationScreen api={api} />
    </View>
  );
}
