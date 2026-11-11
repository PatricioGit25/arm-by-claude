"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions";

export function ActionForm({
  action,
  submit,
  children,
  className = "space-y-4",
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submit: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{state.error}</p>}
      {state?.ok && <p className="rounded-lg bg-arm/10 px-3 py-2 text-sm text-arm">{state.ok}</p>}
      <button className="btn w-full sm:w-auto" disabled={pending}>{pending ? "…" : submit}</button>
    </form>
  );
}
