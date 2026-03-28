import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import './mobile.css';

// Inline a tiny SVG logo fallback — the real logo is loaded from assets
import amronaLogo from '../assests/logo.png';

export default function MobileLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success('Welcome!');
      navigate('/mobile/sales');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="m-root">
      <div className="m-login-wrap">
        {/* ── LOGO ── */}
        <div className="m-login-logo">
          <img src={amronaLogo} alt="Amrona" />
          <h1>Amrona</h1>
          <p>Spices Manufacturing &amp; Distributing</p>
        </div>

        <div className="m-login-badge">📦 Sales Portal</div>

        {/* ── CARD ── */}
        <div className="m-login-card">
          <h2>Sign In</h2>
          <p>Enter your credentials to access the sales entry.</p>

          <form onSubmit={handleSubmit}>
            <div className="m-field">
              <label>Email</label>
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@amrona.local"
                required
              />
            </div>

            <div className="m-field">
              <label>Password</label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            <button type="submit" className="m-btn-primary" disabled={loading}>
              {loading ? <span className="m-spinner" /> : 'Sign In →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
