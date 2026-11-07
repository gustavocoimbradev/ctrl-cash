// Web: the session lives in the browser's IndexedDB/localStorage (SDK default).
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { app, useEmulator } from './app';

export const auth = getAuth(app);
if (useEmulator) connectAuthEmulator(auth, 'http://127.0.0.1:19099', { disableWarnings: true });
