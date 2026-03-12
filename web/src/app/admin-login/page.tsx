'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    Mail, Lock, ShieldCheck, ArrowLeft, TrendingUp, Clock, CheckCircle
} from 'lucide-react';
import s from './admin-login.module.css';

import { signIn } from 'next-auth/react';

export default function AdminLoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    
    // --- Pending Approval State ---
    const [isPending, setIsPending] = useState(false);
    const [isApproved, setIsApproved] = useState(false);
    const [pendingEmail, setPendingEmail] = useState('');

    // Check for email in URL (from register redirect)
    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        const emailParam = searchParams.get('email');
        const statusParam = searchParams.get('status');
        if (emailParam && statusParam === 'pending') {
            setPendingEmail(emailParam);
            setIsPending(true);
        }
    }, []);

    // Debug tool for owner to test mailer
    const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const isDebug = searchParams?.get('debug') === '1';
    const [testResult, setTestResult] = useState('');

    const runMailTest = async () => {
        setTestResult('Sending...');
        try {
            const res = await fetch('/api/debug/test-mail?secret=jaswanth-secret-123');
            const data = await res.json();
            setTestResult(data.success ? 'Success! Check your inbox.' : `Failed: ${data.error}`);
        } catch (e) {
            setTestResult('Error: API not responding');
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const result = await signIn('credentials', {
                redirect: false,
                email: email.toLowerCase().trim(),
                password,
                role: 'admin'
            });

            if (result?.error) {
                if (result.error.includes('PENDING_APPROVAL')) {
                    setPendingEmail(email.toLowerCase().trim());
                    setIsPending(true);
                } else {
                    setError('Invalid admin credentials.');
                }
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

    // --- Polling for Approval ---
    useEffect(() => {
        if (isPending && pendingEmail && !isApproved) {
            const interval = setInterval(async () => {
                try {
                    const res = await fetch(`/api/auth/status?email=${encodeURIComponent(pendingEmail)}`);
                    const data = await res.json();
                    if (data.status === 'approved') {
                        setIsApproved(true);
                        clearInterval(interval);
                        
                        // Wait 2s for visual feedback then attempt final login (if password available) or just refresh
                        setTimeout(async () => {
                            if (password) {
                                // Re-run login automatically since we have the password in state
                                handleLogin(new Event('submit') as any);
                            } else {
                                // If they refreshed, they'll need to type password once to confirm
                                // but the UI already says approved
                                router.push('/');
                                router.refresh();
                            }
                        }, 2000);
                    }
                } catch (e) {
                    console.error("Polling error:", e);
                }
            }, 5000);
            return () => clearInterval(interval);
        }
    }, [isPending, pendingEmail, isApproved, password]);

    if (isPending) {
        return (
            <div className={s.loginContainer}>
                <div style={{ maxWidth: '480px', margin: '40px auto', padding: '24px' }}>
                    <div style={{
                        background: '#fff',
                        borderRadius: '20px',
                        overflow: 'hidden',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
                        position: 'relative'
                    }}>
                        <button
                            onClick={() => setIsPending(false)}
                            style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                        >
                            <ArrowLeft size={20} />
                        </button>

                        <div style={{
                            background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                            padding: '28px',
                            textAlign: 'center'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                                <TrendingUp size={28} color="#ef4444" />
                                <span style={{ color: '#fff', fontSize: '22px', fontWeight: 800 }}>StockTrack</span>
                            </div>
                            <p style={{ color: '#94a3b8', margin: '6px 0 0', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase' }}>Admin Portal</p>
                        </div>

                        <div style={{ padding: '40px 32px', textAlign: 'center' }}>
                            <div style={{
                                width: '72px', height: '72px',
                                borderRadius: '50%',
                                background: isApproved ? '#f0fdf4' : '#fef3c7',
                                border: `3px solid ${isApproved ? '#bbf7d0' : '#fde68a'}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto 24px'
                            }}>
                                {isApproved ? <CheckCircle size={36} color="#16a34a" /> : <Clock size={36} color="#f59e0b" />}
                            </div>

                            <h2 style={{ color: '#0f172a', fontSize: '22px', fontWeight: 700, margin: '0 0 12px' }}>
                                {isApproved ? 'Access Granted!' : 'Awaiting Approval'}
                            </h2>
                            <p style={{ color: '#64748b', fontSize: '14px', lineHeight: 1.7, margin: '0 0 28px' }}>
                                {isApproved ? (
                                    <>Your account has been approved!<br />Redirecting you to the dashboard...</>
                                ) : (
                                    <>Account <strong>{pendingEmail}</strong> is awaiting approval.<br />
                                    An approval request is pending from the system owner.<br />
                                    You will be redirected automatically once approved.</>
                                )}
                            </p>

                            <div style={{
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                borderRadius: '12px',
                                padding: '16px 20px',
                                marginBottom: '28px',
                                textAlign: 'left'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                    <CheckCircle size={16} color="#16a34a" />
                                    <span style={{ color: '#475569', fontSize: '13px' }}>Credentials verified</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {isApproved ? <CheckCircle size={16} color="#16a34a" /> : <Clock size={16} color="#f59e0b" />}
                                    <span style={{ color: '#475569', fontSize: '13px' }}>{isApproved ? 'Approved by owner' : 'Waiting for owner approval…'}</span>
                                </div>
                            </div>

                            {!isApproved && (
                                <button
                                    onClick={() => setIsPending(false)}
                                    style={{
                                        width: '100%',
                                        padding: '13px',
                                        background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '10px',
                                        fontWeight: 700,
                                        fontSize: '14px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Try Different Login
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

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

                        {/* Debug tool */}
                        {isDebug && (
                            <div style={{ marginTop: '20px', padding: '15px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                                <p style={{ fontSize: '12px', color: '#64748b', margin: '0 10px 10px 0' }}>Mailer Diagnostic Tool</p>
                                <button
                                    onClick={runMailTest}
                                    style={{ width: '100%', padding: '8px', background: '#334155', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                                >
                                    {testResult || 'Send Test Email to Owner'}
                                </button>
                            </div>
                        )}

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
