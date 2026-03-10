'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    Mail, Lock, ShieldCheck, ArrowLeft, TrendingUp
} from 'lucide-react';
import s from './admin-login.module.css';

import { signIn } from 'next-auth/react';

export default function AdminLoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const result = await signIn('credentials', {
                redirect: false,
                email,
                password,
            });

            if (result?.error) {
                setError('Invalid admin credentials.');
            } else {
                router.push('/');
                router.refresh();
            }
        } catch (err: any) {
            setError('An error occurred during sign in.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={s.loginContainer}>
            <div className={s.loginWrapper}>
                {/* Left Section: Branding & Graphics (Consistent with User Login) */}
                <div className={s.brandSection}>
                    <div className={s.dotsGrid}>
                        {[...Array(25)].map((_, i) => <div key={i} className={s.dot} />)}
                    </div>
                    <div className={s.pillShape} />
                    <div className={s.circleLarge} />
                    <div className={s.circleSmall}>
                        <div className={s.circleSmallInner} />
                    </div>

                    <div className={s.floatingDot} style={{ top: '20%', left: '10%', background: '#ff6b6b' }} />
                    <div className={s.floatingDot} style={{ bottom: '15%', right: '15%', background: '#ff9f43' }} />

                    <div className={s.contentBox}>
                        <h1 className={s.brandTitle}>
                            ADMIN <br /> PORTAL
                        </h1>
                        <p className={s.brandSubtitle}>
                            Secure access to the StockTrack engine. authorized personnel only.
                        </p>
                    </div>
                </div>

                {/* Right Section: Auth Form (Matches Image) */}
                <div className={s.formSection}>
                    <button
                        onClick={() => router.push('/login')}
                        style={{ position: 'absolute', top: '24px', right: '24px', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                    >
                        <ArrowLeft size={20} />
                    </button>

                    <div className={s.logoWrapper}>
                        <div className={s.appLogo}>
                            <TrendingUp size={32} color="#d93025" strokeWidth={3} />
                        </div>
                        <h2 className={s.welcomeText}>Admin Login</h2>
                    </div>

                    <form onSubmit={handleLogin} className={s.form}>
                        <div className={s.inputGroup}>
                            <label className={s.label}>Admin Email</label>
                            <div className={s.inputWrapper}>
                                <Mail size={18} className={s.inputIcon} />
                                <input
                                    type="email"
                                    className={s.input}
                                    placeholder="admin@stocktrack.com"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div className={s.inputGroup}>
                            <label className={s.label}>Password</label>
                            <div className={s.inputWrapper}>
                                <Lock size={18} className={s.inputIcon} />
                                <input
                                    type="password"
                                    className={s.input}
                                    placeholder="Enter password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div className={s.formOptions}>
                            <label className={s.checkboxLabel}>
                                <input type="checkbox" style={{ accentColor: '#d93025' }} />
                                Remember me
                            </label>
                            <a href="#" className={s.forgotLink}>Reset Password!</a>
                        </div>

                        {error && <p className={s.error}>{error}</p>}

                        <button type="submit" className={s.primaryButton} disabled={loading}>
                            {loading ? 'Processing...' : 'Verify Credentials'}
                        </button>
                    </form>

                    <div className={s.adminSection}>
                        <button
                            type="button"
                            className={s.adminButton}
                            onClick={() => router.push('/register')}
                        >
                            Create Account
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
