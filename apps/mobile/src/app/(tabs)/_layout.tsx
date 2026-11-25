import type { ColorValue } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;
const icon = (name: IconName) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={typeof color === 'string' ? color : colors.muted} size={size} />;
  };

export default function TabLayout() {
  const { pendingCount } = useSession();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand,
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.ink,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Customers', tabBarIcon: icon('people-outline') }} />
      <Tabs.Screen name="collect" options={{ title: 'Collect', tabBarIcon: icon('cash-outline') }} />
      <Tabs.Screen
        name="sync"
        options={{
          title: 'Sync',
          tabBarIcon: icon('cloud-upload-outline'),
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
        }}
      />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
