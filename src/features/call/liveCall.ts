// A live voice call with Pinky over WebRTC. Speech and actions stay separate: captions never authorize anything; requests
// Pinky delegates run on the server like typed ones, and their results are spoken back. Ported from 人脉's voice-call.js.
export type CallState = "idle" | "connecting" | "connected" | "ending" | "ended";
export type CaptionRow = { id: string; role: "user" | "agent"; text: string; start: number; end: number };
type ProviderEvent = { type: string; event_id?: string; delta?: string; start_ms?: number; end_ms?: number; delegation?: { id?: string; target?: string } };
type Options = {
  start: (body: { sdp: string; requestId: string }) => Promise<{ id: string; sdp: string; secondsLeft: number }>;
  post: (path: string, body: unknown) => Promise<{ reply?: string; spoken?: string }>;
  onState: (state: CallState, detail: string) => void;
  onCaptions: (rows: CaptionRow[]) => void;
  onTask: (pending: number) => void;
  onEnd: (rows: CaptionRow[]) => void;
};

/** Caption pieces from the provider, merged into rows per speaker when the gap is short. */
export class Transcript {
  private parts: Array<{ role: "user" | "agent"; text: string; start: number; end: number; sequence: number }> = [];
  private seen = new Set<string>(); private sequence = 0; lastInputAt = 0;
  add(event: ProviderEvent) {
    const role = event.type === "session.input_transcript.delta" ? "user" : event.type === "session.output_transcript.delta" ? "agent" : null;
    if (!role || typeof event.delta !== "string" || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms) || event.start_ms! < 0 || event.end_ms! < event.start_ms! || this.parts.length >= 20000) return false;
    if (event.event_id) { if (this.seen.has(event.event_id)) return false; this.seen.add(event.event_id); }
    this.parts.push({ role, text: event.delta, start: event.start_ms!, end: event.end_ms!, sequence: this.sequence++ });
    if (role === "user") this.lastInputAt = Date.now();
    return true;
  }
  rows(): CaptionRow[] {
    const groups: CaptionRow[] = [], last: Partial<Record<"user" | "agent", CaptionRow>> = {};
    for (const part of [...this.parts].sort((a, b) => a.start - b.start || a.sequence - b.sequence)) {
      let row = last[part.role];
      if (!row || part.start - row.end > 1500) { row = { id: `speech-${part.sequence}`, role: part.role, text: "", start: part.start, end: part.end }; last[part.role] = row; groups.push(row); }
      row.text += part.text; row.end = Math.max(row.end, part.end);
    }
    return groups;
  }
  /** The latest thing people said after `after`, which is what a delegation is about. */
  request(after: number) {
    const latest = this.rows().filter((row) => row.role === "user" && row.end > after).pop();
    return latest ? { text: latest.text.trim().slice(-4000), end: latest.end } : null;
  }
}

