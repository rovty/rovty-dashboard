import { Fragment, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { signInDestination } from '../lib/navigation';

// Client-side gate for the SPA. Real data protection is Supabase RLS; this
// only decides what to render while the session resolves.
const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-dvh bg-ink text-paper font-archivo" aria-busy="true" aria-label="Loading workspace">
        <div className="h-[64px] bg-ink border-b-2 border-line-700" />
        <div className="max-w-[1240px] mx-auto px-5 sm:px-8 py-14 animate-pulse">
          <div className="h-3 w-24 bg-line-800 mb-3" />
          <div className="h-14 w-72 max-w-full bg-line-800 mb-10" />
          <div className="border border-line-800 h-64" />
        </div>
      </div>
    );
  }

  if (!user) {
    const next = signInDestination(location.pathname + location.search + location.hash);
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Fragment key={user.id}>{children}</Fragment>;
};

export default ProtectedRoute;
