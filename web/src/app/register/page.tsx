'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    Mail, Lock, User, TrendingUp, ArrowLeft, Clock, CheckCircle, XCircle
} from 'lucide-react';
import s from './register.module.css';

export default function RegisterPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<'form' | 'pending'>('form');

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            setLoading(false);
            return;
        }

        if (password.length < 6) {
            setError('Password must be at least 6 characters');
            setLoading(false);
            return;
        }

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim() || email.split('@')[0],
                    email: email.toLowerCase().trim(),
                    password,
                    role: 'admin'
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.message || 'Registration failed');
                setLoading(false);
                return;
            }

            // Registration successful — show pending approval screen
            setStatus('pending');
        } catch (err: any) {
            setError('An unexpected error occurred. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // --- Polling for status ---
    const [isApproved, setIsApproved] = useState(false);
    
    useEffect(() => {
        if (status === 'pending') {
            const interval = setInterval(async () => {
                try {
                    const res = await fetch(`/api/auth/status?email=${encodeURIComponent(email)}`);
                    const data = await res.json();
                    if (data.status === 'approved') {
                        setIsApproved(true);
                        clearInterval(interval);
                        setTimeout(() => {
                            router.push('/');
                        }, 2000);
                    }
                } catch (e) {
                    console.error("Polling error:", e);
                }
            }, 5000);
            return () => clearInterval(interval);
        }
    }, [status, email, router]);

    // Registration successful — show pending approval screen
    if (status === 'pending') {
        return (
            <div className={s.loginContainer}>
                <div style={{ maxWidth: '480px', margin: '40px auto', padding: '24px' }}>
                    <div style={{
                        background: '#fff',
                        borderRadius: '20px',
                        overflow: 'hidden',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
                    }}>
                        {/* Header */}
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

                        {/* Body */}
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
                                    <>Your account has been created successfully!<br />
                                    An approval request has been sent to the <strong>system owner</strong>.<br />
                                    You will receive access once your request is approved.</>
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
                                    <span style={{ color: '#475569', fontSize: '13px' }}>Account created</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                    <CheckCircle size={16} color="#16a34a" />
                                    <span style={{ color: '#475569', fontSize: '13px' }}>Approval email sent to owner</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {isApproved ? <CheckCircle size={16} color="#16a34a" /> : <Clock size={16} color="#f59e0b" />}
                                    <span style={{ color: '#475569', fontSize: '13px' }}>{isApproved ? 'Approved by owner' : 'Waiting for owner approval…'}</span>
                                </div>
                            </div>

                            {!isApproved && (
                                <button
                                    onClick={() => router.push('/admin-login')}
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
                                    Back to Login
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // --- Registration Form ---
    return (
        <div className={s.loginContainer}>
            <div className={s.loginWrapper}>
                <div className={s.formSection}>
                    <button
                        onClick={() => router.push('/admin-login')}
                        style={{ position: 'absolute', top: '24px', right: '24px', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                    >
                        <ArrowLeft size={20} />
                    </button>

                    <div className={s.logoWrapper}>
                        <div className={s.appLogo}>
                            <TrendingUp size={32} color="#d93025" strokeWidth={3} />
                        </div>
                        <h2 className={s.welcomeText}>Create Admin Account</h2>
                        <p style={{ color: '#94a3b8', fontSize: '12px', margin: '4px 0 0', textAlign: 'center' }}>
                            Requires owner approval to access the system
                        </p>
                    </div>

                    <form onSubmit={handleRegister}>
                        <div className={s.inputGroup}>
                            <label className={s.label}>Full Name</label>
                            <div className={s.inputWrapper}>
                                <User size={18} className={s.inputIcon} />
                                <input
                                    type="text"
                                    className={s.input}
                                    placeholder="Enter your name"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div className={s.inputGroup}>
                            <label className={s.label}>Email Address</label>
                            <div className={s.inputWrapper}>
                                <Mail size={18} className={s.inputIcon} />
                                <input
                                    type="email"
                                    className={s.input}
                                    placeholder="Enter your email"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div className={s.inputGroup}>
                            <label className={s.label}>New Password</label>
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

                        <div className={s.inputGroup}>
                            <label className={s.label}>Confirm Password</label>
                            <div className={s.inputWrapper}>
                                <Lock size={18} className={s.inputIcon} />
                                <input
                                    type="password"
                                    className={s.input}
                                    placeholder="Repeat password"
                                    value={confirmPassword}
                                    onChange={e => setConfirmPassword(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        {error && <p className={s.error}>{error}</p>}

                        <button type="submit" className={s.primaryButton} disabled={loading}>
                            {loading ? 'Sending Request...' : 'Request Admin Access'}
                        </button>
                    </form>

                    <div className={s.loginSection}>
                        <button
                            type="button"
                            className={s.loginButton}
                            onClick={() => router.push('/admin-login')}
                        >
                            Back to Login
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
