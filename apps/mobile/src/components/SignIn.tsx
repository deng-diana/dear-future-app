import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';

type Props = {
  onVerified: () => void; // 验证成功后,通知外面"可以封存了"
  onCancel: () => void; // 用户反悔,关掉登录回去写信
};

export default function SignIn({ onVerified, onCancel }: Props) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email'); // 现在在哪一步:输邮箱 还是 输码
  const [busy, setBusy] = useState(false); // 正在等服务器(发码 / 验码)
  const [error, setError] = useState('');

  // 第 1 步:把 6 位码发到这个邮箱
  async function sendCode() {
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStage('code'); // 发成功 → 切到"输码"那一屏
  }

  // 第 2 步:拿用户输入的码去验证
  async function verifyCode() {
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    onVerified(); // 验证通过 → 通知外面封存
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.body}>
          {stage === 'email' ? (
            <>
              <Text style={styles.title}>Where should it be sent, years from now?</Text>
              <Text style={styles.hint}>Your letter will return here. This address is your only key.</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#b3a99a"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
            </>
          ) : (
            <>
              <Text style={styles.title}>A code is waiting for you</Text>
              <Text style={styles.hint}>We sent it to {email.trim()}.</Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder="••••••"
                placeholderTextColor="#b3a99a"
                keyboardType="number-pad"
                maxLength={10}
                autoFocus
              />
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <View style={styles.footer}>
          {stage === 'email' ? (
            <Pressable
              style={[styles.button, (busy || email.trim().length === 0) && styles.buttonDisabled]}
              onPress={sendCode}
              disabled={busy || email.trim().length === 0}>
              {busy ? <ActivityIndicator color="#fbf6ec" /> : <Text style={styles.buttonText}>Send code</Text>}
            </Pressable>
          ) : (
            <Pressable
              style={[styles.button, (busy || code.trim().length < 6) && styles.buttonDisabled]}
              onPress={verifyCode}
              disabled={busy || code.trim().length < 6}>
              {busy ? <ActivityIndicator color="#fbf6ec" /> : <Text style={styles.buttonText}>Verify</Text>}
            </Pressable>
          )}

          <Pressable onPress={onCancel} disabled={busy}>
            <Text style={styles.cancel}>Not now</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#fbf6ec' },
  body: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  title: { fontSize: 22, color: '#33302b', lineHeight: 30 },
  hint: { fontSize: 14, color: '#8a8175', lineHeight: 20 },
  input: {
    marginTop: 12,
    paddingVertical: 12,
    fontSize: 20,
    color: '#33302b',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd5c7',
  },
  codeInput: { fontSize: 26, letterSpacing: 6 },
  error: { fontSize: 13, color: '#b4533a' },

  footer: { padding: 16, gap: 14, alignItems: 'center' },
  button: {
    width: '100%',
    backgroundColor: '#3a3a3a',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#ddd5c7' },
  buttonText: { color: '#fbf6ec', fontSize: 17, fontWeight: '600', letterSpacing: 2 },
  cancel: { fontSize: 15, color: '#8a8175' },
});
