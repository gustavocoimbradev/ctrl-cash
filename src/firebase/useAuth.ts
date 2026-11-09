import { Platform } from 'react-native';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  onAuthStateChanged,
  sendPasswordResetEmail,
  EmailAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  updatePassword,
  signOut as fbSignOut,
  updateProfile,
} from 'firebase/auth';
import { useEffect, useState } from 'react';
import { auth } from './auth';
import { t } from '../i18n';

/** What an email can do on the sign-in screen. */
export type EmailStatus = 'password' | 'google' | 'new';

export type AuthState =
  | { status: 'loading' }
  | { status: 'out' }
  /** `name` is the account's display name: the one typed at sign-up, or the one Google gives (empty when there is none) */
  | { status: 'in'; uid: string; email: string; name: string };

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
  'auth/requires-recent-login': 'For your security, sign in again and retry.',
  'auth/provider-already-linked': 'This account already has a password.',
  'auth/credential-already-in-use': 'This email already has a password on another account.',
  'auth/configuration-not-found': 'Sign-in is not enabled yet.',
};

export function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  return code in MESSAGES ? (MESSAGES[code] ? t(MESSAGES[code]) : '') : t('Could not sign in. Try again.');
}

/** Whether the signed-in account has a password (accounts that only use Google do not). */
export function currentHasPassword(): boolean {
  return !!auth.currentUser?.providerData.some((p) => p.providerId === 'password');
}

/**
 * Changes the password, or sets the first one for an account that only used Google. With a password already set,
 * `current` is checked first (a fresh sign-in is required to change it). Google-only accounts are asked to confirm
 * with Google when Firebase wants a recent sign-in.
 */
export async function savePassword(current: string, next: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) throw Object.assign(new Error('no user'), { code: 'auth/requires-recent-login' });
  if (currentHasPassword()) {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
    await updatePassword(user, next);
    return;
  }
  const credential = EmailAuthProvider.credential(user.email, next);
  try {
    await linkWithCredential(user, credential);
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/requires-recent-login' || Platform.OS !== 'web') throw e;
    const { reauthenticateWithPopup } = await import('firebase/auth');
    await reauthenticateWithPopup(user, new GoogleAuthProvider());
    await linkWithCredential(user, credential);
  }
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) =>
        setState(user ? { status: 'in', uid: user.uid, email: user.email ?? '', name: user.displayName ?? '' } : { status: 'out' }),
      ),
    [],
  );

  return {
    state,
    signIn: (email: string, password: string) => signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password).then(() => undefined),
    /** creates the account with the name the person typed (kept as the account's display name) */
    signUp: async (email: string, password: string, name: string) => {
      const { user } = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      await updateProfile(user, { displayName: name.trim() });
      // the sign-in event already fired without the name: tell the app the name is there now
      setState({ status: 'in', uid: user.uid, email: user.email ?? '', name: name.trim() });
    },
    /**
     * Sign in with Google (web). If the account does not exist yet, Firebase **creates it automatically** on the first
     * access. Popup first; if the browser blocks it (common on phones), uses redirect.
     */
    signInWithGoogle: async (loginHint?: string) => {
      if (Platform.OS !== 'web') throw Object.assign(new Error('google-native'), { code: 'auth/operation-not-supported-in-this-environment' });
      // dynamic import: the popup/redirect functions only exist in the SDK's web build
      const { signInWithPopup, signInWithRedirect } = await import('firebase/auth');
      const provider = new GoogleAuthProvider();
      // with the email already typed, Google opens on that account; otherwise it lets the person choose
      provider.setCustomParameters(loginHint ? { login_hint: loginHint } : { prompt: 'select_account' });
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
