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
                // Since we want admin/user roles, let's allow signup for demo
                const { error } = await supabase.auth.signUp({ email, password });
                if (error) throw error;
                toast.success('Check your email for the confirmation link!');
            } else {
                const { error } = await signIn(email, password);
                if (error) throw error;
                toast.success('Logged in successfully!');
                navigate('/');
            }
        } catch (error) {
            toast.error(error.message);
        } finally {
            setLoading(false);
        }
    };

    // Demo Login helper
    const handleDemoLogin = (type) => {
        setEmail(type === 'admin' ? 'admin@amrona.local' : 'user@amrona.local');
        setPassword('password123');
    }

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <h2>Amrona Inventory</h2>
                    <p>Login to access the system</p>
                </div>

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="form-group">
                        <label>Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            placeholder="admin@amrona.local"
                        />
                    </div>
                    <div className="form-group">
                        <label>Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            placeholder="••••••••"
                        />
                    </div>

                    <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                        {loading ? 'Processing...' : (isSignUp ? 'Sign Up' : 'Sign In')}
                    </button>

                    <div className="login-toggle">
                        <button type="button" onClick={() => setIsSignUp(!isSignUp)} className="btn-link">
                            {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
                        </button>
                    </div>
                </form>

                <div className="demo-credentials">
                    <p><strong>Demo Access (if Supabase Auth disabled)</strong></p>
                    <div className="demo-buttons">
                        <button type="button" className="btn-outline" onClick={() => handleDemoLogin('admin')}>Fill Admin</button>
                        <button type="button" className="btn-outline" onClick={() => handleDemoLogin('user')}>Fill User</button>
                    </div>
                    <p className="help-text">Note: Real authentication requires a configured Supabase project with email sign in enabled.</p>
                </div>
            </div>
        </div>
    );
}
