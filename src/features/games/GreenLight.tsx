import { Circle, HandTap, Lightning, Minus } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { ArcadeStage, type ArcadeMatchState } from "./ArcadeStage";
import type { ScreenProps } from "./MatchScreen";
import "./green-light.css";

type Heat = { winner: 0 | 1 | null; reason: "miss" | "false-start" | "double-start" | "tie" | "fastest";
  times: [number | null, number | null] };
type LightResult = { winner: 0 | 1 | null; points: [number, number]; heats: Heat[] };
type LightView = Pick<LightResult, "points" | "heats"> & { signal: "red" | "green" | "result"; pressed: boolean; round: number; total: number };

function SignalBoard({ data, seat, phase, send, language, partnerName }: { data: LightView; seat: 0 | 1; phase: string;
  send: (action: Record<string, unknown>) => void; language: Language; partnerName: string }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const last = data.heats.at(-1);
  const scored = data.signal === "result";
  const green = data.signal === "green";
  const active = phase === "playing";
  const lightText = green ? t("绿灯！", "Green!", "¡Verde!") : t("红灯", "Red light", "Luz roja");
  const headline = scored && last
    ? last.winner === null ? t("本轮平局", "This heat is tied", "Esta ronda quedó empatada")
      : last.winner === seat ? t("你拿下一分", "You get the point", "Punto para ti")
      : t(`${partnerName} 得一分`, `${partnerName} gets the point`, `Punto para ${partnerName}`)
    : data.pressed ? t("正在判定", "Checking the taps…", "Comprobando…") : lightText;
  const detail = scored && last ? last.reason === "false-start"
    ? (last.winner === seat ? t("TA 提前按了。", "Your partner tapped early.", "Tu pareja tocó antes de tiempo.")
      : t("你提前按了。", "You tapped early.", "Tocaste antes de tiempo."))
    : last.reason === "double-start" ? t("两个人都提前按了。", "You both tapped early.", "Ambos se adelantaron.")
      : last.reason === "miss" ? t("两个人都没按。", "Neither of you tapped.", "Ninguno tocó.")
        : last.reason === "tie" ? t("两下太接近，算平局。", "The taps were too close to call.", "Los toques fueron casi simultáneos.")
          : t("先按到的人赢下本轮。", "The first tap took this heat.", "El primer toque ganó esta ronda.")
    : green ? t("现在拍！", "Tap now!", "¡Toca ahora!") : t("等灯变绿。", "Wait for green.", "Espera a que cambie a verde.");

  return <div className="green-light" data-testid="green-light" data-signal={data.signal} data-round={data.round}>
    <div className="green-light-scores">
      <div><span>{t("你", "You", "Tú")}</span><strong data-testid="green-light-your-points">{data.points[seat]}</strong></div>
      <div><span>{t(`第 ${data.round}／${data.total} 轮`, `Heat ${data.round} / ${data.total}`, `Ronda ${data.round} / ${data.total}`)}</span>
        <span className="green-light-heats" aria-hidden="true">
          {Array.from({ length: data.total }, (_, index) => {
            const heat = data.heats[index];
            return !heat ? <Circle key={index} size={12} /> : heat.winner === null ? <Minus key={index} size={12} weight="bold" />
              : <Circle key={index} size={12} weight="fill" className={heat.winner === seat ? "green-light-dot-own" : "green-light-dot-partner"} />;
          })}
        </span>
      </div>
      <div><span>{partnerName}</span><strong>{data.points[1 - seat]}</strong></div>
    </div>
    <button type="button" className={`green-light-tap is-${data.signal}`} data-testid="green-light-tap" data-signal={data.signal}
      disabled={!active || scored || data.pressed} aria-label={scored ? headline : green ? t("绿灯，拍一下", "Green light, tap now", "Luz verde, toca ahora")
        : t("红灯，等待", "Red light, wait", "Luz roja, espera")}
      onClick={() => send({ type: "tap", round: data.round, signal: data.signal })}>
      <span className="green-light-bulbs" aria-hidden="true"><i /><i /></span>
      <span data-testid="green-light-signal">{headline}</span>
      {!scored && <HandTap size={25} weight="duotone" aria-hidden="true" />}
    </button>
    <p className="green-light-note" role="status" data-testid="green-light-feedback">{detail}</p>
    {scored && last?.times[seat] != null && <p className="green-light-time">
      {t(`从亮绿灯到服务器收到你的按键，用时 ${last.times[seat]} 毫秒`, `Green to your tap, measured at the server: ${last.times[seat]} ms`,
        `Del verde a tu toque, medido en el servidor: ${last.times[seat]} ms`)}
    </p>}
  </div>;
}

export function GreenLight(props: ScreenProps<ArcadeMatchState<LightResult>>) {
  const { language, partnerName } = props;
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  return <ArcadeStage<LightView, LightResult> {...props}
    instructions={t("绿了再拍。抢跑送对方一分，几乎同时按下算平局。比五轮。",
      "Tap on green. An early tap gives your partner a point. Nearly simultaneous taps tie. Play five heats.",
      "Toca en verde. Si te adelantas, el punto es de tu pareja. Los toques casi simultáneos empatan. Son cinco rondas.")}
    summary={(result, seat) => <div className="green-light-result" data-testid="green-light-result">
      <Lightning size={26} weight="fill" aria-hidden="true" />
      <strong>{result.winner === null ? t("打成平手！", "It's a draw!", "¡Empate!") : result.winner === seat ? t("你赢了！", "You win!", "¡Ganaste!")
        : t(`${partnerName} 赢了！`, `${partnerName} wins!`, `¡Ganó ${partnerName}!`)}</strong>
      <span>{result.points[seat]} : {result.points[1 - seat]}</span>
    </div>}>
    {({ data, seat, phase, send }) => <SignalBoard data={data} seat={seat} phase={phase} send={send} language={language} partnerName={partnerName} />}
  </ArcadeStage>;
}
