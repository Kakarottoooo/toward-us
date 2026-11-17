import { ArrowUp, Circle, Lightning } from "@phosphor-icons/react";
import { localized, type Language } from "../../i18n";
import { ArcadeStage, type ArcadeMatchState } from "./ArcadeStage";
import type { ScreenProps } from "./MatchScreen";
import "./arcade-sports.css";

type Point = { x: number; y: number };
type Rail = { x1: number; y1: number; x2: number; y2: number };
type Bumper = Point & { radius: number; points: number; lit: boolean };
type PinballResult = { winner: null; score: number; target: number; ballsRemaining: number; cleared: boolean; hits: number };
type PinballView = {
  width: number;
  height: number;
  ballRadius: number;
  ball: Point | null;
  bumpers: Bumper[];
  rails: Rail[];
  flippers: [Rail & { raised: boolean }, Rail & { raised: boolean }];
  score: number;
  target: number;
  ballsRemaining: number;
};

function PinballTable({ data, seat, active, send, language }: {
  data: PinballView; seat: 0 | 1; active: boolean; send: (action: Record<string, unknown>) => void; language: Language;
}) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const { width, height } = data;
  const side = seat === 0 ? t("左侧", "Left side", "Lado izquierdo") : t("右侧", "Right side", "Lado derecho");
  const flip = seat === 0 ? t("抬左挡板", "Left flipper", "Paleta izquierda") : t("抬右挡板", "Right flipper", "Paleta derecha");
  const launch = t("发球", "Launch ball", "Lanzar bola");
  const showFlip = Boolean(data.ball);
  const position = ({ x, y }: Point) => ({ left: `${x / width * 100}%`, top: `${y / height * 100}%` });

  function railStyle({ x1, y1, x2, y2 }: Rail) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return {
      ...position({ x: x1, y: y1 }), width: `${Math.hypot(dx, dy) / width * 100}%`,
      transform: `translateY(-50%) rotate(${Math.atan2(dy, dx)}rad)`,
    };
  }

  return <section className="sports-game" data-testid="pinball-duo">
    <div className="sports-score pinball-score">
      <div role="status"><small>{t("共同得分", "Team score", "Puntos del equipo")}</small><strong data-testid="pinball-score">{data.score}</strong><span className="pinball-score-target">{t(`目标 ${data.target}`, `Goal ${data.target}`, `Meta ${data.target}`)}</span></div>
      <div className="pinball-lives"><small>{t("剩余球", "Balls left", "Bolas restantes")}</small><strong data-testid="pinball-balls">{data.ballsRemaining}</strong>
        <span aria-hidden="true">{[0, 1, 2].map((index) => <Circle key={index} weight={index < data.ballsRemaining ? "fill" : "regular"} size={12} />)}</span></div>
    </div>
    <div className="sports-board pinball-board" style={{ aspectRatio: `${width} / ${height}` }} data-testid="pinball-table" role="img"
      aria-label={t("弹珠台，上半部有五个得分区，下方各有一块挡板。", "Pinball table with five bumpers and a flipper on each side.", "Mesa de pinball con cinco rebotes y una paleta a cada lado.")}>
      <i className="pinball-orbit" aria-hidden="true" />
      {data.rails.map((rail, index) => <i className="pinball-bar pinball-rail" style={railStyle(rail)} key={index} aria-hidden="true" />)}
      {data.bumpers.map((bumper, index) => <i className={`sports-disc pinball-bumper${bumper.lit ? " pinball-bumper-lit" : ""}`} key={index}
        style={{ ...position(bumper), width: `${bumper.radius * 2 / width * 100}%` }} aria-hidden="true">{bumper.points}</i>)}
      {data.flippers.map((flipper, index) => <i className={`pinball-bar pinball-flipper ${index === seat ? "pinball-flipper-you" : "pinball-flipper-partner"}`} style={railStyle(flipper)} key={index} aria-hidden="true" data-raised={flipper.raised} data-testid={index === 0 ? "pinball-left-flipper" : "pinball-right-flipper"} />)}
      {data.ball && <i className="sports-disc pinball-ball" style={{ ...position(data.ball), width: `${data.ballRadius * 2 / width * 100}%` }} aria-hidden="true" />}
      <span className="pinball-side" aria-hidden="true">{t(`你 · ${side}`, `You · ${side}`, `Tú · ${side}`)}</span>
    </div>
    <button className="sports-control pinball-action" type="button" onClick={() => send({ type: showFlip ? "flip" : "launch" })}
      disabled={!active || data.ballsRemaining === 0} data-testid={showFlip ? "pinball-flip" : "pinball-launch"}>
      {showFlip ? <Lightning size={19} weight="fill" aria-hidden="true" /> : <ArrowUp size={19} weight="bold" aria-hidden="true" />}
      {showFlip ? flip : launch}
    </button>
  </section>;
}

export function PinballDuo(props: ScreenProps<ArcadeMatchState<PinballResult>>) {
  const { language } = props;
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  return <ArcadeStage<PinballView, PinballResult> {...props}
    instructions={t("你们各控一块挡板。球落近时点一下，把球打回得分区。", "You each control one flipper. Tap when the ball gets close to send it back through the bumpers.", "Cada persona controla una paleta. Pulsa cuando la bola se acerque para devolverla a los rebotes.")}
    summary={(result) => <div className="sports-outcome"><strong>{result.cleared ? t("一起达标了！", "You hit the goal together!", "¡Alcanzaron la meta!")
      : t("双人弹珠结束", "Pinball round complete", "Partida de pinball terminada")}</strong>
      <span>{t(`${result.score} 分 · ${result.hits} 次击中`, `${result.score} points · ${result.hits} hits`, `${result.score} puntos · ${result.hits} rebotes`)}</span></div>}>
    {({ data, seat, phase, send }) => <PinballTable data={data} seat={seat} active={phase === "playing"} send={send} language={language} />}
  </ArcadeStage>;
}
