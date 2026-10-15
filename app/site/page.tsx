'use client';
// Opens a folder of site files (what was a Google Drive folder link in the QC app): /site?files=<folder>
import { useEffect, useState } from 'react';
import { FileList } from '../site-qc';

export default function SiteFiles() {
  const [prefix, setPrefix] = useState('');
  useEffect(() => { setPrefix(new URLSearchParams(window.location.search).get('files') || ''); }, []);
  return (
    <main className="site-files-page">
      <a href="/">← Back to the app</a>
      <h1>{prefix.split('/').filter(Boolean).slice(-2).join(' / ') || 'Site files'}</h1>
      {prefix ? <FileList prefix={prefix} title="Files in this folder" /> : <p>No folder was given.</p>}
    </main>
  );
}
