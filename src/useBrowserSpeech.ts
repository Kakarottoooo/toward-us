import { useEffect, useRef, useState } from "react";

// The phone's own speech recognition (Web Speech API), used when the realtime voice service is unavailable.
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null };
const constructor = () => (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
  || (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

export const browserSpeechAvailable = () => typeof window !== "undefined" && Boolean(constructor());

export function useBrowserSpeech({ lang, onTranscript, onError }: { lang: string; onTranscript: (text: string, itemId: string) => unknown; onError: (message: string) => void }) {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const callbacks = useRef({ onTranscript, onError }); callbacks.current = { onTranscript, onError };

  const stop = () => { wanted.current = false; setListening(false); setPartial(""); try { recognition.current?.stop(); } catch { /* Already stopped. */ } recognition.current = null; };
  const start = () => {
    const Speech = constructor(); if (!Speech) { callbacks.current.onError("Speech recognition is not available on this device."); return; }
    stop(); wanted.current = true;
    const instance = new Speech(); instance.lang = lang; instance.continuous = true; instance.interimResults = true;
    instance.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]; const text = result[0].transcript.trim();
        if (result.isFinal) { if (text) void callbacks.current.onTranscript(text, crypto.randomUUID()); } else interim += text;
      }
      setPartial(interim);
    };
    instance.onerror = (event) => { if (["no-speech", "aborted"].includes(event.error)) return; stop(); callbacks.current.onError(event.error === "not-allowed" ? "Allow microphone and speech recognition for Pinky in Settings." : "Voice is unavailable right now. You can still type."); };
    // Phones end a session after a pause; keep listening until the person stops.
    instance.onend = () => { if (wanted.current && recognition.current === instance) { try { instance.start(); } catch { stop(); } } };
    recognition.current = instance;
    try { instance.start(); setListening(true); } catch { stop(); callbacks.current.onError("Voice is unavailable right now. You can still type."); }
  };
  useEffect(() => () => { wanted.current = false; try { recognition.current?.abort(); } catch { /* Gone. */ } }, []);
  return { listening, partial, start, stop };
}
