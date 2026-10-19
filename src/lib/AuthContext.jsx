import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { db } from '@/api/localClient';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState(null);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    setAuthError(null);
    try {
      setUser(await db.auth.me());
    } catch (error) {
      console.error('Não foi possível verificar a sessão local.', error);
      setAuthError(error);
      setUser(null);
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    checkUserAuth();
  }, [checkUserAuth]);

  const logout = useCallback(() => {
    db.auth.logout().catch((error) => {
      console.error('Não foi possível encerrar a sessão compartilhada.', error);
    });
    setUser(null);
    setAuthChecked(true);
  }, []);

  const switchCompany = useCallback(async (companyId) => {
    const updatedUser = await db.auth.switchCompany(companyId);
    setUser(updatedUser);
    return updatedUser;
  }, []);

  const value = {
    user,
    isAuthenticated: Boolean(user),
    isLoadingAuth,
    authChecked,
    authError,
    logout,
    switchCompany,
    checkUserAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
