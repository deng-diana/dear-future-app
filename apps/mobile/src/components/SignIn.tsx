import { useEffect, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '@/components/Button';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme';

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

  // A5: 有错误时立即通过屏幕阅读器播报(让 VoiceOver/TalkBack 用户知道出错了)
  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

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

    // 审核专用登录:App Store 审核员收不到 review 邮箱的验证码,所以这个特定邮箱走
    // review-login 边缘函数,用「固定码」换会话(普通用户邮箱不匹配,永远走不到这里;
    // 且服务器没配 REVIEW_LOGIN_CODE 时函数会拒)。
    const REVIEW_EMAIL = 'review@dearfuture.space';
    if (email.trim().toLowerCase() === REVIEW_EMAIL) {
      const { data, error: fnErr } = await supabase.functions.invoke('review-login', {
        body: { code: code.trim() },
      });
      if (fnErr || !data?.token_hash) {
        setBusy(false);
        setError('That code is not valid.');
        return;
      }
      const { error: vErr } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash as string,
        type: 'magiclink',
      });
      setBusy(false);
      if (vErr) {
        setError(vErr.message);
        return;
      }
      onVerified();
      return;
    }

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
              {/* A4: 添加邮箱自动填充提示(textContentType / autoComplete)+ 屏幕阅读器标签 */}
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMutedLight}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                textContentType="emailAddress"
                autoComplete="email"
                accessibilityLabel="Email address"
              />
            </>
          ) : (
            <>
              <Text style={styles.title}>A code is waiting for you</Text>
              <Text style={styles.hint}>We sent it to {email.trim()}.</Text>
              {/* A3: OTP 字段加上自动填充(textContentType / autoComplete)+ 屏幕阅读器标签 */}
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder="••••••"
                placeholderTextColor={colors.textMutedLight}
                keyboardType="number-pad"
                maxLength={10}
                autoFocus
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                accessibilityLabel="Verification code"
              />
            </>
          )}

          {/* A5: accessibilityLiveRegion="assertive" — 错误出现时屏幕阅读器立即打断并播报 */}
          {error ? <Text style={styles.error} accessibilityLiveRegion="assertive">{error}</Text> : null}
        </View>

        <View style={styles.footer}>
          {stage === 'email' ? (
            // 发码按钮:邮箱为空 / 正在发送 → 禁用
            <Button
              label="Send code"
              onPress={sendCode}
              disabled={email.trim().length === 0}
              loading={busy}
              style={styles.buttonLayout}
              textStyle={styles.buttonText}
            />
          ) : (
            // 验码按钮:码不足 6 位 / 正在验证 → 禁用
            <Button
              label="Verify"
              onPress={verifyCode}
              disabled={code.trim().length < 6}
              loading={busy}
              style={styles.buttonLayout}
              textStyle={styles.buttonText}
            />
          )}

          {/* 取消:字号与颜色与默认 link 不同,通过 textStyle 覆盖 */}
          <Button
            variant="link"
            label="Not now"
            onPress={onCancel}
            disabled={busy}
            textStyle={styles.cancel}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.backgroundPaper },
  body: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  title: { fontSize: 22, color: colors.textPrimary, lineHeight: 30 },
  hint: { fontSize: 14, color: colors.textMutedMid, lineHeight: 20 },
  input: {
    marginTop: 12,
    paddingVertical: 12,
    fontSize: 20,
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  codeInput: { fontSize: 26, letterSpacing: 6 },
  error: { fontSize: 13, color: colors.danger },

  footer: { padding: 16, gap: 14, alignItems: 'center' },
  // Button 组件默认 alignSelf:'stretch';这里再加 width:'100%' 确保 footer alignItems:'center' 不压缩它
  buttonLayout: { width: '100%' },
  // SignIn 按钮文字比 Button 默认值略大、字距更宽,通过 textStyle 覆盖
  buttonText: { fontSize: 17, fontWeight: '600' as const, letterSpacing: 2 },
  // "Not now" 是静默取消:字号略大、用更深的灰色(与默认 link 不同)
  cancel: { fontSize: 15, color: colors.textMutedMid },
});
