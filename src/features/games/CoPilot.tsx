import { ArrowLeft, ArrowRight, ArrowUp, Bridge, Drop, FlagCheckered, Heart, Lighthouse, MapTrifold, SteeringWheel, Storefront, Windmill } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { localized, type Language } from "../../i18n";
import { ArcadeStage, type ArcadeMatchState } from "./ArcadeStage";
import type { ScreenProps } from "./MatchScreen";
import "./live-coop-routes.css";

type Direction = "left" | "straight" | "right";
type Course = "harbor" | "mountain" | "desert";
type Landmark = "lighthouse" | "market" | "fountain" | "windmill" | "bridge";
type DrivingView = {
  role: "driver" | "navigator";
  course: Course;
  junction: number;
  total: number;
  landmark: Landmark | null;
  progress: number;
  recovery: boolean;
  attemptsLeft: number;
  choice: Direction | null;
  signal: Direction | null;
  last: {correct: boolean; choice: Direction} | null;
  map: {landmark: Landmark; direction: Direction}[] | null;
};
type DrivingResult = {
  winner: null;
  outcome: "arrived" | "lost" | "time";
  course: Course;
  reached: number;
  total: number;
  wrongTurns: number;
};

const routeNames = {
  harbor: ["海港公路", "Harbor Road", "Carretera del puerto"],
  mountain: ["山谷兜风", "Valley Drive", "Paseo por el valle"],
  desert: ["落日公路", "Sunset Highway", "Ruta del atardecer"],
} as const;

const landmarks = {
  lighthouse: { icon: Lighthouse, name: ["灯塔", "Lighthouse", "Faro"] },
  market: { icon: Storefront, name: ["市场", "Market", "Mercado"] },
  fountain: { icon: Drop, name: ["喷泉", "Fountain", "Fuente"] },
  windmill: { icon: Windmill, name: ["风车", "Windmill", "Molino"] },
  bridge: { icon: Bridge, name: ["小桥", "Bridge", "Puente"] },
} as const;

const directions = {
  left: { icon: ArrowLeft, name: ["左转", "Turn left", "Gira a la izquierda"], short: ["左", "Left", "Izquierda"] },
  straight: { icon: ArrowUp, name: ["直行", "Go straight", "Sigue recto"], short: ["直行", "Straight", "Recto"] },
  right: { icon: ArrowRight, name: ["右转", "Turn right", "Gira a la derecha"], short: ["右", "Right", "Derecha"] },
} as const;
const orderedDirections = ["left", "straight", "right"] as const;
const label = (language: Language, copy: readonly [string, string, string]) => localized(language, ...copy);

function DriverRoad({ data, language }: { data: DrivingView; language: Language }) {
  const finish = localized(language, "终点", "Finish", "Meta");
  const landmark = data.landmark ? landmarks[data.landmark] : null;
  const LandmarkIcon = landmark?.icon ?? FlagCheckered;
  const spread = Math.pow(data.progress, 1.75);
  const shift = data.choice === "left" ? -1 : data.choice === "right" ? 1 : 0;
  return <div className="pilot-road-scene" data-course={data.course} data-recovery={data.recovery}
    style={{"--pilot-junction-y": `${43 + spread * 28}%`, "--pilot-stripe-y": `${data.progress * 64}px`, "--pilot-shift": shift} as CSSProperties}
    aria-label={landmark ? label(language, landmark.name) : finish} role="img">
    <div className="pilot-sun" aria-hidden="true" />
    <div className="pilot-mountains" aria-hidden="true" />
    <div className="pilot-ground" aria-hidden="true" />
    <div className="pilot-branch" aria-hidden="true" />
    <div className="pilot-road" aria-hidden="true"><i /></div>
    <span className="pilot-location" aria-hidden="true"><LandmarkIcon size={17} weight="bold" /> {landmark ? label(language, landmark.name) : finish}</span>
    <div className="pilot-car" aria-hidden="true"><i /><b /></div>
  </div>;
}

function NavigatorMap({ data, language }: { data: DrivingView; language: Language }) {
  return <ol className="pilot-map" aria-label={localized(language, "路线图", "Route map", "Mapa de ruta")}>
    {data.map?.map(({ landmark, direction }, index) => {
      const TurnIcon = directions[direction].icon;
      const LandmarkIcon = landmarks[landmark].icon;
      const status = index === data.junction ? "current" : index < data.junction ? "passed" : "ahead";
      return <li key={landmark} data-status={status} aria-current={status === "current" ? "step" : undefined}>
        <span className="pilot-map-index" aria-hidden="true">{index + 1}</span>
        <span className="pilot-map-place"><LandmarkIcon size={17} weight="duotone" aria-hidden="true" />{label(language, landmarks[landmark].name)}</span>
        <span className="pilot-map-direction" aria-label={label(language, directions[direction].name)}><TurnIcon size={23} weight="bold" aria-hidden="true" /><small>{label(language, directions[direction].short)}</small></span>
      </li>;
    })}
  </ol>;
}

