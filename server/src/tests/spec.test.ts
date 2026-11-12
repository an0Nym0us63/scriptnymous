import { describe, expect, it } from 'vitest';
import { depsFingerprint, parseSpec, SpecError, stringifySpec } from '../core/spec.js';
import { buildInvocation, maskSecrets, ParamError, resolveParams } from '../core/params.js';

const FULL = `
name: Sauvegarde
description: Sauvegarde nocturne
group: Maison
interpreter: bash
file: backup.sh
timeout_seconds: 600
params:
  - name: cible
    type: choice
    choices: [nas, cloud]
    default: nas
  - name: dry_run
    type: boolean
    pass: option
    as: dry-run
  - name: token
    type: secret
    pass: env
  - name: tags
    type: multichoice
    choices: [a, b, c]
    pass: option
concurrency: queue
retry:
  attempts: 3
  delay_seconds: 10
schedules:
  - cron: "0 3 * * *"
    jitter_seconds: 60
    window: "02:00-05:00"
    exclude_days: [sun, 2026-12-25]
    catch_up: true
notify:
  events: [failure, final_failure]
  tags: [floppy_disk]
deps:
  apt: [rsync]
  pip: [requests==2.32.0]
`;

describe('parseSpec', () => {
  it('lit une déclaration complète avec les valeurs par défaut', () => {
    const s = parseSpec(FULL);
    expect(s.name).toBe('Sauvegarde');
    expect(s.schedules[0].id).toBe('s1');
    expect(s.schedules[0].timezone).toBeUndefined();
    expect(s.retry.factor).toBe(2);
    expect(s.params[1].pass).toBe('option');
    expect(s.deps.npm).toEqual([]);
    expect(s.enabled).toBe(true);
  });

  it('refuse une déclaration sans interpréteur ni commande', () => {
    expect(() => parseSpec('name: x\nfile: a.sh\n')).toThrow(SpecError);
  });

  it('refuse un choix sans liste de choix', () => {
    expect(() => parseSpec('name: x\ninterpreter: bash\nfile: a.sh\nparams:\n  - name: p\n    type: choice\n')).toThrow(/choix/);
  });

  it('refuse les clés inconnues et le YAML cassé', () => {
    expect(() => parseSpec('name: x\ninterpreter: bash\nfile: a.sh\nfoo: 1\n')).toThrow(/foo/);
    expect(() => parseSpec('name: [')).toThrow(/YAML invalide/);
  });

  it('refuse deux planifications avec le même id', () => {
    expect(() => parseSpec('name: x\ninterpreter: bash\nfile: a.sh\nschedules:\n  - {id: a, cron: "* * * * *"}\n  - {id: a, cron: "* * * * *"}\n')).toThrow(/double/);
  });

  it('sérialise puis relit à l’identique', () => {
    const s = parseSpec(FULL);
    const again = parseSpec(stringifySpec(s));
    expect(again).toEqual(s);
  });

  it('calcule une empreinte de dépendances insensible à l’ordre', () => {
    const a = parseSpec(FULL).deps;
    const b = { ...a, apt: [...a.apt].reverse() };
    expect(depsFingerprint(a)).toBe(depsFingerprint(b));
  });
});

describe('paramètres', () => {
  const spec = parseSpec(FULL);

  it('applique les valeurs par défaut et valide les choix', () => {
    const v = resolveParams(spec, {});
    expect(v.cible).toBe('nas');
    expect(v.dry_run).toBe(false);
    expect(() => resolveParams(spec, { cible: 'ailleurs' })).toThrow(ParamError);
  });

  it('construit arguments et environnement', () => {
    const v = resolveParams(spec, { cible: 'cloud', dry_run: 'true', token: 'abc', tags: ['a', 'c'] });
    const { args, env } = buildInvocation(spec, v);
    expect(args).toEqual(['cloud', '--dry-run', '--tags', 'a', '--tags', 'c']);
    expect(env.TOKEN).toBe('abc');
    expect(env.SN_PARAM_CIBLE).toBe('cloud');
  });

  it('masque les secrets', () => {
    const v = resolveParams(spec, { token: 'abc' });
    expect(maskSecrets(spec, v).token).toBe('••••••');
  });

  it('exige les paramètres obligatoires', () => {
    const s = parseSpec('name: x\ninterpreter: bash\nfile: a.sh\nparams:\n  - name: p\n    required: true\n');
    expect(() => resolveParams(s, {})).toThrow(/obligatoire/);
  });
});

describe('identifiants', () => {
  it('accepte des chemins imbriqués, majuscules et espaces, refuse les chemins dangereux', async () => {
    const { isValidSlug } = await import('../core/spec.js');
    for (const ok of ['hello-bash', 'Photos', 'Photos/Tri doublons', 'a/b/c/d', 'sauvegarde_2026']) expect(isValidSlug(ok), ok).toBe(true);
    for (const ko of ['', '../x', 'a/../b', '.cache', 'a//b', 'a/', '/a', 'a:b', 'a?b', ' a', 'a/ b']) expect(isValidSlug(ko), ko).toBe(false);
  });
});
