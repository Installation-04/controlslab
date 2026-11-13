// SPDX-License-Identifier: AGPL-3.0-only
import {
  addAfter, addParallel, cloneWithNewIds, coil, contact, find, leaves, parentOf, removeNode, rung as newRung, toST, uid, updateNode, validateLd,
  type CmpOp, type ContactKind, type LdIssue, type LdProgram, type LdVar, type LogicNode, type Output, type Read, type Rung,
} from '@controlslab/ladder';
import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { LadderRung } from './LadderRung';

type Sel = { rung: string; node: string | null } | null;

function issueText(i: LdIssue, fr: boolean): string {
  const where = i.rung ? `${fr ? 'Échelon' : 'Rung'} ${i.rung} — ` : '';
  const d = i.detail ? ` (${i.detail})` : '';
  const M: Record<LdIssue['code'], [string, string]> = {
    bad_name: ['nom invalide', 'invalid name'],
    duplicate: ['nom en double', 'duplicate name'],
    unknown_var: ['variable inconnue', 'unknown variable'],
    write_input: ['on ne peut pas écrire sur une entrée', 'cannot write to an input'],
    bad_time: ['durée invalide (ex. T#5s)', 'invalid time (e.g. T#5s)'],
    bad_address: ['adresse invalide', 'invalid address'],
    empty_rung: ['échelon vide', 'empty rung'],
    not_bool: ['doit être de type BOOL', 'must be BOOL'],
    reserved: ['mot réservé', 'reserved word'],
  };
  return `${where}${M[i.code][fr ? 0 : 1]}${d}`;
}

