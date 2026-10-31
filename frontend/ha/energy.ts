// The energy overlay's numbers: which sensors to read (from the house model, else Home
// Assistant's energy settings) and the power flowing into the house's hub.

import { formatNumber, type NumberLocale } from "../i18n/localize";
import type { Energy } from "../model/types";
import type { Hass } from "./hass";

/** The parts of HA's energy settings (`energy/get_prefs`) used here. */
export interface EnergyPrefs {
  energy_sources: { type: string; stat_rate?: string; power_config?: { stat_rate?: string } }[];
  device_consumption: { name?: string; stat_rate?: string; stat_consumption: string }[];
}

export interface EnergyReading {
  /** Watts flowing into the hub: solar, a discharging battery and grid import are positive, devices negative. */
  flow: number | null;
  /** Power shown on the label, W (as the sensor reports it, converted from kW). */
  power: number | null;
  /** Battery charge in %. */
  soc: number | null;
}

/** A sensor's value in watts, or null. */
export function watts(hass: Hass, entity: string | undefined): number | null {
  const s = entity ? hass.states[entity] : undefined;
  const v = s ? parseFloat(s.state) : NaN;
  if (!s || isNaN(v)) return null;
  const unit = String(s.attributes.unit_of_measurement ?? "W");
  return unit === "kW" ? v * 1000 : unit === "MW" ? v * 1e6 : v;
}

/** The power sensors HA's energy settings name for a kind (solar may have several). */
export function prefsSensors(prefs: EnergyPrefs | null, kind: Energy["kind"]): string[] {
  if (!prefs) return [];
  const type = kind === "solar" ? "solar" : kind === "battery" ? "battery" : kind === "grid" ? "grid" : null;
  if (!type) return [];
  return prefs.energy_sources.filter((s) => s.type === type).flatMap((s) => [s.power_config?.stat_rate ?? s.stat_rate].filter((x): x is string => !!x));
}

/** The battery's charge sensor: a % battery sensor on the same device as its power sensor. */
export function batterySoc(hass: Hass, power: string | undefined): string | undefined {
  const device = power ? hass.entities?.[power]?.device_id : undefined;
  if (!device) return undefined;
  const candidates = Object.values(hass.entities ?? {})
    .filter((e) => e.device_id === device && hass.states[e.entity_id]?.attributes.device_class === "battery")
    .map((e) => e.entity_id);
  // prefer the charge itself over cut-off limits and health
  return candidates.find((id) => /(^|_)soc$/.test(id) && !/cut_off/.test(id)) ?? candidates.find((id) => !/cut_off|soh/.test(id));
}

/** What an energy item reads now. */
export function readEnergy(hass: Hass, e: Energy, prefs: EnergyPrefs | null): EnergyReading {
  const sensors = e.power ? [e.power] : prefsSensors(prefs, e.kind);
  const values = sensors.map((s) => watts(hass, s)).filter((v): v is number => v !== null);
  const power = values.length ? values.reduce((a, b) => a + b, 0) : null;
  const socEntity = e.kind === "battery" ? (e.soc ?? batterySoc(hass, sensors[0])) : undefined;
  const socValue = socEntity ? parseFloat(hass.states[socEntity]?.state ?? "") : NaN;
  const flow = power === null ? null : e.kind === "device" ? -Math.abs(power) : e.kind === "solar" ? Math.max(0, power) : e.kind === "inverter" ? null : power;
  return { flow, power, soc: isNaN(socValue) ? null : socValue };
}

/** "1.2 kW" / "350 W". */
export function formatPower(w: number | null, locale?: NumberLocale): string {
  if (w === null) return "–";
  const a = Math.abs(w);
  return a >= 1000 ? `${formatNumber(locale, w / 1000, a >= 10000 ? 0 : 1)} kW` : `${Math.round(w)} W`;
}
