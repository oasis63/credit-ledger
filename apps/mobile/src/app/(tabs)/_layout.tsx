import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { Ionicons, type IconName } from '../../components/ui';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';

const icon = (outline: IconName, filled: IconName) =>
  function TabIcon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
    return <Ionicons name={focused ? filled : outline} color={typeof color === 'string' ? color : colors.muted} size={size} />;
  };

export default function TabLayout() {
  const { pendingCount } = useSession();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { height: 62, paddingTop: 6, paddingBottom: 8, borderTopColor: colors.line },
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: '700' },
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '800', fontSize: 20, color: colors.ink },
        headerTintColor: colors.ink,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', headerShown: false, tabBarIcon: icon('navigate-circle-outline', 'navigate-circle') }} />
      <Tabs.Screen name="customers" options={{ title: 'Customers', tabBarIcon: icon('people-outline', 'people') }} />
      <Tabs.Screen name="collect" options={{ title: 'Collect', tabBarIcon: icon('wallet-outline', 'wallet') }} />
      <Tabs.Screen
        name="sync"
        options={{ title: 'Sync', tabBarIcon: icon('cloud-upload-outline', 'cloud-upload'), tabBarBadge: pendingCount > 0 ? pendingCount : undefined }}
      />
      <Tabs.Screen name="account" options={{ title: 'Me', tabBarIcon: icon('person-circle-outline', 'person-circle') }} />
    </Tabs>
  );
}
