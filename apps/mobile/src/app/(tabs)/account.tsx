import { Alert, ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Avatar, Button, Card, Ionicons, SectionTitle, styles as ui, type IconName } from '../../components/ui';
import { useSession } from '../../lib/session';
import { colors, space } from '../../lib/theme';

const ROLE: Record<string, string> = { owner: 'Owner', accountant: 'Accountant', salesman: 'Salesman' };

function Row({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.sunken, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={17} color={colors.muted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.muted, fontSize: 12.5 }}>{label}</Text>
        <Text style={{ color: colors.ink, fontWeight: '600' }} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

export default function Account() {
  const { user, serverUrl, pendingCount, online, signOut } = useSession();

  function confirmSignOut() {
    if (pendingCount > 0) {
      Alert.alert('Sync first', `${pendingCount} item${pendingCount > 1 ? 's are' : ' is'} still on this phone. Go online and sync before signing out, so the money is recorded under your name.`);
      return;
    }
    Alert.alert('Sign out?', 'Saved customer data will be removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
        <Avatar name={user?.name ?? '?'} size={72} />
        <Text style={{ fontSize: 21, fontWeight: '800', color: colors.ink, marginTop: space.md }}>{user?.name}</Text>
        <Text style={ui.muted}>{user ? ROLE[user.role] : ''}</Text>
      </Card>
      <SectionTitle>This phone</SectionTitle>
      <Card>
        <Row icon="server-outline" label="Server" value={serverUrl} />
        <Row icon={online ? 'wifi' : 'cloud-offline-outline'} label="Connection" value={online ? 'Online' : 'Offline'} />
        <Row icon="cloud-upload-outline" label="Waiting to sync" value={pendingCount ? `${pendingCount} item${pendingCount > 1 ? 's' : ''}` : 'Nothing'} />
        <Row icon="information-circle-outline" label="App version" value={Constants.expoConfig?.version ?? 'dev'} />
      </Card>
      <Text style={[ui.muted, { marginBottom: space.md, lineHeight: 20 }]}>
        Bills, beats, reports and settings are managed by the office on the web app. This app is for your route, visits and collections, and works without internet.
      </Text>
      <Button title="Sign out" icon="log-out-outline" variant="danger" onPress={confirmSignOut} />
    </ScrollView>
  );
}
