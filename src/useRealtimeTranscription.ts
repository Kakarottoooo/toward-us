import { useEffect, useRef, useState } from "react";

type PartialTurn = { itemId: string; speakerId: string; text: string };

export function useRealtimeTranscription<T>({
  endpoint,
  speakerId,
  onCommitted,
  onError,
}: {
  endpoint: string;
  speakerId: string;
  onCommitted: (payload: T) => void;
  onError: (message: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [partial, setPartial] = useState<PartialTurn | null>(null);
  const speakerRef = useRef(speakerId);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const connectionTimerRef = useRef<number | null>(null);
  const itemSpeakersRef = useRef(new Map<string, string>());
  const itemTextRef = useRef(new Map<string, string>());

  useEffect(() => { speakerRef.current = speakerId; }, [speakerId]);

  const stop = () => {
    if (connectionTimerRef.current !== null) window.clearTimeout(connectionTimerRef.current);
    connectionTimerRef.current = null;
    channelRef.current?.close();
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    channelRef.current = null;
    peerRef.current = null;
    streamRef.current = null;
    itemSpeakersRef.current.clear();
    itemTextRef.current.clear();
    setListening(false);
    setConnecting(false);
    setPartial(null);
  };

  useEffect(() => stop, []);

  const commit = async (itemId: string, transcript: string) => {
    const text = transcript.trim();
    const turnSpeaker = itemSpeakersRef.current.get(itemId) || speakerRef.current;
    itemSpeakersRef.current.delete(itemId);
    itemTextRef.current.delete(itemId);
    setPartial((current) => current?.itemId === itemId ? null : current);
    if (!text) return;
    try {
      const response = await fetch(endpoint.replace(/\/realtime$/, "/transcripts"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, speakerId: turnSpeaker, text }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "实时转录保存失败。");
      onCommitted(payload as T);
    } catch (error) {
      onError((error as Error).message);
    }
  };

  const handleEvent = (event: MessageEvent<string>) => {
    try {
      const data = JSON.parse(event.data);
      const itemId = String(data.item_id || "");
      if (data.type === "input_audio_buffer.speech_started" && itemId) {
        itemSpeakersRef.current.set(itemId, speakerRef.current);
        itemTextRef.current.set(itemId, "");
        setPartial({ itemId, speakerId: speakerRef.current, text: "" });
      }
      if (data.type === "conversation.item.input_audio_transcription.delta" && itemId) {
        const text = `${itemTextRef.current.get(itemId) || ""}${data.delta || ""}`;
        itemTextRef.current.set(itemId, text);
        const turnSpeaker = itemSpeakersRef.current.get(itemId) || speakerRef.current;
        itemSpeakersRef.current.set(itemId, turnSpeaker);
        setPartial({ itemId, speakerId: turnSpeaker, text });
      }
      if (data.type === "conversation.item.input_audio_transcription.completed" && itemId) void commit(itemId, String(data.transcript || itemTextRef.current.get(itemId) || ""));
      if (data.type === "error") onError(data.error?.message || "实时语音连接发生错误。");
    } catch {
      onError("实时语音返回了无法识别的数据。");
    }
  };

  const start = async () => {
    if (connecting || listening) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      onError("当前浏览器不支持实时语音，请继续使用文字。");
      return;
    }
    setConnecting(true);
    try {
      let permissionTimedOut = false;
      const microphone = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then((stream) => {
        if (permissionTimedOut) { stream.getTracks().forEach((track) => track.stop()); throw new Error("麦克风授权已超时，请重新点击并允许访问。"); }
        return stream;
      });
      const stream = await Promise.race<MediaStream>([
        microphone,
        new Promise((_, reject) => window.setTimeout(() => { permissionTimedOut = true; reject(new Error("麦克风授权已超时，请重新点击并允许访问。")); }, 12_000)),
      ]);
      const peer = new RTCPeerConnection();
      const channel = peer.createDataChannel("oai-events");
      stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
      channel.onmessage = handleEvent;
      channel.onopen = () => { if (connectionTimerRef.current !== null) window.clearTimeout(connectionTimerRef.current); connectionTimerRef.current = null; setConnecting(false); setListening(true); };
      channel.onclose = () => setListening(false);
      peer.onconnectionstatechange = () => {
        if (["failed", "closed", "disconnected"].includes(peer.connectionState)) stop();
      };
      streamRef.current = stream;
      peerRef.current = peer;
      channelRef.current = channel;
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/sdp" }, body: offer.sdp || "" });
      const answer = await response.text();
      if (!response.ok) {
        let message = "实时语音暂时不可用。";
        try { message = JSON.parse(answer).error || message; } catch { /* keep generic copy */ }
        throw new Error(message);
      }
      await peer.setRemoteDescription({ type: "answer", sdp: answer });
      connectionTimerRef.current = window.setTimeout(() => {
        if (channel.readyState !== "open") { stop(); onError("实时语音连接超时，请重试；文字输入仍可继续使用。"); }
      }, 12_000);
    } catch (error) {
      stop();
      onError((error as Error).message || "没有获得麦克风权限，仍可使用文字。");
    }
  };

  return { listening, connecting, partial, start, stop };
}
