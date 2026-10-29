import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, BarChart3, BedDouble, ClipboardList, Users, Building2, History, LogOut, UserCog, Shirt, Package } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import LogoFooter from '@/components/LogoFooter';
import { toast } from 'sonner';

const items = [
  { to: '/', label: 'Leitos', icon: BedDouble },
  { to: '/solicitacoes', label: 'Limpeza', icon: ClipboardList },
  { to: '/rouparia', label: 'Rouparia', icon: Shirt, roles: ['admin', 'manager', 'collaborator', 'rouparia'] },
  { to: '/monitoramento', label: 'Monitoramento', icon: Activity, roles: ['admin', 'manager'] },
  { to: '/equipe', label: 'Equipe', icon: Users },
  { to: '/estrutura', label: 'Unidades', icon: Building2, labels: { manager: 'Utensílios' }, icons: { manager: Package } },
  { to: '/historico', label: 'Histórico', icon: History },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { to: '/usuarios', label: 'Usuários', icon: UserCog, roles: ['admin'] },
];

export default function Layout() {
  const { logout, user, switchCompany } = useAuth();
  const queryClient = useQueryClient();
  const [changingCompany, setChangingCompany] = useState(false);
  const role = user?.role === 'user' ? 'manager' : user?.role;
  const visibleItems = items.filter((item) =>
    item.roles
      ? item.roles.includes(role)
      : item.to === '/solicitacoes'
        ? ['admin', 'manager', 'collaborator'].includes(role)
        : ['admin', 'manager'].includes(role));
  const navigate = useNavigate();
  const handleLogout = () => {
    logout();
    navigate('/login');
  };
  const handleCompanyChange = async (event) => {
    setChangingCompany(true);
    try {
      await switchCompany(event.target.value);
      await queryClient.invalidateQueries();
    } catch (error) {
      toast.error(error.message || 'Não foi possível trocar de empresa.');
    } finally {
      setChangingCompany(false);
    }
  };

  return (
    <div className="app-layout flex min-h-screen flex-col bg-[#f2f8fa] pb-20 md:pb-0 md:pl-60">
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-cyan-950/10 bg-white p-5 print:hidden">
        <div className="mb-8">
          <p className="text-xs tracking-widest text-primary font-semibold">HIGIENIZAÇÃO</p>
          <h1 className="text-xl font-semibold text-slate-900">
            {role === 'collaborator' ? 'Área de Limpeza' : role === 'rouparia' ? 'Liderança de Rouparia' : 'Controle de Leitos'}
          </h1>
        </div>
        <nav className="flex-1 space-y-1">
          {visibleItems.map(({ to, label, icon, labels, icons }) => {
            const Icon = icons?.[role] || icon;
            return (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${isActive ? 'bg-cyan-50 text-primary font-semibold' : 'text-slate-600 hover:bg-slate-100'}`}>
                <Icon className="w-4 h-4" />{labels?.[role] || label}
              </NavLink>
            );
          })}
        </nav>
        <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2 text-sm text-slate-500 hover:text-slate-900"><LogOut className="w-4 h-4" />Sair</button>
      </aside>
      <main className="w-full flex-1 p-4 md:p-8 max-w-6xl mx-auto">
        {user?.companies?.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
            <span className="text-sm text-slate-500">{user.name || user.email}</span>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Empresa ativa
              <select value={user.activeCompanyId || ''} onChange={handleCompanyChange}
                disabled={changingCompany || user.companies.length < 2}
                className="h-10 max-w-64 rounded-md border bg-white px-3 text-slate-900 disabled:opacity-70">
                {user.companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        <Outlet />
      </main>
      <div className="print:hidden"><LogoFooter /></div>
      <nav className="md:hidden fixed bottom-0 inset-x-0 overflow-x-auto overscroll-x-contain border-t border-cyan-950/10 bg-white grid z-40 print:hidden"
        style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(64px, 1fr))` }}>
        {visibleItems.map(({ to, label, icon, labels, icons }) => {
          const Icon = icons?.[role] || icon;
          return (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex flex-col items-center py-2.5 text-[11px] gap-1 ${isActive ? 'text-primary font-semibold' : 'text-slate-500'}`}>
              <Icon className="w-5 h-5" />{labels?.[role] || label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}