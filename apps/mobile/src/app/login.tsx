import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '@credit-ledger/shared';
import { Banner, Button, Field } from '../components/ui';
import { normaliseServerUrl } from '../lib/config';
import { useSession } from '../lib/session';
import { colors, space } from '../lib/theme';

export default function Login() {
  const { signIn, serverUrl } = useSession();
  const [server, setServer] = useState(serverUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const url = normaliseServerUrl(server);
    if (!url) return setError('Enter a valid server address');
    if (!email.trim() || !password) return setError('Enter your email and password');
    setBusy(true);
    try {
      await signIn(url, email, password);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? `Can't reach ${url}. Check your internet and the server address.` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: space.xl, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg }}>
            <Text style={{ color: '#fff', fontSize: 32, fontWeight: '800' }}>₹</Text>
          </View>
          <Text style={{ fontSize: 30, fontWeight: '800', color: colors.ink, marginBottom: 4 }}>Credit Ledger</Text>
          <Text style={{ fontSize: 16, color: colors.muted, marginBottom: space.xl }}>Your route, visits and collections. Works without internet.</Text>
          {error && <Banner tone="bad">{error}</Banner>}
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            onSubmitEditing={submit}
          />
          {showServer ? (
            <Field label="Server address" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" autoCorrect={false} />
          ) : (
            <Text onPress={() => setShowServer(true)} style={{ color: colors.brand, marginBottom: space.lg }} accessibilityRole="button">
              Server: {server} (change)
            </Text>
          )}
          <View style={{ marginTop: space.sm }}>
            <Button title="Sign in" icon="log-in-outline" onPress={submit} busy={busy} />
          </View>
          <Text style={{ color: colors.muted, marginTop: space.lg, fontSize: 13 }}>
            Your office creates your account. Ask the owner if you don't have one.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
