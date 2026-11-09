import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Brand } from '../components/Brand';
import { ControlScene } from '../components/ControlScene';
import { Reveal } from '../components/Reveal';
import { authMessage, EmailStatus } from '../firebase/useAuth';
import { colors as c, desktopBreakpoint, fontFamily, radius, spacing, type } from '../theme';
import { motion, useReducedMotion } from '../theme/motion';
import { useViewportHeight } from '../theme/viewport';
import { t, usePrefsVersion } from '../i18n';

/** Sober sign-in tones: refined accent blue (no neon) and a deeper shade for hover. */
const BLUE = c.primary;
const BLUE_DEEP = '#2447BD';
const NAVY = c.sidebar;
const NAVY_DEEP = '#0E2240';


export function Splash() {
  return (
    <View style={[s.splash, { backgroundColor: c.bg }]}>
      <View style={s.logoRow}>
        <Brand size={30} color={c.text} />
      </View>
      <ActivityIndicator color={BLUE} />
    </View>
  );
}

/** Google logo (official brand colors). */
function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <Path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <Path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <Path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </Svg>
  );
}

/** Bands the 3D artwork keeps free, full width: nothing spawns beside the logotype and headline either. */
const avoidDesktopText = (w: number, _h: number) => [{ l: 0, t: 0, r: w, b: 270 }];
const avoidMobileText = (w: number, h: number) => [{ l: 0, r: w, t: h / 2 - 78, b: h / 2 + 78 }];

