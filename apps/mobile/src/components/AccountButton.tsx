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

  return (
    <>
      <Pressable
        style={[styles.avatar, { top: insets.top + 8 }]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Account">
        <Text style={styles.initial}>{initial}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* 半透明背景:点空白处关掉 */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* 卡片本身:吸收点击,不让它穿透去关掉 */}
          <Pressable style={[styles.card, { top: insets.top + 54 }]} onPress={() => {}}>
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
  avatar: {
    position: 'absolute',
    right: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ece3d2',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  initial: { fontSize: 16, fontWeight: '600', color: '#6b6155' },

  backdrop: { flex: 1, backgroundColor: 'rgba(40,36,30,0.12)' },
  card: {
    position: 'absolute',
    right: 16,
    width: 248,
    backgroundColor: '#fffdf7',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  label: { fontSize: 12, color: '#b3a99a' },
  email: { fontSize: 15, color: '#33302b', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#eee5d6', marginVertical: 12 },
  signOut: { fontSize: 15, color: '#b4533a' },
});
