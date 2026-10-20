import { useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from 'sonner';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute';
import { appUrl, BASE_PATH } from '@/lib/basePath';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import Layout from '@/components/Layout';
import Leitos from '@/pages/Leitos';
import Equipe from '@/pages/Equipe';
import Relatorios from '@/pages/Relatorios';
import Solicitacoes from '@/pages/Solicitacoes';
import Rouparia from '@/pages/Rouparia';
import Estrutura from '@/pages/Estrutura';
import Historico from '@/pages/Historico';
import UserManagement from '@/pages/UserManagement';
import Monitoramento from '@/pages/Monitoramento';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
import LogoFooter from '@/components/LogoFooter';
// Add page imports here

const AuthenticatedApp = () => {
  const { isLoadingAuth, authError, isAuthenticated, checkUserAuth } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const eventSource = new EventSource(appUrl('/api/events'));
    const refreshQueries = (event) => {
      void queryClient.invalidateQueries();
      if (JSON.parse(event.data).event === 'user.access_changed') {
        void checkUserAuth();
      }
    };
    eventSource.addEventListener('change', refreshQueries);

    return () => {
      eventSource.removeEventListener('change', refreshQueries);
      eventSource.close();
    };
  }, [isAuthenticated, queryClient, checkUserAuth]);

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
        </div>
        <LogoFooter />
      </div>
    );
  }

  if (authError) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <div role="alert" className="flex-1 flex items-center justify-center p-6 text-center text-red-700">
          Não foi possível carregar a sessão local: {authError.message}
        </div>
        <LogoFooter />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<Layout />}>
          <Route element={<ProtectedRoute allowedRoles={['admin', 'manager']} redirectTo="role-home" />}>
            <Route path="/" element={<Leitos />} />
            <Route path="/monitoramento" element={<Monitoramento />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['admin', 'manager', 'collaborator']} redirectTo="role-home" />}>
            <Route path="/solicitacoes" element={<Solicitacoes />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['admin', 'manager', 'collaborator', 'rouparia']} redirectTo="role-home" />}>
            <Route path="/rouparia" element={<Rouparia />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['admin', 'manager']} redirectTo="role-home" />}>
            <Route path="/relatorios" element={<Relatorios />} />
            <Route path="/equipe" element={<Equipe />} />
            <Route path="/estrutura" element={<Estrutura />} />
            <Route path="/historico" element={<Historico />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
            <Route path="/usuarios" element={<UserManagement />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router basename={BASE_PATH || '/'}>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <SonnerToaster position="top-right" richColors />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App