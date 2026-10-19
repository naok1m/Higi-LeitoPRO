import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { db } from '@/api/localClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/AuthContext';

const roleLabels = {
  admin: 'Administrador de TI',
  manager: 'Gestor do setor',
  collaborator: 'Colaborador',
  rouparia: 'Rouparia',
};

export default function UserManagement() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('collaborator');
  const [companyIds, setCompanyIds] = useState(() =>
    currentUser?.activeCompanyId ? [currentUser.activeCompanyId] : []);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-users'],
    queryFn: db.admin.users,
  });

  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });
  const createUser = useMutation({
    mutationFn: () => db.admin.createUser({
      email,
      password,
      role,
      companyIds: role === 'admin'
        ? currentUser.companies.map((company) => company.id)
        : companyIds,
    }),
    onSuccess: () => {
      setEmail('');
      setPassword('');
      setCompanyIds(currentUser?.activeCompanyId ? [currentUser.activeCompanyId] : []);
      toast.success('Usuário criado.');
      refreshUsers();
    },
    onError: (requestError) => toast.error(requestError.message || 'Não foi possível criar o usuário.'),
  });
  const updateUser = useMutation({
    mutationFn: ({ id, values }) => db.admin.updateUser(id, values),
    onSuccess: () => {
      toast.success('Usuário atualizado.');
      refreshUsers();
    },
    onError: (requestError) => {
      toast.error(requestError.message || 'Não foi possível atualizar o usuário.');
      refreshUsers();
    },
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    createUser.mutate();
  };
  const toggleUserCompany = (account, companyId) => {
    const assigned = account.companyIds || [];
    const nextCompanyIds = assigned.includes(companyId)
      ? assigned.filter((id) => id !== companyId)
      : [...assigned, companyId];
    if (!nextCompanyIds.length) {
      toast.error('Cada usuário precisa ter acesso a pelo menos uma empresa.');
      return;
    }
    updateUser.mutate({ id: account.id, values: { companyIds: nextCompanyIds } });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Gerenciar usuários</h2>
        <p className="mt-1 text-sm text-slate-500">Crie contas, defina o perfil e escolha as empresas disponíveis para cada pessoa.</p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4 rounded-2xl border bg-white p-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="new-user-email">E-mail</Label>
          <Input id="new-user-email" type="email" autoComplete="off" required value={email}
            onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-user-password">Senha inicial</Label>
          <Input id="new-user-password" type="password" autoComplete="new-password" minLength={6} required value={password}
            onChange={(event) => setPassword(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-user-role">Tipo de usuário</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger id="new-user-role"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(roleLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <fieldset className="space-y-2 md:col-span-2">
          <legend className="text-sm font-medium text-slate-700">Empresas com acesso</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {currentUser?.companies?.map((company) => (
              <label key={company.id} className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={role === 'admin' || companyIds.includes(company.id)}
                  disabled={role === 'admin'}
                  onChange={(event) => setCompanyIds((previous) => event.target.checked
                    ? [...new Set([...previous, company.id])]
                    : previous.filter((id) => id !== company.id))} />
                {company.name}
              </label>
            ))}
          </div>
          {role === 'admin' && <p className="text-xs text-slate-500">Administradores de TI têm acesso às três empresas.</p>}
        </fieldset>
        <div className="flex items-end">
          <Button type="submit" className="w-full md:w-auto"
            disabled={createUser.isPending || (role !== 'admin' && companyIds.length === 0)}>
            <UserPlus className="mr-2 h-4 w-4" />
            {createUser.isPending ? 'Criando...' : 'Criar usuário'}
          </Button>
        </div>
      </form>

      <section className="space-y-3">
        <h3 className="font-semibold text-slate-900">Contas cadastradas</h3>
        {isLoading && <p className="text-sm text-slate-500">Carregando usuários...</p>}
        {isError && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
        {!isLoading && !isError && data?.users.length === 0 && (
          <p className="text-sm text-slate-500">Nenhum usuário cadastrado.</p>
        )}
        {data?.users.map((account) => {
          const isCurrentUser = account.id === currentUser?.id;
          return (
            <div key={account.id} className="flex flex-col gap-3 rounded-2xl border bg-white p-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="break-all font-medium text-slate-900">{account.email}</p>
                <p className={`text-sm ${account.active ? 'text-slate-500' : 'text-red-600'}`}>
                  {account.active ? roleLabels[account.role] || account.role : 'Conta desativada'}
                  {isCurrentUser ? ' · Sua conta' : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {currentUser?.companies?.map((company) => {
                    const checked = (account.companyIds || []).includes(company.id);
                    return (
                      <label key={company.id} className="flex items-center gap-1.5 text-xs text-slate-500">
                        <input type="checkbox" checked={checked}
                          disabled={isCurrentUser || account.role === 'admin' || updateUser.isPending}
                          onChange={() => toggleUserCompany(account, company.id)} />
                        {company.name}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={account.role}
                  onValueChange={(nextRole) => updateUser.mutate({ id: account.id, values: { role: nextRole } })}
                  disabled={isCurrentUser || updateUser.isPending}
                >
                  <SelectTrigger className="w-full md:w-52" aria-label={`Tipo de usuário de ${account.email}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(roleLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isCurrentUser || updateUser.isPending}
                  onClick={() => updateUser.mutate({ id: account.id, values: { active: !account.active } })}
                >
                  {account.active ? 'Desativar' : 'Reativar'}
                </Button>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
