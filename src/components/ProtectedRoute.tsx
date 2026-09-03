import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Gate for every dashboard route: only a signed-in user gets past this.
 * Anyone else is bounced to /login, remembering where they were headed
 * (LoginPage sends them back there once they've signed in).
 */
const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center font-archivo">
        <p className="text-sm font-semibold uppercase tracking-[0.04em] text-line-700">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
