import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PACKAGE_TYPE, PurchasesPackage } from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buy, getPackages, restore } from '../pro';

const PRIVACY_URL = 'https://kevindicke.github.io/speed-cams/privacy.html';
// Apple's standard license agreement, used as the Terms of Use for subscriptions.
const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

const FEATURES = [
  ['🔒', 'Warnings with the screen off', 'Keeps watching while your phone is locked or you use Maps or music.'],
  ['🚨', 'Speeding warnings', '"Slow down! Speed camera ahead" when you are over the limit.'],
  ['❤️', 'Supports camera data updates', 'Weekly updates from OpenStreetMap and city open data.'],
] as const;

function packageLabel(pkg: PurchasesPackage) {
  switch (pkg.packageType) {
    case PACKAGE_TYPE.MONTHLY:
      return { name: 'Monthly', note: `${pkg.product.priceString} / month` };
    case PACKAGE_TYPE.ANNUAL:
      return { name: 'Yearly', note: `${pkg.product.priceString} / year` };
    case PACKAGE_TYPE.LIFETIME:
      return { name: 'Lifetime', note: `${pkg.product.priceString} one-time` };
    default:
      return { name: pkg.product.title, note: pkg.product.priceString };
  }
}

type Props = { visible: boolean; onClose: () => void };

export function ProPaywall({ visible, onClose }: Props) {
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    getPackages()
      .then((p) => {
        setError(null);
        setPackages(p);
      })
      .catch((e) => setError(`Couldn't load prices. ${String(e?.message ?? e)}`));
  }, [visible]);

  const onBuy = async (pkg: PurchasesPackage) => {
    setBusy(pkg.identifier);
    try {
      if ((await buy(pkg)) === 'purchased') {
        Alert.alert('Welcome to Pro', 'Background and speeding warnings are now on.');
        onClose();
      }
    } catch (e) {
      Alert.alert('Purchase failed', String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const onRestore = async () => {
    setBusy('restore');
    try {
      if (await restore()) {
        Alert.alert('Purchases restored', 'Pro is active on this device.');
        onClose();
      } else {
        Alert.alert('Nothing to restore', 'No Pro purchase was found for this Apple ID.');
      }
    } catch (e) {
      Alert.alert('Restore failed', String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const hasSubscription = packages?.some(
    (p) => p.packageType !== PACKAGE_TYPE.LIFETIME && p.packageType !== PACKAGE_TYPE.CUSTOM,
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Speed Cams Pro</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          {FEATURES.map(([icon, title, body]) => (
            <View key={title} style={styles.feature}>
              <Text style={styles.featureIcon}>{icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.featureTitle}>{title}</Text>
                <Text style={styles.featureBody}>{body}</Text>
              </View>
            </View>
          ))}

          <View style={styles.packages}>
            {error ? (
              <Text style={styles.error}>{error}</Text>
            ) : packages == null ? (
              <ActivityIndicator style={{ marginVertical: 24 }} />
            ) : packages.length === 0 ? (
              <Text style={styles.error}>No Pro options are available right now.</Text>
            ) : (
              packages.map((pkg) => {
                const { name, note } = packageLabel(pkg);
                return (
                  <Pressable
                    key={pkg.identifier}
                    onPress={() => onBuy(pkg)}
                    disabled={busy != null}
                    style={({ pressed }) => [styles.package, pressed && { opacity: 0.85 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Buy ${name}, ${note}`}
                  >
                    {busy === pkg.identifier ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Text style={styles.packageName}>{name}</Text>
                        <Text style={styles.packageNote}>{note}</Text>
                      </>
                    )}
                  </Pressable>
                );
              })
            )}
          </View>

          <Pressable onPress={onRestore} disabled={busy != null} style={styles.restore} accessibilityRole="button">
            {busy === 'restore' ? <ActivityIndicator /> : <Text style={styles.link}>Restore purchases</Text>}
          </Pressable>

          {hasSubscription ? (
            <Text style={styles.legal}>
              Subscriptions renew automatically at the price shown unless cancelled at least 24 hours
              before the end of the current period. Payment is charged to your Apple ID. Manage or
              cancel in Settings → Apple ID → Subscriptions.
            </Text>
          ) : null}
          <View style={styles.legalLinks}>
            <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>
              Terms of Use
            </Text>
            <Text style={styles.legalDot}>·</Text>
            <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>
              Privacy Policy
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F8' },
  content: { padding: 20, paddingTop: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 28, fontWeight: '800', color: '#101828' },
  close: { fontSize: 22, color: '#667085' },
  feature: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  featureIcon: { fontSize: 24 },
  featureTitle: { fontSize: 16, fontWeight: '700', color: '#101828' },
  featureBody: { fontSize: 14, color: '#475467', marginTop: 2 },
  packages: { marginTop: 12, gap: 10 },
  package: {
    backgroundColor: '#1570EF',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    minHeight: 64,
    justifyContent: 'center',
  },
  packageName: { color: '#fff', fontSize: 17, fontWeight: '700' },
  packageNote: { color: '#D1E9FF', fontSize: 14, marginTop: 2 },
  error: { color: '#D92D20', textAlign: 'center', marginVertical: 16 },
  restore: { alignItems: 'center', paddingVertical: 16, minHeight: 52, justifyContent: 'center' },
  link: { color: '#1570EF', fontSize: 14, fontWeight: '600' },
  legal: { fontSize: 12, color: '#667085', textAlign: 'center', lineHeight: 17 },
  legalLinks: { flexDirection: 'row', justifyContent: 'center', marginTop: 12, gap: 6 },
  legalDot: { color: '#98A2B3' },
});
