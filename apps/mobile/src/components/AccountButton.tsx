import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  email: string;
  onSignOut: () => void; // 点 Sign out 时调用(外面会弹"确定吗")
};

export default function AccountButton({ email, onSignOut }: Props) {
  const [open, setOpen] = useState(false); // 卡片开着没
  const insets = useSafeAreaInsets(); // 安全区(避开刘海)

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
          {/* 卡片本身:吸收点击,不让它穿透去关掉 */}
          <Pressable style={[styles.card, { top: cardTop + 48 }]} onPress={() => {}}>
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
