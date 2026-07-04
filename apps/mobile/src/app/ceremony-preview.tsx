// 开发预览屏 — 开发预览用,提交前可删。
// Renders SealCeremony in an endless loop: onDone → 600 ms pause → remount.

import { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SealCeremony from '@/components/SealCeremony';
import { colors } from '@/theme';

export default function CeremonyPreview() {
  const [key, setKey] = useState(0);

  const handleDone = useCallback(() => {
    // 600 ms 停顿后重新挂载,方便反复观察。
    setTimeout(() => setKey((k) => k + 1), 600);
  }, []);

  return (
    <View style={styles.container}>
      <SealCeremony key={key} onDone={handleDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
