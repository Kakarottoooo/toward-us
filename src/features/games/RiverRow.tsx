import { ArrowLeft, ArrowRight, Boat, Flag, FlagCheckered, Heart, Lightning, Waves } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { localized, type Language } from "../../i18n";
import { ArcadeStage, type ArcadeMatchState } from "./ArcadeStage";
import type { ScreenProps } from "./MatchScreen";
import "./live-coop-routes.css";

type Course = "willow" | "canyon" | "glow";
type RiverGate = { at: number; x: number; width: number; status: "ahead" | "passed" | "missed" };
type RiverRock = { at: number; x: number; radius: number };
type RiverView = {
  course: Course;
  x: number;
  distance: number;
  drift: number;
  hull: number;
  synced: number;
  boost: boolean;
  recentStroke: boolean[];
  strokeReady: boolean[];
  gates: RiverGate[];
  rocks: RiverRock[];
  passed: number;
  target: number;
};
type RiverResult = {
  winner: null;
  outcome: "finished" | "gates" | "paddles" | "rocks" | "time";
  course: Course;
  gates: number;
  target: number;
  synced: number;
  strokes: number[];
  hits: number;
};

const riverNames: Record<Course, readonly [string, string, string]> = {
  willow: ["柳湾", "Willow Bend", "Curva de los sauces"],
  canyon: ["峡谷激流", "Canyon Rapids", "Rápidos del cañón"],
  glow: ["萤火水道", "Firefly Run", "Río de luciérnagas"],
};

const boatPosition = 78;
const surfaceY = (at: number, distance: number) => boatPosition - (at - distance) * 4.2;

function RiverBoard({ data, language }: { data: RiverView; language: Language }) {
  const t = (...copy: readonly [string, string, string]) => localized(language, ...copy);
  const nearGate = data.gates.find((gate) => gate.status === "ahead");
  const zone = data.x < 39 ? t("左侧", "left", "a la izquierda") : data.x > 61 ? t("右侧", "right", "a la derecha") : t("中间", "center", "en el centro");
  const hint = nearGate === undefined ? t("前方是终点", "The finish is ahead", "La meta está delante")
    : nearGate.x - data.x > 12 ? t("下一个浮标门在船右边", "Next gate is to your right", "La próxima puerta está a su derecha")
    : data.x - nearGate.x > 12 ? t("下一个浮标门在船左边", "Next gate is to your left", "La próxima puerta está a su izquierda")
    : t("船正对下一个浮标门", "Lined up with the next gate", "En línea con la próxima puerta");
  return <div className="river-scene" data-course={data.course} data-boost={data.boost} role="img"
    aria-label={t(`船在${zone}，${hint}`, `Boat: ${zone}. ${hint}.`, `Barca: ${zone}. ${hint}.`)}
    style={{"--river-flow": `${data.distance * 7}px`} as CSSProperties}>
    <div className="river-bank river-bank-left" aria-hidden="true" /><div className="river-bank river-bank-right" aria-hidden="true" />
    <div className="river-surface" aria-hidden="true">
      {data.rocks.map((rock) => {
        const top = surfaceY(rock.at, data.distance);
        return top >= -12 && top <= 110 ? <i key={rock.at} className="river-rock" style={{top: `${top}%`, left: `${rock.x}%`, width: `${rock.radius * 1.9}%`}} /> : null;
      })}
      {data.gates.map((gate) => {
        const top = surfaceY(gate.at, data.distance);
        return top >= -10 && top <= 105 ? <i key={gate.at} className="river-gate" data-status={gate.status} data-next={gate === nearGate}
          style={{top: `${top}%`, left: `${gate.x}%`, width: `${gate.width}%`}}><b /><b /></i> : null;
      })}
      {data.distance > 81 && <div className="river-finish-line" style={{top: `${surfaceY(100, data.distance)}%`}} />}
      <div className="river-boat" style={{left: `${data.x}%`, top: `${boatPosition}%`, "--river-tilt": `${data.drift * 1.05}deg`} as CSSProperties}>
        <i /><b /><span className="river-left-oar" data-active={data.recentStroke[0]} /><span className="river-right-oar" data-active={data.recentStroke[1]} />
      </div>
    </div>
  </div>;
}

