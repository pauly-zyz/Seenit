import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Storage } from "@reown/appkit-react-native";

import type { QueueItem, QueueStore } from "./upload-queue";

const QUEUE_KEY = "seenit.uploadQueue.v1";

export const queueStore: QueueStore = {
  async load() {
    try {
      const raw = await AsyncStorage.getItem(QUEUE_KEY);
      return raw ? (JSON.parse(raw) as QueueItem[]) : [];
    } catch {
      return [];
    }
  },
  async save(items) {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  },
};

/** AppKit session storage (per the Reown docs' AsyncStorage example). */
export const appKitStorage: Storage = {
  getKeys: async () => [...(await AsyncStorage.getAllKeys())],
  getEntries: async <T = unknown>() => {
    const keys = await AsyncStorage.getAllKeys();
    return Promise.all(
      keys.map(async (k) => [k, safeParse<T>(await AsyncStorage.getItem(k))] as [string, T]),
    );
  },
  getItem: async <T = unknown>(key: string) => {
    const v = await AsyncStorage.getItem(key);
    return v === null ? undefined : safeParse<T>(v);
  },
  setItem: async <T = unknown>(key: string, value: T) => {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  removeItem: async (key: string) => {
    await AsyncStorage.removeItem(key);
  },
};

function safeParse<T>(raw: string | null): T {
  try {
    return JSON.parse(raw ?? "null") as T;
  } catch {
    return raw as T;
  }
}
