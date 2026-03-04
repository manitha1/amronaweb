import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';

export default function Login() {
    const navigate = useNavigate();
    const { signIn } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSignUp, setIsSignUp] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (isSignUp) {
                const { error } = await supabase.auth.signUp({ email, password });
                if (error) throw error;
                toast.success('Check your email for the confirmation link!');
            } else {
                const { error } = await signIn(email, password);
                if (error) throw error;
                toast.success('Welcome back!');
                navigate('/');
            }
        } catch (error) {
            toast.error(error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDemoLogin = (type) => {
        setEmail(type === 'admin' ? 'admin@amrona.local' : 'user@amrona.local');
        setPassword('password123');
    };

    return (
        <div className="login-container">

            {/* ── LEFT BRAND PANEL ── */}
            <div className="login-left">
                <div className="login-brand">
                    <img src="/src/assests/logo.png.png" alt="Amrona Logo" />
                    <h1>Amrona Inventory</h1>
                    <p>
                        Smart spice manufacturing &amp; inventory management for your growing business.
                    </p>
                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '2rem', flexWrap: 'wrap' }}>
                        {['Purchase Tracking', 'Production Control', 'Sales Management', 'Stock Reports'].map(f => (
                            <span key={f} style={{
                                background: 'rgba(255,255,255,0.12)',
                                border: '1px solid rgba(255,255,255,0.2)',
                                borderRadius: 999, padding: '0.3rem 0.85rem',
                                fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.9)'
                            }}>{f}</span>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── RIGHT LOGIN FORM ── */}
            <div className="login-right">
                <div className="login-card">
                    <div className="login-header">
                        <h2>{isSignUp ? 'Create Account' : 'Sign in'}</h2>
                        <p>{isSignUp ? 'Fill in your details to get started.' : 'Enter your credentials to continue.'}</p>
                    </div>

                    <form onSubmit={handleSubmit} className="login-form">
                        <div className="form-group">
                            <label>Email address</label>
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                                placeholder="admin@amrona.local"
                            />
                        </div>
                        <div className="form-group">
                            <label>Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                placeholder="••••••••"
                            />
                        </div>

                        <button type="submit" disabled={loading} className="login-submit-btn">
                            {loading ? 'Please wait...' : (isSignUp ? 'Create Account' : 'Sign In →')}
                        </button>

                        <div className="login-toggle">
                            <button type="button" onClick={() => setIsSignUp(!isSignUp)} className="btn-link">
                                {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
                            </button>
                        </div>
                    </form>

                    <div className="demo-credentials">
                        <p><strong>Quick Demo Access</strong></p>
                        <div className="demo-buttons">
                            <button type="button" className="btn-outline" onClick={() => handleDemoLogin('admin')}>
                                Fill Admin
                            </button>
                            <button type="button" className="btn-outline" onClick={() => handleDemoLogin('user')}>
                                Fill User
                            </button>
                        </div>
                        <p className="help-text">Real auth requires a configured Supabase project.</p>
                    </div>
                </div>
            </div>

        </div>
    );
}
