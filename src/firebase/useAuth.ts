import { Platform } from 'react-native';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth';
import { useEffect, useState } from 'react';
import { auth } from './auth';

/** What an email can do on the sign-in screen. */
export type EmailStatus = 'password' | 'google' | 'new';

export type AuthState =
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'in'; uid: string; email: string };

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/invalid-email': 'Invalid email address.',
  'auth/email-already-in-use': 'This email already has an account.',
  'auth/weak-password': 'Use a password with 6+ characters.',
  'auth/popup-blocked': 'Pop-up blocked. Allow pop-ups and try again.',
  'auth/unauthorized-domain': 'Google sign-in is not available on this domain.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled yet.',
  'auth/missing-email': 'Enter your email to receive the link.',
  'auth/cancelled-popup-request': '',
  'auth/popup-closed-by-user': '',
  'auth/too-many-requests': 'Too many attempts. Try again soon.',
  'auth/network-request-failed': 'No connection. Check your internet.',
  'auth/configuration-not-found': 'Sign-in is not enabled yet.',
};

export function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  return code in MESSAGES ? MESSAGES[code] : 'Could not sign in. Try again.';
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) =>
        setState(user ? { status: 'in', uid: user.uid, email: user.email ?? '' } : { status: 'out' }),
      ),
    [],
  );

  return {
    state,
    signIn: (email: string, password: string) => signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password).then(() => undefined),
    signUp: (email: string, password: string) => createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password).then(() => undefined),
    /**
     * Sign in with Google (web). If the account does not exist yet, Firebase **creates it automatically** on the first
     * access. Popup first; if the browser blocks it (common on phones), uses redirect.
     */
    signInWithGoogle: async () => {
      if (Platform.OS !== 'web') throw Object.assign(new Error('google-native'), { code: 'auth/operation-not-supported-in-this-environment' });
      // dynamic import: the popup/redirect functions only exist in the SDK's web build
      const { signInWithPopup, signInWithRedirect } = await import('firebase/auth');
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'auth/popup-blocked') return signInWithRedirect(auth, provider);
        throw e;
      }
    },
    /**
     * Whether the email already has an account. Needs the project's email enumeration protection OFF
     * (`npm run firebase:auth-privacy -- off`); with it ON this always answers 'new'.
     */
    checkEmail: async (email: string): Promise<EmailStatus> => {
      const methods = await fetchSignInMethodsForEmail(auth, email.trim().toLowerCase());
      if (methods.includes('password')) return 'password';
      return methods.length ? 'google' : 'new';
    },
    signOut: () => fbSignOut(auth),
    /** sends the password reset link to the email */
    resetPassword: (email: string) => sendPasswordResetEmail(auth, email.trim().toLowerCase()).then(() => undefined),
  };
}
