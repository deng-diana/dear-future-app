import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import { useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import { colors, fonts } from '@/theme';

type Props = {
  email: string;
  onSignOut: () => void; // 点 Sign out 时调用(外面会弹"确定吗")
};

export default function AccountButton({ email, onSignOut }: Props) {
  const [open, setOpen] = useState(false); // 卡片开着没
  const [deleting, setDeleting] = useState(false); // 正在删账号?
  const insets = useSafeAreaInsets(); // 安全区(避开刘海)

  // 删账号:两步确认,第二步才真正调 Edge Function(边缘函数)。
  // 第一步弹框说清楚后果:所有未送达的信永远消失,无法撤销。
  function handleDeleteAccount() {
    setOpen(false); // 先关掉卡片,让弹框完整显示
    Alert.alert(
      'Delete account',
      'Every letter still sealed and waiting will be permanently cancelled — they will NEVER be delivered. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: confirmDeleteAccount,
        },
      ],
    );
  }

  // 第二步确认:再问一次,确保用户没有误触。
  function confirmDeleteAccount() {
    Alert.alert(
      'Are you sure?',
      'Your account and all sealed letters will be permanently deleted. There is no going back.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete my account',
          style: 'destructive',
          onPress: runDeleteAccount,
        },
      ],
    );
  }

  // 真正执行:调 delete-account Edge Function → 成功后登出(回到未登录状态)。
  async function runDeleteAccount() {
    if (deleting) return; // 重入保护:删除进行中再次触发直接忽略,避免重复调用
    setDeleting(true);
    const { error } = await supabase.functions.invoke('delete-account');
    setDeleting(false);
    if (error) {
      Alert.alert('Something went wrong', error.message || 'Could not delete your account. Please try again.');
      return;
    }
    // Edge Function 删除成功 → 本地也清掉登录状态,回到未登录界面。
    await supabase.auth.signOut();
    // onSignOut 通知父级 UI 更新(index.tsx 里 auth 状态变化会自动触发,signOut 已足够)。
  }

  // 卡片顶部:优先用真实刘海高度;若 insets 还没测到(返回 0),
  // 回退到 iOS 标准状态栏高度 44,保证卡片不会躲进状态栏下面。
  const cardTop = (insets.top > 0 ? insets.top : 44) + 8;

  return (
    <>
      {/*
        头像:绝对定位浮在右上角,与顶部邮戳(日期/城市/时间)顶对齐 ——
        不再单独占一整行、留一大片空白。它落在 SafeAreaView 安全区内,
        top 与 Dateline 的 paddingTop(16)对齐,自然和"日期那行"平齐。
        默认头像换成蜡封人像图(avatar-default.png),不再用邮箱首字母。
      */}
      <Pressable
        style={styles.avatar}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Account"
        hitSlop={8}>
        <Image source={require('@/assets/images/avatar-default.png')} style={styles.avatarImg} resizeMode="contain" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* 半透明背景:点空白处关掉 */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* 卡片本身:吸收点击,不让它穿透去关掉。A11: accessibilityViewIsModal 让 VoiceOver 把焦点锁在卡片内 */}
          <Pressable style={[styles.card, { top: cardTop + 48 }]} onPress={() => {}} accessibilityViewIsModal={true}>
            <Text style={styles.label}>Your letters return to</Text>
            <Text style={styles.email} numberOfLines={1}>
              {email}
            </Text>
            <View style={styles.divider} />
            {/* Support:打开支持页(FAQ + 联系方式)。App 审核也要求有可达的支持入口。 */}
            <Pressable
              onPress={() => Linking.openURL('https://dear-future-app.vercel.app/support')}
              style={styles.menuRow}
              accessibilityRole="button"
              accessibilityLabel="Support">
              <Ionicons name="help-circle-outline" size={18} color={colors.textBody} />
              <Text style={styles.signOut}>Support</Text>
            </Pressable>
            <View style={styles.divider} />
            {/* Delete account 放在上方(用户要求);用红色 + 垃圾桶图标强烈区分,避免误点;且本身有两步确认。 */}
            <Pressable
              onPress={handleDeleteAccount}
              disabled={deleting}
              style={styles.menuRow}
              accessibilityRole="button"
              accessibilityLabel="Delete account">
              <Ionicons name="trash-outline" size={18} color={colors.dangerDeep} />
              <Text style={styles.deleteAccount}>{deleting ? 'Deleting…' : 'Delete account'}</Text>
            </Pressable>
            <View style={styles.divider} />
            {/* Sign out 放在下方;正常正文色 + 退出图标 —— 安全/常用,与上面的红色 Delete 明显区分。 */}
            <Pressable
              onPress={() => {
                setOpen(false);
                onSignOut();
              }}
              style={styles.menuRow}
              accessibilityRole="button"
              accessibilityLabel="Sign out">
              <Ionicons name="log-out-outline" size={18} color={colors.textBody} />
              <Text style={styles.signOut}>Sign out</Text>
            </Pressable>
            <View style={styles.divider} />
            {/* 版本号脚注:显示真实的原生版本 + build 号,方便确认装的是哪个 build(也利于排查 / 审核)。 */}
            <Text style={styles.version}>
              Version {Application.nativeApplicationVersion ?? '?'}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // 头像:绝对定位的右上角,与顶部日期那行平齐。不占流式空间,所以邮戳会自然上移到最顶。
  // top:14 ≈ Dateline 的 paddingTop(16),让蜡封顶端与"日期"那一行对齐。
  avatar: {
    position: 'absolute',
    top: 14,
    right: 24,
    width: 44,
    height: 44,
    zIndex: 10,
  },
  avatarImg: { width: 44, height: 44 },

  backdrop: { flex: 1, backgroundColor: 'rgba(40,36,30,0.12)' },
  card: {
    position: 'absolute',
    right: 16,
    width: 248,
    backgroundColor: colors.surfaceCard,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  label: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMutedLight },
  email: { fontFamily: fonts.regular, fontSize: 15, color: colors.textPrimary, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.surfacePhoto, marginVertical: 12 },
  // 一行菜单项:图标 + 文字,横向排列。
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  signOut: { fontFamily: fonts.regular, fontSize: 15, color: colors.textBody }, // 改正常正文色(原为 danger 红)—— 与红色 Delete 明显区分
  // 删账号:破坏性操作,保持红色(dangerDeep)+ 垃圾桶图标。
  deleteAccount: { fontFamily: fonts.regular, fontSize: 15, color: colors.dangerDeep },
  // 版本号脚注:小号、静默色、居中。
  version: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMutedLight, textAlign: 'left', marginTop: 4 },
});
