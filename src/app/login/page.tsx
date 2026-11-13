import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LoginForm } from "@/components/LoginForm";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/seed";
import { VACATION_DEMO_EMAIL } from "@/lib/seed-vacation";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-10 text-center"><Logo className="text-3xl" /></Link>
      <div className="card !p-6">
        <h1 className="text-xl font-semibold">Bienvenido de nuevo</h1>
        <p className="mb-5 mt-1 text-sm text-mute">Entra al panel de tu agencia.</p>
        <LoginForm demos={[
          { label: "Demo inmobiliaria", email: DEMO_EMAIL, password: DEMO_PASSWORD },
          { label: "Demo alquiler vacacional", email: VACATION_DEMO_EMAIL, password: DEMO_PASSWORD },
        ]} />
      </div>
      <p className="mt-4 text-center text-sm text-mute">¿Nueva agencia? <Link href="/signup" className="text-arm">Crear cuenta</Link></p>
    </main>
  );
}
