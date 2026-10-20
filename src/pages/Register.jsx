import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Mail, UserPlus } from 'lucide-react';
import { db } from '@/api/localClient';
import AuthLayout from '@/components/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { safeReturnTo } from '@/lib/authReturnTo';
import { appUrl } from '@/lib/basePath';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      await db.auth.register({ email, password });
      window.location.href = appUrl(safeReturnTo());
    } catch (registrationError) {
      setError(registrationError.message || 'Não foi possível criar a conta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={UserPlus}
      title="Configurar administrador inicial"
      subtitle="A configuração inicial do administrador deve ser feita pelo TI no computador que hospeda o sistema"
      footer={<>Já tem uma conta? <Link to="/login" className="text-primary font-medium hover:underline">Entrar</Link></>}
    >
      {error && <div role="alert" className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input id="email" type="email" autoComplete="email" autoFocus required value={email}
              onChange={(event) => setEmail(event.target.value)} className="pl-10 h-12" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input id="password" type="password" autoComplete="new-password" minLength={6} required value={password}
              onChange={(event) => setPassword(event.target.value)} className="pl-10 h-12" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirmar senha</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input id="confirm" type="password" autoComplete="new-password" minLength={6} required value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)} className="pl-10 h-12" />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? 'Configurando...' : 'Criar administrador de TI'}
        </Button>
      </form>
    </AuthLayout>
  );
}
