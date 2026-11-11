import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { properties } from "@/lib/db/schema";
import { formatPrice } from "@/lib/scoring";
import { ActionForm } from "@/components/ActionForm";
import { createPropertyAction, setPropertyStatusAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  const { agency } = await requireUser();
  const db = await getDb();
  const list = await db.select().from(properties).where(eq(properties.agencyId, agency.id)).orderBy(desc(properties.createdAt));
  const vacation = agency.vertical === "vacacional";

  return (
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
              </div>
              <div className="flex items-center gap-3">
                {!vacation && <span className="font-bold text-arm">{formatPrice(p.price)}</span>}
                <form action={setPropertyStatusAction} className="flex gap-1">
                  <input type="hidden" name="id" value={p.id} />
                  <select name="status" defaultValue={p.status} className="input !w-auto !py-1 text-xs">
                    <option value="disponible">{vacation ? "Activo" : "Disponible"}</option><option value="reservada">{vacation ? "Bloqueado" : "Reservada"}</option><option value="vendida">{vacation ? "Retirado" : "Vendida"}</option>
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
  );
}
