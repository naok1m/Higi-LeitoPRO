import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Lock, Loader2 } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import { appUrl } from '@/lib/basePath';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { db } from '@/api/localClient';
import { useAuth } from '@/lib/AuthContext';

const isStrongPassword = (password) =>
  password.length >= 12
  && /[a-z]/.test(password)
  && /[A-Z]/.test(password)
  && /\d/.test(password)
  && /[^A-Za-z0-9]/.test(password);

export default function ChangeTemporaryPassword() {
  const navigate = useNavigate();
  const { checkUserAuth } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!isStrongPassword(password)) {
      setError('Use pelo menos 12 caracteres, com letras maiúsculas, minúsculas, número e símbolo.');
      return;
    }
    if (password !== confirmation) {
      setError('As senhas não coincidem.');
      return;
    }
    setSaving(true);
    try {
      await db.auth.changeTemporaryPassword(password);
      await checkUserAuth();
      toast.success('Senha alterada. Seu acesso foi liberado.');
      navigate('/', { replace: true });
    } catch (requestError) {
      setError(requestError.message || 'Não foi possível alterar a senha.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthLayout icon={Lock} imageSrc={appUrl('/I%CC%81cone%20de%20Limpeza%20Inteligente.png')}
      imageAlt="Ícone de Limpeza Inteligente" title="Troca de senha obrigatória"
      subtitle="Defina uma senha forte para continuar." footer={null}>
      {error && <p role="alert" className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="temporary-new-password">Nova senha</Label>
          <Input id="temporary-new-password" type="password" autoComplete="new-password" autoFocus
            required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="temporary-password-confirmation">Confirmar nova senha</Label>
          <Input id="temporary-password-confirmation" type="password" autoComplete="new-password"
            required minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </div>
        <p className="text-xs text-slate-500">Mínimo de 12 caracteres, incluindo maiúsculas, minúsculas, número e símbolo.</p>
        <Button type="submit" className="w-full" disabled={saving}>
          {saving && <Loader2 aria-hidden="true" className="animate-spin" />}
          {saving ? 'Salvando...' : 'Salvar nova senha'}
        </Button>
      </form>
    </AuthLayout>
  );
}
