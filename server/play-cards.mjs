// [title, prompt, options, follow-up]. Option order is shared by all locales:
// the saved choice is an index, even when partners use different languages.
const cards = [
  {
    id: "choice-half-hour", type: "choice",
    zh: ["今晚的小约会", "今晚忽然多出半小时，你想跟 TA 怎么过？", ["出门散步，顺便买点吃的", "窝在家里，各挑一首歌给对方"], "下次真有半小时，你们最想先做哪一个？"],
    en: ["Half an hour together", "You both get an unexpected half hour tonight. How would you spend it?", ["Go for a walk and grab a snack", "Stay in and pick a song for each other"], "Which would you actually try the next time you get half an hour?"],
    es: ["Media hora juntos", "Esta noche les sobran treinta minutos. ¿Cómo los pasarían?", ["Salir a caminar y comprar algo para comer", "Quedarnos en casa y elegir una canción para el otro"], "¿Cuál probarían la próxima vez que tengan media hora libre?"],
  },
  {
    id: "choice-weekend-start", type: "choice",
    zh: ["周末怎么开场", "明早都不用赶时间，你更想怎么开场？", ["睡到自然醒，再慢慢吃早饭", "早一点出门，逛个没去过的地方"], "有没有一个周末，可以试试对方喜欢的开场？"],
    en: ["A weekend opener", "Neither of you has to rush tomorrow morning. How would you start the day?", ["Sleep in and take our time over breakfast", "Head out early and explore somewhere new"], "Is there a weekend when you'd try your partner's pick?"],
    es: ["Así empieza el finde", "Mañana ninguno tiene prisa. ¿Cómo les gustaría empezar el día?", ["Dormir un poco más y desayunar sin prisa", "Salir temprano a descubrir un lugar nuevo"], "¿Qué fin de semana podrían probar la opción del otro?"],
  },
  {
    id: "choice-revisit-evening", type: "choice",
    zh: ["想重来的一晚", "如果能把一种夜晚再过一遍，你会选哪一种？", ["笑得停不下来的一晚", "什么都没赶、安静待在一起的一晚"], "看到这两个选项时，你想到了哪一次？"],
    en: ["One night on repeat", "If you could have another evening like one of these, which would you pick?", ["A night we couldn't stop laughing", "A quiet night together with nowhere to be"], "Did either of these bring a particular night to mind?"],
    es: ["Una noche para repetir", "Si pudieran volver a vivir una noche así, ¿cuál elegirían?", ["Una en la que no paramos de reír", "Una tranquila, juntos y sin nada de prisa"], "¿Alguna de estas opciones les recordó una noche en particular?"],
  },
  {
    id: "choice-small-surprise", type: "choice",
    zh: ["小惊喜怎么给", "手里有一份小惊喜，你会什么时候给 TA？", ["一见面就给，看 TA 的第一反应", "先藏起来，等 TA 自己发现"], "如果角色互换，你希望 TA 怎么给你这份惊喜？"],
    en: ["A little surprise", "You have a small surprise for your partner. When would you give it to them?", ["Right when we meet, so I can see their face", "Hide it somewhere they'll find it later"], "If your partner had a surprise for you, how would you like them to give it?"],
    es: ["Una sorpresa pequeña", "Tienes una pequeña sorpresa para tu pareja. ¿Cuándo se la darías?", ["Al vernos, para ver su primera reacción", "La escondería para que la encuentre después"], "Si la sorpresa fuera para ti, ¿cómo te gustaría recibirla?"],
  },
  {
    id: "choice-new-town", type: "choice",
    zh: ["旅行的第一站", "到了一个没来过的小镇，你想先去哪儿？", ["找间店坐下来，看路上的人", "挑条有意思的路，走到哪算哪"], "如果这周就能试一次，你们附近哪里适合这样玩？"],
    en: ["First stop in a new town", "You've just arrived in an unfamiliar town. Where do you go first?", ["Find a place to sit and watch the world go by", "Pick an interesting street and see where it goes"], "Where near you could you try one of those this week?"],
    es: ["Primera parada", "Acaban de llegar a un pueblo que no conocen. ¿Adónde irían primero?", ["A un lugar para sentarnos y ver a la gente pasar", "Por una calle que nos llame la atención, a ver adónde lleva"], "¿En qué lugar cerca de ustedes podrían probar una de esas ideas esta semana?"],
  },
  {
    id: "choice-private-signal", type: "choice",
    zh: ["只有你们懂的暗号", "如果要选一个「我想你了」的专属暗号，你想用什么？", ["一个只有你们懂的梗", "一个发出去就明白的表情"], "现在就给彼此出一个候选暗号，会是什么？"],
    en: ["A signal just for you two", "If you made a secret code for “I miss you,” what would you choose?", ["An inside joke only we understand", "An emoji that says it all"], "What code would each of you nominate right now?"],
    es: ["Una señal solo suya", "Si inventaran un código secreto para decir «te extraño», ¿qué elegirían?", ["Un chiste que solo entendemos nosotros", "Un emoji que lo diga todo"], "¿Qué código propondría cada uno ahora mismo?"],
  },
  {
    id: "choice-vending-machine", type: "choice",
    zh: ["神奇售货机", "有台只收一枚硬币的神奇售货机，你想买什么？", ["一张明天就能用的瞬移券", "一段能重新体验的快乐回忆"], "如果今天真的买到了，你的第一站或第一段回忆会是什么？"],
    en: ["The one-coin vending machine", "A magic vending machine takes one coin. What do you buy?", ["A teleport pass you can use tomorrow", "A happy memory you can live through again"], "Where would you go, or which memory would you pick?"],
    es: ["La máquina de una moneda", "Una máquina expendedora mágica solo cobra una moneda. ¿Qué comprarías?", ["Un pase para teletransportarme mañana", "Un recuerdo feliz que pueda volver a vivir"], "¿Adónde irías, o qué recuerdo elegirías?"],
  },
  {
    id: "choice-two-photos", type: "choice",
    zh: ["相册只放一张", "要给你们这一段写张明信片，你想配哪种照片？", ["两个人都摆好姿势的照片", "一张没摆好，但一看就想笑的照片"], "如果只能补一句照片注释，你会写什么？"],
    en: ["The postcard cover", "If you made a postcard of this chapter together, which photo would go on it?", ["A photo we both posed for", "An unposed photo that makes us laugh"], "What one-line caption would you put on it?"],
    es: ["La portada de su postal", "Si hicieran una postal de esta etapa juntos, ¿qué foto pondrían?", ["Una foto en la que los dos salimos posando", "Una foto espontánea que nos hace reír"], "Si solo pudieras poner una línea debajo de la foto, ¿qué escribirías?"],
  },
  {
    id: "guess-after-a-long-day", type: "guess",
    zh: ["忙完以后", "我忙了一整天，最想 TA 先做什么？", ["坐下来听我说一会儿", "先帮我做一件手边的事", "陪我做点轻松的事", "让我先自己待一会儿"], "想到最近一次忙完回家，有什么是 TA 现在就能试试的？"],
    en: ["After a long day", "After a long day, what would I like my partner to do first?", ["Sit and listen to me for a bit", "Take one task off my hands", "Do something low-key with me", "Give me a little time on my own"], "Think of the last time you came home worn out. What could your partner try next time?"],
    es: ["Después de un día largo", "Después de un día agotador, ¿qué me gustaría que hiciera primero mi pareja?", ["Sentarse a escucharme un rato", "Echarme una mano con algo pendiente", "Hacer algo tranquilo conmigo", "Darme un rato para mí"], "Piensen en la última vez que uno llegó sin energía. ¿Qué podría probar el otro la próxima vez?"],
  },
  {
    id: "guess-good-news", type: "guess",
    zh: ["有好消息的时候", "我遇到一件值得高兴的事，最希望 TA 怎么接？", ["先听我讲完整个故事", "跟我一起热热闹闹地开心", "约个小小的庆祝", "告诉我 TA 看见了我的努力"], "最近有什么值得补一次庆祝的小事？"],
    en: ["When I have good news", "When something goes well for me, what reaction would make my day?", ["Listen to the whole story", "Get excited right along with me", "Plan a little celebration", "Tell me they noticed the work I put in"], "Is there a recent little win you could still celebrate together?"],
    es: ["Cuando traigo buenas noticias", "Cuando me sale algo bien, ¿qué reacción de mi pareja me alegraría el día?", ["Que escuche toda la historia", "Que se emocione conmigo", "Que planee una pequeña celebración", "Que me diga que notó mi esfuerzo"], "¿Hay algún pequeño logro reciente que todavía puedan celebrar juntos?"],
  },
  {
    id: "guess-window-seat", type: "guess",
    zh: ["车窗外的风景", "我坐在车上看风景，最可能想做什么？", ["戴耳机听歌", "拍下窗外有意思的一幕", "跟 TA 聊路上看到的东西", "什么都不做，发会儿呆"], "猜的时候，你想起了哪一趟旅程？"],
    en: ["The window seat", "On a ride with a view, what am I most likely to do?", ["Put on my headphones", "Take a picture of something outside", "Point things out and chat with my partner", "Just stare out and daydream"], "Did you think of a particular trip when you guessed?"],
    es: ["El asiento de la ventana", "En un viaje con buenas vistas, ¿qué es más probable que haga?", ["Ponerme los auriculares", "Hacerle una foto a algo de afuera", "Comentar con mi pareja lo que vemos", "Mirar por la ventana y dejar volar la mente"], "¿Se te vino a la cabeza algún viaje al adivinar?"],
  },
  {
    id: "guess-kitchen-dj", type: "guess",
    zh: ["厨房里的 DJ", "我们一起做饭时，如果让我选声音，我更想听什么？", ["放一首能跟着唱的歌", "听个有意思的播客", "什么都不放，边做边聊"], "下一次一起做饭，谁来选第一首歌或第一个话题？"],
    en: ["Kitchen DJ", "If we're cooking together and I get to pick the soundtrack, what do I choose?", ["A song I can sing along to", "An interesting podcast", "Nothing playing so we can talk"], "Who's picking the first song or starting the first conversation next time?"],
    es: ["DJ en la cocina", "Si cocinamos juntos y puedo elegir qué escuchar, ¿qué pongo?", ["Una canción que pueda cantar", "Un pódcast interesante", "Nada, así podemos charlar"], "La próxima vez, ¿quién elige la primera canción o el primer tema de conversación?"],
  },
  {
    id: "guess-photo-worth-keeping", type: "guess",
    zh: ["我会收藏的照片", "如果要我收一张两个人的照片，我最可能挑什么？", ["抓拍到 TA 开怀大笑的一张", "记录了一个特别日子的一张", "拍得不完美但有故事的一张", "一个日常小瞬间的一张"], "愿意的话，各挑一张发给对方，说说自己为什么舍不得删。"],
    en: ["A photo I'd keep", "If I could save just one photo of our time together, which would I pick?", ["A candid shot of my partner cracking up", "One that marks a special day", "An imperfect photo with a good story", "One from a small, everyday moment"], "If you feel like it, send each other one photo and say why you'd keep it."],
    es: ["Una foto que guardaría", "Si solo pudiera guardar una foto de nuestro tiempo juntos, ¿cuál elegiría?", ["Una espontánea con mi pareja a carcajadas", "Una que me recuerde un día especial", "Una imperfecta, pero con una buena historia", "Una de un pequeño momento cotidiano"], "Si les apetece, mándense una foto y cuenten por qué la guardarían."],
  },
  {
    id: "guess-plan-cancelled", type: "guess",
    zh: ["忽然空出了一天", "计划临时取消，我通常第一反应是什么？", ["立刻找个新的安排", "先弄清楚发生了什么", "觉得刚好多了点自由时间", "先听听 TA 怎么想"], "有哪种情况会让你的答案变得不一样？"],
    en: ["An unexpectedly free day", "When a plan falls through, what's usually my first reaction?", ["Find a new plan right away", "Ask what happened", "Enjoy the surprise free time", "See what my partner feels like doing"], "Is there a situation where your answer would change?"],
    es: ["Un día libre de sorpresa", "Cuando se cancela un plan a última hora, ¿cuál suele ser mi primera reacción?", ["Buscar otro plan enseguida", "Preguntar qué pasó", "Disfrutar del tiempo libre inesperado", "Ver qué le apetece hacer a mi pareja"], "¿En qué situación cambiaría tu respuesta?"],
  },
  {
    id: "guess-small-kindness", type: "guess",
    zh: ["最能打动我的小事", "下面哪件小事，最容易让我觉得 TA 想到了我？", ["记住我随口提过的小事", "出门时顺手给我带吃的", "发一句没什么原因的问候", "帮我留一点一起相处的时间"], "对方揭晓的答案里，有没有一件你今天就能做的小事？"],
    en: ["The little thing I'd notice", "Which small thing would most make me feel like my partner thought of me?", ["Remember a detail I mentioned in passing", "Bring me a snack when they're out", "Text me just because", "Make a little time for us"], "Is there something in your partner's answer you could do today?"],
    es: ["El detalle que notaría", "¿Qué detalle me haría sentir más que mi pareja pensó en mí?", ["Acordarse de algo que mencioné de pasada", "Traerme algo rico cuando sale", "Mandarme un mensaje porque sí", "Reservar un ratito para estar juntos"], "¿Hay algún detalle de la respuesta de tu pareja que puedas tener hoy?"],
  },
  {
    id: "guess-date-replay", type: "guess",
    zh: ["下次还想这么约", "如果可以原样再来一次，我更想重温哪种约会？", ["一起边走边聊", "发现一家都喜欢的小店", "在家一起做点东西", "一起体验从没试过的活动"], "下次约会，要不要每人选一个想留住的细节？"],
    en: ["A date worth repeating", "If I could replay a date just the way it was, what kind would I pick?", ["A walk with a long conversation", "Finding a little spot we both loved", "Making something together at home", "Trying an activity neither of us had done"], "For your next date, what detail would each of you bring back?"],
    es: ["Una cita para repetir", "Si pudiera repetir una cita tal como fue, ¿cuál elegiría?", ["Un paseo con una larga charla", "Descubrir un sitio pequeño que nos encantó", "Hacer algo juntos en casa", "Probar una actividad nueva para ambos"], "Para la próxima cita, ¿qué detalle le gustaría recuperar a cada uno?"],
  },
  {
    id: "truth-one-tiny-scene", type: "truth",
    zh: ["舍不得忘的小事", "如果从最近的生活里留一幕给未来的自己，你会留哪一幕？", [], "对方选的那一幕里，有没有一个你没注意到的细节？"],
    en: ["A moment to keep", "If you could save one little scene from lately for your future self, which one would it be?", [], "Was there a detail in your partner's scene you hadn't noticed?"],
    es: ["Un momento para guardar", "Si pudieras guardar una pequeña escena reciente para tu yo del futuro, ¿cuál sería?", [], "¿Hay algún detalle en la escena de tu pareja que no habías notado?"],
  },
  {
    id: "truth-an-ordinary-kindness", type: "truth",
    zh: ["那天其实有被照顾到", "TA 做过哪件看起来普通、但你记到现在的小事？", [], "选一个你还记得的细节，让 TA 听听你为什么记住了它。"],
    en: ["A kindness I still remember", "What's an ordinary little thing your partner did that has stuck with you?", [], "Tell your partner one detail you remember and why it stayed with you."],
    es: ["Un gesto que sigo recordando", "¿Qué pequeño gesto cotidiano de tu pareja se te quedó grabado?", [], "Cuéntale qué detalle recuerdas y por qué se te quedó grabado."],
  },
  {
    id: "truth-do-more-often", type: "truth",
    zh: ["下周想多做一次", "有没有一件不怎么费力、但你很想下周一起再做一次的事？", [], "如果两个人提的事不同，哪一件可以先试，另一件留给什么时候？"],
    en: ["One more time next week", "What's something easy you'd love to do together one more time next week?", [], "If you picked different things, which could you try first and when could you do the other?"],
    es: ["Una vez más la próxima semana", "¿Qué cosa sencilla te gustaría volver a hacer juntos la próxima semana?", [], "Si eligieron cosas distintas, ¿cuál podrían probar primero y cuándo harían la otra?"],
  },
  {
    id: "truth-a-better-check-in", type: "truth",
    zh: ["比「今天咋样」更好的一句", "如果今天只能问你一个问题，什么问题会让你想认真聊一会儿？", [], "如果两个人都愿意，就挑其中一个问题好好聊一会儿。"],
    en: ["Better than ‘How was your day?’", "If your partner could ask you just one question today, what would get you talking?", [], "If you're both up for it, pick one of your questions and talk about it for a bit."],
    es: ["Algo más que «¿qué tal el día?»", "Si tu pareja solo pudiera hacerte una pregunta hoy, ¿cuál te daría ganas de conversar?", [], "Si a los dos les apetece, elijan una de las preguntas y conversen un rato."],
  },
  {
    id: "truth-imaginary-holiday", type: "truth",
    zh: ["自创一个两人节日", "如果你们能在日历上造一个只有两个人过的节日，它叫什么？", [], "给这个节日加一条规则，那天你们要一起做什么？"],
    en: ["A holiday just for us", "If you could add a holiday to the calendar just for you two, what would you call it?", [], "Make up one rule for your new holiday. What do you always do together that day?"],
    es: ["Una fiesta solo nuestra", "Si pudieran inventar un día festivo solo para los dos, ¿cómo lo llamarían?", [], "Pónganle una regla a su nuevo día festivo. ¿Qué harían siempre juntos ese día?"],
  },
  {
    id: "truth-making-space", type: "truth",
    zh: ["给自己留点空白", "你最近最想给自己留出一点什么时间？", [], "有什么小安排，能让两个人都保留想要的时间？"],
    en: ["A little time for myself", "What kind of time have you been wanting to make a little more space for lately?", [], "Is there a small change that could make room for what you both want?"],
    es: ["Un ratito para mí", "Últimamente, ¿para qué te gustaría reservar un poco más de tiempo?", [], "¿Hay algún pequeño cambio que deje espacio para lo que quieren los dos?"],
  },
  {
    id: "truth-state-the-return", type: "truth",
    zh: ["暂停之后怎么回来", "如果话题聊得有点卡，哪一句开场会让你更容易接着聊？", [], "各试着说一遍自己的那句，看看听起来是什么感觉。"],
    en: ["Picking up a conversation", "When a conversation gets stuck, what's one thing your partner could say that would make it easier to pick back up?", [], "Try saying your sentence out loud and see how it sounds to each other."],
    es: ["Retomar una conversación", "Cuando una conversación se atasca, ¿qué frase de tu pareja te ayudaría a retomarla?", [], "Digan su frase en voz alta y vean cómo le suena al otro."],
  },
  {
    id: "truth-next-visit-postcard", type: "truth",
    zh: ["下次见面的预告", "如果提前给下次见面写一句预告，你会写什么？", [], "想不想挑一句当作下次见面时要兑现的小约定？"],
    en: ["A preview of next time", "If you wrote a one-line teaser for the next time you see each other, what would it say?", [], "Would you like to pick one line and make it a tiny plan for next time?"],
    es: ["Un adelanto para la próxima vez", "Si escribieras un adelanto de una línea para la próxima vez que se vean, ¿qué diría?", [], "¿Les gustaría elegir una de esas frases y convertirla en un pequeño plan?"],
  },
];

export function localizedPlayCards(language) {
  const locale = language === "en" || language === "es" ? language : "zh";
  return cards.map((card) => {
    const [title, prompt, options, followup] = card[locale];
    return { id: card.id, type: card.type, title, prompt, options: [...options], followup };
  });
}