/** Brand panel (left on desktop): brand on top, headline with breathing room and the 3D artwork only at the bottom. */
function BrandPanel() {
  return (
    <LinearGradient colors={[NAVY, NAVY_DEEP]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.brand}>
      {/* very soft ambient glow rising from the bottom */}
      <LinearGradient pointerEvents="none" colors={['rgba(61,101,235,0)', 'rgba(61,101,235,0.20)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={[s.glow, { height: '55%' }]} />
      {/* 3D artwork (web): faint floating coins over the whole panel, clear of the text */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <ControlScene avoid={avoidDesktopText} />
      </View>
      {/* dark fade at the base: the coins sink into the background */}
      <LinearGradient pointerEvents="none" colors={['rgba(14,34,64,0)', 'rgba(14,34,64,0.96)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={[s.glow, { height: '42%' }]} />
      <View style={{ gap: 40 }}>
        <Reveal distance={6} duration={700}>
          <View style={s.logoRow}>
            <Brand size={34} />
          </View>
        </Reveal>
        <Reveal index={2} distance={6} duration={700}>
          <Text style={s.headline}>{t('Control your money.')}{'\n'}{t("Don't let it control you.")}</Text>
        </Reveal>
      </View>
    </LinearGradient>
  );
}

/**
 * Mobile blue panel: takes the leftover space and shrinks to a minimum so the white form
 * sheet can rise and never get cut off; without room, the background chart disappears instead of crossing the text.
 */
function MobilePanel({ tight }: { tight: boolean }) {
  const [panelH, setPanelH] = useState(0);
  const showChart = panelH === 0 || panelH >= 250;
  return (
    <LinearGradient colors={[NAVY, NAVY_DEEP]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.mobilePanel, tight && s.mobilePanelTight]} onLayout={(e) => setPanelH(e.nativeEvent.layout.height)}>
      {showChart && (
        <>
          <LinearGradient pointerEvents="none" colors={['rgba(61,101,235,0)', 'rgba(61,101,235,0.20)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={[s.glow, { height: 130 }]} />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill]}>
            <ControlScene avoid={avoidMobileText} spacing={100} />
          </View>
          <LinearGradient pointerEvents="none" colors={['rgba(14,34,64,0)', 'rgba(14,34,64,0.96)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={[s.glow, { height: '45%' }]} />
        </>
      )}
      {/* brand and headline centered horizontally and vertically in the visible panel area */}
      <View style={{ gap: tight ? spacing.md : spacing.lg, alignItems: 'center' }}>
        <Reveal distance={6} duration={700}>
          <View style={s.logoRow}>
            <Brand size={30} />
          </View>
        </Reveal>
        <Reveal index={2} distance={6} duration={700}>
          <Text style={[s.headline, { fontSize: tight ? 20 : 22, lineHeight: tight ? 27 : 30, textAlign: 'center' }]}>{t('Control your money.')}{'\n'}{t("Don't let it control you.")}</Text>
        </Reveal>
      </View>
    </LinearGradient>
  );
}

interface FieldProps extends TextInputProps {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  error?: boolean;
  /** error text shown on the label row, at the right (no extra height, so nothing moves or gets crowded) */
  message?: string;
  messageColor?: string;
  /** right-side button (e.g. show/hide password) */
  right?: React.ReactNode;
  inputRef?: React.Ref<React.ComponentRef<typeof TextInput>>;
}

/** Sign-in field: discreet icon, border that changes color and a slight glow on focus (160ms transition). */
function AuthField({ label, icon, error, message, messageColor, right, inputRef, ...rest }: FieldProps) {
  const reduced = useReducedMotion();
  const focus = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (reduced) {
      focus.setValue(focused ? 1 : 0);
      return;
    }
    Animated.timing(focus, { toValue: focused ? 1 : 0, duration: 160, easing: motion.ease, useNativeDriver: false }).start();
  }, [focused, focus, reduced]);
  const accent = error ? c.expense : BLUE;
  const borderColor = focus.interpolate({ inputRange: [0, 1], outputRange: [error ? c.expense : 'rgba(15,27,51,0.12)', accent] });
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={s.labelRow}>
        <Text style={[type.label, { color: c.text }]}>{label}</Text>
        {message ? <Text numberOfLines={1} style={[type.body, { color: messageColor ?? c.expense, flexShrink: 1, textAlign: 'right' }]} accessibilityLiveRegion="polite">{message}</Text> : null}
      </View>
      <Animated.View
        style={[
          s.field,
          { borderColor, backgroundColor: focused ? '#FFFFFF' : c.bg, shadowColor: accent, shadowOpacity: focus.interpolate({ inputRange: [0, 1], outputRange: [0, 0.22] }) as any, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
          Platform.OS === 'web' && ({ transitionProperty: 'background-color', transitionDuration: '160ms' } as object),
        ]}
      >
        <Feather name={icon} size={20} color={focused ? accent : c.textMuted} />
        <TextInput
          {...rest}
          ref={inputRef}
          accessibilityLabel={label}
          placeholderTextColor={c.textMuted}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[type.body, s.input, { color: c.text }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
        />
        {right}
      </Animated.View>
    </View>
  );
}

interface LoginProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string, name: string) => Promise<void>;
  onReset: (email: string) => Promise<void>;
  /** sign in with Google (web): creates the account automatically if it does not exist yet */
  onGoogle: (email?: string) => Promise<void>;
  /** whether the email already has an account (password, Google only) or is new */
  onCheckEmail: (email: string) => Promise<EmailStatus>;
}

/** Where the email-first flow is: nothing typed yet, checking, known account, Google-only account or new account. */
type Step = 'idle' | 'checking' | 'exists' | 'google' | 'new';
const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function LoginScreen({ onSignIn, onSignUp, onReset, onGoogle, onCheckEmail }: LoginProps) {
  usePrefsVersion(); // re-render when the language changes
  const { width } = useWindowDimensions();
  // the page height the app really has (the install banner, when shown, takes part of the window)
  const height = useViewportHeight();
  const desktop = width >= desktopBreakpoint;
  /** short phone: compacts to fit without scrolling */
  const tight = !desktop && height < 780;
  /** very short phone: also hides the "or" divider to fit without scrolling */
  const tiny = !desktop && height < 700;
  const [content, setContent] = useState(0);
  const [layoutH, setLayoutH] = useState(0);
  const reduced = useReducedMotion();
  // the login's navy panel reaches the top of the phone: the browser's top color is navy only while it is shown
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const meta = document.querySelector('meta[name="theme-color"]');
    const prevMeta = meta?.getAttribute('content') ?? null;
    const prevBg = document.documentElement.style.backgroundColor;
    meta?.setAttribute('content', NAVY);
    document.documentElement.style.backgroundColor = NAVY;
    document.body.classList.add('on-login');
    return () => {
      document.body.classList.remove('on-login');
      if (prevMeta) meta?.setAttribute('content', prevMeta);
      document.documentElement.style.backgroundColor = prevBg;
    };
  }, []);
  const [step, setStep] = useState<Step>('idle');
  const [fieldH, setFieldH] = useState(84);
  const [contentH, setContentH] = useState(0);
  const creating = step === 'new';
  const request = useRef(0);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const confirmRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const passwordRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const nameRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [gHover, setGHover] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  /** quick, subtle horizontal shake on error */
  const fail = (msg: string) => {
    setError(msg);
    setInfo('');
    if (reduced) return;
    shake.setValue(0);
    Animated.sequence([-6, 6, -4, 4, -2, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 55, easing: motion.ease, useNativeDriver: Platform.OS !== 'web' }))).start();
  };

  /** asks whether the email has an account and moves the flow forward */
  const check = async (value: string, id: number) => {
    setStep('checking');
    try {
      const found = await onCheckEmail(value);
      if (id !== request.current) return;
      setStep(found === 'password' ? 'exists' : found === 'google' ? 'google' : 'new');
      // an email that belongs to a Google account signs in with Google right away, no extra click
      if (found === 'google') void google(value);
    } catch (e) {
      if (id !== request.current) return;
      setStep('idle');
      fail(authMessage(e));
    }
  };

  const changeEmail = (value: string) => {
    request.current++; // a check still in flight is for the old email: ignore its answer
    setEmail(value);
    setConfirm('');
    setStep('idle');
    setError('');
    setInfo('');
  };

  const submit = async () => {
    if (busy || step === 'checking') return;
    const value = email.trim();
    if (!EMAIL_RE.test(value)) return fail(t('Enter a valid email.'));
    if (step === 'idle') return check(value, ++request.current);
    if (step === 'google') return google(value);
    if (creating && !name.trim()) return fail(t('Enter your name.'));
    if (!password) return fail(creating ? t('Choose a password.') : t('Enter your password.'));
    if (creating && confirm !== password) return fail(confirm ? t('The passwords do not match.') : t('Repeat the password to confirm it.'));
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await (creating ? onSignUp(value, password, name) : onSignIn(value, password));
    } catch (e) {
      fail(authMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const google = async (hint?: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await onGoogle(hint);
    } catch (e) {
      const msg = authMessage(e);
      if (msg) fail(msg); // closing the Google window is not an error
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (busy) return;
    if (!EMAIL_RE.test(email.trim())) return fail(t('Enter your email to receive the link.'));
    setBusy(true);
    try {
      await onReset(email);
      setError('');
      setInfo(t('We sent a reset link to {email}.', { email: email.trim() }));
    } catch (e) {
      fail(authMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // The box keeps the size of its tallest step (email + password + repeat) and the content sits
  // centered inside it: no layout shift between steps, no big empty gaps between items.
  const gap = tight ? spacing.md : spacing.lg;
  const emailErr = !!error && !email.trim();
  const nameErr = !!error && creating && !name.trim();
  const passwordErr = !!error && !password;
  const confirmErr = !!error && (!confirm || confirm !== password);
  // the message goes on the label row of the field it is about; one that is about none goes on the last visible field
  const note = error || info;
  const target: 'email' | 'name' | 'password' | 'confirm' | null = !note ? null : emailErr ? 'email' : nameErr ? 'name' : passwordErr ? 'password' : confirmErr ? 'confirm' : step === 'new' ? 'confirm' : step === 'exists' ? 'password' : 'email';
  const extra = fieldH + gap;
  const baseH = useRef(0);
  if (contentH > 0 && step !== 'google') baseH.current = contentH - (step === 'exists' ? extra : step === 'new' ? 3 * extra : 0);
  const boxMin = baseH.current > 0 ? baseH.current + 3 * extra : undefined;

  // Phone: no fixed size, the white box follows its content and the height change is animated. (The desktop
  // card keeps the size of its tallest step, above.)
  const animH = useRef(new Animated.Value(0)).current;
  const [measured, setMeasured] = useState(false);
  useEffect(() => {
    if (desktop || contentH <= 0) return;
    if (!measured || reduced) {
      animH.setValue(contentH);
      setMeasured(true);
    } else Animated.timing(animH, { toValue: contentH, duration: 260, easing: motion.ease, useNativeDriver: false }).start();
  }, [contentH, desktop, reduced]);
  const Box: any = desktop ? View : Animated.View;
  const boxStyle = desktop ? { minHeight: boxMin, justifyContent: 'center' as const } : measured ? { height: animH, overflow: 'hidden' as const } : undefined;

  const form = (
    <Animated.View style={[s.form, desktop && s.formDesktop, { transform: [{ translateX: shake }] }]}>
     <Box style={boxStyle}>
      <View style={[s.form, tight && { gap: spacing.md }, !desktop && measured && { position: 'absolute', left: 0, right: 0, top: 0 }]} onLayout={(e) => setContentH(e.nativeEvent.layout.height)}>
      {/* title and subtitle on desktop only: on mobile the blue panel already shows the brand and the button indicates the mode */}
      {desktop && (
        <Reveal index={1} distance={6} duration={600}>
          <View style={{ gap: spacing.xs }}>
            <Text style={s.title}>{creating ? t('Create your account') : step === 'exists' || step === 'google' ? t('Welcome back') : t('Welcome')}</Text>
            <Text style={[type.body, { color: c.textMuted, minHeight: 48 }]}>
              {creating ? t('Tell us your name and choose a password.') : step === 'exists' ? t('Enter your password to continue.') : step === 'google' ? '' : t('Enter your email to sign in or create your account.')}
            </Text>
          </View>
        </Reveal>
      )}
      <Reveal index={2} distance={6} duration={600}>
       <View onLayout={(e) => setFieldH(e.nativeEvent.layout.height)}>
        <AuthField
          label={t('Email')}
          icon="mail"
          value={email}
          onChangeText={changeEmail}
          onSubmitEditing={submit}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          maxLength={120}
          error={emailErr}
          message={target === 'email' ? note : undefined}
          messageColor={error ? c.expense : BLUE}
        />
       </View>
      </Reveal>
      {step === 'new' && (
        <Reveal distance={6} duration={400}>
          <AuthField
            label={t('Name')}
            icon="user"
            inputRef={nameRef}
            autoFocus
            value={name}
            onChangeText={setName}
            autoComplete="name"
            autoCapitalize="words"
            autoCorrect={false}
            onSubmitEditing={() => passwordRef.current?.focus()}
            returnKeyType="next"
            maxLength={40}
            error={nameErr}
            message={target === 'name' ? note : undefined}
            messageColor={error ? c.expense : BLUE}
          />
        </Reveal>
      )}
      {(step === 'exists' || step === 'new') && (
        <Reveal key={step === 'new' ? 'pw-new' : 'pw'} distance={6} duration={400}>
          <AuthField
            label={t('Password')}
            icon="lock"
            inputRef={passwordRef}
            autoFocus={!creating}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!show}
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => (creating ? confirmRef.current?.focus() : submit())}
            returnKeyType={creating ? 'next' : 'go'}
            maxLength={128}
            error={passwordErr}
            message={target === 'password' ? note : undefined}
            messageColor={error ? c.expense : BLUE}
            right={
              <Pressable accessibilityRole="button" accessibilityLabel={show ? t('Hide password') : t('Show password')} onPress={() => setShow((v) => !v)} style={s.eye}>
                <Feather name={show ? 'eye-off' : 'eye'} size={20} color={c.textMuted} />
              </Pressable>
            }
          />
        </Reveal>
      )}
      {step === 'new' && (
        <Reveal distance={6} duration={400}>
          <AuthField
            label={t('Repeat password')}
            icon="lock"
            inputRef={confirmRef}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!show}
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={submit}
            maxLength={128}
            error={confirmErr}
            message={target === 'confirm' ? note : undefined}
            messageColor={error ? c.expense : BLUE}
          />
        </Reveal>
      )}
      <Reveal index={4} distance={6} duration={600}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy }}
          disabled={busy || step === 'checking'}
          onPress={submit}
          onHoverIn={() => setHover(true)}
          onHoverOut={() => setHover(false)}
          style={({ pressed }) => [
            s.submit,
            // hover/pressed: only the background tone changes (no scale or elevation)
            { backgroundColor: pressed || hover ? BLUE_DEEP : BLUE },
            Platform.OS === 'web' && ({ transitionProperty: 'background-color', transitionDuration: '180ms', cursor: busy ? 'default' : 'pointer' } as object),
          ]}
        >
          {busy || step === 'checking' ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
          <Text style={[type.label, { color: '#FFFFFF', lineHeight: 20 }]}>
            {busy ? (creating ? t('Creating account...') : t('Signing in...')) : step === 'checking' ? t('Checking...') : creating ? t('Create account') : step === 'exists' ? t('Sign in') : step === 'google' ? t('Continue with Google') : t('Continue')}
          </Text>
          {!busy && step !== 'checking' && (
            // drawn as SVG (not an icon font): the arrow is optically centered on the label, no baseline offset
            <View style={[{ width: 18, height: 18, opacity: hover ? 1 : 0.85 }, Platform.OS === 'web' && ({ transitionProperty: 'opacity', transitionDuration: '180ms' } as object)]}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M4 12h15M13 6l6 6-6 6" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          )}
        </Pressable>
      </Reveal>
      {Platform.OS === 'web' && (
        <Reveal index={5} distance={6} duration={600}>
          <View style={{ gap: tight ? spacing.sm : spacing.md }}>
            {!tiny && (
              <View style={s.or}>
                <View style={s.orLine} />
                <Text style={[type.body, { color: c.textMuted }]}>{t('or')}</Text>
                <View style={s.orLine} />
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Continue with Google')}
              disabled={busy}
              onPress={() => google()}
              onHoverIn={() => setGHover(true)}
              onHoverOut={() => setGHover(false)}
              style={[
                s.googleBtn,
                // hover: only the background tone (no scale or elevation)
                { backgroundColor: gHover ? '#F4F7FB' : '#FFFFFF', opacity: busy ? 0.6 : 1 },
                Platform.OS === 'web' && ({ transitionProperty: 'background-color', transitionDuration: '160ms', cursor: busy ? 'default' : 'pointer' } as object),
              ]}
            >
              <GoogleMark />
              <Text style={[type.label, { color: c.text }]}>{t('Continue with Google')}</Text>
            </Pressable>
          </View>
        </Reveal>
      )}
      {step !== 'google' && (
        <Reveal index={6} distance={6} duration={600}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setError('');
              setInfo('');
              if (step === 'exists') return reset();
              setStep(step === 'new' ? 'idle' : 'new');
            }}
            style={s.link}
          >
            <Text style={[type.body, { color: c.textMuted }]}>
              {step === 'exists' ? t('Forgot your password?') : step === 'new' ? t('I already have an account.') : t('First time here?')}{' '}
              <Text style={{ color: BLUE, fontWeight: '600' }}>{step === 'exists' ? t('Reset it') : step === 'new' ? t('Sign in') : t('Create account')}</Text>
            </Text>
          </Pressable>
        </Reveal>
      )}
      </View>
     </Box>
    </Animated.View>
  );

  if (desktop) {
    return (
      <View style={[s.root, { backgroundColor: c.bg }]}>
        <StatusBar style="light" />
        <View style={s.card}>
          <View style={{ flex: 1.1 }}>
            <BrandPanel />
          </View>
          <View style={s.formSide}>{form}</View>
        </View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: NAVY }}>
      <StatusBar style="light" />
      {/* only scrolls if the content still does not fit with the panel at its minimum (e.g. keyboard open) */}
      <ScrollView
        style={{ backgroundColor: c.card }}
        contentContainerStyle={s.mobileScroll}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        onContentSizeChange={(_, h) => setContent(h)}
        onLayout={(e) => setLayoutH(e.nativeEvent.layout.height)}
        scrollEnabled={content > layoutH + 1}
      >
        <MobilePanel tight={tight} />
        <View style={[s.mobileSheet, tight && { padding: spacing.xl, paddingTop: spacing.xl }]}>{form}</View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xl },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  /** desktop: raised floating card, split into two panels */
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, overflow: 'hidden' },
  card: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: 1040,
    minHeight: 600,
    borderRadius: 32,
    overflow: 'hidden',
    backgroundColor: c.card,
    shadowColor: '#0B192C',
    shadowOpacity: 0.1,
    shadowRadius: 56,
    shadowOffset: { width: 0, height: 24 },
    elevation: 14,
  },
  brand: { flex: 1, padding: 52, justifyContent: 'flex-start', overflow: 'hidden', userSelect: 'none' },
  glow: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  chartBox: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // the headline supports the brand, it does not compete with it: smaller, lighter and in a blue-gray tone
  headline: { fontSize: 26, lineHeight: 36, fontWeight: '500', color: '#B4C3E2', fontFamily },
  formSide: { flex: 1, justifyContent: 'center', backgroundColor: c.card },
  formDesktop: { maxWidth: 400, alignSelf: 'center', paddingHorizontal: spacing.xl, paddingVertical: 48 },
  /** mobile: centered white card over the off-white background */
  mobileScroll: { flexGrow: 1 },
  // paddingBottom compensates for the white sheet that rises 28px over the panel, centering in the visible area
  mobilePanel: { flex: 1, minHeight: 168, padding: spacing.xl, paddingBottom: spacing.xl + 28, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', userSelect: 'none' },
  mobilePanelTight: { minHeight: 150, padding: spacing.lg, paddingBottom: spacing.lg + 28 },
  /** rounded white sheet that rises over the blue panel, full width */
  mobileSheet: { flexGrow: 0, flexShrink: 0, backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -28, padding: spacing.xxl, paddingTop: spacing.xxl },
  form: { gap: spacing.lg, width: '100%' },
  title: { fontSize: 28, fontWeight: '700', color: c.text, fontFamily },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, borderRadius: radius.control, borderWidth: 1.5, paddingHorizontal: spacing.lg },
  input: { flex: 1, minHeight: 48 },
  eye: { width: 44, height: 44, marginRight: -spacing.sm, alignItems: 'center', justifyContent: 'center' },
  submit: { minHeight: 54, borderRadius: radius.control, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  or: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  orLine: { flex: 1, height: 1, backgroundColor: 'rgba(15,27,51,0.1)' },
  googleBtn: { minHeight: 52, borderRadius: radius.control, borderWidth: 1.5, borderColor: 'rgba(15,27,51,0.14)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  /** one-line message laid over the gap between the last field and the button */
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
});
