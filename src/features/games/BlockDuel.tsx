import { ArrowDown, ArrowLeft, ArrowRight, ArrowClockwise, Lightning } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { localized, type Language } from "../../i18n";
import { ArcadeStage, type ArcadeMatchState } from "./ArcadeStage";
import type { ScreenProps } from "./MatchScreen";
import "./block-duel.css";

type DuelView = { own: string; other: string; piece: number; lines: [number, number]; incoming: number;
  next: { kind: number; cells: [number, number][] } };
type DuelResult = { winner: 0 | 1 | null; reason: "top-out" | "time"; lines: [number, number]; heights: [number, number] };

const colors = ["#202440", "#79d6e2", "#f8d776", "#bb9cf4", "#9cde8d", "#f6a0a9", "#f5ad72", "#8cacf4", "#8a899e"];
const keys = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "rotate", ArrowDown: "down", " ": "drop" } as const;

function Blocks({ cells, label, compact = false }: { cells: string; label: string; compact?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const unit = compact ? 8 : 22;
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.fillStyle = "#151a31";
    context.fillRect(0, 0, unit * 10, unit * 20);

    Array.from(cells).forEach((entry, index) => {
      const x = (index % 10) * unit;
      const y = Math.floor(index / 10) * unit;
      const kind = Number(entry);
      if (kind === 9) {
        context.strokeStyle = "#8d96b8";
        context.strokeRect(x + 2, y + 2, unit - 4, unit - 4);
        return;
      }
      context.fillStyle = colors[kind] ?? colors[0];
      context.fillRect(x + 1, y + 1, unit - 2, unit - 2);
      if (kind && !compact) {
        context.fillStyle = "#ffffff4f";
        context.fillRect(x + 2, y + 2, unit - 4, 2);
      }
    });
  }, [cells, compact, unit]);
  return <canvas ref={canvas} role="img" aria-label={label} width={unit * 10} height={unit * 20} />;
}

function DuelBoard({ data, phase, send, language, partnerName }: { data: DuelView; phase: string;
  send: (action: Record<string, unknown>) => void; language: Language; partnerName: string }) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const play = phase === "playing";
  const lineCount = (count: number) => t(`${count} 行`, `${count} ${count === 1 ? "line" : "lines"}`, `${count} ${count === 1 ? "fila" : "filas"}`);
  const controls = [
    { type: "left", title: t("左移", "Left", "Izq."), label: t("向左移动", "Move left", "Mover a la izquierda"), icon: ArrowLeft },
    { type: "right", title: t("右移", "Right", "Der."), label: t("向右移动", "Move right", "Mover a la derecha"), icon: ArrowRight },
    { type: "rotate", title: t("旋转", "Rotate", "Girar"), label: t("旋转方块", "Rotate block", "Girar pieza"), icon: ArrowClockwise },
    { type: "down", title: t("下降", "Down", "Bajar"), label: t("向下移动一格", "Move down one row", "Bajar una fila"), icon: ArrowDown },
    { type: "drop", title: t("速落", "Drop", "Soltar"), label: t("直接落到底", "Drop to the bottom", "Soltar al fondo"), icon: Lightning },
  ];

  function move(type: string) {
    if (play) send({ type, piece: data.piece });
  }

  return <div className="block-duel" data-testid="block-duel" data-piece={data.piece} data-incoming={data.incoming}
    role="group" tabIndex={0} aria-label={t("方块对战棋盘和操作", "Block Duel boards and controls", "Tableros y controles del Duelo de bloques")}
    onKeyDown={(event) => {
      if (event.currentTarget !== event.target || !play) return;
      const moveType = keys[event.key as keyof typeof keys];
      if (!moveType) return;
      event.preventDefault();
      if (!(moveType === "drop" && event.repeat)) move(moveType);
    }}>
    <div className="block-panels">
      <section className="block-own">
        <div className="block-board-label"><span>{t("你", "You", "Tú")}</span><strong>{lineCount(data.lines[0])}</strong></div>
        <Blocks cells={data.own} label={t("你的棋盘", "Your board", "Tu tablero")} />
      </section>
      <aside className="block-side">
        <div className="block-board-label"><span>{partnerName}</span><strong>{lineCount(data.lines[1])}</strong></div>
        <Blocks cells={data.other} compact label={t("对方的棋盘", "Partner's board", "Tablero de tu pareja")} />
        <div className="block-next">
          <span>{t("下一块", "Next", "Siguiente")}</span>
          <div className="block-next-cells" aria-hidden="true">
            {data.next.cells.map(([x, y]) => <i key={`${x}-${y}`} style={{ gridArea: `${y + 1}/${x + 1}`, background: colors[data.next.kind] }} />)}
          </div>
        </div>
        {data.incoming > 0 && <p className="block-attack" role="status">
          {t(`即将落下 ${data.incoming} 行障碍`, `${data.incoming} incoming ${data.incoming === 1 ? "row" : "rows"}`,
            `${data.incoming} ${data.incoming === 1 ? "fila" : "filas"} en camino`)}
        </p>}
      </aside>
    </div>
    <div className="block-controls">
      {controls.map(({ type, title, label, icon: Icon }) => <button key={type} type="button" data-testid={`block-${type}`}
        aria-label={label} title={label} onClick={() => move(type)} disabled={!play}>
        <Icon size={22} weight={type === "drop" ? "fill" : "bold"} aria-hidden="true" />
        <span>{title}</span>
      </button>)}
    </div>
  </div>;
}

export function BlockDuel(props: ScreenProps<ArcadeMatchState<DuelResult>>) {
  const { language, partnerName } = props;
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  return <ArcadeStage<DuelView, DuelResult> {...props}
    instructions={t("一次消两行以上就能给对方加障碍。堆到顶就输，时间到先比消行，再比谁堆得低。",
      "Clear two or more rows to send obstacles. The first to top out loses. At time, more lines win, then the lower stack.",
      "Borra dos filas o más para enviar obstáculos. Si llegas arriba, pierdes. Al acabarse el tiempo, ganan más filas y luego la pila más baja.")}
    summary={(result, seat) => <div className="block-result" data-testid="block-result">
      <strong>{result.winner === null ? t("平局", "It's a draw", "Empate") : result.winner === seat ? t("你赢了！", "You win!", "¡Ganaste!")
        : t(`${partnerName} 赢了！`, `${partnerName} wins!`, `¡Ganó ${partnerName}!`)}</strong>
      <p>{t(`消除行数：你 ${result.lines[seat]} · ${partnerName} ${result.lines[1 - seat]}`,
        `Lines cleared: you ${result.lines[seat]} · ${partnerName} ${result.lines[1 - seat]}`,
        `Filas borradas: tú ${result.lines[seat]} · ${partnerName} ${result.lines[1 - seat]}`)}</p>
    </div>}>
    {({ data, phase, send }) => <DuelBoard data={data} phase={phase} send={send} language={language} partnerName={partnerName} />}
  </ArcadeStage>;
}