export class LiveCall {
  transcript = new Transcript(); state: CallState = "idle"; id = ""; muted = false; speakerMuted = false;
  private closed = false; private pc: RTCPeerConnection | null = null; private channel: RTCDataChannel | null = null; private stream: MediaStream | null = null;
  private audio = new Audio(); private delegations = new Set<string>(); private queue: Promise<void> = Promise.resolve(); private lastUserEnd = -1; private pending = 0;
  private timers: number[] = []; private resolveClosed: (() => void) | null = null;
  constructor(private options: Options) { this.audio.autoplay = true; this.audio.setAttribute("playsinline", ""); }
  private update(state: CallState, detail = "") { this.state = state; this.options.onState(state, detail); }
  private send(event: object) { if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(event)); }
  private later(ms: number, run: () => void) { this.timers.push(window.setTimeout(run, ms)); }

  async start() {
    this.update("connecting");
    this.later(45000, () => { if (!this.closed && this.state === "connecting") void this.end("connection_lost"); });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (this.closed) { this.release(); return; }
      const pc = this.pc = new RTCPeerConnection();
      this.stream.getTracks().forEach((track) => pc.addTrack(track, this.stream!));
      pc.ontrack = (event) => { this.audio.srcObject = event.streams[0]; this.audio.play().catch(() => { this.speakerMuted = true; this.audio.muted = true; if (!this.closed) this.options.onState(this.state, "playback_blocked"); }); };
      pc.onconnectionstatechange = () => {
        if (this.closed) return;
        if (pc.connectionState === "failed" || pc.connectionState === "closed") void this.end("connection_lost");
        if (pc.connectionState === "disconnected") this.later(5000, () => { if (!this.closed && pc.connectionState === "disconnected") void this.end("connection_lost"); });
      };
      const channel = this.channel = pc.createDataChannel("oai-events");
      channel.onmessage = (event) => { try { this.event(JSON.parse(event.data)); } catch { /* Ignore malformed provider events. */ } };
      channel.onclose = () => { if (!this.closed) void this.end("connection_lost"); };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") return resolve();
        const timeout = window.setTimeout(resolve, 3000);
        pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { clearTimeout(timeout); resolve(); } };
      });
      if (this.closed) return;
      const session = await this.options.start({ sdp: pc.localDescription!.sdp, requestId: crypto.randomUUID().replace(/-/g, "") });
      this.id = session.id;
      if (this.closed) { await this.options.post("/api/voice/close", { id: this.id }).catch(() => {}); return; }
      this.later(session.secondsLeft * 1000, () => void this.end("time_limit"));
      await pc.setRemoteDescription({ type: "answer", sdp: session.sdp });
      this.later(20000, () => { if (this.state === "connecting") void this.end("connection_lost"); });
    } catch (error) {
      if (!this.closed) await this.end((error as Error).name === "NotAllowedError" ? "microphone_denied" : (error as Error).message || "connection_lost");
    }
  }

  private event(event: ProviderEvent) {
    if (event.type === "session.closed") { this.resolveClosed?.(); if (!this.closed) void this.end("ended"); return; }
    if (this.closed) return;
    if (event.type === "session.started") this.update("connected");
    if (this.transcript.add(event)) this.options.onCaptions(this.transcript.rows());
    if (event.type === "error") { void this.end("connection_lost"); return; }
    const id = event.delegation?.id;
    if (event.type !== "session.delegation.created" || event.delegation?.target !== "client" || !id || this.delegations.has(id)) return;
    this.delegations.add(id); this.pending += 1; this.options.onTask(this.pending);
    this.queue = this.queue.then(async () => {
      // A delegation can arrive before the last words; wait for speech to settle, at most 15 seconds.
      const deadline = Date.now() + 15000;
      do { await new Promise((resolve) => setTimeout(resolve, 200)); } while (!this.closed && Date.now() - this.transcript.lastInputAt < 800 && Date.now() < deadline);
      if (this.closed) return;
      const request = this.transcript.request(this.lastUserEnd);
      const reply = (content: string) => this.send({ type: "session.commentary.append", event_id: crypto.randomUUID(), delegation_id: id, content });
      if (!request) { reply("The backend did not receive a complete request. Ask them to say it again; nothing was done."); return; }
      this.lastUserEnd = request.end;
      try { const result = await this.options.post("/api/voice/turn", { id: this.id, turnId: id, text: request.text }); if (!this.closed) reply(String(result.spoken || result.reply || "Done.").slice(0, 450)); }
      catch { if (!this.closed) reply("The backend did not return a confirmed result. Say it is not confirmed; do not claim success or repeat the action. They can check in the app."); }
    }).catch(() => {}).finally(() => { this.pending -= 1; this.options.onTask(this.pending); });
  }

  mute() {
    this.muted = !this.muted;
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = !this.muted; });
    this.send({ type: this.muted ? "session.input_audio.mute" : "session.input_audio.unmute", event_id: crypto.randomUUID() });
    return this.muted;
  }
  speaker() {
    this.speakerMuted = !this.speakerMuted; this.audio.muted = this.speakerMuted;
    if (!this.speakerMuted) this.audio.play().catch(() => { this.speakerMuted = true; this.audio.muted = true; this.options.onState(this.state, "playback_blocked"); });
    return this.speakerMuted;
  }
  private release() {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.stream?.getTracks().forEach((track) => track.stop());
    this.audio.pause(); this.audio.srcObject = null; this.pc?.close();
  }
  async end(reason = "ended") {
    if (this.closed) return;
    this.closed = true; this.update("ending", reason);
    this.stream?.getTracks().forEach((track) => track.stop()); this.audio.pause();
    const closed = new Promise<void>((resolve) => { this.resolveClosed = resolve; });
    this.send({ type: "session.close", event_id: crypto.randomUUID() });
    if (this.id) await this.options.post("/api/voice/close", { id: this.id }).catch(() => { reason = "close_uncertain"; });
    if (this.id || this.channel?.readyState === "open") await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 1200))]);
    this.release(); this.update("ended", reason);
    this.options.onEnd(this.transcript.rows());
  }
}
