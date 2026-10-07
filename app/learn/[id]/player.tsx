'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, LoaderCircle, Maximize2, Minimize2 } from 'lucide-react';
import type { Sco } from '@/lib/course-types';

type Launch = { token: string; title: string; scos: Sco[]; scoId: string; url: string; preview: boolean };
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function Player({ courseId, preview }: { courseId: string; preview: boolean }) {
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<SaveState>('idle');
  const [busy, setBusy] = useState(true);
  const [frameLoading, setFrameLoading] = useState(true);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenMessage, setFullscreenMessage] = useState('');
  const player = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const active = useRef<Launch | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const sequence = useRef(0);
  const failed = useRef(false);
  const pendingSaves = useRef(0);
  const approvedExit = useRef(false);
  const flushFailed = useRef(false);
  const pendingFlush = useRef<{ id: string; resolve: (saved: boolean) => void } | null>(null);
  const latest = useRef<Record<string, string> | null>(null);

  const send = useCallback((data: Record<string, string>) => {
    latest.current = data;
    const current = active.current;
    if (!current) return;
    const seq = ++sequence.current;
    pendingSaves.current++;
    setSaving('saving');
    queue.current = queue.current.then(async () => {
      const r = await fetch('/api/scorm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', token: current.token, sequence: seq, data }), keepalive: true,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      failed.current = false;
      setError('');
      // A queued save must finish before the toolbar reports that everything is saved.
      if (seq === sequence.current) setSaving('saved');
    }).catch(e => {
      failed.current = true;
      setError(e.message || 'Progress could not be saved. Keep this page open and retry.');
      setSaving('error');
    }).finally(() => { pendingSaves.current--; });
  }, []);

  const start = useCallback(async (scoId?: string) => {
    setBusy(true);
    setFrameLoading(true);
    setError('');
    try {
      const r = await fetch('/api/scorm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'launch', courseId, scoId, preview }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      active.current = d;
      sequence.current = 0;
      latest.current = null;
      failed.current = false;
      flushFailed.current = false;
      setLaunch(d);
      setSaving('idle');
    } catch (e) {
      setError((e as Error).message);
      setFrameLoading(false);
    } finally {
      setBusy(false);
    }
  }, [courseId, preview]);

  useEffect(() => { void start(); }, [start]);
  useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.token !== active.current?.token) return;
      if (e.data.type === 'primark-scorm-ready') { setFrameLoading(false); return; }
      if (e.data.type === 'primark-scorm-flushed') {
        const waiting = pendingFlush.current;
        if (!waiting || waiting.id !== e.data.requestId) return;
        if (e.data.data) send(e.data.data);
        void (async () => {
          // A package may commit again while the final snapshot is saving.
          while (pendingSaves.current) await queue.current;
          flushFailed.current = false;
          waiting.resolve(!failed.current);
        })();
        return;
      }
      if (e.data.type !== 'primark-scorm-save' || approvedExit.current) return;
      // Some packages commit before all their media has finished loading.
      setFrameLoading(false);
      send(e.data.data);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [send]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      // Refs reflect the completed save immediately; React's displayed status
      // may still say "Saving…" in the navigation event's render cycle.
      if (!approvedExit.current && (failed.current || flushFailed.current || pendingSaves.current > 0)) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => {
    setFullscreenAvailable(Boolean(document.fullscreenEnabled));
    const update = () => setFullscreen(document.fullscreenElement === player.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  async function flush() {
    if (!active.current) return true;
    const requestId = crypto.randomUUID();
    return new Promise<boolean>(resolve => {
      const timer = window.setTimeout(() => {
        if (pendingFlush.current?.id !== requestId) return;
        pendingFlush.current = null;
        flushFailed.current = true;
        setError('The course has not confirmed its progress yet. Keep this page open and try Save & exit again.');
        resolve(false);
      }, 12000);
      pendingFlush.current = { id: requestId, resolve: saved => {
        window.clearTimeout(timer);
        if (pendingFlush.current?.id !== requestId) return;
        pendingFlush.current = null;
        resolve(saved);
      }};
      frame.current?.contentWindow?.postMessage({ type: 'primark-scorm-flush', token: active.current?.token, requestId }, '*');
    });
  }
  async function exit() {
    if (busy) return;
    setBusy(true);
    if (await flush()) {
      approvedExit.current = true;
      location.assign(preview ? '/admin/courses/' : '/?courses=1');
    }
    else setBusy(false);
  }
  async function toggleFullscreen() {
    setFullscreenMessage('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await player.current?.requestFullscreen();
    } catch {
      setFullscreenMessage('Full screen is unavailable in this browser. You can continue learning here.');
    }
  }

  const status = preview ? 'Preview' : saving === 'saved' ? 'Saved' : saving === 'saving' ? 'Saving…' : saving === 'error' ? 'Not saved' : 'Autosave on';
  const statusDetail = preview ? 'Preview — progress is not recorded' : saving === 'saved' ? 'Your progress is saved' : saving === 'idle' ? 'Your progress saves as you learn' : status;

  return <div className="scorm-player" ref={player}>
    <header className="player-toolbar">
      <span className="player-wordmark" aria-label="Primark">PRIMARK</span>
      <div className="player-heading">
        <h1 title={launch?.title}>{launch?.title || 'Opening course…'}</h1>
        {launch && launch.scos.length > 1 && <select aria-label="Lesson" value={launch.scoId} disabled={busy}
          onChange={async e => {
            const id = e.target.value;
            setBusy(true);
            if (await flush()) await start(id);
            else setBusy(false);
          }}>
          {launch.scos.map((s, i) => <option value={s.id} key={s.id}>{i + 1}. {s.title}</option>)}
        </select>}
      </div>
      <div className="player-actions">
        <span className={`player-save-state is-${preview ? 'preview' : saving}`} role="status" aria-label={statusDetail} title={statusDetail}>
          {!preview && (saving === 'saved' ? <Check aria-hidden="true" /> : saving === 'saving' ? <LoaderCircle className="player-spinner" aria-hidden="true" /> : saving === 'error' ? <AlertCircle aria-hidden="true" /> : <span className="player-status-dot" aria-hidden="true" />)}
          <span className="player-status-text">{status}</span>
        </span>
        {fullscreenAvailable && <button type="button" className="player-fullscreen" onClick={toggleFullscreen}
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title={fullscreen ? 'Exit full screen' : 'Full screen'} aria-pressed={fullscreen}>
          {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </button>}
        <button type="button" className="player-exit" disabled={busy} onClick={exit}>{preview ? 'Exit preview' : 'Save & exit'}</button>
      </div>
    </header>
    {fullscreenMessage && <p className="player-notice" role="status">{fullscreenMessage}</p>}
    {error && <div role="alert" className="player-error">
      <span>{error}</span>
      {latest.current ? <button type="button" onClick={() => send(latest.current!)}>Retry save</button> : <a href={preview ? '/admin/courses/' : '/'}>Return to sign in</a>}
    </div>}
    <main className="player-stage" aria-label="Course">
      {launch && <iframe key={launch.token} ref={frame} title={launch.title} src={launch.url}
        onLoad={() => setFrameLoading(false)}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        allow="fullscreen; autoplay" referrerPolicy="no-referrer" />}
      {frameLoading && !error && <div className="player-loading" role="status">
        <LoaderCircle className="player-spinner" aria-hidden="true" /><span>Opening course…</span>
      </div>}
    </main>
  </div>;
}
