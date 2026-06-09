import { useCallback, useEffect, useReducer } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

type StorageState = readonly [loading: boolean, value: string | null];

function reducer(_state: StorageState, value: string | null): StorageState {
  return [false, value];
}

export async function setStorageItemAsync(key: string, value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

export function useStorageState(key: string): readonly [StorageState, (value: string | null) => void] {
  const [state, setState] = useReducer(reducer, [true, null] as StorageState);

  useEffect(() => {
    if (Platform.OS === 'web') {
      setState(typeof localStorage === 'undefined' ? null : localStorage.getItem(key));
      return;
    }
    SecureStore.getItemAsync(key).then(setState).catch(() => setState(null));
  }, [key]);

  const setValue = useCallback(
    (value: string | null) => {
      setState(value);
      void setStorageItemAsync(key, value);
    },
    [key],
  );

  return [state, setValue];
}
