import type { WearableAdaptationContext } from "$lib/domain";
import {
  summarizeWearableAdaptation,
  type WearableMetricRow,
} from "$lib/fitness/adaptation";
import { addIsoDateDays } from "$lib/program-dates";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/database.types";

export async function loadWearableAdaptationContext(options: {
  client: SupabaseClient<Database>;
  weekEnd: string;
  weekStart: string;
}): Promise<WearableAdaptationContext | undefined> {
  const baselineStart = addIsoDateDays(options.weekStart, -14);
  const [metricsResult, connectionsResult] = await Promise.all([
    options.client
      .from("fitness_daily_metrics")
      .select(
        "connection_id, metric_date, sleep_minutes, resting_heart_rate, hrv_rmssd_ms",
      )
      .gte("metric_date", baselineStart)
      .lte("metric_date", options.weekEnd)
      .order("metric_date"),
    options.client
      .from("fitness_connections")
      .select("id, provider")
      .eq("status", "active"),
  ]);
  if (metricsResult.error || connectionsResult.error) {
    const errorCode =
      metricsResult.error?.code ?? connectionsResult.error?.code;
    if (!["42P01", "PGRST205"].includes(errorCode ?? "")) {
      console.warn("Wearable adaptation context could not be loaded:", {
        code: errorCode,
      });
    }
    return undefined;
  }
  const providers = new Map(
    (connectionsResult.data ?? []).map((connection) => [
      connection.id,
      connection.provider,
    ]),
  );
  const rows: WearableMetricRow[] = (metricsResult.data ?? []).flatMap(
    (metric) => {
      const provider = providers.get(metric.connection_id);
      return provider === undefined
        ? []
        : [
            {
              connectionId: metric.connection_id,
              provider,
              metricDate: metric.metric_date,
              sleepMinutes: metric.sleep_minutes,
              restingHeartRateBpm:
                metric.resting_heart_rate === null
                  ? null
                  : Number(metric.resting_heart_rate),
              heartRateVariabilityMs:
                metric.hrv_rmssd_ms === null
                  ? null
                  : Number(metric.hrv_rmssd_ms),
            },
          ];
    },
  );
  return summarizeWearableAdaptation({
    rows,
    weekStart: options.weekStart,
    weekEnd: options.weekEnd,
  });
}
