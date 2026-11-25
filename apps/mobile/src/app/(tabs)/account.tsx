import { Alert, ScrollView, Text } from 'react-native';
import Constants from 'expo-constants';
import { Button, Card, styles as ui } from '../../components/ui';
import { useSession } from '../../lib/session';
import { colors, space } from '../../lib/theme';

const ROLE: Record<string, string> = { owner: 'Owner', accountant: 'Accountant', salesman: 'Salesman' };

export default function Account() {
  const { user, serverUrl, pendingCount, signOut } = useSession();

  function confirmSignOut() {
    if (pendingCount > 0) {
      Alert.alert(
        'Sync first',
        `${pendingCount} collection${pendingCount > 1 ? 's are' : ' is'} still on this phone. Go online and sync before signing out, so the money is recorded under your name.`,
      );
      return;
    }
    Alert.alert('Sign out?', 'Saved customer data will be removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <Card>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.ink }}>{user?.name}</Text>
        <Text style={ui.muted}>{user ? ROLE[user.role] : ''}</Text>
      </Card>
      <Card>
        <Text style={ui.label}>Server</Text>
        <Text style={{ color: colors.ink, marginBottom: space.md }}>{serverUrl}</Text>
        <Text style={ui.label}>App version</Text>
        <Text style={{ color: colors.ink }}>{Constants.expoConfig?.version ?? 'dev'}</Text>
      </Card>
      <Text style={[ui.muted, { marginBottom: space.md }]}>
        The office manages customers, invoices, disputes and settings on the web app. This app is for collections and checking balances in the field.
      </Text>
      <Button title="Sign out" variant="danger" onPress={confirmSignOut} />
    </ScrollView>
  );
}
