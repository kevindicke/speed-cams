import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';
import Purchases, { CustomerInfo, PurchasesPackage } from 'react-native-purchases';

import {
  PRO_ENTITLEMENT,
  REVENUECAT_ANDROID_KEY,
  REVENUECAT_IOS_KEY,
  REVENUECAT_TEST_STORE_KEY,
} from './config';

/**
 * Pro status. Saved on the device so the background location task can check it without
 * talking to RevenueCat (which may not be configured in a background launch).
 */
const PRO_KEY = 'pro-active-v1';

function apiKey(): string {
  if (__DEV__ && REVENUECAT_TEST_STORE_KEY) return REVENUECAT_TEST_STORE_KEY;
  return Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
}

/** False until RevenueCat keys are added to config.ts; everyone gets Pro meanwhile. */
export const purchasesEnabled = apiKey() !== '';

let proActive: boolean = !purchasesEnabled;
let loaded = !purchasesEnabled;
const listeners = new Set<() => void>();

function setPro(active: boolean) {
  loaded = true;
  if (active === proActive) return;
  proActive = active;
  Storage.setItem(PRO_KEY, active ? '1' : '0').catch(() => {});
  listeners.forEach((fn) => fn());
}

/** Current Pro status, reading the saved value on first use. */
export async function isPro(): Promise<boolean> {
  if (!loaded) {
    try {
      proActive = (await Storage.getItem(PRO_KEY)) === '1';
    } catch {
      proActive = false;
    }
    loaded = true;
  }
  return proActive;
}

export function getProSnapshot() {
  return proActive;
}

export function subscribePro(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const hasPro = (info: CustomerInfo) => info.entitlements.active[PRO_ENTITLEMENT] !== undefined;

let configured = false;

/** Call once when the app UI starts. Safe to call again. */
export async function initPurchases() {
  if (!purchasesEnabled || configured) return;
  configured = true;
  await isPro(); // show the saved status immediately
  listeners.forEach((fn) => fn());
  Purchases.configure({ apiKey: apiKey() });
  Purchases.addCustomerInfoUpdateListener((info) => setPro(hasPro(info)));
  try {
    setPro(hasPro(await Purchases.getCustomerInfo()));
  } catch {
    // Offline: keep the saved status.
  }
}

/** Packages in the current RevenueCat offering (e.g. monthly, annual, lifetime). */
export async function getPackages(): Promise<PurchasesPackage[]> {
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages ?? [];
}

export async function buy(pkg: PurchasesPackage): Promise<'purchased' | 'cancelled'> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    setPro(hasPro(customerInfo));
    if (!hasPro(customerInfo)) {
      // Paid, but the product isn't attached to the Pro entitlement in RevenueCat
      // (or PRO_ENTITLEMENT doesn't match its identifier).
      throw new Error(
        'Your purchase went through, but Pro could not be unlocked. Try "Restore purchases", or contact support.',
      );
    }
    return 'purchased';
  } catch (e) {
    if ((e as { userCancelled?: boolean | null }).userCancelled) return 'cancelled';
    throw e;
  }
}

/** Only call from a user tap: it can trigger an App Store sign-in prompt. */
export async function restore(): Promise<boolean> {
  const info = await Purchases.restorePurchases();
  setPro(hasPro(info));
  return hasPro(info);
}
