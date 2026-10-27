import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

export default function ProtectedRoute({ fallback = <DefaultFallback />, unauthenticatedElement, allowedRoles, redirectTo = '/' }) {
  const { isAuthenticated, isLoadingAuth, authChecked, checkUserAuth, user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!authChecked && !isLoadingAuth) {
      checkUserAuth();
    }
  }, [authChecked, isLoadingAuth, checkUserAuth]);

  if (isLoadingAuth || !authChecked) {
    return fallback;
  }

  if (!isAuthenticated) {
    return unauthenticatedElement;
  }

  if (user?.mustChangePassword && location.pathname !== '/trocar-senha') {
    return <Navigate to="/trocar-senha" replace />;
  }

  const role = user?.role === 'user' ? 'manager' : user?.role;
  if (allowedRoles && !allowedRoles.includes(role)) {
    const roleHome = role === 'rouparia' ? '/rouparia' : role === 'collaborator' ? '/solicitacoes' : '/';
    return <Navigate to={redirectTo === 'role-home' ? roleHome : redirectTo} replace />;
  }

  return <Outlet />;
}
