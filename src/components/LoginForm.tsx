"use client";

import { useActionState, useState } from "react";
import { loginAction } from "@/app/actions";

/** Formulario de acceso. Los campos se mantienen tras un error (no vuelven a la cuenta de demo). */
export function LoginForm({ demos }: { demos: { label: string; email: string; password: string }[] }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            autoCapitalize="none" autoCorrect="off" autoComplete="username" spellCheck={false} className="input" placeholder="tu@email.com" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Contraseña</label>
          <div className="relative">
            <input id="password" name="password" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
              autoCapitalize="none" autoCorrect="off" autoComplete="current-password" spellCheck={false} className="input pr-20" required />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-2 my-auto h-7 rounded-full px-2.5 text-xs text-mute hover:text-fg">
              {show ? "Ocultar" : "Mostrar"}
            </button>
          </div>
        </div>
        {state?.error && <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{state.error}</p>}
        <button type="submit" className="btn w-full !py-2.5" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
      </form>
      <div className="border-t border-line pt-4">
        <p className="text-xs text-mute">¿Solo quieres ver cómo funciona? Entra a una demo:</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {demos.map((d) => (
            <button key={d.email} type="button" className="chip hover:text-fg" onClick={() => { setEmail(d.email); setPassword(d.password); }}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
