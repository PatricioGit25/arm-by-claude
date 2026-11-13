import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { properties } from "@/lib/db/schema";
import { formatPrice } from "@/lib/scoring";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { DictationTextarea } from "@/components/DictationTextarea";
import { addPropertyVoiceAction, createPropertyAction, setPropertyStatusAction, syncFeedAction, updatePropertyAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  const { agency } = await requireUser();
  const db = await getDb();
  const list = await db.select().from(properties).where(eq(properties.agencyId, agency.id)).orderBy(desc(properties.createdAt));
  const vacation = agency.vertical === "vacacional";

  return (
    <div className="space-y-6">
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card">
        <h2 className="font-semibold">🎤 Dictar {vacation ? "un alojamiento" : "una propiedad"}</h2>
        <p className="mb-3 mt-1 text-sm text-mute">Al salir de la visita, dicta lo que has visto. El ARM crea la ficha, redacta la descripción en español, inglés y sueco y avisa a los clientes a los que les encaja.</p>
        <ActionForm action={addPropertyVoiceAction} submit="Crear ficha">
          <DictationTextarea name="note" rows={4} serverStt={!!process.env.ELEVENLABS_API_KEY}
            placeholder="Ej.: Piso en Burriana, 2 habitaciones, 2 baños, 85 metros, terraza con vistas al mar, piscina comunitaria, 285 mil. Propietaria María 600 123 456." />
        </ActionForm>
      </section>
      <section className="card">
        <h2 className="font-semibold">🔄 Conexión con tu CRM</h2>
        {agency.feedUrl ? (
          <>
            <p className="mt-1 text-sm text-mute">Las propiedades se cargan solas desde tu CRM cada día. Última sincronización: {agency.feedSyncedAt ? agency.feedSyncedAt.toLocaleString("es-ES", { timeZone: agency.timezone, dateStyle: "short", timeStyle: "short" }) : "nunca"}.</p>
            {agency.feedStatus && <p className={`mt-2 rounded-lg px-3 py-2 text-xs ${agency.feedStatus.startsWith("✓") ? "bg-arm/10 text-arm" : "bg-hot/10 text-hot"}`}>{agency.feedStatus}</p>}
            <div className="mt-3"><ActionForm action={syncFeedAction} submit="Sincronizar ahora">{null}</ActionForm></div>
          </>
        ) : (
          <p className="mt-1 text-sm text-mute">
            ¿Usas Inmovilla, Witei, Mobilia u otro CRM? Pega el enlace del feed XML que usáis para Kyero u otros portales en{" "}
            <Link href="/app/settings" className="text-arm underline">Ajustes</Link> y tus propiedades se cargarán solas, sin escribir nada.
          </p>
        )}
      </section>
    </div>
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="lg:col-span-2">
        <h1 className="mb-1 text-2xl font-bold">{vacation ? "Alojamientos" : "Propiedades"} <span className="text-base font-normal text-mute">({list.length})</span></h1>
        <p className="mb-4 text-sm text-mute">{vacation
          ? "La IA solo recomienda alojamientos de esta lista y da los datos privados (códigos, wifi) únicamente a huéspedes confirmados."
          : "La IA solo ofrece propiedades de este catálogo. Al cargar una nueva, avisa sola a los compradores que encajan."}</p>
        <div className="space-y-2">
          {list.map((p) => (
            <div key={p.id} className="card flex flex-wrap items-center justify-between gap-3 !p-4">
              <div className="min-w-0">
                <p className="truncate font-semibold"><span className="text-mute">{p.ref}</span> · {p.title}</p>
                <p className="text-sm text-mute">{vacation
                  ? `${p.type} · hasta ${p.maxGuests} pers. · ${p.areaM2} m² · ${p.town}${p.zone ? ` (${p.zone})` : ""}${p.bookingUrl ? "" : " · sin enlace de reserva"}`
                  : `${p.type} · ${p.bedrooms} dorm · ${p.areaM2} m² · ${p.town}${p.zone ? ` (${p.zone})` : ""}`}</p>
                <p className="mt-1 flex flex-wrap gap-2 text-[11px] text-mute">
                  {p.origin !== "manual" && <span className="chip">{p.origin === "feed" ? "Desde tu CRM" : "Dictada"}</span>}
                  {p.ownerContact && <span className="chip">🔒 Propietario: {p.ownerContact}</span>}
                </p>
                {p.origin === "voz" && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-arm">Revisar y completar</summary>
                    <form action={updatePropertyAction} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <input type="hidden" name="id" value={p.id} />
                      <input name="title" defaultValue={p.title} className="input col-span-2 sm:col-span-4" aria-label="Título" />
                      <input name="price" type="number" defaultValue={p.price || ""} placeholder="Precio €" className="input" aria-label="Precio" />
                      <input name="bedrooms" type="number" defaultValue={p.bedrooms || ""} placeholder="Dorm." className="input" aria-label="Dormitorios" />
                      <input name="area" type="number" defaultValue={p.areaM2 || ""} placeholder="m²" className="input" aria-label="Metros" />
                      <button className="btn-ghost">Guardar</button>
                    </form>
                    <p className="mt-2 whitespace-pre-line text-mute">{p.description}</p>
                  </details>
                )}
              </div>
              <div className="flex items-center gap-3">
                {!vacation && <span className={`font-bold ${p.price ? "text-arm" : "text-hot"}`}>{p.price ? formatPrice(p.price) : "Sin precio"}</span>}
                <form action={setPropertyStatusAction} className="flex gap-1">
                  <input type="hidden" name="id" value={p.id} />
                  <select name="status" defaultValue={p.status} className="input !w-auto !py-1 text-xs">
                    <option value="disponible">{vacation ? "Activo" : "Disponible"}</option><option value="reservada">{vacation ? "Bloqueado" : "Reservada"}</option><option value="vendida">{vacation ? "Retirado" : "Vendida"}</option>{p.status === "retirada" && <option value="retirada">Retirada del CRM</option>}
                  </select>
                  <button className="btn-ghost !px-2 !py-1 text-xs">OK</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="card h-fit">
        <h2 className="mb-3 font-semibold">{vacation ? "Nuevo alojamiento" : "Nueva propiedad"}</h2>
        <ActionForm action={createPropertyAction} submit={vacation ? "Guardar alojamiento" : "Publicar y avisar a compradores"} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Referencia</label><input name="ref" className="input" placeholder="NJ-110" required /></div>
            <div><label className="label">Tipo</label>
              <select name="type" className="input">{["apartamento", "atico", "estudio", "casa", "villa", "terreno"].map((t) => <option key={t}>{t}</option>)}</select>
            </div>
          </div>
          <div><label className="label">Título</label><input name="title" className="input" required /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Pueblo</label><input name="town" className="input" defaultValue={agency.town} required /></div>
            <div><label className="label">Zona</label><input name="zone" className="input" /></div>
            {vacation ? (
              <>
                <div><label className="label">Personas máx.</label><input name="maxGuests" type="number" className="input" required /></div>
                <div><label className="label">m²</label><input name="area" type="number" className="input" /></div>
                <div><label className="label">Mascotas</label>
                  <select name="pets" className="input"><option value="consultar">Consultar</option><option value="si">Sí</option><option value="no">No</option></select>
                </div>
                <div><label className="label">Dormitorios</label><input name="bedrooms" type="number" className="input" /></div>
              </>
            ) : (
              <>
                <div><label className="label">Precio (€)</label><input name="price" type="number" className="input" required /></div>
                <div><label className="label">m²</label><input name="area" type="number" className="input" /></div>
                <div><label className="label">Dormitorios</label><input name="bedrooms" type="number" className="input" /></div>
                <div><label className="label">Baños</label><input name="bathrooms" type="number" className="input" /></div>
              </>
            )}
          </div>
          {vacation && (
            <>
              <div><label className="label">Enlace de reserva (Lodgify, web…)</label><input name="bookingUrl" type="url" className="input" placeholder="https://" /></div>
              <div><label className="label">Info privada para huéspedes</label><textarea name="guestInfo" rows={3} className="input" placeholder="Código del cajetín, wifi, parking, basura…" /></div>
            </>
          )}
          <div><label className="label">Características (separadas por comas)</label><input name="features" className="input" placeholder="vistas al mar, piscina" /></div>
          <div><label className="label">Descripción</label><textarea name="description" rows={3} className="input" /></div>
        </ActionForm>
      </section>
    </div>
    </div>
  );
}
