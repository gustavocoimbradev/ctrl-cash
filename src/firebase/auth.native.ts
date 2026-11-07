// iOS/Android: the session persists in AsyncStorage.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
// @ts-expect-error exported only in the SDK's React Native bundle
import { getReactNativePersistence } from 'firebase/auth';
import { app } from './app';

function createAuth() {
  try {
    return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    return getAuth(getApps()[0]);
  }
}

export const auth = createAuth();
