'use client';

import {
  Check, Clipboard, Download, FileArchive, FolderOpen, Link2, Mic,
  MonitorUp, Radio, Send, ShieldCheck, Volume2, Wifi, X,
} from 'lucide-react';
import { ChangeEvent, useEffect, useRef, useState } from 'react';

type Signal = { offer: RTCSessionDescriptionInit; answer?: RTCSessionDescriptionInit };
type TransferItem = { id: string; name: string; path: string; size: number; sent: number; status: string };
type FileWithPath = File & { webkitRelativePath?: string };

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ],
};
const CHUNK_SIZE = 64 * 1024;
const BUFFER_LIMIT = 4 * 1024 * 1024;

function roomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function waitForIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const listener = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', listener);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', listener);
    setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', listener);
      resolve();
    }, 7000);
  });
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(power > 1 ? 1 : 0)} ${units[power]}`;
}

async function directoryFile(root: FileSystemDirectoryHandle, relativePath: string) {
  const parts = relativePath.split('/').filter(Boolean);
  const name = parts.pop() ?? 'download';
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create: true });
  const handle = await current.getFileHandle(name, { create: true });
  return handle.createWritable();
}

export default function Home() {
  const [room, setRoom] = useState('');
  const [isGuest, setIsGuest] = useState(false);
  const [status, setStatus] = useState<'idle' | 'waiting' | 'connecting' | 'connected' | 'error'>('idle');
  const [message, setMessage] = useState('공유할 항목을 준비한 뒤 새 방을 만드세요.');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [files, setFiles] = useState<FileWithPath[]>([]);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [saveDirectory, setSaveDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [speed, setSpeed] = useState('');
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const receiving = useRef<{
    meta: TransferItem;
    writable: FileSystemWritableFileStream | null;
    chunks: BlobPart[];
    received: number;
  } | null>(null);

  const inviteUrl = room && typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}?room=${room}` : '';
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  useEffect(() => {
    const invitedRoom = new URLSearchParams(window.location.search).get('room') ?? '';
    if (invitedRoom) {
      // The invite is intentionally read after hydration because the query string is browser-owned state.
      // oxlint-disable-next-line react/react-compiler
      setRoom(invitedRoom);
      setIsGuest(true);
      setMessage('초대 링크가 확인되었습니다. 연결 버튼을 눌러주세요.');
    }
  }, []);

  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = localStream; }, [localStream]);
  useEffect(() => { if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream; }, [remoteStream]);

  useEffect(() => () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    peer.current?.close();
  }, []);

  const setConnection = (pc: RTCPeerConnection) => {
    peer.current?.close();
    peer.current = pc;
    pc.ontrack = ({ streams }) => setRemoteStream(streams[0] ?? new MediaStream());
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setStatus('connected');
        setMessage('상대방과 직접 연결되었습니다. 이제 화면을 보거나 파일을 전송할 수 있습니다.');
        if (pollTimer.current) clearInterval(pollTimer.current);
      }
      if (['failed', 'disconnected'].includes(pc.connectionState)) {
        setStatus('error');
        setMessage('연결이 끊어졌습니다. 새 방을 만들어 다시 시도해주세요.');
      }
    };
    localStream?.getTracks().forEach((track) => pc.addTrack(track, localStream));
    return pc;
  };

  const bindDataChannel = (dc: RTCDataChannel) => {
    channel.current = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 1024 * 1024;
    let incomingQueue = Promise.resolve();
    const processIncoming = async (data: string | ArrayBuffer) => {
      if (typeof data === 'string') {
        const event = JSON.parse(data) as { type: string; item?: TransferItem };
        if (event.type === 'file-start' && event.item) {
          const writable = saveDirectory ? await directoryFile(saveDirectory, event.item.path) : null;
          receiving.current = { meta: event.item, writable, chunks: [], received: 0 };
          setTransfers((items) => [...items.filter((item) => item.id !== event.item!.id), { ...event.item!, status: '받는 중' }]);
        }
        if (event.type === 'file-end' && receiving.current) {
          const active = receiving.current;
          if (active.writable) await active.writable.close();
          else {
            const blobUrl = URL.createObjectURL(new Blob(active.chunks));
            const anchor = document.createElement('a');
            anchor.href = blobUrl;
            anchor.download = active.meta.name;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
          }
          setTransfers((items) => items.map((item) => item.id === active.meta.id ? { ...item, sent: item.size, status: '완료' } : item));
          receiving.current = null;
        }
        return;
      }
      const active = receiving.current;
      if (!active) return;
      const bytes = data as ArrayBuffer;
      if (active.writable) await active.writable.write(bytes);
      else active.chunks.push(bytes);
      active.received += bytes.byteLength;
      setTransfers((items) => items.map((item) => item.id === active.meta.id ? { ...item, sent: active.received } : item));
    };
    dc.onmessage = ({ data }) => {
      incomingQueue = incomingQueue.then(() => processIncoming(data as string | ArrayBuffer)).catch(() => {
        setMessage('파일을 기록하는 중 오류가 발생했습니다. 저장 공간과 권한을 확인해주세요.');
      });
    };
  };

  const prepareMedia = async () => {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      let mic: MediaStream | null = null;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        setMessage('화면은 준비됐지만 마이크 권한이 없어 시스템 소리만 공유합니다.');
      }
      const audioTracks = [...display.getAudioTracks(), ...(mic?.getAudioTracks() ?? [])];
      let mixedTrack: MediaStreamTrack | undefined;
      if (audioTracks.length > 1) {
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        for (const track of audioTracks) context.createMediaStreamSource(new MediaStream([track])).connect(destination);
        mixedTrack = destination.stream.getAudioTracks()[0];
      } else mixedTrack = audioTracks[0];
      const combined = new MediaStream([...display.getVideoTracks(), ...(mixedTrack ? [mixedTrack] : [])]);
      display.getVideoTracks()[0]?.addEventListener('ended', () => setLocalStream(null));
      setLocalStream(combined);
      setMessage('화면, 시스템 소리, 마이크가 준비되었습니다. 이제 새 방을 만드세요.');
    } catch {
      setMessage('공유 선택이 취소되었습니다. 다시 눌러 화면 또는 창을 선택해주세요.');
    }
  };

  const createRoom = async () => {
    try {
      const id = roomCode();
      setRoom(id);
      setStatus('waiting');
      setMessage('초대 링크를 상대방에게 보내고 접속을 기다리세요.');
      window.history.replaceState({}, '', `?room=${id}`);
      const pc = setConnection(new RTCPeerConnection(ICE_SERVERS));
      bindDataChannel(pc.createDataChannel('transfer', { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIce(pc);
      const response = await fetch('/api/signal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room: id, offer: pc.localDescription }) });
      if (!response.ok) throw new Error('signal');
      pollTimer.current = setInterval(async () => {
        const result = await fetch(`/api/signal?room=${id}`, { cache: 'no-store' });
        if (!result.ok) return;
        const signal = await result.json() as Signal;
        if (signal.answer && !pc.remoteDescription) await pc.setRemoteDescription(signal.answer);
      }, 1200);
    } catch {
      setStatus('error');
      setMessage('방을 만들지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  const joinRoom = async () => {
    try {
      setStatus('connecting');
      setMessage('방을 찾고 안전한 직접 연결을 준비하고 있습니다.');
      const response = await fetch(`/api/signal?room=${room}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('room');
      const signal = await response.json() as Signal;
      const pc = setConnection(new RTCPeerConnection(ICE_SERVERS));
      pc.ondatachannel = ({ channel: incoming }) => bindDataChannel(incoming);
      await pc.setRemoteDescription(signal.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIce(pc);
      const result = await fetch('/api/signal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room, answer: pc.localDescription }) });
      if (!result.ok) throw new Error('answer');
    } catch {
      setStatus('error');
      setMessage('유효한 방을 찾지 못했습니다. 초대 링크가 정확한지 확인해주세요.');
    }
  };

  const stopSharing = () => {
    localStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    setMessage('화면 공유가 중지되었습니다.');
  };

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []) as FileWithPath[];
    setFiles(selected);
    setMessage(`${selected.length}개 항목, ${formatBytes(selected.reduce((sum, file) => sum + file.size, 0))}를 선택했습니다.`);
  };

  const chooseSaveFolder = async () => {
    if (!('showDirectoryPicker' in window)) {
      setMessage('이 브라우저는 폴더 직접 저장을 지원하지 않아 파일별 다운로드를 사용합니다.');
      return;
    }
    try {
      const handle = await (window as Window & {
        showDirectoryPicker: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker({ mode: 'readwrite' });
      setSaveDirectory(handle);
      setMessage(`받은 파일을 “${handle.name}” 폴더에 바로 기록합니다.`);
    } catch { setMessage('저장 폴더 선택이 취소되었습니다.'); }
  };

  const waitForBuffer = async (dc: RTCDataChannel) => {
    if (dc.bufferedAmount < BUFFER_LIMIT) return;
    await new Promise<void>((resolve) => {
      const done = () => { dc.removeEventListener('bufferedamountlow', done); resolve(); };
      dc.addEventListener('bufferedamountlow', done);
    });
  };

  const sendFiles = async () => {
    const dc = channel.current;
    if (!dc || dc.readyState !== 'open' || files.length === 0) {
      setMessage('상대방과 연결한 뒤 보낼 파일이나 폴더를 선택해주세요.');
      return;
    }
    const started = performance.now();
    let totalSent = 0;
    for (const file of files) {
      const id = crypto.randomUUID();
      const item: TransferItem = { id, name: file.name, path: file.webkitRelativePath || file.name, size: file.size, sent: 0, status: '보내는 중' };
      setTransfers((items) => [...items, item]);
      dc.send(JSON.stringify({ type: 'file-start', item }));
      for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
        await waitForBuffer(dc);
        const buffer = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
        dc.send(buffer);
        totalSent += buffer.byteLength;
        const sent = Math.min(offset + buffer.byteLength, file.size);
        setTransfers((items) => items.map((entry) => entry.id === id ? { ...entry, sent } : entry));
        setSpeed(`${formatBytes(totalSent / Math.max((performance.now() - started) / 1000, 0.1))}/s`);
      }
      dc.send(JSON.stringify({ type: 'file-end', id }));
      setTransfers((items) => items.map((entry) => entry.id === id ? { ...entry, sent: entry.size, status: '완료' } : entry));
    }
    setMessage('모든 파일 전송이 완료되었습니다.');
  };

  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/8 bg-[#07111f]/92 px-5 py-4 text-white backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-cyan-300 text-[#07111f] shadow-[0_0_28px_rgb(103_232_249/30%)]"><Radio size={21} strokeWidth={2.5} /></span>
            <div><p className="text-[15px] font-bold tracking-tight">직접전송</p><p className="text-[11px] text-slate-400">WebRTC peer-to-peer</p></div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300">
            <span className={`size-2 rounded-full ${status === 'connected' ? 'bg-emerald-400 shadow-[0_0_10px_#34d399]' : status === 'error' ? 'bg-rose-400' : 'bg-slate-500'}`} />
            {status === 'connected' ? '직접 연결됨' : status === 'waiting' ? '접속 대기 중' : status === 'connecting' ? '연결 중' : '연결 전'}
          </div>
        </div>
      </header>

      <section className="border-b border-border bg-[#0a1628] px-5 py-8 text-white sm:px-8">
        <div className="mx-auto grid max-w-[1440px] gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300"><Wifi size={14} /> 브라우저끼리 바로 연결</p>
            <h1 className="max-w-3xl text-3xl font-bold tracking-[-0.04em] sm:text-4xl">화면과 대용량 파일을<br className="hidden sm:block" /> 서버를 거치지 않고 전달하세요.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">전송 데이터는 두 기기 사이를 직접 이동합니다. 방 링크는 연결에만 쓰이고 2시간 뒤 자동 만료됩니다.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-300"><span className="feature-pill"><ShieldCheck size={14} /> 서버 저장 없음</span><span className="feature-pill"><FileArchive size={14} /> 용량 제한 없음</span></div>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1440px] gap-5 px-5 py-6 sm:px-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,.65fr)]">
        <div className="space-y-5">
          <section className="panel overflow-hidden">
            <div className="panel-head"><div><p className="eyebrow">01 · 라이브 공유</p><h2>화면, 시스템 소리, 마이크</h2></div><MonitorUp className="text-cyan-700" size={22} /></div>
            <div className="relative aspect-video min-h-[280px] bg-[#060d18]">
              {localStream || remoteStream ? <>
                {/* Live user-shared media does not have a pre-authored caption track. */}
                {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={remoteVideo} autoPlay playsInline className={`h-full w-full object-contain ${remoteStream ? '' : 'hidden'}`} />
                {!remoteStream && <video ref={localVideo} autoPlay playsInline muted className="h-full w-full object-contain" />}
                {localStream && remoteStream && <video ref={localVideo} autoPlay playsInline muted className="absolute bottom-4 right-4 aspect-video w-36 rounded-lg border border-white/20 bg-black object-cover shadow-xl sm:w-52" />}
              </> : <div className="absolute inset-0 grid place-items-center p-8 text-center"><div><span className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl border border-cyan-300/15 bg-cyan-300/8 text-cyan-300"><MonitorUp size={29} /></span><p className="font-semibold text-white">아직 공유 중인 화면이 없습니다</p><p className="mt-1 text-sm text-slate-500">전체 화면, 특정 창, 브라우저 탭 중 하나를 선택할 수 있습니다.</p></div></div>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
              <div className="flex gap-2 text-xs text-muted-foreground"><span className="device-tag"><Volume2 size={13} /> 시스템 소리</span><span className="device-tag"><Mic size={13} /> 마이크 믹싱</span></div>
              {!localStream ? <button className="button-primary" onClick={prepareMedia}><MonitorUp size={17} /> 공유할 화면 선택</button> : <button className="button-danger" onClick={stopSharing}><X size={17} /> 공유 중지</button>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><div><p className="eyebrow">02 · 대용량 전송</p><h2>파일 또는 폴더 보내기</h2></div><Send className="text-cyan-700" size={22} /></div>
            <div className="p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <button className="select-card" onClick={() => document.getElementById('file-picker')?.click()}><span><FileArchive size={22} /></span><div><b>파일 선택</b><small>여러 파일을 한 번에</small></div></button>
                <button className="select-card" onClick={() => document.getElementById('folder-picker')?.click()}><span><FolderOpen size={22} /></span><div><b>폴더 선택</b><small>하위 구조까지 그대로</small></div></button>
                <input id="file-picker" type="file" multiple className="hidden" onChange={addFiles} />
                <input id="folder-picker" type="file" multiple className="hidden" onChange={addFiles} {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-3">
                <div><p className="text-sm font-semibold">{files.length ? `${files.length}개 항목 선택됨` : '전송할 항목을 선택하세요'}</p><p className="text-xs text-muted-foreground">{files.length ? formatBytes(totalSize) : '파일은 64KB 조각으로 나누어 안전하게 전송됩니다.'}</p></div>
                <button className="button-primary disabled:opacity-40" disabled={!files.length || status !== 'connected'} onClick={sendFiles}><Send size={16} /> 전송 시작</button>
              </div>
              {transfers.length > 0 && <div className="mt-4 space-y-2">{transfers.slice(-5).map((item) => <div key={item.id} className="transfer-row"><div className="min-w-0 flex-1"><div className="flex justify-between gap-4 text-xs"><span className="truncate font-medium">{item.path}</span><span className="shrink-0 text-muted-foreground">{item.status}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-cyan-500 transition-[width]" style={{ width: `${item.size ? Math.min(100, item.sent / item.size * 100) : 100}%` }} /></div></div><span className="w-20 text-right text-xs text-muted-foreground">{formatBytes(item.sent)}</span></div>)}</div>}
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="panel sticky top-5">
            <div className="panel-head"><div><p className="eyebrow">03 · 상대방 연결</p><h2>{isGuest ? '초대받은 방 연결' : '공유 방 만들기'}</h2></div><Link2 className="text-cyan-700" size={22} /></div>
            <div className="space-y-4 p-5">
              {isGuest ? <div className="rounded-xl border border-cyan-600/20 bg-cyan-50 p-4"><p className="text-xs font-semibold text-cyan-800">방 코드</p><p className="mt-1 truncate font-mono text-sm text-cyan-950">{room}</p></div> : room ? <div><label htmlFor="invite-url" className="mb-1.5 block text-xs font-semibold text-muted-foreground">초대 링크</label><div className="flex gap-2"><input id="invite-url" readOnly value={inviteUrl} className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-3 text-xs outline-none" /><button className="icon-button" onClick={copyInvite} aria-label="초대 링크 복사">{copied ? <Check size={17} /> : <Clipboard size={17} />}</button></div></div> : <div className="rounded-xl border border-dashed border-border bg-muted/35 p-4 text-sm leading-6 text-muted-foreground">새 방을 만들면 추측하기 어려운 일회성 링크가 생성됩니다. 상대방 한 명에게만 보내세요.</div>}
              <div className={`status-box ${status === 'error' ? 'status-error' : ''}`}><span className="mt-0.5"><Radio size={16} /></span><p>{message}</p></div>
              {isGuest ? <button className="button-primary w-full justify-center py-3" onClick={joinRoom} disabled={status === 'connecting' || status === 'connected'}><Link2 size={17} /> {status === 'connected' ? '연결 완료' : '이 방에 연결'}</button> : !room ? <button className="button-primary w-full justify-center py-3" onClick={createRoom}><Radio size={17} /> 새 공유 방 만들기</button> : <button className="button-secondary w-full justify-center" onClick={copyInvite}>{copied ? <Check size={16} /> : <Clipboard size={16} />} {copied ? '복사됨' : '초대 링크 복사'}</button>}
              <div className="border-t border-border pt-4"><button className="button-secondary w-full justify-center" onClick={chooseSaveFolder}><Download size={16} /> {saveDirectory ? `저장 위치: ${saveDirectory.name}` : '받을 폴더 미리 선택'}</button><p className="mt-2 text-center text-[11px] leading-4 text-muted-foreground">대용량 파일을 받을 때 저장 폴더를 먼저 고르면 메모리에 쌓지 않고 디스크에 바로 기록합니다.</p></div>
              {(speed || status === 'connected') && <div className="grid grid-cols-2 gap-2 border-t border-border pt-4"><div className="stat"><small>연결 방식</small><b>P2P 직접 연결</b></div><div className="stat"><small>현재 속도</small><b>{speed || '대기 중'}</b></div></div>}
            </div>
          </section>
        </aside>
      </div>
      <footer className="px-5 pb-8 text-center text-xs leading-5 text-muted-foreground sm:px-8">Chrome 또는 Edge 최신 버전을 권장합니다. 일부 회사·학교 네트워크처럼 직접 연결을 차단하는 환경에서는 연결되지 않을 수 있습니다.</footer>
    </main>
  );
}
