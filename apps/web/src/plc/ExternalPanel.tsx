// SPDX-License-Identifier: AGPL-3.0-only
import type { IoPoint } from '@controlslab/plc-engine';
import { useT } from '../i18n';
import type { ExternalPlc } from './external';

/** Modbus table index (8·byte + bit) of a bit address, or NaN. */
const bitIndex = (addr: string) => {
  const m = /%[IQ]X(\d+)\.(\d)/i.exec(addr);
  return m ? Number(m[1]) * 8 + Number(m[2]) : NaN;
};

export function PlcSourceSwitch({ ext }: { ext: ExternalPlc }) {
  const { lang } = useT();
  const fr = lang === 'fr';
  return (
    <div className="seg" role="radiogroup" aria-label={fr ? 'Source de l’automate' : 'PLC source'}>
      <button role="radio" aria-checked={!ext.enabled} className={!ext.enabled ? 'sel' : ''} onClick={() => ext.setEnabled(false)} data-testid="plc-virtual">
        {fr ? 'Automate virtuel' : 'Virtual PLC'}
      </button>
      <button role="radio" aria-checked={ext.enabled} className={ext.enabled ? 'sel' : ''} onClick={() => ext.setEnabled(true)} data-testid="plc-external">
        {fr ? 'Automate externe (Modbus TCP)' : 'External PLC (Modbus TCP)'}
      </button>
    </div>
  );
}

export function ExternalPanel({ ext, ioPoints, inputs, outputs }: {
  ext: ExternalPlc;
  ioPoints: IoPoint[];
  /** PLC inputs currently sent to the connector. */
  inputs?: Record<string, boolean>;
  outputs: Record<string, boolean | number>;
}) {
  const { lang } = useT();
  const fr = lang === 'fr';
  const label: Record<string, string> = {
    disconnected: fr ? 'Déconnecté' : 'Disconnected',
    connecting: fr ? 'Connexion…' : 'Connecting…',
    connected: fr ? 'Connecté' : 'Connected',
    error: fr ? 'Erreur' : 'Error',
  };
  return (
    <div className="ext-panel" data-testid="external-panel">
      <p className="muted small">
        {fr
          ? 'Un automate ou un logiciel d’automate externe (maître Modbus TCP) lit les capteurs et pilote les sorties de la machine virtuelle par l’intermédiaire du connecteur ControlsLab, un petit programme à lancer sur votre ordinateur :'
          : 'An external PLC or PLC software (Modbus TCP master) reads the sensors and drives the virtual machine outputs through the ControlsLab connector, a small program to run on your computer:'}
      </p>
      <pre className="ext-cmd"><code>node controlslab-connector.mjs</code></pre>
      <p className="small">
        <a href="./downloads/controlslab-connector.mjs" download data-testid="ext-download">{fr ? 'Télécharger le connecteur' : 'Download the connector'}</a>{' '}
        <span className="muted">({fr ? 'Node.js 20 ou plus requis; Windows, macOS et Linux' : 'Node.js 20+ required; Windows, macOS and Linux'})</span>
      </p>
      <div className="row wrap">
        <label className="field inline" style={{ margin: 0 }}>
          <span>{fr ? 'Connecteur' : 'Connector'}</span>
          <input value={ext.url} onChange={(e) => ext.setUrl(e.target.value)} spellCheck={false} data-testid="ext-url" aria-label="URL" style={{ width: 220 }} />
        </label>
        {ext.state === 'connected' ? (
          <button onClick={ext.disconnect} data-testid="ext-disconnect">{fr ? 'Déconnecter' : 'Disconnect'}</button>
        ) : (
          <button className="primary" onClick={ext.connect} disabled={ext.state === 'connecting'} data-testid="ext-connect">{fr ? 'Connecter' : 'Connect'}</button>
        )}
        <span className={`badge-state ${ext.state}`} data-testid="ext-state">{label[ext.state]}</span>
      </div>
      {ext.error && <p className="alert bad small" data-testid="ext-error">{ext.error}</p>}
      {ext.state === 'connected' && ext.modbus && (
        <p className="alert ok small" data-testid="ext-info">
          {fr ? 'Serveur Modbus TCP' : 'Modbus TCP server'} : <code>{ext.modbus.host}:{ext.modbus.port}</code> · {fr ? 'maîtres connectés' : 'masters connected'} : <strong data-testid="ext-masters">{ext.masters}</strong>
        </p>
      )}
      <details className="small">
        <summary>{fr ? 'Cartographie des adresses' : 'Address map'}</summary>
        <p>
          <code>%IXb.p</code> {fr ? '(capteurs → automate) = entrée discrète' : '(sensors → PLC) = discrete input'} <strong>8·b + p</strong> ({fr ? 'lecture, fonction 02' : 'read, function 02'})<br />
          <code>%QXb.p</code> {fr ? '(automate → actionneurs) = bobine' : '(PLC → actuators) = coil'} <strong>8·b + p</strong> ({fr ? 'lecture 01, écriture 05/15' : 'read 01, write 05/15'})<br />
          {fr ? 'Adresses de base 0, ID d’unité ignoré. Ex. : %QX0.1 = bobine 1; %IX1.2 = entrée discrète 10.' : 'Zero-based addresses, unit ID ignored. E.g. %QX0.1 = coil 1; %IX1.2 = discrete input 10.'}
        </p>
        {ioPoints.length > 0 && (
          <table className="io">
            <tbody>
              {ioPoints.map((p) => {
                const idx = bitIndex(p.address);
                const on = p.area === 'Q' ? !!outputs[p.address] : !!inputs?.[p.address];
                return (
                  <tr key={p.address}>
                    <td><span className={`led ${on ? 'on' : ''}`} /></td>
                    <td><code>{p.address}</code></td>
                    <td>{p.area === 'Q' ? (fr ? 'bobine' : 'coil') : fr ? 'entrée discrète' : 'discrete input'} {Number.isFinite(idx) ? idx : ''}</td>
                    <td>{p.name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </details>
      <p className="muted small">
        {fr
          ? 'Le vérificateur de bon de travail exécute le programme du navigateur : pour être noté, repassez en « Automate virtuel ».'
          : 'The work-order checker runs the in-browser program: switch back to “Virtual PLC” to be scored.'}
      </p>
    </div>
  );
}
