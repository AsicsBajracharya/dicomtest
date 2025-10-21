import React, { useEffect, useRef, useState } from 'react';
import { RenderingEngine, Enums, init as coreInit, metaData } from '@cornerstonejs/core';
import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';
import JSZip from 'jszip';
import * as dicomParser from 'dicom-parser';
import { fileManager } from '@cornerstonejs/dicom-image-loader/wadouri';

type LoadState = 'idle' | 'parsing' | 'rendering' | 'done' | 'error';

export default function App() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderingEngine | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [msg, setMsg] = useState('Open a .zip of DICOM files (P10)');

  // One-time init: Cornerstone core + DICOM loader + empty viewport
  useEffect(() => {
    let mounted = true;

    (async () => {
      await coreInit();
      await dicomImageLoaderInit(); // registers wado-rs/wado-uri + local file support

      if (!mounted) return;
      const engine = new RenderingEngine('engine');
      engineRef.current = engine;

      engine.enableElement({
        viewportId: 'vp',
        element: viewportRef.current as HTMLDivElement,
        type: Enums.ViewportType.STACK,
      });
    })();

    return () => {
      mounted = false;
      try {
        engineRef.current?.disableElement?.('vp');
        engineRef.current?.destroy?.();
      } catch {}
      engineRef.current = null;
    };
  }, []);

  async function handleZipFile(file: File) {
    try {
      setState('parsing');
      setMsg('Reading ZIP…');

      // 1) Inflate ZIP in the browser
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((f) => !f.dir);
      if (!entries.length) {
        setState('error');
        setMsg('ZIP is empty.');
        return;
      }

      // 2) Convert each entry to an imageId via fileManager.add(Blob)
      const items: { imageId: string; instanceNumber: number }[] = [];
      let i = 0;

      for (const entry of entries) {
        i++;
        setMsg(`Parsing DICOM ${i}/${entries.length}…`);
        const buf = await entry.async('arraybuffer');

        // Try to read (0020,0013) InstanceNumber for proper stack order
        let instNum = 0;
        try {
          const ds = dicomParser.parseDicom(new DataView(buf));
          instNum = Number(ds.intString('x00200013')) || 0;
        } catch {
          // non-fatal: leave instNum = 0
        }

        const imageId = fileManager.add(new Blob([buf])); // local-file path for wadouri
        items.push({ imageId, instanceNumber: instNum });
      }

      // 3) Sort & build imageIds
      items.sort((a, b) => a.instanceNumber - b.instanceNumber);
      const imageIds = items.map((x) => x.imageId);
      if (!imageIds.length) {
        setState('error');
        setMsg('No DICOM files detected in ZIP.');
        return;
      }

      // (Optional) quick metadata check for the first image (may be undefined pre-load)
      void metaData.get('imagePixelModule', imageIds[0]);

      // 4) Render the stack
      setState('rendering');
      setMsg('Rendering…');

      const engine = engineRef.current!;
      const vp = engine.getViewport('vp');
      await (vp as any).setStack(imageIds, Math.floor(imageIds.length / 2));
      await vp.render();

      setState('done');
      setMsg(`Loaded ${imageIds.length} images ✔`);
    } catch (err: any) {
      console.error(err);
      setState('error');
      setMsg(err?.message || 'Failed to load ZIP');
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f && f.name.toLowerCase().endsWith('.zip')) handleZipFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.name.toLowerCase().endsWith('.zip')) handleZipFile(f);
  }

  return (
    <div
      style={styles.page}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <header style={styles.header}>
        <div>Cornerstone3D — Minimal ZIP Viewer (core only)</div>
        <label style={styles.fileLabel}>
          <input type="file" accept=".zip" onChange={onFileInput} style={{ display: 'none' }} />
          <span style={styles.button}>Open ZIP</span>
        </label>
      </header>

      <main style={styles.main}>
        <div ref={viewportRef} style={styles.viewport} />
        <div style={styles.status} aria-live="polite">
          <strong>Status:</strong> {state} — {msg}
        </div>
        <div style={styles.hint}>Tip: You can also drag & drop a .zip anywhere on this page.</div>
      </main>

      <footer style={styles.footer}>
        Uses <code>fileManager.add(Blob)</code> to view local DICOMs entirely in memory.
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    gridTemplateRows: 'auto 1fr auto',
    background: '#0b0f1a',
    color: '#e6e9ef',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    borderBottom: '1px solid #172036',
  },
  main: {
    padding: 14,
    display: 'grid',
    gridTemplateRows: '1fr auto auto',
    gap: 10,
  },
  viewport: {
    width: '100%',
    height: 'calc(100vh - 160px)',
    background: '#000',
    borderRadius: 10,
    outline: '1px solid #223455',
    overflow: 'hidden',
  },
  status: { fontSize: 13, opacity: 0.9 },
  hint: { fontSize: 12, opacity: 0.7 },
  footer: {
    padding: '8px 14px',
    borderTop: '1px solid #172036',
    fontSize: 12,
    opacity: 0.8,
  },
  fileLabel: { marginLeft: 'auto' },
  button: {
    border: '1px solid #2b3f66',
    padding: '6px 10px',
    borderRadius: 8,
    cursor: 'pointer',
    userSelect: 'none',
  },
};
