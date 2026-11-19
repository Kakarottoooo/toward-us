const rate = 16_000;
const maxMs = 120_000;
const maxFrames = rate * maxMs / 1000;

type CaptureOptions = {
  signal: AbortSignal;
  onMeter: (elapsedMs: number, level: number) => void;
  onStop: (audio: Blob) => void;
  onError: () => void;
};

// A standard mono, little-endian PCM WAV. The payload never leaves the recorder until stop.
function wav(pcm: Int16Array<ArrayBuffer>, frames: number) {
  const header = new DataView(new ArrayBuffer(44));
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) header.setUint8(offset + i, value.charCodeAt(i));
  };
  tag(0, "RIFF");
  header.setUint32(4, 36 + frames * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  tag(36, "data");
  header.setUint32(40, frames * 2, true);
  return new Blob([header, pcm.subarray(0, frames)], { type: "audio/wav" });
}

export async function startFeedbackCapture({ signal, onMeter, onStop, onError }: CaptureOptions) {
  const aborted = () => new DOMException("Recording cancelled", "AbortError");
  if (signal.aborted || document.hidden) throw aborted();
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
    throw new DOMException("Microphone unavailable", "NotSupportedError");
  }

  // Resume in the tap's call stack, before the native permission prompt can consume activation.
  const context = new AudioContext();
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let timer: number | undefined;
  let ready = false, finished = false, hasSignal = false, frames = 0;
  let pcm: Int16Array<ArrayBuffer> | undefined;
  let rejectStart!: (error: Error) => void;
  const interruptedStart = new Promise<never>((_, reject) => { rejectStart = reject; });

  function release() {
    finished = true;
    window.clearInterval(timer);
    signal.removeEventListener("abort", cancel);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", interrupt);
    context.onstatechange = null;
    if (processor) { processor.onaudioprocess = null; processor.disconnect(); }
    source?.disconnect();
    for (const track of stream?.getTracks() || []) {
      track.removeEventListener("ended", interrupt);
      track.removeEventListener("mute", interrupt);
      track.stop();
    }
    void context.close().catch(() => {});
  }
  function cancel() {
    if (finished) return;
    release();
    pcm = undefined;
    if (!ready) rejectStart(aborted());
  }
  function stop() {
    if (finished) return;
    release();
    const audio = pcm && frames && hasSignal ? wav(pcm, frames) : undefined;
    pcm = undefined;
    if (audio) onStop(audio);
    else onError();
  }
  function interrupt() {
    if (ready) stop();
    else cancel();
  }
  function visibility() { if (document.hidden) interrupt(); }
  signal.addEventListener("abort", cancel, { once: true });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", interrupt);

  try {
    timer = window.setTimeout(() => {
      release();
      rejectStart(new DOMException("Microphone unavailable", "TimeoutError"));
    }, 45_000);
    const resumed = context.resume();
    const microphone = navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true, autoGainControl: true },
    }).then((obtained) => {
      // Native permission prompts cannot be aborted. Release any late grant immediately.
      if (finished) { obtained.getTracks().forEach((track) => track.stop()); throw aborted(); }
      stream = obtained;
      return obtained;
    });
    const [input] = await Promise.race([Promise.all([microphone, resumed]), interruptedStart]);
    if (finished) throw aborted();
    window.clearTimeout(timer);
    if (!input.getAudioTracks().some((track) => track.readyState === "live")) {
      throw new DOMException("Microphone disconnected", "NotReadableError");
    }
    source = context.createMediaStreamSource(input);
    // This built-in node also works on an already-open offline WebView: no worklet download.
    processor = context.createScriptProcessor(2048, 1, 1);
    pcm = new Int16Array(maxFrames);
    let phase = 0, sum = 0, count = 0, level = 0;
    const started = performance.now();
    let lastSpeech = started, heardSpeech = false;
    processor.onaudioprocess = ({ inputBuffer, outputBuffer }) => {
      // Never play microphone input to the speaker.
      outputBuffer.getChannelData(0).fill(0);
      if (!pcm) return;
      const input = inputBuffer.getChannelData(0);
      let energy = 0;
      for (const sample of input) {
        energy += sample * sample;
        sum += sample;
        count++;
        // Average each source-rate window into a 16 kHz sample; carry partial windows
        // across callbacks so 44.1 kHz and 48 kHz devices keep identical timing.
        phase += rate;
        if (phase < context.sampleRate) continue;
        const value = Math.max(-1, Math.min(1, sum / count));
        const encoded = Math.round(value * (value < 0 ? 32768 : 32767));
        while (phase >= context.sampleRate && frames < maxFrames) {
          pcm[frames++] = encoded;
          phase -= context.sampleRate;
        }
        sum = count = 0;
        if (frames >= maxFrames) { stop(); return; }
      }
      const rms = Math.sqrt(energy / input.length);
      if (rms > 0.0001) hasSignal = true;
      level = Math.min(1, rms * 6);
      if (rms >= 0.008) { heardSpeech = true; lastSpeech = performance.now(); }
    };
    source.connect(processor);
    processor.connect(context.destination);
    for (const track of input.getAudioTracks()) {
      track.addEventListener("ended", interrupt);
      track.addEventListener("mute", interrupt);
    }
    context.onstatechange = () => { if (context.state !== "running") interrupt(); };
    ready = true;
    timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - started;
      onMeter(Math.min(maxMs, elapsed), level);
      if (elapsed >= maxMs || now - lastSpeech >= (heardSpeech ? 3500 : 8000)) stop();
    }, 125);
    return { stop, cancel };
  } catch (error) {
    if (!finished) release();
    throw error;
  }
}
