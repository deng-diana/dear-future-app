import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  email: string;
  onSignOut: () => void; // 点 Sign out 时调用(外面会弹"确定吗")
};

export default function AccountButton({ email, onSignOut }: Props) {
  const [open, setOpen] = useState(false); // 卡片开着没
  const insets = useSafeAreaInsets(); // 安全区(避开刘海)
  const initial = email.trim().charAt(0).toUpperCase() || '·'; // 默认头像 = 邮箱首字母

  // 卡片顶部:优先用真实刘海高度;若 insets 还没测到(返回 0),
  // 回退到 iOS 标准状态栏高度 44,保证卡片不会躲进状态栏下面。
  const cardTop = (insets.top > 0 ? insets.top : 44) + 8;

  return (
    <>
      {/*
        头像行:普通 flex 流(不再 position: absolute)。
        index.tsx 把它渲染在 SafeAreaView 顶部,
        SafeAreaView 的 padding 已经把内容推到刘海下方 —— 这个机制已被证明有效。
        头像靠右:用 alignItems: 'flex-end' + 固定高度实现"安静的右上角"效果。
      */}
      <View style={styles.headerRow}>
        <Pressable
          style={styles.avatar}
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Account">
          <Text style={styles.initial}>{initial}</Text>
        </Pressable>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* 半透明背景:点空白处关掉 */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* 卡片本身:吸收点击,不让它穿透去关掉 */}
          <Pressable style={[styles.card, { top: cardTop + 46 }]} onPress={() => {}}>
            <Text style={styles.label}>Your letters return to</Text>
            <Text style={styles.email} numberOfLines={1}>
              {email}
            </Text>
            <View style={styles.divider} />
            <Pressable
              onPress={() => {
                setOpen(false);
                onSignOut();
              }}
              accessibilityRole="button">
              <Text style={styles.signOut}>Sign out</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // 头像所在的行:撑满横向宽度,头像贴右边,高度给够 avatar 尺寸 + 上下留白。
  headerRow: {
    height: 54,
    paddingHorizontal: 16,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E3CDB4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontSize: 16, fontWeight: '600', color: '#5A3A24' },

  backdrop: { flex: 1, backgroundColor: 'rgba(40,36,30,0.12)' },
  card: {
    position: 'absolute',
    right: 16,
    width: 248,
    backgroundColor: '#F4E7D6',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  label: { fontSize: 12, color: '#B09A80' },
  email: { fontSize: 15, color: '#3A2416', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#E3CDB4', marginVertical: 12 },
  signOut: { fontSize: 15, color: '#B24A18' },
});
