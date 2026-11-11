import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Logo } from "@/components/Logo";
import { signupAction } from "../actions";

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-8 text-center"><Logo className="text-3xl" /></Link>
      <div className="card">
        <h1 className="mb-1 text-lg font-semibold">Crear inmobiliaria</h1>
        <p className="mb-4 text-sm text-mute">Cada inmobiliaria tiene su propio asistente, catálogo, leads y equipo.</p>
        <ActionForm action={signupAction} submit="Crear cuenta">
          <div><label className="label">Nombre de la inmobiliaria</label><input name="agency" className="input" required /></div>
          <div><label className="label">Pueblo / zona</label><input name="town" className="input" placeholder="Nerja" /></div>
          <div><label className="label">Tu nombre</label><input name="name" className="input" required /></div>
          <div><label className="label">Email</label><input name="email" type="email" className="input" required /></div>
          <div><label className="label">Contraseña</label><input name="password" type="password" minLength={8} className="input" required /></div>
        </ActionForm>
      </div>
    </main>
  );
}
