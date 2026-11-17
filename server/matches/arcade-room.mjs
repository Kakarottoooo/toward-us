import { performance } from "node:perf_hooks";
import { matchError } from "./errors.mjs";

const STEP_MS = 1000 / 30;
const FRAME_MS = 60;
const COUNTDOWN_MS = 3_000;
const SAVE_MS = 12_000;
const SECURITY_MS = 8_000;
const INACTIVE_MS = 90_000;
const MAX_ROOMS = 96;
const MAX_PEERS_PER_SEAT = 2;

export function mountArcadeRooms(router, { store, games, persist }) {
  const rooms = new Map();
  let ticker = null;

  async function activePair(userId, relationshipId, players) {
    const context = await store.getRelationshipContext(userId);
    return context?.relationship.id === relationshipId && context.relationship.status === "active" &&
      context.members.length === 2 && players.every((id) => context.members.some((member) => member.userId === id));
  }

  const present = (room) => room.peers.map((bucket) => bucket.size > 0);
  const remaining = (room) => Math.ceil(Math.max(0, room.rules.durationMs - room.elapsedMs));

  function snapshot(room, seat, now) {
    return {
      seat, phase: room.phase, ready: room.ready, present: present(room), data: room.rules.view(room.data, seat),
      countdownMs: room.phase === "countdown" ? Math.max(0, room.countdownAt - now) : 0,
      remainingMs: remaining(room), elapsedMs: Math.round(room.elapsedMs), result: room.data.result || null,
    };
  }

  function writeFrame(room, peer, seat, now) {
    if (peer.writableEnded || peer.destroyed || peer.writableLength > 32_768) return;
    peer.write(`event: frame\ndata: ${JSON.stringify(snapshot(room, seat, now))}\n\n`);
  }

  function broadcast(room, now = performance.now()) {
    room.lastFrame = now;
    room.peers.forEach((bucket, seat) => bucket.forEach((peer) => writeFrame(room, peer, seat, now)));
  }

  function close(id) {
    const room = rooms.get(id);
    if (!room) return;
    rooms.delete(id);
    room.closed = true;
    for (const bucket of room.peers) {
      for (const peer of bucket) peer.end();
      bucket.clear();
    }
    if (!rooms.size && ticker) { clearInterval(ticker); ticker = null; }
  }

  function save(room, now) {
    if (room.saving || now < room.nextSave || room.savedResult || room.closed) return;
    const result = room.data.result;
    const action = result
      ? { type: "arcade_complete", result: structuredClone(result) }
      : { type: "arcade_checkpoint", checkpoint: { simulation: structuredClone(room.data), elapsedMs: room.elapsedMs } };
    room.saving = true;
    room.dirty = false;
    void persist({ userId: room.players[0], matchId: room.id, game: room.game, action }).then(() => {
      room.savedResult = Boolean(result);
      room.nextSave = performance.now() + (room.data.result && !result ? 0 : SAVE_MS);
    }).catch((error) => {
      if (["not_found", "pairing_required", "match_over"].includes(error?.matchCode)) { close(room.id); return; }
      room.dirty = true;
      room.nextSave = performance.now() + 2000;
      console.error("Arcade progress save failed", room.game);
    }).finally(() => { room.saving = false; });
  }

  function stopControls(room) {
    room.rules.neutral?.(room.data, 0);
    room.rules.neutral?.(room.data, 1);
  }

  function pause(room, now) {
    if (room.phase === "finished") return;
    const wasPlaying = room.phase === "playing" || room.phase === "countdown";
    room.ready = [false, false];
    if (wasPlaying) room.phase = "paused";
    if (wasPlaying) stopControls(room);
    broadcast(room, now);
    if (room.dirty && !room.saving) { room.nextSave = now; save(room, now); }
  }

  function finish(room, now) {
    room.phase = "finished";
    room.endedAt = now;
    room.nextSave = now;
    stopControls(room);
    broadcast(room, now);
    save(room, now);
  }

  function step(room, now) {
    if (!present(room).some(Boolean) && now - room.lastSeen >= INACTIVE_MS && !room.saving && (!room.data.result || room.savedResult)) {
      close(room.id);
      return;
    }
    if (room.phase === "finished") {
      if (!room.savedResult) save(room, now);
      if (room.savedResult && now - room.endedAt >= INACTIVE_MS) close(room.id);
      return;
    }
    if (now >= room.nextSecurity && present(room).some(Boolean)) {
      room.nextSecurity = now + SECURITY_MS;
      void activePair(room.players[0], room.relationshipId, room.players).then((allowed) => { if (!allowed) close(room.id); })
        .catch(() => { if (rooms.get(room.id) === room) pause(room, performance.now()); });
    }
    if (room.phase === "countdown" && now >= room.countdownAt) {
      room.phase = "playing";
      room.lastTick = now;
      broadcast(room, now);
    } else if (room.phase === "playing") {
      // A short cap avoids large physics steps after a busy process or suspended computer.
      const dt = Math.min(0.05, Math.max(0, (now - room.lastTick) / 1000));
      room.lastTick = now;
      room.elapsedMs += dt * 1000;
      room.rules.tick(room.data, dt);
      room.dirty = true;
      if (!room.data.result && !remaining(room)) room.data.result = room.rules.timeout(room.data);
      if (room.data.result) { finish(room, now); return; }
    }
    if (room.dirty) save(room, now);
    if (now - room.lastFrame >= (["playing", "countdown"].includes(room.phase) ? FRAME_MS : 3500)) broadcast(room, now);
  }

  function run() {
    if (ticker) return;
    ticker = setInterval(() => {
      const now = performance.now();
      for (const room of rooms.values()) {
        try { step(room, now); }
        catch { console.error("Arcade frame failed", room.game); close(room.id); }
      }
    }, STEP_MS);
    ticker.unref?.();
  }

  router.get("/matches/:id/live", async (req, res) => {
    const userId = req.auth.user.id;
    const match = await store.getRelationshipRecordForUser("matches", req.params.id, userId);
    const rules = games[match?.game]?.live;
    const players = match?.state?.players;
    const seat = players?.indexOf(userId);
    if (!rules || match.status !== "active" || ![0, 1].includes(seat) || !(await activePair(userId, match.relationshipId, players))) {
      throw matchError(404, "not_found");
    }
    let room = rooms.get(match.id);
    const now = performance.now();
    if (!room) {
      if (rooms.size >= MAX_ROOMS) throw matchError(503, "arcade_busy");
      const checkpoint = match.state.checkpoint;
      room = {
        id: match.id, game: match.game, relationshipId: match.relationshipId, rules, players,
        data: checkpoint?.simulation || rules.boot({ variant: match.state.variant, players }), elapsedMs: checkpoint?.elapsedMs || 0,
        phase: checkpoint ? "paused" : "lobby", ready: [false, false], peers: [new Set(), new Set()],
        lastInput: [-Infinity, -Infinity], rate: players.map(() => ({ since: now, count: 0 })), lastSeen: now, nextSave: now + SAVE_MS, nextSecurity: now + SECURITY_MS,
        dirty: false, saving: false, savedResult: false, lastFrame: now,
      };
      rooms.set(match.id, room);
      run();
    }
    if (room.peers[seat].size >= MAX_PEERS_PER_SEAT) throw matchError(429, "arcade_busy");
    room.lastSeen = now;
    room.peers[seat].add(res);
    res.set({ "content-type": "text/event-stream", "cache-control": "private, no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.flushHeaders();
    res.once("close", () => {
      if (rooms.get(room.id) !== room) return;
      room.peers[seat].delete(res);
      room.lastSeen = performance.now();
      if (!room.peers[seat].size) pause(room, room.lastSeen);
    });
    broadcast(room, now);
  });

  router.post("/matches/:id/live", async (req, res) => {
    const room = rooms.get(req.params.id);
    const userId = req.auth.user.id;
    const seat = room?.players.indexOf(userId);
    if (!room || ![0, 1].includes(seat) || !room.peers[seat].size) throw matchError(404, "not_found");
    if (!(await activePair(userId, room.relationshipId, room.players))) { close(room.id); throw matchError(404, "not_found"); }
    if (rooms.get(room.id) !== room || room.phase === "finished") throw matchError(409, "match_over");
    const now = performance.now();
    const action = req.body?.action;
    if (!action || typeof action !== "object" || typeof action.type !== "string") throw matchError(400, "invalid_action");
    if (action.type === "pause") pause(room, now);
    else if (action.type === "ready") {
      if (!["lobby", "paused"].includes(room.phase)) throw matchError(409, "invalid_action");
      room.ready[seat] = true;
      if (room.ready.every(Boolean) && present(room).every(Boolean)) { room.phase = "countdown"; room.countdownAt = now + COUNTDOWN_MS; }
      broadcast(room, now);
    } else {
      if (room.phase !== "playing") throw matchError(409, "invalid_action");
      const rate = room.rate[seat];
      if (now - rate.since >= 1000) { rate.since = now; rate.count = 0; }
      if (rate.count >= 45) throw matchError(429, "arcade_busy");
      rate.count += 1;
      // Bound high-rate analogue commands. Discrete taps and release commands remain independent.
      if (req.body.mode === "continuous") {
        if (now - room.lastInput[seat] < 24) return res.sendStatus(204);
        room.lastInput[seat] = now;
      }
      if (!room.rules.input(room.data, seat, action)) throw matchError(400, "invalid_action");
      room.dirty = true;
      if (room.data.result) finish(room, now);
    }
    res.sendStatus(204);
  });

  return { close };
}
