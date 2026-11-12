// Schéma de déclaration d'un script (script.yaml). Documenté dans docs/format-script.md.
import { z } from 'zod';
import YAML from 'yaml';
import { SLUG_RE } from '../util/ids.js';

export const ParamTypes = ['text', 'number', 'boolean', 'choice', 'multichoice', 'file', 'secret'] as const;
export const PassModes = ['positional', 'option', 'env'] as const;
export const ConcurrencyPolicies = ['skip', 'queue', 'kill', 'parallel'] as const;
export const NotifyEvents = ['start', 'success', 'failure', 'final_failure', 'already_running', 'missing', 'lost'] as const;

export const ParamSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, 'nom de paramètre invalide'),
    label: z.string().optional(),
    description: z.string().optional(),
    type: z.enum(ParamTypes).default('text'),
    required: z.boolean().default(false),
    default: z.any().optional(),
    choices: z.array(z.union([z.string(), z.number()])).optional(),
    pass: z.enum(PassModes).default('positional'),
    // Nom de l'option (--nom) ou de la variable d'environnement ; par défaut dérivé de `name`.
    as: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    placeholder: z.string().optional(),
  })
  .strict();

export const RetrySchema = z
  .object({
    attempts: z.number().int().min(1).max(50).default(1),
    delay_seconds: z.number().min(0).default(30),
    factor: z.number().min(1).default(2),
    max_delay_seconds: z.number().min(0).default(3600),
    // Codes de sortie qui déclenchent un nouvel essai (vide = tous sauf ceux de `no_retry_on`).
    retry_on: z.array(z.number().int()).default([]),
    no_retry_on: z.array(z.number().int()).default([]),
  })
  .strict();

export const ScheduleSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    cron: z.string().min(1),
    timezone: z.string().optional(),
    enabled: z.boolean().default(true),
    // Décalage aléatoire maximal (secondes) ajouté à chaque occurrence.
    jitter_seconds: z.number().int().min(0).default(0),
    // Fenêtre horaire autorisée « HH:MM-HH:MM » (occurrences hors fenêtre ignorées).
    window: z
      .string()
      .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/)
      .optional(),
    // Jours exclus : dates ISO « 2026-12-25 » ou jours de semaine « sun », « sat ».
    exclude_days: z.array(z.string()).default([]),
    // Rattraper une occurrence manquée pendant un arrêt du service.
    catch_up: z.boolean().default(false),
    params: z.record(z.any()).default({}),
  })
  .strict();

export const NotifySchema = z
  .object({
    topic: z.string().optional(),
    server: z.string().optional(),
    token: z.string().optional(),
    events: z.array(z.enum(NotifyEvents)).default(['failure', 'final_failure', 'missing', 'lost']),
    priority: z.number().int().min(1).max(5).default(3),
    tags: z.array(z.string()).default([]),
  })
  .strict();

export const BinDepSchema = z
  .object({ name: z.string().min(1), url: z.string().url(), sha256: z.string().length(64).optional() })
  .strict();

export const DepsSchema = z
  .object({
    apt: z.array(z.string()).default([]),
    pip: z.array(z.string()).default([]),
    npm: z.array(z.string()).default([]),
    bin: z.array(BinDepSchema).default([]),
  })
  .strict();

export const ScriptSpecSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(''),
    group: z.string().optional(),
    icon: z.string().default('terminal'),
    color: z.string().default('#6366f1'),
    // Interpréteur : bash | sh | python3 | node, ou une commande libre via `command`.
    interpreter: z.enum(['bash', 'sh', 'python3', 'node']).optional(),
    command: z.string().optional(),
    file: z.string().min(1),
    workdir: z.string().optional(),
    env: z.record(z.string()).default({}),
    timeout_seconds: z.number().int().min(0).default(0),
    params: z.array(ParamSchema).default([]),
    concurrency: z.enum(ConcurrencyPolicies).default('skip'),
    retry: RetrySchema.default({}),
    schedules: z.array(ScheduleSchema).default([]),
    notify: NotifySchema.default({}),
    deps: DepsSchema.default({}),
    enabled: z.boolean().default(true),
  })
  .strict()
  .refine((s) => s.interpreter || s.command, { message: '`interpreter` ou `command` est requis' });

export type ScriptSpec = z.infer<typeof ScriptSpecSchema>;
export type ParamSpec = z.infer<typeof ParamSchema>;
export type ScheduleSpec = z.infer<typeof ScheduleSchema>;
export type RetrySpec = z.infer<typeof RetrySchema>;
export type NotifySpec = z.infer<typeof NotifySchema>;
export type DepsSpec = z.infer<typeof DepsSchema>;
export type NotifyEvent = (typeof NotifyEvents)[number];
export type ConcurrencyPolicy = (typeof ConcurrencyPolicies)[number];

export class SpecError extends Error {
  constructor(
    message: string,
    public readonly issues: string[] = [],
  ) {
    super(message);
  }
}

/** Analyse un script.yaml et renvoie la déclaration validée, avec valeurs par défaut. */
export function parseSpec(yamlText: string): ScriptSpec {
  let raw: unknown;
  try {
    raw = YAML.parse(yamlText);
  } catch (e) {
    throw new SpecError(`YAML invalide : ${(e as Error).message}`);
  }
  if (raw === null || typeof raw !== 'object') throw new SpecError('Le YAML doit décrire un objet');
  return validateSpec(raw);
}

/** Valide un objet déjà désérialisé (JSON venant de l'interface, par exemple). */
export function validateSpec(raw: unknown): ScriptSpec {
  const res = ScriptSpecSchema.safeParse(raw);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`);
    throw new SpecError(`Déclaration invalide : ${issues.join(' ; ')}`, issues);
  }
  const spec = res.data;
  // Identifiants stables pour les planifications sans `id` : index dans la liste.
  spec.schedules = spec.schedules.map((s, i) => ({ ...s, id: s.id ?? `s${i + 1}` }));
  const ids = new Set<string>();
  for (const s of spec.schedules) {
    if (ids.has(s.id!)) throw new SpecError(`Planification en double : ${s.id}`);
    ids.add(s.id!);
  }
  for (const p of spec.params) {
    if ((p.type === 'choice' || p.type === 'multichoice') && !p.choices?.length)
      throw new SpecError(`Le paramètre « ${p.name} » doit fournir des choix (choices)`);
  }
  return spec;
}

/** Sérialise une déclaration en YAML lisible (utilisé lors de l'édition depuis l'interface). */
export function stringifySpec(spec: ScriptSpec): string {
  const clean = JSON.parse(JSON.stringify(spec));
  return YAML.stringify(clean, { lineWidth: 100 });
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** Empreinte des dépendances : recréer l'environnement seulement quand elle change. */
export function depsFingerprint(deps: DepsSpec): string {
  const norm = {
    pip: [...deps.pip].sort(),
    npm: [...deps.npm].sort(),
    bin: [...deps.bin].sort((a, b) => a.name.localeCompare(b.name)),
    apt: [...deps.apt].sort(),
  };
  return JSON.stringify(norm);
}

export function hasDeps(deps: DepsSpec): boolean {
  return deps.pip.length + deps.npm.length + deps.bin.length + deps.apt.length > 0;
}
