import { useRef } from "react";
import { Microphone, StopCircle } from "@phosphor-icons/react";
import { languageTag, localized, type Language } from "../../i18n";
import { browserSpeechAvailable, useBrowserSpeech } from "../../useBrowserSpeech";
import { useRealtimeTranscription } from "../../useRealtimeTranscription";

/**
 * Speaking into a game's text box (founder 11-06: 海龟汤 needs voice as well as typing). Like the App conversation:
 * realtime transcription first, the phone's own speech recognition when that service is unavailable. What is heard only
 * fills the box (`onText`); the player still reads it and sends it themselves.
 */
export function useDictation({ matchId, language, onText, onError }: { matchId: string; language: Language; onText: (text: string) => void; onError: (message: string) => void }) {
  const endpoint = `/api/matches/${encodeURIComponent(matchId)}/realtime?language=${language}`;
  const phone = useRef(false);
  const speech = useBrowserSpeech({ lang: languageTag(language), onTranscript: (text) => onText(text), onError });
  const realtime = useRealtimeTranscription<null>({
    endpoint, speakerId: "",
    onTranscript: async (text) => { onText(text); return null; },
    onCommitted: () => {},
    onError: (message) => { realtime.stop(); if (browserSpeechAvailable()) { phone.current = true; speech.start(); } else onError(message); },
  });
  const listening = realtime.listening || speech.listening, connecting = realtime.connecting;
  const stop = () => { realtime.stop(); speech.stop(); };
  const start = () => { if (phone.current) speech.start(); else void realtime.start(endpoint); };
  return { listening, connecting, active: listening || connecting, partial: speech.partial || realtime.partial?.text || "", start, stop, toggle: () => (listening || connecting ? stop() : start()) };
}

/** Joins what was heard onto what is already in the box: no space between Chinese phrases. */
export const joinHeard = (language: Language, before: string, heard: string) => !before.trim() ? heard : language === "zh" ? `${before}${heard}` : `${before.trimEnd()} ${heard}`;

export function MicButton({ language, dictation, disabled = false }: { language: Language; dictation: ReturnType<typeof useDictation>; disabled?: boolean }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  return <button type="button" className={`game-mic ${dictation.active ? "is-on" : ""}`} disabled={disabled} aria-pressed={dictation.active}
    aria-label={dictation.active ? t("停止说话", "Stop speaking", "Dejar de hablar") : t("用说的", "Speak instead", "Hablar en vez de escribir")}
    onClick={dictation.toggle} data-testid="game-mic">
    {dictation.active ? <StopCircle size={18} weight="fill" /> : <Microphone size={18} />}
  </button>;
}
