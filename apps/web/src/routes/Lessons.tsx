// SPDX-License-Identifier: AGPL-3.0-only
import type { Lesson } from '@controlslab/content';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { OhmCalc } from '../components/OhmCalc';
import { useRegistry } from '../content';
import { useT } from '../i18n';
import { Schematic } from '../lab/Schematic';
import { actions, useProgress } from '../store/progress';
import { Machine } from '@controlslab/sim';
import { useMemo } from 'react';

export function LessonsList() {
  const { t, loc } = useT();
  const reg = useRegistry();
  const progress = useProgress();
  return (
    <main className="page">
      <h1>{t('nav.lessons')}</h1>
      <ol className="cards">
        {reg.lessons.map((l) => {
          const done = progress.lessons[l.id]?.done;
          const missing = l.prerequisites.filter((p) => !progress.lessons[p]?.done);
          return (
            <li key={l.id} className={`card ${done ? 'done' : ''}`}>
              <Link to={`/lessons/${l.id}`}>
                <span className="num">{l.order}</span>
                <span className="body">
                  <strong>{loc(l.title)}</strong>
                  <span className="muted">{loc(l.summary)}</span>
                  <span className="meta">
                    {t('lessons.minutes', { n: l.minutes })}
                    {done && <b className="ok"> · ✓ {t('lessons.done')}</b>}
                    {!done && missing.length > 0 && (
                      <em className="muted"> · {t('lessons.locked', { names: missing.map((id) => loc(reg.lessons.find((x) => x.id === id)?.title) || id).join(', ') })}</em>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

function Quiz({ lessonId, block }: { lessonId: string; block: Extract<Lesson['blocks'][number], { type: 'quiz' }> }) {
  const { t, loc } = useT();
  const progress = useProgress();
  const [sel, setSel] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const prev = progress.lessons[lessonId]?.quiz[block.id];
  const correct = sel === block.answer;
  return (
    <fieldset className="quiz" data-testid={`quiz-${block.id}`}>
      <legend>{loc(block.question)}</legend>
      {block.choices.map((c, i) => (
        <label key={i} className={checked ? (i === block.answer ? 'right' : i === sel ? 'wrong' : '') : ''}>
          <input type="radio" name={block.id} checked={sel === i} onChange={() => { setSel(i); setChecked(false); }} />
          {loc(c)}
        </label>
      ))}
      <button disabled={sel === null} onClick={() => { setChecked(true); actions.recordQuiz(lessonId, block.id, correct); }}>{t('quiz.check')}</button>
      {prev && !checked && <span className="ok"> ✓</span>}
      {checked && (
        <p className={`alert ${correct ? 'ok' : 'bad'}`}>
          <strong>{correct ? t('quiz.right') : t('quiz.wrong')}</strong> {loc(block.explain)}
        </p>
      )}
    </fieldset>
  );
}

function LessonSchematic({ machineId, caption, highlight }: { machineId: string; caption?: Lesson['title']; highlight?: string[] }) {
  const { loc } = useT();
  const reg = useRegistry();
  const def = reg.machines.find((m) => m.id === machineId);
  const machine = useMemo(() => (def ? new Machine(structuredClone(def)) : null), [def]);
  if (!machine) return null;
  return (
    <figure className="figure">
      <Schematic machine={machine} rev={0} probes={{}} onProbe={() => undefined} onPress={() => undefined} onRelease={() => undefined} onToggleDisconnect={() => undefined} onResetOverload={() => undefined} readOnly highlight={highlight} />
      {caption && <figcaption>{loc(caption)} <Link to="/lab">→ Laboratoire</Link></figcaption>}
    </figure>
  );
}

export function LessonPage() {
  const { id } = useParams();
  const { t, loc } = useT();
  const reg = useRegistry();
  const progress = useProgress();
  const lesson = reg.lessons.find((l) => l.id === id);
  if (!lesson) return <main className="page"><p>Leçon introuvable. <Link to="/lessons">{t('common.back')}</Link></p></main>;
  const done = progress.lessons[lesson.id]?.done;
  const next = reg.lessons.find((l) => l.order === lesson.order + 1);
  return (
    <main className="page lesson">
      <p className="crumb"><Link to="/lessons">{t('nav.lessons')}</Link> › {lesson.order}</p>
      <h1>{loc(lesson.title)}</h1>
      <p className="lead">{loc(lesson.summary)}</p>
      <div className="objectives">
        <strong>{t('lessons.objectives')}</strong>
        <ul>{lesson.objectives.map((o, i) => <li key={i}>{loc(o)}</li>)}</ul>
      </div>
      {lesson.blocks.map((b, i) => {
        switch (b.type) {
          case 'text':
            return <Markdown key={i} md={loc(b.md)} />;
          case 'callout':
            return (
              <aside key={i} className={`callout ${b.kind}`}>
                {b.title && <strong className="ctitle">{loc(b.title)}</strong>}
                <Markdown md={loc(b.md)} />
              </aside>
            );
          case 'code':
            return (
              <figure key={i} className="code">
                {b.title && <figcaption>{loc(b.title)}</figcaption>}
                <pre><code>{b.code}</code></pre>
              </figure>
            );
          case 'schematic':
            return <LessonSchematic key={i} machineId={b.machine} caption={b.caption} highlight={b.highlight} />;
          case 'quiz':
            return <Quiz key={i} lessonId={lesson.id} block={b} />;
          case 'calc':
            return <OhmCalc key={i} preset={b.preset} />;
          case 'practice':
            return (
              <p key={i} className="practice">
                <Link className="btn primary" to={`/orders/${b.workorder}`} data-testid="practice-link">▶ {b.label ? loc(b.label) : t('lessons.practice')}</Link>
              </p>
            );
        }
      })}
      {lesson.references.length > 0 && (
        <footer className="refs"><ul>{lesson.references.map((r, i) => <li key={i}>{loc(r)}</li>)}</ul></footer>
      )}
      <div className="lesson-actions">
        <button className={done ? '' : 'primary'} onClick={() => actions.setLessonDone(lesson.id, !done)} data-testid="lesson-done">
          {done ? `✓ ${t('lessons.done')}` : t('lessons.mark')}
        </button>
        {next && <Link className="btn" to={`/lessons/${next.id}`}>{t('lessons.next')} →</Link>}
      </div>
    </main>
  );
}
