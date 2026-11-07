import { getApps, initializeApp } from 'firebase/app';
import { firebaseConfig } from './config';

/** Firebase is used only for sign-in (email/password and Google). The data lives in PostgreSQL behind the API. */
export const app = getApps()[0] ?? initializeApp(firebaseConfig);

/** Only for local development with the Auth emulator (EXPO_PUBLIC_FIREBASE_EMULATOR=1); never in production. */
export const useEmulator = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR === '1';
