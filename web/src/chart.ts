import { h, fmt, fmtDateShort } from "./ui";

const NS = "http://www.w3.org/2000/svg";

function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export type Point = { x: string; y: number }; // x: YYYY-MM-DD

/** Single-series line chart with crosshair tooltip and a direct label on the latest point. */
export function lineChart(points: Point[], opts: { unit?: string; height?: number } = {}): HTMLElement {
  const wrap = h("div", { class: "chart-wrap" });
  if (points.length === 0) {
    wrap.append(h("div", { class: "empty" }, "尚無資料"));
    return wrap;
  }

  const W = 520;
  const H = opts.height ?? 150;
  const pad = { l: 34, r: 44, t: 12, b: 22 };
  const unit = opts.unit ?? "";

  const ys = points.map((p) => p.y);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const span = yMax - yMin;
  yMin -= span * 0.15;
  yMax += span * 0.15;

  const px = (i: number) =>
    points.length === 1
      ? (pad.l + W - pad.r) / 2
      : pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const py = (y: number) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });

  // recessive grid: 3 lines with y labels
  for (let g = 0; g < 3; g++) {
    const yv = yMin + ((g + 0.5) / 3) * (yMax - yMin);
    const gy = py(yv);
    svg.append(s("line", { x1: pad.l, x2: W - pad.r, y1: gy, y2: gy, stroke: "var(--line)", "stroke-width": 1 }));
    const lbl = s("text", { x: pad.l - 6, y: gy + 3.5, "text-anchor": "end", "font-size": 10, fill: "var(--ink-3)", "font-family": "var(--mono)" });
    lbl.textContent = fmt(yv, span > 10 ? 0 : 1);
    svg.append(lbl);
  }

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(p.y).toFixed(1)}`).join("");
  svg.append(s("path", { d, fill: "none", stroke: "var(--data)", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }));

  // latest point: marker + direct label
  const last = points[points.length - 1];
  const lx = px(points.length - 1);
  const ly = py(last.y);
  svg.append(s("circle", { cx: lx, cy: ly, r: 4, fill: "var(--data)", stroke: "var(--card)", "stroke-width": 2 }));
  const lastLbl = s("text", { x: lx + 8, y: ly + 4, "font-size": 11, "font-weight": 600, fill: "var(--ink)", "font-family": "var(--mono)" });
  lastLbl.textContent = fmt(last.y);
  svg.append(lastLbl);

  // x labels: first & last date
  const x0 = s("text", { x: pad.l, y: H - 6, "font-size": 10, fill: "var(--ink-3)" });
  x0.textContent = fmtDateShort(points[0].x);
  svg.append(x0);
  if (points.length > 1) {
    const x1 = s("text", { x: W - pad.r, y: H - 6, "text-anchor": "end", "font-size": 10, fill: "var(--ink-3)" });
    x1.textContent = fmtDateShort(last.x);
    svg.append(x1);
  }

  // hover layer: crosshair + tooltip
  const cross = s("line", { x1: 0, x2: 0, y1: pad.t, y2: H - pad.b, stroke: "var(--ink-3)", "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden" });
  const dot = s("circle", { r: 4.5, fill: "var(--data)", stroke: "var(--card)", "stroke-width": 2, visibility: "hidden" });
  svg.append(cross, dot);
  const tip = h("div", { class: "chart-tip" });
  wrap.append(svg, tip);

  const show = (clientX: number) => {
    const rect = svg.getBoundingClientRect();
    const xView = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    points.forEach((_, i) => {
      const dd = Math.abs(px(i) - xView);
      if (dd < bestD) { bestD = dd; best = i; }
    });
    const bx = px(best);
    const by = py(points[best].y);
    cross.setAttribute("x1", String(bx));
    cross.setAttribute("x2", String(bx));
    cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", String(bx));
    dot.setAttribute("cy", String(by));
    dot.setAttribute("visibility", "visible");
    tip.textContent = `${fmtDateShort(points[best].x)}  ${fmt(points[best].y)}${unit}`;
    tip.style.display = "block";
    tip.style.left = `${(bx / W) * rect.width}px`;
    tip.style.top = `${(by / H) * rect.height}px`;
  };
  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    tip.style.display = "none";
  };
  svg.addEventListener("pointermove", (e) => show(e.clientX));
  svg.addEventListener("pointerdown", (e) => show(e.clientX));
  svg.addEventListener("pointerleave", hide);

  return wrap;
}
