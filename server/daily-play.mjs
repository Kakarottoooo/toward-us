import { decisionError } from "./agreement-actions.mjs";
import { localizedPlayCards } from "./play-cards.mjs";
import { readPlayDrawing } from "./play-drawing.mjs";

const languages = ["zh", "en", "es"];
const rotation = ["text", "choice", "guess", "draw"];
const videoCard = {
  cardId: "talk-after-a-long-day",
  activity: "video",
  i18n: {
    zh: "忙了一天，有点想 TA。你想视频十分钟，还是留条语音？",
    en: "After a long day apart, a ten-minute video call or a voice note?",
    es: "Al final de un día largo, ¿videollamada de diez minutos o nota de voz?",
  },
  variants: {
    zh: { options: ["视频十分钟", "留条语音"], followup: "累的时候，什么样的联系最舒服？" },
    en: { options: ["A ten-minute video call", "A voice note"], followup: "What kind of check-in feels best when you're tired?" },
    es: { options: ["Una videollamada de diez minutos", "Una nota de voz"], followup: "Cuando tienes un día largo, ¿cómo te gusta que estemos en contacto?" },
  },
};
export function bothPickedVideo(question, members) {
  return question.dailyPlay?.cardId === videoCard.cardId && members.length === 2 &&
    members.every(({ userId }) => question.answers?.[userId]?.choice === 0);
}
const drawingPrompts = [
  ["画一只正在度假的动物。", "Draw an animal on vacation.", "Dibuja un animal de vacaciones."],
  ["用几笔画出想送给 TA 的甜点。", "Sketch a dessert you would share with your partner.", "Dibuja un postre que compartirías con tu pareja."],
  ["画一间建在奇怪地方的小屋。", "Draw a tiny house in an unusual place.", "Dibuja una casita en un lugar insólito."],
  ["画一双能带你去任何地方的鞋。", "Draw shoes that could take you anywhere.", "Dibuja unos zapatos que puedan llevarte a cualquier lugar."],
  ["画一个你们俩的秘密队徽。", "Draw a secret badge for your team of two.", "Dibuja un emblema secreto para su equipo de dos."],
  ["把今天的天气画成一个小怪物。", "Draw today's weather as a little monster.", "Dibuja el clima de hoy como un monstruito."],
  ["画一把打开后能让人开心的伞。", "Draw an umbrella that cheers you up when it opens.", "Dibuja un paraguas que te alegre al abrirlo."],
  ["画一只你想带 TA 一起放的风筝。", "Draw a kite you want to fly with your partner.", "Dibuja una cometa que te gustaría volar con tu pareja."],
  ["画一座只通向有趣地方的桥。", "Draw a bridge that leads somewhere fun.", "Dibuja un puente que lleve a un lugar divertido."],
  ["把 TA 想象成小小宇航员，画出 TA 的飞船。", "Imagine your partner as an astronaut and draw their spaceship.", "Imagina a tu pareja como astronauta y dibuja su nave."],
  ["画出一扇你们想一起打开的门。", "Draw a door you'd like to open together.", "Dibuja una puerta que les gustaría abrir juntos."],
  ["画一个只按一下就会出惊喜的开关。", "Draw a button that gives a surprise each time it's pressed.", "Dibuja un botón que da una sorpresa cada vez que lo pulsas."],
];

export function nextDailyFormat(recent) {
  const previous = recent.at(-1);
  if (!previous) return "choice";
  return rotation[(rotation.indexOf(previous.dailyPlay?.kind || "text") + 1) % rotation.length];
}

export function makeDailyPlay({ format, recent, members, day, repeats }) {
  if (format === "text") return null;
  const submitted = new Set(recent.map((item) => item.dailyPlay?.cardId).filter(Boolean));
  const canUse = (item) => !submitted.has(item.cardId) && Object.values(item.i18n).every((text) => !repeats(text));
  if (format === "choice" && canUse(videoCard)) {
    const { i18n, ...dailyPlay } = videoCard;
    return { i18n, dailyPlay: { ...dailyPlay, kind: format } };
  }
  const cards = format === "draw"
    ? drawingPrompts.map((prompts, index) => ({
      cardId: `draw:${index}`,
      i18n: Object.fromEntries(languages.map((language, index) => [language, prompts[index]])),
      variants: {},
    }))
    : localizedPlayCards("zh").filter((card) => card.type === format).map(({ id }) => {
      const rows = languages.map((language) => [language, localizedPlayCards(language).find((card) => card.id === id)]);
      return {
        cardId: id,
        i18n: Object.fromEntries(rows.map(([language, row]) => [language, row.prompt])),
        variants: Object.fromEntries(rows.map(([language, row]) => [language, { options: row.options, followup: row.followup }])),
      };
    });
  const start = ((day % cards.length) + cards.length) % cards.length;
  const card = [...cards.slice(start), ...cards.slice(0, start)].find(canUse);
  if (!card) return null;
  const lastSubject = recent.findLast((item) => item.dailyPlay?.kind === "guess")?.dailyPlay.aboutUserId;
  const aboutUserId = format === "guess" ? members.find((member) => member.userId !== lastSubject)?.userId : undefined;
  return { i18n: card.i18n, dailyPlay: { kind: format, cardId: card.cardId, variants: card.variants, aboutUserId } };
}

export function readDailyPlayAnswer(question, { choice, drawing, language }) {
  const play = question.dailyPlay;
  if (play.kind === "draw") {
    if (drawing == null) return null;
    const strokes = readPlayDrawing(drawing);
    if (!strokes) throw decisionError(400, "invalid_drawing");
    // A neutral description keeps the existing conversation model from interpreting coordinates as text.
    const captions = { zh: "画了一张图", en: "Shared a drawing", es: "Compartió un dibujo" };
    return { drawing: strokes, text: captions[language] || captions.zh };
  }
  const options = (play.variants[language] || play.variants.zh).options;
  if (!Number.isInteger(choice) || !options[choice]) throw decisionError(400, "invalid_choice");
  return { choice, text: options[choice] };
}