export function LadderEditor({ program, onChange, read, readOnly }: {
  program: LdProgram;
  onChange(p: LdProgram): void;
  /** Live reader for power flow (running PLC). */
  read?: Read;
  readOnly?: boolean;
}) {
  const { lang } = useT();
  const fr = lang === 'fr';
  const L = (a: string, b: string) => (fr ? a : b);
  const [sel, setSel] = useState<Sel>(null);
  const issues = useMemo(() => validateLd(program), [program]);
  const names = useMemo(() => {
    const out = program.vars.map((v) => v.name);
    for (const r of program.rungs)
      for (const o of r.outputs) {
        if (o.t === 'timer') out.push(`${o.name}.Q`, `${o.name}.ET`);
        if (o.t === 'counter') out.push(`${o.name}.Q`, `${o.name}.CV`);
      }
    return out;
  }, [program]);

  const setRungs = (rungs: Rung[]) => onChange({ ...program, rungs });
  const patchRung = (id: string, f: (r: Rung) => Rung) => setRungs(program.rungs.map((r) => (r.id === id ? f(r) : r)));
  const selRung = sel ? program.rungs.find((r) => r.id === sel.rung) : undefined;
  const selNode = selRung?.logic && sel?.node ? find(selRung.logic, sel.node) : null;
  const selOut = selRung && sel?.node ? selRung.outputs.find((o) => o.id === sel.node) : undefined;
  const defaultVar = program.vars.find((v) => v.type === 'BOOL')?.name ?? '';

  const rungIndex = selRung ? program.rungs.indexOf(selRung) : -1;
  const move = (d: -1 | 1) => {
    const j = rungIndex + d;
    if (j < 0 || j >= program.rungs.length) return;
    const list = [...program.rungs];
    [list[rungIndex], list[j]] = [list[j]!, list[rungIndex]!];
    setRungs(list);
  };

  const dis = !!readOnly;
  const btn = (label: string, onClick: () => void, opts: { disabled?: boolean; primary?: boolean; testid?: string; danger?: boolean } = {}) => (
    <button className={`small ${opts.primary ? 'primary' : ''} ${opts.danger ? 'bad' : ''}`} disabled={dis || opts.disabled} onClick={onClick} data-testid={opts.testid}>{label}</button>
  );

  const selectLeaf = (id: string | null) => {
    if (!selRung) return;
    setSel({ rung: selRung.id, node: id });
  };

  return (
    <div className="ld-editor" data-testid="ld-editor">
      <div className="ld-toolbar">
        {btn(`+ ${L('Échelon', 'Rung')}`, () => {
          const r = newRung(null, []);
          const list = [...program.rungs];
          list.splice(rungIndex >= 0 ? rungIndex + 1 : list.length, 0, r);
          setRungs(list);
          setSel({ rung: r.id, node: null });
        }, { primary: true, testid: 'ld-add-rung' })}
        {selRung && (
          <>
            <span className="sep" />
            {btn(`+ ${L('Contact', 'Contact')}`, () => {
              const last = leaves(selRung.logic).at(-1);
              const c = contact(defaultVar);
              patchRung(selRung.id, (r) => ({ ...r, logic: addAfter(r.logic, selNode?.id ?? last?.id ?? null, c) }));
              setSel({ rung: selRung.id, node: c.id });
            }, { testid: 'ld-add-contact' })}
            {btn(`+ ${L('Branche parallèle', 'Parallel branch')}`, () => {
              const target = selNode?.id ?? selRung.logic?.id ?? null;
              const c = contact(defaultVar);
              patchRung(selRung.id, (r) => ({ ...r, logic: addParallel(r.logic, target, c) }));
              setSel({ rung: selRung.id, node: c.id });
            }, { testid: 'ld-add-parallel' })}
            {selNode && parentOf(selRung.logic, selNode.id) && btn(`↑ ${L('Groupe', 'Group')}`, () => setSel({ rung: selRung.id, node: parentOf(selRung.logic, selNode.id)!.id }), { testid: 'ld-parent' })}
            <span className="sep" />
            {btn(`+ ${L('Bobine', 'Coil')}`, () => {
              const o = coil(defaultVar);
              patchRung(selRung.id, (r) => ({ ...r, outputs: [...r.outputs, o] }));
              setSel({ rung: selRung.id, node: o.id });
            }, { testid: 'ld-add-coil' })}
            {btn(`+ ${L('Temporisateur', 'Timer')}`, () => {
              const o: Output = { id: uid('o'), t: 'timer', fb: 'TON', name: `T${program.rungs.flatMap((r) => r.outputs).filter((x) => x.t === 'timer').length + 1}`, pt: 'T#5s' };
              patchRung(selRung.id, (r) => ({ ...r, outputs: [...r.outputs, o] }));
              setSel({ rung: selRung.id, node: o.id });
            }, { testid: 'ld-add-timer' })}
            {btn(`+ ${L('Compteur', 'Counter')}`, () => {
              const o: Output = { id: uid('o'), t: 'counter', fb: 'CTU', name: `C${program.rungs.flatMap((r) => r.outputs).filter((x) => x.t === 'counter').length + 1}`, pv: 3 };
              patchRung(selRung.id, (r) => ({ ...r, outputs: [...r.outputs, o] }));
              setSel({ rung: selRung.id, node: o.id });
            }, { testid: 'ld-add-counter' })}
            <span className="sep" />
            {btn('↑', () => move(-1), { disabled: rungIndex <= 0 })}
            {btn('↓', () => move(1), { disabled: rungIndex >= program.rungs.length - 1 })}
            {btn(L('Dupliquer', 'Duplicate'), () => {
              const copy: Rung = { ...selRung, id: uid('r'), logic: selRung.logic ? cloneWithNewIds(selRung.logic) : null, outputs: selRung.outputs.map((o) => ({ ...o, id: uid('o') })) };
              const list = [...program.rungs];
              list.splice(rungIndex + 1, 0, copy);
              setRungs(list);
            })}
            {btn(L('Supprimer l’échelon', 'Delete rung'), () => {
              setRungs(program.rungs.filter((r) => r.id !== selRung.id));
              setSel(null);
            }, { danger: true, testid: 'ld-del-rung' })}
          </>
        )}
      </div>

      {selRung && (
        <div className="ld-props" data-testid="ld-props">
          <label className="field inline">
            <span>{L('Commentaire', 'Comment')}</span>
            <input value={selRung.comment ?? ''} disabled={dis} onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, comment: e.target.value || undefined }))} />
          </label>
          {selNode && (selNode.t === 'contact' || selNode.t === 'cmp') && (
            <div className="row wrap">
              {selNode.t === 'contact' ? (
                <>
                  <select value={selNode.k} disabled={dis} aria-label={L('Type de contact', 'Contact type')} data-testid="ld-kind" onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, logic: updateNode(r.logic, selNode.id, { k: e.target.value as ContactKind }) }))}>
                    <option value="NO">{L('NO — normalement ouvert', 'NO — normally open')}</option>
                    <option value="NC">{L('NF — normalement fermé', 'NC — normally closed')}</option>
                    <option value="P">{L('P — front montant', 'P — rising edge')}</option>
                    <option value="N">{L('N — front descendant', 'N — falling edge')}</option>
                  </select>
                  <input list="ld-names" value={selNode.v} disabled={dis} placeholder={L('variable', 'variable')} aria-label={L('Variable', 'Variable')} data-testid="ld-var" onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, logic: updateNode(r.logic, selNode.id, { v: e.target.value }) }))} />
                </>
              ) : (
                <>
                  <input list="ld-names" value={selNode.a} disabled={dis} onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, logic: updateNode(r.logic, selNode.id, { a: e.target.value }) }))} aria-label="A" />
                  <select value={selNode.op} disabled={dis} onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, logic: updateNode(r.logic, selNode.id, { op: e.target.value as CmpOp }) }))} aria-label="op">
                    {['=', '<>', '<', '>', '<=', '>='].map((o) => <option key={o}>{o}</option>)}
                  </select>
                  <input list="ld-names" value={selNode.b} disabled={dis} onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, logic: updateNode(r.logic, selNode.id, { b: e.target.value }) }))} aria-label="B" />
                </>
              )}
              {btn(L('Supprimer', 'Delete'), () => {
                patchRung(selRung.id, (r) => ({ ...r, logic: removeNode(r.logic, selNode.id) }));
                setSel({ rung: selRung.id, node: null });
              }, { danger: true, testid: 'ld-del-node' })}
              {btn(L('Contact → comparaison', 'Contact → compare'), () => {
                if (selNode.t !== 'contact') return;
                patchRung(selRung.id, (r) => {
                  const repl: LogicNode = { id: selNode.id, t: 'cmp', a: selNode.v, op: '>=', b: '1' };
                  return { ...r, logic: mapNode(r.logic, selNode.id, repl) };
                });
              }, { disabled: selNode.t !== 'contact' })}
            </div>
          )}
          {selNode && (selNode.t === 'series' || selNode.t === 'parallel') && (
            <div className="row wrap">
              <span className="muted small">{selNode.t === 'series' ? L('Groupe en série', 'Series group') : L('Groupe en parallèle', 'Parallel group')}</span>
              {btn(L('Supprimer le groupe', 'Delete group'), () => {
                patchRung(selRung.id, (r) => ({ ...r, logic: removeNode(r.logic, selNode.id) }));
                setSel({ rung: selRung.id, node: null });
              }, { danger: true })}
            </div>
          )}
          {selOut && (
            <div className="row wrap" data-testid="ld-out-props">
              {selOut.t === 'coil' && (
                <>
                  <select value={selOut.k} disabled={dis} aria-label={L('Type de bobine', 'Coil type')} data-testid="ld-coil-kind" onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, outputs: r.outputs.map((o) => (o.id === selOut.id ? { ...selOut, k: e.target.value as 'normal' } : o)) }))}>
                    <option value="normal">( ) {L('normale', 'normal')}</option>
                    <option value="negated">(/) {L('inversée', 'negated')}</option>
                    <option value="set">(S) {L('mise à 1', 'set')}</option>
                    <option value="reset">(R) {L('mise à 0', 'reset')}</option>
                  </select>
                  <input list="ld-names" value={selOut.v} disabled={dis} aria-label={L('Variable', 'Variable')} data-testid="ld-coil-var" onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, outputs: r.outputs.map((o) => (o.id === selOut.id ? { ...selOut, v: e.target.value } : o)) }))} />
                </>
              )}
              {selOut.t === 'timer' && (
                <>
                  <select value={selOut.fb} disabled={dis} aria-label="FB" onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, outputs: r.outputs.map((o) => (o.id === selOut.id ? { ...selOut, fb: e.target.value as 'TON' } : o)) }))}>
                    <option>TON</option><option>TOF</option><option>TP</option>
                  </select>
                  <input value={selOut.name} disabled={dis} aria-label={L('Nom', 'Name')} onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, outputs: r.outputs.map((o) => (o.id === selOut.id ? { ...selOut, name: e.target.value } : o)) }))} />
                  <input value={selOut.pt} disabled={dis} aria-label="PT" placeholder="T#5s" onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, outputs: r.outputs.map((o) => (o.id === selOut.id ? { ...selOut, pt: e.target.value } : o)) }))} />
                </>
              )}
              {selOut.t === 'counter' && (
                <>
                  <select value={selOut.fb} disabled={dis} aria-label="FB" onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, outputs: r.outputs.map((o) => (o.id === selOut.id ? { ...selOut, fb: e.target.value as 'CTU' } : o)) }))}>
                    <option>CTU</option><option>CTD</option>
                  </select>
                  <input value={selOut.name} disabled={dis} aria-label={L('Nom', 'Name')} onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, outputs: r.outputs.map((o) => (o.id === selOut.id ? { ...selOut, name: e.target.value } : o)) }))} />
                  <input type="number" value={selOut.pv} disabled={dis} aria-label="PV" onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, outputs: r.outputs.map((o) => (o.id === selOut.id ? { ...selOut, pv: Number(e.target.value) } : o)) }))} />
                  <input list="ld-names" value={selOut.reset ?? ''} disabled={dis} aria-label="R" placeholder={L('remise à zéro', 'reset var')} onChange={(e) => patchRung(selRung.id, (r) => ({ ...r, outputs: r.outputs.map((o) => (o.id === selOut.id ? { ...selOut, reset: e.target.value || undefined } : o)) }))} />
                </>
              )}
              {btn(L('Supprimer', 'Delete'), () => {
                patchRung(selRung.id, (r) => ({ ...r, outputs: r.outputs.filter((o) => o.id !== selOut.id) }));
                setSel({ rung: selRung.id, node: null });
              }, { danger: true, testid: 'ld-del-out' })}
            </div>
          )}
        </div>
      )}

      <datalist id="ld-names">{names.map((n) => <option key={n} value={n} />)}</datalist>

      <div className="ld-rungs">
        {program.rungs.length === 0 && <p className="muted">{L('Aucun échelon. Cliquez « + Échelon » pour commencer.', 'No rungs yet. Click “+ Rung” to start.')}</p>}
        {program.rungs.map((r, i) => (
          <div key={r.id} onClick={() => setSel({ rung: r.id, node: null })}>
            <LadderRung
              rung={r}
              index={i}
              read={read}
              selectedRung={sel?.rung === r.id}
              selected={sel?.rung === r.id ? sel.node : null}
              onSelect={(id) => {
                setSel({ rung: r.id, node: id });
                if (id === null) selectLeaf(null);
              }}
            />
          </div>
        ))}
      </div>

      <VarTable vars={program.vars} onChange={(vars) => onChange({ ...program, vars })} readOnly={dis} fr={fr} />

      {issues.length > 0 && (
        <ul className="issues" data-testid="ld-issues">
          {issues.map((i, k) => <li key={k} className={i.level}>{issueText(i, fr)}</li>)}
        </ul>
      )}

      <details className="ld-st">
        <summary>{L('Voir le Structured Text généré', 'Show generated Structured Text')}</summary>
        <pre data-testid="ld-st">{toST(program)}</pre>
      </details>
    </div>
  );
}

