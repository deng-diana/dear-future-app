import { useEffect, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '@/components/Button';
import { supabase } from '@/lib/supabase';
import { colors, fonts } from '@/theme';

type Props = {
  onVerified: () => void; // 验证成功后,通知外面"可以封存了"
  onCancel: () => void; // 用户反悔,关掉登录回去写信
};

// 把 Supabase 原始错误信息翻译成品牌语气的提示文案(模块级,不依赖组件状态)
function friendlyError(raw: string): string {
  const l = raw.toLowerCase();
  // Supabase 限流:同一邮箱 60s 内只能发一次
  if (l.includes('security purposes') || l.includes('once every 60 seconds')) {
    return 'One moment — a code was just sent. You can ask for another in a minute.';
  }
  // 验证码无效或已过期
  if (
    (l.includes('token') && (l.includes('invalid') || l.includes('expired'))) ||
    l.includes('not valid')
  ) {
    return 'That code didn’t match. Have another look at the email — or resend a fresh one.';
  }
  // 网络不通
  if (
    l.includes('network request failed') ||
    l.includes('failed to fetch') ||
    l.includes('networkerror')
  ) {
    return 'You’re offline. Your letter is safe — try again in a moment.';
  }
  // 兜底
  return 'Something went sideways. Please try again.';
}

// 常见邮箱域名手滑对照表 —— 真实事故的直接防线:用户把 hotmail 打成 hotamil,
// 验证码飞进不存在的邮箱,还以为是我们没发。检测到就给一条可点的"你是不是想输…"。
const DOMAIN_FIXES: Record<string, string> = {
  'hotamil.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmall.com': 'hotmail.com',
  'gamil.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gmali.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'outlok.com': 'outlook.com', 'outloook.com': 'outlook.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com',
  'icoud.com': 'icloud.com', 'iclould.com': 'icloud.com', 'icluod.com': 'icloud.com',
};
function suggestEmailFix(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(/^([^@\s]+)@([^@\s]+)$/);
  if (!m) return null;
  const fixed = DOMAIN_FIXES[m[2]];
  return fixed ? `${m[1]}@${fixed}` : null;
}

export default function SignIn({ onVerified, onCancel }: Props) {
  const insets = useSafeAreaInsets(); // 刘海/状态栏高度 —— 关闭按钮避让用
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email'); // 现在在哪一步:输邮箱 还是 输码
  const [busy, setBusy] = useState(false); // 正在等服务器(发码 / 验码)
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0); // 重发倒计时(秒),0 = 可重发
  const [resendNote, setResendNote] = useState(''); // 重发成功后的软提示

  // A5: 有错误时立即通过屏幕阅读器播报(让 VoiceOver/TalkBack 用户知道出错了)
  // web 跳过:react-native-web 的无障碍 API 不全,错误路径调用可能抛错卸载整棵树;
  // 网页上错误本来就有红字展示,不需要播报。
  useEffect(() => {
    if (error && Platform.OS !== 'web') AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  // 重发倒计时:每秒递减,到 0 停止
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // 第 1 步:把 8 位码发到这个邮箱
  async function sendCode() {
    setBusy(true);
    setError('');
    const { error: sendErr } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (sendErr) {
      setError(friendlyError(sendErr.message));
      return;
    }
    setResendCooldown(60); // 首次发送后启动 60s 冷却,与重发保持一致
    setStage('code'); // 发成功 → 切到"输码"那一屏
  }

  // 重发验证码(已在"输码"步骤内):重新发、启动倒计时、显示软提示
  async function handleResend() {
    setBusy(true);
    setError('');
    setResendNote('');
    const { error: sendErr } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (sendErr) {
      setError(friendlyError(sendErr.message));
      return;
    }
    setResendNote('A new code is on its way.');
    setResendCooldown(60);
  }

  // 换一个邮箱:返回输邮箱步骤,清空已输入的码、提示和倒计时
  function useDifferentEmail() {
    setStage('email');
    setCode('');
    setError('');
    setResendNote('');
    setResendCooldown(0);
  }

  // 第 2 步:拿用户输入的码去验证
  async function verifyCode() {
    setBusy(true);
    setError('');
    setResendNote(''); // 开始验证时清掉软提示,保持界面干净

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
        setError(friendlyError('Token has expired or is invalid'));
        return;
      }
      const { error: vErr } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash as string,
        type: 'magiclink',
      });
      setBusy(false);
      if (vErr) {
        setError(friendlyError(vErr.message));
        return;
      }
      onVerified();
      return;
    }

    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (verifyErr) {
      setError(friendlyError(verifyErr.message));
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
              {/* 手滑救援:检测到常见域名拼写错误(hotamil→hotmail)→ 一点即改。 */}
              {suggestEmailFix(email) ? (
                <Pressable
                  onPress={() => setEmail(suggestEmailFix(email)!)}
                  hitSlop={{ top: 8, bottom: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${suggestEmailFix(email)}`}>
                  <Text style={styles.suggestText}>Did you mean {suggestEmailFix(email)}?</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.title}>A code is waiting for you</Text>
              {/* 一段话说完:邮箱和发件人名用主题色点亮(嵌套 Text),不再用背景框。
                  发件人名依赖 Supabase SMTP Sender name 设置 —— 需与之保持一致(Reunite)。 */}
              <Text style={styles.hint}>
                We sent it to <Text style={styles.hintBrand}>{email.trim()}</Text>. It arrives from{' '}
                <Text style={styles.hintBrand}>“Reunite”</Text> — if it isn’t there, check your junk folder.
              </Text>
              {/* A3: OTP 字段加上自动填充(textContentType / autoComplete)+ 屏幕阅读器标签 */}
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder="••••••••"
                placeholderTextColor={colors.textMutedLight}
                keyboardType="number-pad"
                maxLength={8}
                autoFocus
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                accessibilityLabel="Verification code"
              />
            </>
          )}

          {/* A5: accessibilityLiveRegion="assertive" — 错误出现时屏幕阅读器立即打断并播报 */}
          {error ? <Text style={styles.error} accessibilityLiveRegion="assertive">{error}</Text> : null}
          {/* 重发成功的软确认(有错误时不显示,避免信息冲突) */}
          {!error && resendNote ? <Text style={styles.resendNote}>{resendNote}</Text> : null}
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
            // 验码按钮:码不足 8 位 / 正在验证 → 禁用
            <Button
              label="Verify"
              onPress={verifyCode}
              disabled={code.trim().length < 8}
              loading={busy}
              style={styles.buttonLayout}
              textStyle={styles.buttonText}
            />
          )}

          {/* 输码阶段:给用户两条退路 — 重发 + 换邮箱 */}
          {stage === 'code' && (
            <>
              <Button
                variant="link"
                label={resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
                onPress={handleResend}
                disabled={resendCooldown > 0 || busy}
                textStyle={styles.cancel}
              />
              <Button
                variant="link"
                label="Use a different email"
                onPress={useDifferentEmail}
                disabled={busy}
                textStyle={styles.cancel}
              />
            </>
          )}

        </View>
      </KeyboardAvoidingView>

      {/* 关闭 ✕:右上角(iOS 惯例)。"放弃登录"是代价最大的动作,不该埋在底部
          链接堆里最易误点的位置(创始人拍板,2026-07-04)。 */}
      <Pressable
        onPress={onCancel}
        disabled={busy}
        style={[styles.closeBtn, { top: (insets.top > 0 ? insets.top : 44) + 4 }]}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close sign in">
        <Text style={styles.closeIcon}>✕</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.backgroundPaper },
  body: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  title: { fontFamily: fonts.regular, fontSize: 22, color: colors.textPrimary, lineHeight: 30 },
  hint: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMutedMid, lineHeight: 20 },
  // 手滑救援行:品牌深棕、可点(样式对齐全 app 的"可点文字"语言)。
  suggestText: { fontFamily: fonts.regular, fontSize: 14, color: colors.brandText, marginTop: 10, textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: colors.accentGold },
  // hint 里的主题色强调(邮箱地址 / 发件人名),嵌套 Text 使用。
  hintBrand: { color: colors.brandText },
  input: {
    marginTop: 12,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: 20,
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  codeInput: { fontSize: 26, letterSpacing: 6 },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
  resendNote: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMutedMid }, // 重发成功的软提示,与 hint 同色

  footer: { paddingVertical: 16, paddingHorizontal: 24, gap: 14, alignItems: 'center' }, // 左右 24 与 body 一致 → 按钮与内容同宽
  // Button 组件默认 alignSelf:'stretch';这里再加 width:'100%' 确保 footer alignItems:'center' 不压缩它
  buttonLayout: { width: '100%' },
  // SignIn 按钮文字比 Button 默认值略大、字距更宽,通过 textStyle 覆盖
  buttonText: { fontSize: 17, fontWeight: '600' as const, letterSpacing: 2 },
  // 右上角关闭按钮:44pt 触区,安静的灰棕 ✕(替代原底部 "Not now" 链接)。
  closeBtn: { position: 'absolute', right: 16, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, // top 由安全区动态计算,避开状态栏
  closeIcon: { fontFamily: fonts.regular, fontSize: 20, color: colors.textMutedMid, lineHeight: 22 },
  // (原 "Not now" 底部链接已移除 —— cancel 样式仍被两条救援链接复用)
  cancel: { fontFamily: fonts.regular, fontSize: 15, color: colors.textMutedMid },
});
