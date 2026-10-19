import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

export default function ProtectedRoute({ fallback = <DefaultFallback />, unauthenticatedElement, allowedRoles, redirectTo = '/' }) {
  const { isAuthenticated, isLoadingAuth, authChecked, checkUserAuth, user } = useAuth();

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

  const role = user?.role === 'user' ? 'manager' : user?.role;
  if (allowedRoles && !allowedRoles.includes(role)) {
    const roleHome = role === 'rouparia' ? '/rouparia' : role === 'collaborator' ? '/solicitacoes' : '/';
    return <Navigate to={redirectTo === 'role-home' ? roleHome : redirectTo} replace />;
  }

  return <Outlet />;
}