function mapNode(n: LogicNode | null, id: string, repl: LogicNode): LogicNode | null {
  if (!n) return null;
  if (n.id === id) return repl;
  if (n.t === 'series' || n.t === 'parallel') return { ...n, items: n.items.map((c) => mapNode(c, id, repl)!) };
  return n;
}

function VarTable({ vars, onChange, readOnly, fr }: { vars: LdVar[]; onChange(v: LdVar[]): void; readOnly: boolean; fr: boolean }) {
  const set = (i: number, patch: Partial<LdVar>) => onChange(vars.map((v, k) => (k === i ? { ...v, ...patch } : v)));
  return (
    <details className="ld-vars" open={vars.length < 12}>
      <summary>{fr ? 'Variables et adresses d’E/S' : 'Variables and I/O addresses'} ({vars.length})</summary>
      <table className="iomap">
        <thead><tr><th>{fr ? 'Nom' : 'Name'}</th><th>{fr ? 'Type' : 'Type'}</th><th>{fr ? 'Adresse' : 'Address'}</th><th /></tr></thead>
        <tbody>
          {vars.map((v, i) => (
            <tr key={i}>
              <td><input value={v.name} disabled={readOnly} aria-label={fr ? 'Nom' : 'Name'} onChange={(e) => set(i, { name: e.target.value })} /></td>
              <td>
                <select value={v.type} disabled={readOnly} onChange={(e) => set(i, { type: e.target.value as LdVar['type'] })}>
                  {['BOOL', 'INT', 'DINT', 'REAL', 'TIME'].map((t) => <option key={t}>{t}</option>)}
                </select>
              </td>
              <td><input value={v.address ?? ''} placeholder="%IX0.0" disabled={readOnly} aria-label={fr ? 'Adresse' : 'Address'} onChange={(e) => set(i, { address: e.target.value.toUpperCase() || undefined })} /></td>
              <td><button className="small ghost" disabled={readOnly} aria-label={fr ? 'Supprimer la variable' : 'Delete variable'} onClick={() => onChange(vars.filter((_, k) => k !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="small" disabled={readOnly} data-testid="ld-add-var" onClick={() => onChange([...vars, { name: `Var${vars.length + 1}`, type: 'BOOL' }])}>+ {fr ? 'Variable' : 'Variable'}</button>
    </details>
  );
}