export function CoPilot(props: ScreenProps<ArcadeMatchState<DrivingResult>>) {
  const { language } = props;
  const t = (...copy: readonly [string, string, string]) => localized(language, ...copy);
  return <ArcadeStage<DrivingView, DrivingResult> {...props}
    instructions={t("一个人开车，一个人看路线。点箭头发指令，驶过五个路口。", "One drives and one reads the map. Signal the turns and make it through five junctions.", "Una persona conduce y la otra mira el mapa. Señalen los giros y pasen cinco cruces.")}
    summary={(result) => {
      const name = label(language, routeNames[result.course]);
      return <div className="coop-route-result" data-testid="co-pilot-result">
        <FlagCheckered size={28} weight="duotone" aria-hidden="true" />
        <strong>{result.outcome === "arrived" ? t("你们到了！", "You made it!", "¡Llegaron!") : result.outcome === "time" ? t("时间到了", "Time's up", "Se acabó el tiempo") : t("这次开错了路", "You took a wrong turn", "Tomaron un giro equivocado")}</strong>
        <span>{t(`${name} · 通过 ${result.reached}/${result.total} 个路口`, `${name} · ${result.reached}/${result.total} junctions cleared`, `${name} · ${result.reached}/${result.total} cruces superados`)}</span>
      </div>;
    }}>
    {({ data, phase, send }) => {
      const driver = data.role === "driver";
      const selected = driver ? data.choice : data.signal;
      const active = phase === "playing";
      const SignalIcon = data.signal ? directions[data.signal].icon : null;
      return <section className="coop-route pilot-game" data-testid="co-pilot" data-role={data.role} data-junction={data.junction}>
        <div className="coop-route-header">
          <div><small>{driver ? <SteeringWheel size={15} aria-hidden="true" /> : <MapTrifold size={15} aria-hidden="true" />}{driver ? t("你来开", "You drive", "Tú conduces") : t("你指路", "You navigate", "Tú guías")}</small>
            <strong>{label(language, routeNames[data.course])}</strong></div>
          <span className="coop-route-step" aria-label={t(`剩余 ${data.attemptsLeft} 次机会`, `${data.attemptsLeft} chances remaining`, `Quedan ${data.attemptsLeft} intentos`)}><Heart size={16} weight="fill" aria-hidden="true" />{data.attemptsLeft}</span>
        </div>
        {driver ? <DriverRoad data={data} language={language} /> : <NavigatorMap data={data} language={language} />}
        <div className="pilot-approach">
          <span>{t(`第 ${Math.min(data.junction + 1, data.total)}/${data.total} 个路口`, `Junction ${Math.min(data.junction + 1, data.total)} of ${data.total}`, `Cruce ${Math.min(data.junction + 1, data.total)} de ${data.total}`)}</span>
          <progress aria-label={t("距离当前路口", "Approaching the junction", "Acercándose al cruce")} value={data.progress} max={1} />
        </div>
        <div className="pilot-callout" data-recovery={data.recovery} data-ready={Boolean(data.signal)} role="status" data-testid="co-pilot-status">
          {data.recovery ? t("转错了，正在返回刚才的路口。", "Wrong turn. Heading back to the junction.", "Giro equivocado. Volviendo al cruce.") : data.signal && SignalIcon ? <><SignalIcon size={19} weight="bold" aria-hidden="true" />{driver ? t("收到", "Signal received", "Señal recibida") : t("已发出", "Signal sent", "Señal enviada")} · {label(language, directions[data.signal].name)}</> : driver
            ? t("到路口前选方向。没选就直行。", "Choose a direction before the junction. The car goes straight by default.", "Elige la dirección antes del cruce. Si no eliges, el coche seguirá recto.")
            : t("看高亮的路口，点箭头告诉 TA。", "Use the highlighted junction to send a direction.", "Mira el cruce resaltado y envía una dirección.")}
        </div>
        <div className="pilot-controls" role="group" aria-label={driver ? t("方向盘", "Steering", "Dirección del coche") : t("发送方向", "Send direction", "Enviar dirección")}>
          {orderedDirections.map((direction) => {
            const entry = directions[direction];
            const Icon = entry.icon;
            const type = driver ? "steer" : "signal";
            return <button key={direction} type="button" className="pilot-direction-button" aria-pressed={selected === direction} disabled={!active}
              data-testid={`co-pilot-${type}-${direction}`} onClick={() => send({type, direction, junction: data.junction})}>
              <Icon size={22} weight="bold" aria-hidden="true" /><span>{label(language, entry.short)}</span>
            </button>;
          })}
        </div>
      </section>;
    }}
  </ArcadeStage>;
}
