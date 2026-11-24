import { useSyncExternalStore } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getMutedSnapshot,
  getWarningDistanceSnapshot,
  setMuted,
  setWarningDistance,
  subscribeSettings,
  WarningDistance,
} from '../settings';

const DISTANCE_OPTIONS: { value: WarningDistance; title: string; body: string }[] = [
  {
    value: 'auto',
    title: 'Auto (recommended)',
    body: 'Warns about 25 seconds before you reach a camera, based on your speed: about 0.15 mi at 20 mph up to 0.5 mi on the highway.',
  },
  {
    value: 'quarter',
    title: '¼ mile',
    body: 'Fewer early warnings in the city. Gives about 15 seconds at highway speed.',
  },
  {
    value: 'half',
    title: '½ mile',
    body: 'Earliest warning. Best for highways; in cities it can warn several blocks early.',
  },
];

type Props = { visible: boolean; onClose: () => void };

export function SettingsSheet({ visible, onClose }: Props) {
  const distance = useSyncExternalStore(subscribeSettings, getWarningDistanceSnapshot);
  const muted = useSyncExternalStore(subscribeSettings, getMutedSnapshot);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Settings</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.done}>Done</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionTitle}>Warning distance</Text>
          <View style={styles.card} accessibilityRole="radiogroup">
            {DISTANCE_OPTIONS.map((opt, i) => {
              const selected = distance === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setWarningDistance(opt.value)}
                  style={({ pressed }) => [styles.option, i > 0 && styles.divider, pressed && styles.pressed]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={opt.title}
                  accessibilityHint={opt.body}
                >
                  <View style={[styles.radio, selected && styles.radioOn]}>
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>{opt.title}</Text>
                    <Text style={styles.optionBody}>{opt.body}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>Sound</Text>
          <View style={[styles.card, styles.switchRow]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.optionTitle}>Spoken warnings</Text>
              <Text style={styles.optionBody}>
                Spoken only when you&rsquo;re 5+ mph over the limit, even with the silent switch on.
                Other warnings appear silently. When off, all warnings are silent.
              </Text>
            </View>
            <Switch
              value={!muted}
              onValueChange={(on) => setMuted(!on)}
              accessibilityLabel="Spoken warnings"
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F8' },
  content: { padding: 20, paddingTop: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#101828' },
  done: { fontSize: 17, fontWeight: '600', color: '#1570EF' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#667085',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
  },
  card: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden' },
  option: { flexDirection: 'row', gap: 12, padding: 16, alignItems: 'flex-start' },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D0D5DD' },
  pressed: { backgroundColor: '#F2F4F7' },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#98A2B3',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioOn: { borderColor: '#1570EF' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#1570EF' },
  optionTitle: { fontSize: 16, fontWeight: '600', color: '#101828' },
  optionBody: { fontSize: 14, color: '#475467', marginTop: 2, lineHeight: 19 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
});
