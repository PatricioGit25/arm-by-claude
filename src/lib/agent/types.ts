import type { Agency, Lang, Lead, LeadProfile, Message, Property } from "../db/schema";

export interface ContactPatch {
  name?: string;
  email?: string;
  phone?: string;
  language?: Lang;
}

/** Lo que el agente decidió durante un turno. El motor (engine.ts) lo aplica. */
export interface TurnState {
  profilePatch: Partial<LeadProfile>;
  contactPatch: ContactPatch;
  handoff?: { reason: string; summary: string };
  visit?: { propertyRef?: string; preferredTime: string };
  shownRefs: string[];
}

export interface AgentInput {
  agency: Agency;
  lead: Lead;
  history: Message[]; // incluye el último mensaje del lead
  catalog: Property[]; // propiedades disponibles de la inmobiliaria
}

export interface AgentOutput {
  reply: string;
  state: TurnState;
  engine: "claude" | "demo";
}

export function emptyTurnState(): TurnState {
  return { profilePatch: {}, contactPatch: {}, shownRefs: [] };
}
