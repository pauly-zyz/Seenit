import { Tabs } from "expo-router";

import { Icon } from "../../components/ui";
import { colors } from "../../theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarLabelStyle: { fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Missions",
          tabBarIcon: ({ color }) => <Icon name="map" color={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "Earnings",
          tabBarIcon: ({ color }) => <Icon name="clock" color={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="verify"
        options={{
          title: "Verify",
          tabBarIcon: ({ color }) => <Icon name="shield" color={String(color)} />,
        }}
      />
    </Tabs>
  );
}
