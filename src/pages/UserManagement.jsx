import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Check, ChevronLeft, ChevronRight, Clipboard, Ellipsis, Loader2, Search, UserPlus,
} from 'lucide-react';
import { db } from '@/api/localClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/AuthContext';

const roleLabels = {
  admin: 'Administrador de TI',
  manager: 'Gestor do setor',
  collaborator: 'Colaborador',
  rouparia: 'Líder Hotelaria',
};
const initialForm = { name: '', email: '', registration: '', password: '', role: 'collaborator', companyIds: [], active: true };
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** @typedef {{ id: string; name?: string; email: string; active: boolean }} ManagedUser */
/** @typedef {{ account: ManagedUser; active: boolean }} StatusMutation */

const formatLastLogin = (value) => {
  if (!value) return 'Nunca acessou';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
};

const FormField = ({ id, label, children, required = false }) => (
  <div className="space-y-2">
    <Label htmlFor={id}>{label}{required ? ' *' : ''}</Label>
    {children}
  </div>
);

export default function UserManagement() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [filters, setFilters] = useState({ search: '', role: 'all', status: 'all', companyId: 'all', page: 1, pageSize: 10 });
  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [statusUser, setStatusUser] = useState(null);
  const [confirmDeactivation, setConfirmDeactivation] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [auditUser, setAuditUser] = useState(null);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [temporaryPasswordTitle, setTemporaryPasswordTitle] = useState('');
  const isTemporaryPasswordOpen = Boolean(temporaryPassword);

  const usersQuery = useQuery({
    queryKey: ['admin-users', filters],
    queryFn: () => db.admin.users({
      ...filters,
      role: filters.role === 'all' ? '' : filters.role,
      status: filters.status,
      companyId: filters.companyId === 'all' ? '' : filters.companyId,
    }),
  });
  const auditQuery = useQuery({
    queryKey: ['admin-user-audit', auditUser?.id],
    queryFn: () => db.admin.userAudit(auditUser.id),
    enabled: Boolean(auditUser),
  });
  const users = usersQuery.data?.users || [];
  const pagination = usersQuery.data?.pagination || { page: 1, pageSize: 10, total: 0, pageCount: 0 };

  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });
  const setFilter = (key, value) => setFilters((previous) => ({ ...previous, [key]: value, page: 1 }));
  const openCreate = () => {
    setEditingUser(null);
    setForm({
      ...initialForm,
      companyIds: currentUser?.activeCompanyId ? [currentUser.activeCompanyId] : [],
    });
    setFormOpen(true);
  };
  const openEdit = (account) => {
    setEditingUser(account);
    setForm({
      name: account.name || '',
      email: account.email,
      registration: account.registration || '',
      password: '',
      role: account.role,
      companyIds: account.companyIds || [],
      active: account.active,
    });
    setFormOpen(true);
  };

  const saveUser = useMutation({
    mutationFn: () => editingUser
      ? db.admin.updateUser(editingUser.id, {
        name: form.name.trim(),
        email: form.email.trim(),
        registration: form.registration.trim(),
        role: form.role,
        companyIds: form.companyIds,
        active: form.active,
      })
      : db.admin.createUser({
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        registration: form.registration.trim(),
        password: form.password || undefined,
      }),
    onSuccess: async (result) => {
      setFormOpen(false);
      toast.success(editingUser ? 'Usuário atualizado.' : 'Usuário criado.');
      if (result.temporaryPassword) {
        setTemporaryPasswordTitle(result.user.mustChangePassword ? 'Senha temporária do novo usuário' : 'Senha inicial do novo usuário');
        setTemporaryPassword(result.temporaryPassword);
      }
      await refreshUsers();
    },
    onError: (error) => toast.error(error.message || 'Não foi possível salvar o usuário.'),
  });
  const updateStatus = useMutation({
    mutationFn: (/** @type {StatusMutation} */ variables) =>
      db.admin.updateUserStatus(variables.account.id, variables.active),
    onSuccess: async (_result, variables) => {
      setStatusUser(null);
      setConfirmDeactivation(false);
      toast.success(variables.active ? 'Usuário ativado.' : 'Usuário desativado.');
      await refreshUsers();
    },
    onError: (error) => toast.error(error.message || 'Não foi possível alterar o status.'),
  });
  const resetPassword = useMutation({
    mutationFn: (/** @type {ManagedUser} */ account) => db.admin.resetUserPassword(account.id),
    onSuccess: async (result) => {
      setResetUser(null);
      setTemporaryPasswordTitle(`Senha temporária de ${result.user.name || result.user.email}`);
      setTemporaryPassword(result.temporaryPassword);
      toast.success('Senha redefinida. A troca será obrigatória no próximo acesso.');
      await refreshUsers();
    },
    onError: (error) => toast.error(error.message || 'Não foi possível redefinir a senha.'),
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    saveUser.mutate();
  };
  const toggleCompany = (companyId) => {
    setForm((previous) => ({
      ...previous,
      companyIds: previous.companyIds.includes(companyId)
        ? previous.companyIds.filter((id) => id !== companyId)
        : [...previous.companyIds, companyId],
    }));
  };
  const copyTemporaryPassword = async () => {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      toast.success('Senha copiada.');
    } catch {
      toast.error('Não foi possível copiar a senha. Selecione e copie o texto manualmente.');
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Gerenciamento de usuários</h2>
          <p className="mt-1 text-sm text-slate-500">Cadastre contas e gerencie perfis, acesso às empresas e status.</p>
        </div>
        <Button type="button" onClick={openCreate}>
          <UserPlus aria-hidden="true" /> Novo usuário
        </Button>
      </header>

      <section aria-label="Filtros de usuários" className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Label htmlFor="user-search">Pesquisar por nome ou e-mail</Label>
          <Search aria-hidden="true" className="absolute left-3 top-9 h-4 w-4 text-slate-400" />
          <Input id="user-search" value={filters.search} onChange={(event) => setFilter('search', event.target.value)}
            className="mt-2 pl-9" placeholder="Nome ou e-mail" />
        </div>
        <div>
          <Label htmlFor="user-role-filter">Perfil</Label>
          <Select value={filters.role} onValueChange={(value) => setFilter('role', value)}>
            <SelectTrigger id="user-role-filter" className="mt-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os perfis</SelectItem>
              {Object.entries(roleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="user-status-filter">Status</Label>
          <Select value={filters.status} onValueChange={(value) => setFilter('status', value)}>
            <SelectTrigger id="user-status-filter" className="mt-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="inactive">Inativos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="user-company-filter">Setor / empresa</Label>
          <Select value={filters.companyId} onValueChange={(value) => setFilter('companyId', value)}>
            <SelectTrigger id="user-company-filter" className="mt-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as empresas</SelectItem>
              {currentUser?.companies?.map((company) => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section aria-label="Usuários cadastrados" className="overflow-hidden rounded-2xl border bg-white">
        {usersQuery.isLoading && (
          <div role="status" className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Carregando usuários...
          </div>
        )}
        {usersQuery.isError && <p role="alert" className="p-5 text-sm text-red-700">{usersQuery.error.message}</p>}
        {!usersQuery.isLoading && !usersQuery.isError && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Setor / empresa</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((account) => {
                  const isCurrentUser = account.id === currentUser?.id;
                  const companies = currentUser?.companies?.filter(({ id }) => account.companyIds.includes(id)) || [];
                  return (
                    <TableRow key={account.id}>
                      <TableCell className="min-w-36 font-medium">{account.name || 'Nome não informado'}{isCurrentUser ? ' (você)' : ''}</TableCell>
                      <TableCell className="min-w-48 break-all">{account.email}</TableCell>
                      <TableCell className="min-w-36">{roleLabels[account.role] || account.role}</TableCell>
                      <TableCell className="min-w-36">{companies.map(({ name }) => name).join(', ') || '—'}</TableCell>
                      <TableCell>
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${account.active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                          {account.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </TableCell>
                      <TableCell className="min-w-32 whitespace-nowrap">{formatLastLogin(account.lastLogin)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" aria-label={`Ações para ${account.name || account.email}`}>
                              <Ellipsis aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openEdit(account)}>Editar</DropdownMenuItem>
                            <DropdownMenuItem disabled={isCurrentUser} onSelect={() => setResetUser(account)}>Redefinir senha</DropdownMenuItem>
                            <DropdownMenuItem disabled={isCurrentUser && account.active} onSelect={() => {
                              setStatusUser(account);
                              setConfirmDeactivation(false);
                              if (!account.active) updateStatus.mutate({ account, active: true });
                            }}>
                              {account.active ? 'Desativar usuário' : 'Ativar usuário'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setAuditUser(account)}>Histórico de ações</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {users.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-10 text-center text-slate-500">Nenhum usuário corresponde aos filtros.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-slate-600">
              <p aria-live="polite">{pagination.total} usuário(s) · Página {pagination.page} de {Math.max(pagination.pageCount, 1)}</p>
              <div className="flex items-center gap-2">
                <Label htmlFor="user-page-size" className="sr-only">Usuários por página</Label>
                <Select value={String(filters.pageSize)} onValueChange={(value) => setFilters((previous) => ({ ...previous, page: 1, pageSize: Number(value) }))}>
                  <SelectTrigger id="user-page-size" className="h-9 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50].map((value) => <SelectItem key={value} value={String(value)}>{value} / página</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" aria-label="Página anterior"
                  disabled={pagination.page <= 1} onClick={() => setFilters((previous) => ({ ...previous, page: pagination.page - 1 }))}>
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <Button type="button" variant="outline" size="icon" aria-label="Próxima página"
                  disabled={pagination.page >= pagination.pageCount} onClick={() => setFilters((previous) => ({ ...previous, page: pagination.page + 1 }))}>
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
            <DialogDescription>Campos marcados com * são obrigatórios. O acesso às empresas controla o escopo dos dados.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField id="user-name" label="Nome completo" required>
              <Input id="user-name" autoComplete="name" required maxLength={200} value={form.name}
                onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} />
            </FormField>
            <FormField id="user-email" label="E-mail" required>
              <Input id="user-email" type="email" autoComplete="email" required value={form.email}
                disabled={Boolean(editingUser?.isPrimaryAdmin)}
                onChange={(event) => setForm((previous) => ({ ...previous, email: event.target.value }))} />
              {editingUser?.isPrimaryAdmin && <p className="text-xs text-slate-500">O e-mail do administrador principal não pode ser alterado.</p>}
            </FormField>
            <FormField id="user-registration" label="CPF ou matrícula">
              <Input id="user-registration" maxLength={40} value={form.registration}
                onChange={(event) => setForm((previous) => ({ ...previous, registration: event.target.value }))} />
            </FormField>
            {!editingUser && (
              <FormField id="user-password" label="Senha inicial (opcional)">
                <Input id="user-password" type="password" autoComplete="new-password" minLength={6} value={form.password}
                  onChange={(event) => setForm((previous) => ({ ...previous, password: event.target.value }))} />
                <p className="text-xs text-slate-500">Se deixar em branco, o sistema gera uma senha temporária e exige troca no primeiro acesso.</p>
              </FormField>
            )}
            <FormField id="user-role" label="Perfil de acesso" required>
              <Select value={form.role} onValueChange={(role) => setForm((previous) => ({ ...previous, role }))}>
                <SelectTrigger id="user-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(roleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">Setor / empresas com acesso *</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {currentUser?.companies?.map((company) => (
                  <label key={company.id} className="flex items-center gap-2 rounded-md border p-3 text-sm">
                    <input type="checkbox" checked={form.role === 'admin' || form.companyIds.includes(company.id)}
                      disabled={form.role === 'admin'}
                      onChange={() => toggleCompany(company.id)} />
                    {company.name}
                  </label>
                ))}
              </div>
              {form.role === 'admin' && <p className="text-xs text-slate-500">Administradores de TI têm acesso a todas as empresas.</p>}
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saveUser.isPending || (form.role !== 'admin' && form.companyIds.length === 0)}>
                {saveUser.isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
                {saveUser.isPending ? 'Salvando...' : 'Salvar usuário'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(statusUser?.active)} onOpenChange={(open) => {
        if (!open) { setStatusUser(null); setConfirmDeactivation(false); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desativar usuário</DialogTitle>
            <DialogDescription>Tem certeza que deseja desativar {statusUser?.name || statusUser?.email}? Isso bloqueará o acesso imediatamente e encerrará as sessões.</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={confirmDeactivation} onChange={(event) => setConfirmDeactivation(event.target.checked)} />
            Confirmo que desejo bloquear o acesso deste usuário.
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setStatusUser(null)}>Cancelar</Button>
            <Button type="button" variant="destructive" disabled={!confirmDeactivation || updateStatus.isPending}
              onClick={() => updateStatus.mutate({ account: statusUser, active: false })}>
              {updateStatus.isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
              Confirmar desativação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetUser)} onOpenChange={(open) => !open && setResetUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>Será gerada uma senha temporária para {resetUser?.name || resetUser?.email}. As sessões atuais serão encerradas e a troca será obrigatória no próximo login.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResetUser(null)}>Cancelar</Button>
            <Button type="button" disabled={resetPassword.isPending} onClick={() => resetPassword.mutate(resetUser)}>
              {resetPassword.isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
              Gerar senha temporária
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isTemporaryPasswordOpen} onOpenChange={(open) => !open && setTemporaryPassword('')}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{temporaryPasswordTitle}</DialogTitle>
            <DialogDescription>Compartilhe a senha com o usuário por um canal seguro. Ela será solicitada apenas para o primeiro acesso.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input aria-label="Senha temporária gerada" readOnly value={temporaryPassword} />
            <Button type="button" variant="outline" aria-label="Copiar senha temporária" onClick={copyTemporaryPassword}>
              <Clipboard aria-hidden="true" />
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setTemporaryPassword('')}><Check aria-hidden="true" /> Concluído</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(auditUser)} onOpenChange={(open) => !open && setAuditUser(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Histórico de ações</DialogTitle>
            <DialogDescription>Alterações administrativas em {auditUser?.name || auditUser?.email}.</DialogDescription>
          </DialogHeader>
          {auditQuery.isLoading && <p role="status" className="text-sm text-slate-500">Carregando histórico...</p>}
          {auditQuery.isError && <p role="alert" className="text-sm text-red-700">{auditQuery.error.message}</p>}
          {auditQuery.data?.events?.length === 0 && <p className="text-sm text-slate-500">Nenhuma ação registrada.</p>}
          <ol className="space-y-3">
            {auditQuery.data?.events?.map((event, index) => (
              <li key={`${event.occurredAt}-${index}`} className="rounded-lg border p-3 text-sm">
                <p className="font-medium text-slate-900">{({
                  created: 'Usuário criado',
                  updated: 'Dados atualizados',
                  password_reset: 'Senha redefinida',
                  password_changed: 'Senha temporária alterada',
                })[event.action] || event.action}</p>
                <p className="mt-1 text-slate-600">{event.actorEmail} · {formatLastLogin(event.occurredAt)}</p>
                {event.details?.changedFields?.length > 0 && <p className="mt-1 text-xs text-slate-500">Campos: {event.details.changedFields.join(', ')}</p>}
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
}
