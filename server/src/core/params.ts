// Paramètres d'un lancement : validation, coercition, passage en argv / options / environnement, masquage des secrets.
import type { ParamSpec, ScriptSpec } from './spec.js';

export class ParamError extends Error {}

export type ParamValues = Record<string, unknown>;

/** Valeur par défaut applicable à un paramètre. */
function defaultFor(p: ParamSpec): unknown {
  if (p.default !== undefined) return p.default;
  switch (p.type) {
    case 'boolean':
      return false;
    case 'multichoice':
      return [];
    default:
      return undefined;
  }
}

/** Valide et normalise les valeurs reçues ; lève ParamError avec un message lisible. */
export function resolveParams(spec: ScriptSpec, input: ParamValues | undefined): ParamValues {
  const out: ParamValues = {};
  const given = input ?? {};
  for (const p of spec.params) {
    let v = given[p.name];
    if (v === '' || v === undefined || v === null) v = defaultFor(p);
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0 && p.required)) {
      if (p.required) throw new ParamError(`Le paramètre « ${p.label ?? p.name} » est obligatoire`);
      if (v === undefined || v === null) continue;
    }
    switch (p.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) throw new ParamError(`« ${p.label ?? p.name} » doit être un nombre`);
        if (p.min !== undefined && n < p.min) throw new ParamError(`« ${p.label ?? p.name} » doit être ≥ ${p.min}`);
        if (p.max !== undefined && n > p.max) throw new ParamError(`« ${p.label ?? p.name} » doit être ≤ ${p.max}`);
        out[p.name] = n;
        break;
      }
      case 'boolean':
        out[p.name] = v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
        break;
      case 'choice': {
        const s = String(v);
        if (!p.choices!.map(String).includes(s)) throw new ParamError(`« ${p.label ?? p.name} » : valeur « ${s} » non autorisée`);
        out[p.name] = s;
        break;
      }
      case 'multichoice': {
        const arr = Array.isArray(v) ? v.map(String) : String(v).split(',').map((s) => s.trim()).filter(Boolean);
        for (const s of arr)
          if (!p.choices!.map(String).includes(s)) throw new ParamError(`« ${p.label ?? p.name} » : valeur « ${s} » non autorisée`);
        out[p.name] = arr;
        break;
      }
      case 'file':
        // La route de lancement remplace la valeur par le chemin du fichier téléversé.
        out[p.name] = String(v);
        break;
      default:
        out[p.name] = String(v);
    }
  }
  return out;
}

function asString(v: unknown): string {
  if (Array.isArray(v)) return v.join(',');
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}

function envName(p: ParamSpec): string {
  return (p.as ?? p.name).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

/** Construit les arguments et variables d'environnement à partir des valeurs résolues. */
export function buildInvocation(spec: ScriptSpec, values: ParamValues): { args: string[]; env: Record<string, string> } {
  const args: string[] = [];
  const env: Record<string, string> = {};
  for (const p of spec.params) {
    const v = values[p.name];
    if (v === undefined) continue;
    switch (p.pass) {
      case 'positional':
        args.push(asString(v));
        break;
      case 'option': {
        const opt = `--${p.as ?? p.name}`;
        if (p.type === 'boolean') {
          if (v) args.push(opt);
        } else if (p.type === 'multichoice' && Array.isArray(v)) {
          for (const item of v) args.push(opt, String(item));
        } else {
          args.push(opt, asString(v));
        }
        break;
      }
      case 'env':
        env[envName(p)] = asString(v);
        break;
    }
  }
  // Toutes les valeurs sont aussi exposées en SN_PARAM_<NOM>, pratique pour les scripts.
  for (const p of spec.params) {
    const v = values[p.name];
    if (v !== undefined) env[`SN_PARAM_${envName(p)}`] = asString(v);
  }
  return { args, env };
}

/** Copie des valeurs avec les secrets masqués (stockage en base, affichage). */
export function maskSecrets(spec: ScriptSpec, values: ParamValues): ParamValues {
  const out: ParamValues = { ...values };
  for (const p of spec.params) if (p.type === 'secret' && out[p.name] !== undefined) out[p.name] = '••••••';
  return out;
}
