import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Logo } from "@/components/Logo";
import { loginAction } from "../actions";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/seed";
import { VACATION_DEMO_EMAIL } from "@/lib/seed-vacation";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-10 text-center"><Logo className="text-3xl" /></Link>
      <div className="card !p-6">
        <h1 className="text-xl font-semibold">Bienvenido de nuevo</h1>
        <p className="mb-5 mt-1 text-sm text-mute">Entra al panel de tu agencia.</p>
        <ActionForm action={loginAction} submit="Entrar" className="space-y-4 [&_button[type=submit]]:w-full">
          <div><label className="label">Email</label><input name="email" type="email" autoCapitalize="none" autoCorrect="off" autoComplete="username" className="input" defaultValue={DEMO_EMAIL} required /></div>
          <div><label className="label">Contraseña</label><input name="password" type="password" autoCapitalize="none" autoCorrect="off" autoComplete="current-password" className="input" defaultValue={DEMO_PASSWORD} required /></div>
        </ActionForm>
        <div className="mt-4 space-y-1 text-xs text-mute">
          <p>Demo inmobiliaria: {DEMO_EMAIL} / {DEMO_PASSWORD}</p>
          <p>Demo alquiler vacacional: {VACATION_DEMO_EMAIL} / {DEMO_PASSWORD}</p>
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-mute">¿Nueva inmobiliaria? <Link href="/signup" className="text-arm">Crear cuenta</Link></p>
    </main>
  );
}