export function RiverRow(props: ScreenProps<ArcadeMatchState<RiverResult>>) {
  const { language } = props;
  const t = (...copy: readonly [string, string, string]) => localized(language, ...copy);
  return <ArcadeStage<RiverView, RiverResult> {...props}
    instructions={t("每人划至少三下，穿过五道浮标门。合拍加速，单边划能转向。", "Take at least three strokes each and pass five gates. Row in sync to speed up, or use one paddle to turn.", "Remen al menos tres veces cada uno y crucen cinco puertas. Remen juntos para acelerar o con un solo remo para girar.")}
    summary={(result) => {
      const outcomes = {
        finished: t("一起划到了！", "You made it downriver!", "¡Llegaron río abajo!"),
        gates: t("到了终点，下次再多穿两道门。", "You reached the finish. Aim for more gates next time.", "Llegaron a la meta. Intenten cruzar más puertas la próxima vez."),
        paddles: t("两个人都要划至少三下。", "Both players need at least three strokes.", "Cada persona tiene que remar al menos tres veces."),
        rocks: t("船碰到太多石头了。", "The boat hit too many rocks.", "La barca chocó contra demasiadas rocas."),
        time: t("时间到了", "Time's up", "Se acabó el tiempo"),
      };
      return <div className="coop-route-result" data-testid="river-row-result"><FlagCheckered size={28} weight="duotone" aria-hidden="true" />
        <strong>{outcomes[result.outcome]}</strong>
        <span>{t(`通过 ${result.gates} 道门 · 合拍 ${result.synced} 次`, `${result.gates} gates · ${result.synced} strokes in sync`, `${result.gates} puertas · ${result.synced} remadas al unísono`)}</span>
      </div>;
    }}>
    {({ data, seat, phase, send }) => {
      const left = seat === 0;
      const TurnIcon = left ? ArrowRight : ArrowLeft;
      const paddle = left ? t("左桨", "Left paddle", "Remo izquierdo") : t("右桨", "Right paddle", "Remo derecho");
      const next = data.gates.find((gate) => gate.status === "ahead");
      const outsideGate = next ? Math.abs(next.x - data.x) > next.width / 2 - 3 : false;
      const turnHint = next && outsideGate ? next.x > data.x ? t("船需要向右一点。", "Steer the boat a little right.", "Giren un poco a la derecha.")
        : t("船需要向左一点。", "Steer the boat a little left.", "Giren un poco a la izquierda.") : t("保持合拍，往前划。", "Keep in sync and paddle ahead.", "Sigan remando al unísono.");
      return <section className="coop-route river-game" data-testid="river-row" data-seat={seat} data-gates={data.passed}>
        <div className="coop-route-header">
          <div><small><Boat size={15} weight="fill" aria-hidden="true" />{paddle}</small><strong>{t(...riverNames[data.course])}</strong></div>
          <span className="coop-route-step" aria-label={t(`船还可以碰石头 ${data.hull} 次`, `Boat health: ${data.hull}`, `Resistencia de la barca: ${data.hull}`)}><Heart size={16} weight="fill" aria-hidden="true" />{data.hull}</span>
        </div>
        <RiverBoard data={data} language={language} />
        <div className="river-hud">
          <span><Flag size={17} weight="fill" aria-hidden="true" />{t(`过门 ${data.passed}/${data.target}`, `Gates ${data.passed}/${data.target}`, `Puertas ${data.passed}/${data.target}`)}</span>
          <span data-active={data.boost}><Lightning size={17} weight={data.boost ? "fill" : "regular"} aria-hidden="true" />{data.boost ? t("合拍加速！", "In-sync boost!", "¡Impulso al unísono!") : t(`合拍 ${data.synced}`, `In sync ${data.synced}`, `Al unísono ${data.synced}`)}</span>
        </div>
        <div className="river-stroke-panel">
          <button type="button" className="game-primary river-stroke" data-testid="river-row-stroke" data-paddle={left ? "left" : "right"}
            aria-label={left ? t("划左桨", "Row with the left paddle", "Rema con el remo izquierdo") : t("划右桨", "Row with the right paddle", "Rema con el remo derecho")}
            disabled={phase !== "playing" || !data.strokeReady[seat]} onClick={() => send({type: "stroke"})}>
            <Waves size={21} weight="bold" aria-hidden="true" />{left ? t("划左桨", "Row left", "Remar a la izquierda") : t("划右桨", "Row right", "Remar a la derecha")}
          </button>
          <small><TurnIcon size={15} weight="bold" aria-hidden="true" />{left ? t("单划会向右转", "This paddle turns you right", "Este remo gira la barca a la derecha") : t("单划会向左转", "This paddle turns you left", "Este remo gira la barca a la izquierda")}</small>
        </div>
        <p className="river-hint">{turnHint}</p>
      </section>;
    }}
  </ArcadeStage>;
}
