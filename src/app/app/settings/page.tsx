import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { addAgentUserAction, updateSettingsAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { agency } = await requireUser();
  const db = await getDb();
  const team = await db.select().from(users).where(eq(users.agencyId, agency.id));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card">
        <h1 className="mb-4 text-lg font-semibold">Inmobiliaria y asistente</h1>
        <ActionForm action={updateSettingsAction} submit="Guardar">
          <div><label className="label">Nombre</label><input name="name" className="input" defaultValue={agency.name} /></div>
          <div><label className="label">Pueblo / zona</label><input name="town" className="input" defaultValue={agency.town} /></div>
          <div><label className="label">Nombre del asistente de IA</label><input name="assistant" className="input" defaultValue={agency.assistantName} /></div>
          <div>
            <label className="label">Puntaje para pasar al agente ({agency.handoffThreshold})</label>
            <input name="threshold" type="number" min={30} max={100} className="input" defaultValue={agency.handoffThreshold} />
            <p className="mt-1 text-xs text-mute">Más bajo = te llegan más leads, pero menos filtrados.</p>
          </div>
          <div><label className="label">WhatsApp del agente (para avisos)</label><input name="agentPhone" className="input" defaultValue={agency.agentPhone ?? ""} placeholder="+34 600 000 000" /></div>
          <div><label className="label">WhatsApp Business · phone_number_id</label><input name="waId" className="input" defaultValue={agency.waPhoneNumberId ?? ""} /></div>
        </ActionForm>
      </section>

      <div className="space-y-6">
        <section className="card">
          <h2 className="mb-2 font-semibold">Canales</h2>
          <p className="text-sm text-mute">Chat web (pon este enlace en tu web, Instagram o anuncios):</p>
          <code className="mt-1 block break-all rounded-lg bg-panel2 p-2 text-xs text-arm">/chat/{agency.slug}</code>
          <p className="mt-3 text-sm text-mute">Webhook de WhatsApp (Meta Cloud API):</p>
          <code className="mt-1 block break-all rounded-lg bg-panel2 p-2 text-xs text-arm">/api/whatsapp</code>
        </section>
        <section className="card">
          <h2 className="mb-2 font-semibold">Equipo</h2>
          <ul className="mb-4 space-y-1 text-sm">{team.map((u) => <li key={u.id}>{u.name} <span className="text-mute">· {u.email} · {u.role === "owner" ? "propietario" : "agente"}</span></li>)}</ul>
          <ActionForm action={addAgentUserAction} submit="Añadir agente" className="space-y-2">
            <input name="name" className="input" placeholder="Nombre" />
            <input name="email" type="email" className="input" placeholder="Email" />
            <input name="password" type="password" className="input" placeholder="Contraseña inicial (8+)" />
          </ActionForm>
        </section>
      </div>
    </div>
  );
}
