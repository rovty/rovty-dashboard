import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Client-side gate for the SPA. Real data protection is Supabase RLS; this
// only decides what to render while the session resolves.
const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-dvh bg-paper font-archivo" aria-busy="true" aria-label="Loading">
        <div className="h-[64px] bg-ink border-b-2 border-line-700" />
        <div className="max-w-[1240px] mx-auto px-5 sm:px-8 py-14 animate-pulse">
          <div className="h-3 w-24 bg-line-300 mb-3" />
          <div className="h-8 w-56 bg-line-300 mb-10" />
          <div className="border-2 border-line-300 h-40" />
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
};

export default ProtectedRoute;
