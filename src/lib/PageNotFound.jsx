import { Link } from 'react-router-dom';
import LogoFooter from '@/components/LogoFooter';

export default function PageNotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="space-y-2">
            <h1 className="text-7xl font-light text-slate-300">404</h1>
            <div className="mx-auto h-0.5 w-16 bg-slate-200" />
          </div>
          <div className="space-y-3">
            <h2 className="text-2xl font-medium text-slate-800">Página não encontrada</h2>
            <p className="leading-relaxed text-slate-600">
              O endereço acessado não corresponde a uma página disponível no sistema.
            </p>
          </div>
          <Link
            to="/"
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
          >
            Voltar ao início
          </Link>
        </div>
      </main>
      <LogoFooter />
    </div>
  );
}
