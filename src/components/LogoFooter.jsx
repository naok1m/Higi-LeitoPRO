import { appUrl } from '@/lib/basePath';
import packageJson from '../../package.json';

export default function LogoFooter() {
  return (
    <footer className="flex w-full items-center justify-center gap-3 px-4 py-3">
      <img
        src={appUrl("/logo%20OTOTECH%20PRETO.png")}
        alt="OtoTech"
        className="h-auto w-36 object-contain sm:w-44"
      />
      <span className="whitespace-nowrap text-xs text-slate-500">v{packageJson.version}</span>
    </footer>
  );
}
