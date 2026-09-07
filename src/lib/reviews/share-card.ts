import type { ReviewChart, WeeklyReviewMetrics } from "./types.js";

export interface WeeklyReviewShareModel {
  programName: string;
  weekNumber: number;
  headline: string;
  takeaway: string;
  metrics: WeeklyReviewMetrics;
  charts: ReviewChart[];
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function lines(value: string, limit: number, maximum = 3): string[] {
  const words = value.trim().split(/\s+/);
  const result: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current === "" ? word : `${current} ${word}`;
    if (next.length <= limit) {
      current = next;
      continue;
    }
    if (current !== "") result.push(current);
    current = word;
    if (result.length === maximum - 1) break;
  }
  if (result.length < maximum && current !== "") result.push(current);
  const consumed = result.join(" ").split(/\s+/).length;
  if (consumed < words.length && result.length > 0) {
    result[result.length - 1] =
      `${result[result.length - 1]?.replace(/[.,;:]?$/, "")}…`;
  }
  return result.map(escapeXml);
}

function textLines(
  values: string[],
  x: number,
  y: number,
  lineHeight: number,
  className: string,
): string {
  return `<text x="${x}" y="${y}" class="${className}">${values
    .map(
      (value, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${value}</tspan>`,
    )
    .join("")}</text>`;
}

function number(value: number): string {
  return Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function chartMarkup(chart: ReviewChart, x: number, y: number): string {
  const visibleWeekCount = Math.min(6, Math.max(1, chart.weeks.length));
  const firstVisibleIndex = Math.max(0, chart.weeks.length - visibleWeekCount);
  const weeks = chart.weeks.slice(firstVisibleIndex);
  const visibleValues = chart.series.flatMap((series) =>
    series.values.slice(firstVisibleIndex),
  );
  const maximum = Math.max(1, ...visibleValues);
  const plotX = x + 8;
  const plotWidth = 864;
  const baselineY = y + 218;
  const groupWidth = plotWidth / visibleWeekCount;
  const seriesCount = Math.max(1, chart.series.length);
  const barGap = 4;
  const barWidth = Math.max(
    5,
    Math.min(46, (groupWidth - 20 - barGap * (seriesCount - 1)) / seriesCount),
  );
  const bars = weeks
    .map((week, weekIndex) => {
      const groupBars = chart.series
        .map((series, seriesIndex) => {
          const value = series.values[firstVisibleIndex + weekIndex] ?? 0;
          const height = value <= 0 ? 0 : Math.max(3, (value / maximum) * 126);
          const groupBarsWidth =
            barWidth * seriesCount + barGap * (seriesCount - 1);
          const barX =
            plotX +
            groupWidth * weekIndex +
            (groupWidth - groupBarsWidth) / 2 +
            seriesIndex * (barWidth + barGap);
          return `<rect x="${barX}" y="${baselineY - height}" width="${barWidth}" height="${height}" rx="4" fill="${series.color}"/>`;
        })
        .join("");
      return `<g>${groupBars}<text x="${plotX + groupWidth * weekIndex + groupWidth / 2}" y="${baselineY + 27}" text-anchor="middle" class="bar-label">W${week}</text></g>`;
    })
    .join("");
  const legend = chart.series
    .slice(0, 4)
    .map((series, index) => {
      const latest = series.values.at(-1) ?? 0;
      const legendX = x + index * 218;
      return `<g><circle cx="${legendX + 7}" cy="${y + 50}" r="6" fill="${series.color}"/><text x="${legendX + 20}" y="${y + 57}" class="chart-legend">${escapeXml(series.label)} ${number(latest)}</text></g>`;
    })
    .join("");
  return `<g><text x="${x}" y="${y}" class="chart-title">${escapeXml(chart.title)}</text><text x="${x + 880}" y="${y}" text-anchor="end" class="chart-unit">${escapeXml(chart.unit)}</text>${legend}<line x1="${plotX}" y1="${baselineY}" x2="${plotX + plotWidth}" y2="${baselineY}" class="axis"/>${bars}</g>`;
}

/** A self-contained 4:5 card that can be rasterized without DOM screenshots. */
export function buildWeeklyReviewShareSvg(
  model: WeeklyReviewShareModel,
): string {
  const headline = lines(model.headline, 34, 2);
  const takeaway = lines(model.takeaway, 60, 3);
  const programName = lines(model.programName, 48, 1)[0] ?? "Training plan";
  const metrics = model.metrics;
  const completion =
    metrics.requiredPlannedSets === 0
      ? "—"
      : `${Math.round((metrics.requiredCompletedSets / metrics.requiredPlannedSets) * 100)}%`;
  const charts = model.charts.slice(0, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <radialGradient id="nebula" cx="20%" cy="5%" r="105%"><stop offset="0" stop-color="#3d246f"/><stop offset=".38" stop-color="#102c52"/><stop offset="1" stop-color="#030812"/></radialGradient>
    <linearGradient id="panel" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#173d62"/><stop offset="1" stop-color="#081525"/></linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="1080" height="1350" fill="url(#nebula)"/>
  <g fill="#fff" opacity=".75">${Array.from({ length: 54 }, (_, index) => `<circle cx="${((index * 193) % 1040) + 20}" cy="${((index * 307) % 1310) + 20}" r="${index % 7 === 0 ? 2.5 : 1.2}"/>`).join("")}</g>
  <rect x="50" y="48" width="980" height="1254" rx="34" fill="url(#panel)" stroke="#7bc8e9" stroke-width="3"/>
  <text x="92" y="112" class="kicker">ORBITAL TRAINING · WEEK ${model.weekNumber}</text>
  <text x="92" y="158" class="program">${programName}</text>
  ${textLines(headline, 92, 238, 62, "headline")}
  ${textLines(takeaway, 92, headline.length > 1 ? 382 : 322, 38, "takeaway")}
  <g transform="translate(92 ${headline.length > 1 ? 500 : 450})">
    <rect width="896" height="142" rx="20" fill="#06101e" stroke="#456c8b"/>
    <text x="34" y="48" class="metric-label">MAIN WORK</text><text x="34" y="105" class="metric-value">${metrics.requiredCompletedSets}/${metrics.requiredPlannedSets} sets</text>
    <text x="330" y="48" class="metric-label">COMPLETION</text><text x="330" y="105" class="metric-value">${completion}</text>
    <text x="610" y="48" class="metric-label">CARDIO</text><text x="610" y="105" class="metric-value">${metrics.completedCardioMinutes} min</text>
  </g>
  ${charts.map((chart, index) => chartMarkup(chart, 92, (headline.length > 1 ? 690 : 640) + index * 285)).join("")}
  <text x="92" y="1260" class="footer">BUILT FROM COMPLETED, LOGGED WORK</text>
  <style>
    text{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#eef8ff}.kicker,.footer{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;font-weight:800;letter-spacing:3px;fill:#78dcf5}.program{font-size:28px;font-weight:700;fill:#c8d9e8}.headline{font-size:52px;font-weight:900}.takeaway{font-size:28px;fill:#cbdbea}.metric-label,.chart-unit{font-size:19px;font-weight:800;letter-spacing:2px;fill:#8fc6df}.metric-value{font-size:34px;font-weight:850}.chart-title{font-size:27px;font-weight:850}.chart-unit{font-size:17px}.chart-legend{font-size:15px;fill:#d7e4ee}.axis{stroke:#53728b;stroke-width:2}.bar-label{font-size:17px;fill:#d7e4ee}.footer{font-size:18px}
  </style>
</svg>`;
}

export async function weeklyReviewShareFile(
  model: WeeklyReviewShareModel,
): Promise<File> {
  const svg = buildWeeklyReviewShareSvg(model);
  const svgUrl = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = svgUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Image rendering is unavailable.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value === null
            ? reject(new Error("Image export failed."))
            : resolve(value),
        "image/png",
        0.94,
      ),
    );
    return new File([blob], `orbital-training-week-${model.weekNumber}.png`, {
      type: "image/png",
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
