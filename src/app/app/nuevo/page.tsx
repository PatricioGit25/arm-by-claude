import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/ActionForm";
import { DictationTextarea } from "@/components/DictationTextarea";
import { addNoteAction, importEmailAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function NewLeadPage() {
  const { agency } = await requireUser();
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const vacation = agency.vertical === "vacacional";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card">
        <h1 className="text-lg font-semibold">📞 Llamada o visita a la oficina</h1>
        <p className="mb-4 mt-1 text-sm text-mute">
          Al colgar o cuando el cliente se va, dicta o escribe en una frase quién es y qué busca. La IA crea la ficha,
          le busca opciones y redacta el primer WhatsApp para que lo envíes con un toque.
        </p>
        <ActionForm action={addNoteAction} submit="Crear ficha y mensaje">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="source">Cómo llegó</label>
              <select id="source" name="source" className="input">
                <option>Llamada</option>
                <option>Visita a la oficina</option>
                <option>Otro</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="language">Idioma del cliente</label>
              <select id="language" name="language" className="input" defaultValue="">
                <option value="">Detectar</option>
                <option value="es">Español</option>
                <option value="en">English</option>
                <option value="sv">Svenska</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Nota</label>
            <DictationTextarea
              name="note"
              placeholder={vacation
                ? "Ej.: Llamó Ana, son 4 con un perro, del 10 al 17 de agosto, quiere piscina. Teléfono 600 123 456."
                : "Ej.: Llamó Juan, sueco, busca piso de 2 habitaciones en Nerja, hasta 250 mil, al contado. Teléfono +46 70 123 45 67."}
            />
          </div>
        </ActionForm>
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold">📥 Email de Idealista u otro portal</h2>
        <p className="mb-4 mt-1 text-sm text-mute">
          Pega el email de aviso del portal tal cual (Idealista, Fotocasa, Rightmove, Kyero…). La IA saca los datos del
          cliente, crea la ficha y le prepara la respuesta.
        </p>
        <ActionForm action={importEmailAction} submit="Importar contacto">
          <textarea name="email" rows={9} className="input" placeholder="Pega aquí el email completo del portal…" required />
        </ActionForm>
        <div className="mt-5 rounded-xl bg-panel2 p-3 text-xs text-mute">
          <p className="font-semibold text-white">Para que entren solos</p>
          <p className="mt-1">Reenvía automáticamente los emails del portal a un servicio de correo entrante (Postmark, CloudMailin, Make, Zapier…) que los envíe a este buzón:</p>
          <code className="mt-2 block break-all rounded-lg bg-ink p-2 text-arm">{base}/api/inbound/email/{agency.inboundToken}</code>
          <p className="mt-2">Es privado: quien tenga esta dirección puede crear contactos en tu cuenta.</p>
        </div>
      </section>
    </div>
  );
}
