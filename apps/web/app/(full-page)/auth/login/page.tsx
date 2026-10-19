'use client';
import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import {
    ArrowRight,
    CircleAlert,
    CircleHelp,
    Eye,
    EyeOff,
    FolderOpen,
    Info,
    LayoutGrid,
    Lock,
    Mail,
    ShieldCheck
} from 'lucide-react';
import { Button, Input, Spinner, cn } from '@itrms/ui';
import { useAuthStore } from '@/lib/auth/authStore';
import { getApiErrorMessage } from '@/lib/api/errors';
import styles from './login.module.css';

/** The `next` target if it stays on this origin, else '/'. The URL parser catches `/\host` and other forms a prefix check misses. */
function sameOriginPath(next: string | null): string {
    if (!next) return '/';
    let url: URL;
    try {
        url = new URL(next, window.location.origin);
    } catch (e) {
        if (e instanceof TypeError) return '/';
        throw e;
    }
    return url.origin === window.location.origin ? url.pathname + url.search + url.hash : '/';
}

// Kept together so the screen can be localised later (LocalizationProvider is not mounted at the root yet).
const copy = {
    product: 'Digital File Cabinet',
    headline: 'Every form, file and submission in one place.',
    lede: 'Design dynamic forms, collect structured data and keep the paperwork behind it organised and auditable.',
    features: [
        {
            icon: LayoutGrid,
            title: 'Build forms visually',
            text: 'Drag-and-drop templates with repeating records and live calculations.'
        },
        { icon: FolderOpen, title: 'Files stay attached', text: 'Uploads travel with the submission they belong to.' },
        {
            icon: ShieldCheck,
            title: 'Secure by default',
            text: 'Per-tenant isolation, role-based access and a full audit trail.'
        }
    ],
    footer: 'Secure workspace sign-in',
    title: 'Welcome back',
    subtitle: 'Sign in to your workspace to continue.',
    email: 'Email',
    emailPlaceholder: 'you@company.com',
    password: 'Password',
    passwordPlaceholder: 'Enter your password',
    show: 'Show password',
    hide: 'Hide password',
    capsLock: 'Caps Lock is on',
    submit: 'Sign in',
    submitting: 'Signing in…',
    failed: 'Sign in failed',
    help: 'Forgot your password or need access? Contact your workspace administrator.'
};

const INPUT = 'h-12 rounded-xl pl-10 text-base';

const BrandMark = ({ height = 34 }: { height?: number }) => (
    <span className={styles.logo} style={{ height, width: height * 1.35 }} aria-hidden="true" />
);

const LoginPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [capsLock, setCapsLock] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const login = useAuthStore((s) => s.login);
    const router = useRouter();

    const signIn = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (submitting) return;
        setError(null);
        setSubmitting(true);
        try {
            await login(email.trim(), password);
            // Same-origin targets only: the URL parser also catches `/\host` and other forms a prefix check misses.
            router.replace(sameOriginPath(new URLSearchParams(window.location.search).get('next')));
        } catch (err) {
            setError(getApiErrorMessage(err, copy.failed));
            setSubmitting(false);
        }
    };

    const trackCapsLock = (e: React.KeyboardEvent) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);

    return (
        <div className={styles.shell}>
            <aside className={styles.brand}>
                <div className={styles.brandMark}>
                    <BrandMark />
                    {copy.product}
                </div>

                <div>
                    <h2 className={styles.headline}>{copy.headline}</h2>
                    <p className={styles.lede}>{copy.lede}</p>
                    <ul className={styles.features}>
                        {copy.features.map((f) => (
                            <li key={f.title} className={styles.feature}>
                                <span className={styles.featureIcon}>
                                    <f.icon className="size-4" aria-hidden="true" />
                                </span>
                                <span>
                                    <span className={styles.featureTitle}>{f.title}</span>
                                    <span className={styles.featureText}>{f.text}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className={styles.brandFooter}>{copy.footer}</div>
            </aside>

            <main className={styles.formPanel}>
                <div className={styles.formWrap}>
                    <div className={styles.mobileBrand}>
                        <BrandMark height={32} />
                        <span>{copy.product}</span>
                    </div>

                    <h1 className={styles.title}>{copy.title}</h1>
                    <p className={styles.subtitle}>{copy.subtitle}</p>

                    <form onSubmit={signIn} noValidate>
                        <div aria-live="polite">
                            {error && (
                                <div className={styles.alert} role="alert" id="login-error">
                                    <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                                    <span>{error}</span>
                                </div>
                            )}
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="email1" className={styles.label}>
                                {copy.email}
                            </label>
                            <div className={styles.control}>
                                <Mail className={cn('size-4', styles.controlIcon)} aria-hidden="true" />
                                <Input
                                    id="email1"
                                    type="email"
                                    autoComplete="username"
                                    autoFocus
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder={copy.emailPlaceholder}
                                    className={INPUT}
                                    aria-invalid={!!error}
                                    aria-describedby={error ? 'login-error' : undefined}
                                />
                            </div>
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="password1" className={styles.label}>
                                {copy.password}
                            </label>
                            <div className={styles.control}>
                                <Lock className={cn('size-4', styles.controlIcon)} aria-hidden="true" />
                                <Input
                                    id="password1"
                                    type={showPassword ? 'text' : 'password'}
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    onKeyUp={trackCapsLock}
                                    onKeyDown={trackCapsLock}
                                    onBlur={() => setCapsLock(false)}
                                    placeholder={copy.passwordPlaceholder}
                                    className={cn(INPUT, 'pr-12')}
                                    aria-invalid={!!error}
                                    aria-describedby={error ? 'login-error' : undefined}
                                />
                                <button
                                    type="button"
                                    className={styles.toggle}
                                    onClick={() => setShowPassword((v) => !v)}
                                    aria-label={showPassword ? copy.hide : copy.show}
                                    aria-pressed={showPassword}
                                >
                                    {showPassword ? (
                                        <EyeOff className="size-4" aria-hidden="true" />
                                    ) : (
                                        <Eye className="size-4" aria-hidden="true" />
                                    )}
                                </button>
                            </div>
                            {capsLock && (
                                <div className={styles.hint} role="status">
                                    <Info className="size-4" aria-hidden="true" />
                                    {copy.capsLock}
                                </div>
                            )}
                        </div>

                        <Button
                            type="submit"
                            className="mt-2 h-12 w-full rounded-xl text-base font-semibold"
                            disabled={submitting || !email || !password}
                        >
                            {submitting ? <Spinner /> : null}
                            {submitting ? copy.submitting : copy.submit}
                            {submitting ? null : <ArrowRight />}
                        </Button>
                    </form>

                    <div className={styles.help}>
                        <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <span>{copy.help}</span>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default LoginPage;
