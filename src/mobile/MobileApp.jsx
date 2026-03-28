import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { supabase } from '../supabase';

import MobileLogin from './MobileLogin';
import MobileSalesEntry from './MobileSalesEntry';

/** Guard: redirect to /mobile/login if not authenticated */
function RequireAuth({ children }) {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate('/mobile/login', { replace: true });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) navigate('/mobile/login', { replace: true });
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return children;
}

export default function MobileApp() {
  return (
    <>
      <Routes>
        {/* Default: go to login */}
        <Route index element={<Navigate to="login" replace />} />

        {/* Login */}
        <Route path="login" element={<MobileLogin />} />

        {/* Protected sales entry */}
        <Route
          path="sales"
          element={
            <RequireAuth>
              <MobileSalesEntry />
            </RequireAuth>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="login" replace />} />
      </Routes>

      {/* Toast notifications */}
      <Toaster position="top-center" toastOptions={{ duration: 3500 }} />
    </>
  );
}
