import React, { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

/**
 * Home Insulation & Energy Performance Simulator — v1.3
 *
 * Fixes:
 * - ReferenceError: Qh_ceil was referenced before definition in calcReferenceWholeHouseKWh.
 *   Added explicit Qh_ceil/Qc_ceil terms using U_ceil and ceilingArea before totals.
 * - Fixed double-counting of sheathing R-value in calcWholeWallR function.
 *   Sheathing is now treated as a distinct layer rather than bundled with common layers.
 * - Updated ScenarioCard to display whole-house energy costs (walls + windows + ceilings + infiltration)
 *   instead of just walls + infiltration, aligning cost figures with HERS index calculations.
 *
 * Adds:
 * - Built‑in unit tests (sanity checks) for core math paths and HERS estimator.
 * - Diagnostics panel to view test results.
 *
 * Key formulas (double‑checked):
 * - Whole‑wall effective R:  U_eff = f/R_stud + (1‑f)/R_cavity  → R_eff = 1/U_eff
 * - Conduction load: Q = U · A · DD · 24   [BTU/yr]
 *   (U in BTU/hr·ft²·°F; DD in °F·days; ×24 hr/day)
 * - Infiltration sensible load: Q = 0.432 · ACH_nat · Volume · DD   [BTU/yr]
 *   Derivation: CFM = ACH·Vol/60; 1.08 BTU/hr·CFM·°F; integrate over DD·24h ⇒ 1.08·(ACH·Vol/60)·DD·24 = 0.432·ACH·Vol·DD
 * - Heating kWh (heat pump): (Q/3412)/COP
 * - Cooling kWh: Q/(SEER·1000)
 * - HERS (estimated): Index = 100 × (Rated site energy / Reference site energy)
 *
 * This tool is transparent and comparative; not for stamped compliance.
 */

const CLIMATE_DEFAULTS = {
  locationName: "Fuquay-Varina, NC (CZ4)",
  HDD65: 3450,
  CDD65: 1730,
};

const FRAMING_OPTIONS = [
  { key: "2x4", label: '2x4 (3.5" depth)', depth: 3.5 },
  { key: "2x6", label: '2x6 (5.5" depth)', depth: 5.5 },
];

const CAVITY_INSULATION_TYPES = [
  { key: "fiberglass", label: "Fiberglass Batts" },
  { key: "mineralwool", label: "Mineral Wool Batts" },
  { key: "flashbatt", label: 'Flash & Batt (1" CC + FG)' },
  { key: "ocspf", label: "Open-Cell Spray Foam (full)" },
  { key: "ccspf", label: "Closed-Cell Spray Foam (full)" },
];

const EXTERIOR_SHEATHING = [
  { key: "osbwrap", label: "OSB + Housewrap", rContinuous: 0 },
  { key: "zip", label: "Taped OSB (ZIP System)", rContinuous: 0 },
  {
    key: "zipr3",
    label: "Exterior Insulated Sheathing (ZIP-R, R-3)",
    rContinuous: 3,
  },
  {
    key: "zipr6",
    label: "Exterior Insulated Sheathing (ZIP-R, R-6)",
    rContinuous: 6,
  },
];

const AIR_TIGHTNESS_PRESETS = [
  { key: "leaky", label: "Leaky (~7 ACH50)", ach50: 7 },
  { key: "builder", label: "Builder Standard (~5 ACH50)", ach50: 5 },
  { key: "energystar", label: "Energy Star (~3 ACH50)", ach50: 3 },
  { key: "passive", label: "Passive House (~0.6 ACH50)", ach50: 0.6 },
];

// Per-inch nominal R-values
const R_PER_INCH = {
  wood: 1.25,
  fiberglass: 3.7,
  mineralwool: 4.2,
  ocspf: 3.6,
  ccspf: 6.5,
  polyiso: 6.0,
};

const LAYER_R = {
  airFilms: 0.85,
  drywallHalf: 0.45,
  osb716: 0.62,
  siding: 0.6,
  interiorPolyisoHalf: 3.0, // continuous thermal break
};

const DEFAULT_HOME = {
  wallAreaFt2: 3000, // net opaque wall area
  conditionedFloorArea: 3500,
  avgCeilingHeight: 9,
  stories: 2,
  windowToWallRatio: 0.15, // fraction of GROSS wall area
};

const DEFAULT_ECON = {
  elecPricePerKWh: 0.14,
  gasPricePerTherm: 1.25,
};

const DEFAULT_HVAC = {
  heatingType: "heatpump",
  heatPumpCOP: 3.0,
  coolingSEER: 15,
};

const HERS_DEFAULTS = {
  ach50ToNatFactor: 0.07, // editable conversion factor
  rated: { windowU: 0.3, ceilingR: 38 },
  reference: {
    // 2006-ish reference style (editable):
    framingKey: "2x4",
    cavityKey: "fiberglass",
    sheathingKey: "osbwrap",
    interiorPolyiso: false,
    ach50: 7,
    windowU: 0.4,
    ceilingR: 38,
  },
  otherSiteEnergyKWh: 6000, // DHW, lights, appliances; same for rated & ref by default
};

function formatUSD(n) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function calcCavityR(depth, insulationKey) {
  const d = depth; // inches
  switch (insulationKey) {
    case "fiberglass":
      return d * R_PER_INCH.fiberglass;
    case "mineralwool":
      return d * R_PER_INCH.mineralwool;
    case "ocspf":
      return d * R_PER_INCH.ocspf;
    case "ccspf":
      return d * R_PER_INCH.ccspf;
    case "flashbatt": {
      const foam = 1 * R_PER_INCH.ccspf;
      const remaining = Math.max(0, d - 1) * R_PER_INCH.fiberglass;
      return foam + remaining;
    }
    default:
      return d * R_PER_INCH.fiberglass;
  }
}

function calcWholeWallR({
  framingDepthIn,
  cavityInsulationKey,
  exteriorSheathingKey,
  interiorPolyiso,
  framingFactor = 0.23,
}) {
  const depth = framingDepthIn; // inches
  const rCavity = calcCavityR(depth, cavityInsulationKey);
  const rWoodStud = depth * R_PER_INCH.wood;
  const ext = EXTERIOR_SHEATHING.find((x) => x.key === exteriorSheathingKey);

  // Determine the R-value of the sheathing layer itself.
  // Standard OSB is R-0.62, while insulated sheathing has its own value.
  const rSheathing = ext?.rContinuous > 0 ? ext.rContinuous : LAYER_R.osb716;

  const rInteriorThermalBreak = interiorPolyiso
    ? LAYER_R.interiorPolyisoHalf
    : 0;

  // Common layers NOT including sheathing
  const rCommon = LAYER_R.airFilms + LAYER_R.drywallHalf + LAYER_R.siding;

  // Add the distinct sheathing R-value to both paths
  const rStudPath = rCommon + rInteriorThermalBreak + rSheathing + rWoodStud;
  const rCavityPath = rCommon + rInteriorThermalBreak + rSheathing + rCavity;

  // Area-weighted effective R
  const uEff = framingFactor / rStudPath + (1 - framingFactor) / rCavityPath;
  const rEff = 1 / uEff;
  return { rEff, rStudPath, rCavityPath };
}

function ach50ToAchnat(ach50, factor) {
  return ach50 * factor; // user-editable factor (default 0.07)
}

function calcLoadsAndCosts({
  wallAreaFt2,
  volumeFt3,
  HDD65,
  CDD65,
  rEff,
  ach50,
  ach50ToNatFactor,
  econ,
  hvac,
}) {
  const U = 1 / rEff; // BTU/hr·ft²·°F

  // Conduction through walls only
  const Qh_cond_BTU = U * wallAreaFt2 * HDD65 * 24;
  const Qc_cond_BTU = U * wallAreaFt2 * CDD65 * 24;

  // Infiltration (whole-house, influenced by ACH)
  const ACHnat = ach50ToAchnat(ach50, ach50ToNatFactor);
  const Qh_inf_BTU = 0.432 * ACHnat * volumeFt3 * HDD65;
  const Qc_inf_BTU = 0.432 * ACHnat * volumeFt3 * CDD65;

  const Qh_total_BTU = Qh_cond_BTU + Qh_inf_BTU;
  const Qc_total_BTU = Qc_cond_BTU + Qc_inf_BTU;

  // Energy use/costs (heat pump for heating in v1)
  const kWhHeat = Qh_total_BTU / 3412 / Math.max(0.5, hvac.heatPumpCOP);
  const kWhCool = Qc_total_BTU / (Math.max(8, hvac.coolingSEER) * 1000);

  const costHeat = kWhHeat * econ.elecPricePerKWh;
  const costCool = kWhCool * econ.elecPricePerKWh;

  return {
    Qh_cond_BTU,
    Qc_cond_BTU,
    Qh_inf_BTU,
    Qc_inf_BTU,
    Qh_total_BTU,
    Qc_total_BTU,
    kWhHeat,
    kWhCool,
    costHeat,
    costCool,
    annualCost: costHeat + costCool,
    ACHnat,
  };
}

function estimateSTC({ framingKey, cavityInsulationKey }) {
  // Heuristic for relative comparison (bounded 28–55)
  let stc = 33; // base 2x4 empty
  if (framingKey === "2x6") stc += 2;
  switch (cavityInsulationKey) {
    case "fiberglass":
      stc += 3;
      break;
    case "mineralwool":
      stc += 5;
      break;
    case "ocspf":
      stc += 2;
      break;
    case "ccspf":
      stc += 1;
      break;
    case "flashbatt":
      stc += 4;
      break;
    default:
      break;
  }
  return Math.max(28, Math.min(55, Math.round(stc)));
}

// --- Whole-house HERS model (simplified & transparent) ---
function wallGrossAreaFromNet(netOpaqueFt2, wwr) {
  const gross = netOpaqueFt2 / Math.max(0.01, 1 - wwr);
  return { gross, windowArea: gross * wwr };
}

function calcWholeHouseKWh({
  scenarioWholeWallR,
  ach50,
  ach50ToNatFactor,
  shared,
  hers,
}) {
  const {
    wallAreaFt2,
    conditionedFloorArea,
    avgCeilingHeight,
    stories,
    windowToWallRatio,
  } = shared;
  const volumeFt3 = conditionedFloorArea * avgCeilingHeight; // total house volume approx
  const { windowArea } = wallGrossAreaFromNet(wallAreaFt2, windowToWallRatio);
  const ceilingArea = conditionedFloorArea / Math.max(1, stories);

  // U-values
  const U_wall = 1 / scenarioWholeWallR; // walls include films; ok
  const U_win = hers.rated.windowU; // NFRC U includes films; use directly
  const U_ceiling = 1 / (hers.rated.ceilingR + LAYER_R.airFilms); // align with wall treatment

  // Degree days
  const { HDD65, CDD65 } = shared;

  // Conduction loads (BTU)
  const Qh_wall = U_wall * wallAreaFt2 * HDD65 * 24;
  const Qc_wall = U_wall * wallAreaFt2 * CDD65 * 24;

  const Qh_win = U_win * windowArea * HDD65 * 24;
  const Qc_win = U_win * windowArea * CDD65 * 24;

  const Qh_ceil = U_ceiling * ceilingArea * HDD65 * 24;
  const Qc_ceil = U_ceiling * ceilingArea * CDD65 * 24;

  // Infiltration (whole-house)
  const ACHnat = ach50ToAchnat(ach50, ach50ToNatFactor);
  const Qh_inf = 0.432 * ACHnat * volumeFt3 * HDD65;
  const Qc_inf = 0.432 * ACHnat * volumeFt3 * CDD65;

  // Totals
  const Qh_total = Qh_wall + Qh_win + Qh_ceil + Qh_inf;
  const Qc_total = Qc_wall + Qc_win + Qc_ceil + Qc_inf;

  // Convert to energy
  const kWhHeat = Qh_total / 3412 / Math.max(0.5, shared.hvac.heatPumpCOP);
  const kWhCool = Qc_total / (Math.max(8, shared.hvac.coolingSEER) * 1000);

  return { kWhHeat, kWhCool, ACHnat, windowArea, ceilingArea };
}

function calcReferenceWholeHouseKWh({
  referenceWholeWallR,
  refAch50,
  ach50ToNatFactor,
  shared,
  hers,
}) {
  // Same geometry as rated (RESNET uses a reference home of same size/shape)
  const {
    wallAreaFt2,
    conditionedFloorArea,
    avgCeilingHeight,
    stories,
    windowToWallRatio,
  } = shared;
  const volumeFt3 = conditionedFloorArea * avgCeilingHeight;
  const { windowArea } = wallGrossAreaFromNet(wallAreaFt2, windowToWallRatio);
  const ceilingArea = conditionedFloorArea / Math.max(1, stories);

  const U_wall = 1 / referenceWholeWallR;
  const U_win = hers.reference.windowU;
  const U_ceil = 1 / (hers.reference.ceilingR + LAYER_R.airFilms);

  const { HDD65, CDD65 } = shared;

  const Qh_wall = U_wall * wallAreaFt2 * HDD65 * 24;
  const Qc_wall = U_wall * wallAreaFt2 * CDD65 * 24;

  const Qh_win = U_win * windowArea * HDD65 * 24;
  const Qc_win = U_win * windowArea * CDD65 * 24;

  // ✅ FIX: define ceiling loads before using in totals
  const Qh_ceil = U_ceil * ceilingArea * HDD65 * 24;
  const Qc_ceil = U_ceil * ceilingArea * CDD65 * 24;

  const ACHnat = ach50ToAchnat(refAch50, ach50ToNatFactor);
  const Qh_inf = 0.432 * ACHnat * volumeFt3 * HDD65;
  const Qc_inf = 0.432 * ACHnat * volumeFt3 * CDD65;

  const Qh_total = Qh_wall + Qh_win + Qh_ceil + Qh_inf;
  const Qc_total = Qc_wall + Qc_win + Qc_ceil + Qc_inf;

  const kWhHeat = Qh_total / 3412 / Math.max(0.5, shared.hvac.heatPumpCOP);
  const kWhCool = Qc_total / (Math.max(8, shared.hvac.coolingSEER) * 1000);

  return { kWhHeat, kWhCool };
}

function estimateHERSIndex({
  ratedKWhHeat,
  ratedKWhCool,
  refKWhHeat,
  refKWhCool,
  otherKWh,
}) {
  const rated = ratedKWhHeat + ratedKWhCool + otherKWh;
  const ref = refKWhHeat + refKWhCool + otherKWh;
  if (ref <= 0) return 100; // guard
  return 100 * (rated / ref);
}

// --- Minimal test harness ---
function isFiniteNum(x) {
  return Number.isFinite(x) && !Number.isNaN(x);
}
function runUnitTests() {
  const results = [];
  const ok = (name, cond) => results.push({ name, pass: !!cond });
  const approxEq = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

  // Common test params
  const shared = {
    HDD65: 3450,
    CDD65: 1730,
    wallAreaFt2: 3000,
    conditionedFloorArea: 3500,
    avgCeilingHeight: 9,
    stories: 2,
    windowToWallRatio: 0.15,
    econ: { elecPricePerKWh: 0.14 },
    hvac: { heatPumpCOP: 3, coolingSEER: 15 },
  };
  const hers = JSON.parse(JSON.stringify(HERS_DEFAULTS));

  // Test 1: whole-wall R increases from 2x4 FG to 2x6 FG
  const R_24 = calcWholeWallR({
    framingDepthIn: 3.5,
    cavityInsulationKey: "fiberglass",
    exteriorSheathingKey: "osbwrap",
    interiorPolyiso: false,
    framingFactor: 0.23,
  }).rEff;
  const R_26 = calcWholeWallR({
    framingDepthIn: 5.5,
    cavityInsulationKey: "fiberglass",
    exteriorSheathingKey: "osbwrap",
    interiorPolyiso: false,
    framingFactor: 0.23,
  }).rEff;
  ok("R(2x6 FG) > R(2x4 FG)", R_26 > R_24);

  // Test 2: whole-house calc returns finite values
  const ratedWH = calcWholeHouseKWh({
    scenarioWholeWallR: R_24,
    ach50: 5,
    ach50ToNatFactor: 0.07,
    shared,
    hers,
  });
  ok(
    "rated kWh finite",
    isFiniteNum(ratedWH.kWhHeat) && isFiniteNum(ratedWH.kWhCool)
  );

  // Test 3: reference calc does not throw and returns finite
  const refWallR = calcWholeWallR({
    framingDepthIn: 3.5,
    cavityInsulationKey: "fiberglass",
    exteriorSheathingKey: "osbwrap",
    interiorPolyiso: false,
    framingFactor: 0.23,
  }).rEff;
  const refWH = calcReferenceWholeHouseKWh({
    referenceWholeWallR: refWallR,
    refAch50: 7,
    ach50ToNatFactor: 0.07,
    shared,
    hers,
  });
  ok(
    "reference kWh finite",
    isFiniteNum(refWH.kWhHeat) && isFiniteNum(refWH.kWhCool)
  );

  // Test 4: lower ACH50 should reduce heating kWh (all else equal)
  const infilHi = calcWholeHouseKWh({
    scenarioWholeWallR: R_24,
    ach50: 7,
    ach50ToNatFactor: 0.07,
    shared,
    hers,
  });
  const infilLo = calcWholeHouseKWh({
    scenarioWholeWallR: R_24,
    ach50: 3,
    ach50ToNatFactor: 0.07,
    shared,
    hers,
  });
  ok("ACH50 3 < 7 reduces kWhHeat", infilLo.kWhHeat < infilHi.kWhHeat);

  // Test 5: HERS == 100 when rated == reference
  const hers100 = estimateHERSIndex({
    ratedKWhHeat: refWH.kWhHeat,
    ratedKWhCool: refWH.kWhCool,
    refKWhHeat: refWH.kWhHeat,
    refKWhCool: refWH.kWhCool,
    otherKWh: 6000,
  });
  ok("HERS 100 when rated==ref", approxEq(hers100, 100, 1e-6));

  return results;
}
const TEST_RESULTS = runUnitTests();

function ScenarioCard({ title, state, onChange, shared }) {
  const framing =
    FRAMING_OPTIONS.find((f) => f.key === state.framingKey) ||
    FRAMING_OPTIONS[0];
  const wholeWall = React.useMemo(
    () =>
      calcWholeWallR({
        framingDepthIn: framing.depth,
        cavityInsulationKey: state.cavityKey,
        exteriorSheathingKey: state.sheathingKey,
        interiorPolyiso: state.interiorPolyiso,
        framingFactor: state.framingFactor,
      }),
    [
      framing.depth,
      state.cavityKey,
      state.sheathingKey,
      state.interiorPolyiso,
      state.framingFactor,
    ]
  );

  const volumeFt3 = shared.conditionedFloorArea * shared.avgCeilingHeight;

  const loads = React.useMemo(
    () =>
      calcLoadsAndCosts({
        wallAreaFt2: shared.wallAreaFt2,
        volumeFt3,
        HDD65: shared.HDD65,
        CDD65: shared.CDD65,
        rEff: wholeWall.rEff,
        ach50: state.ach50,
        ach50ToNatFactor: shared.hers.ach50ToNatFactor,
        econ: shared.econ,
        hvac: shared.hvac,
      }),
    [
      shared.wallAreaFt2,
      volumeFt3,
      shared.HDD65,
      shared.CDD65,
      wholeWall.rEff,
      state.ach50,
      shared.hers.ach50ToNatFactor,
      shared.econ,
      shared.hvac,
    ]
  );

  const stc = React.useMemo(
    () =>
      estimateSTC({
        framingKey: state.framingKey,
        cavityInsulationKey: state.cavityKey,
      }),
    [state.framingKey, state.cavityKey]
  );

  // HERS (rated vs reference)
  const ratedWH = React.useMemo(
    () =>
      calcWholeHouseKWh({
        scenarioWholeWallR: wholeWall.rEff,
        ach50: state.ach50,
        ach50ToNatFactor: shared.hers.ach50ToNatFactor,
        shared,
        hers: shared.hers,
      }),
    [wholeWall.rEff, state.ach50, shared]
  );

  // Calculate costs based on whole-house energy use (walls + windows + ceilings + infiltration)
  const wholeHouseCosts = React.useMemo(() => {
    const costHeat = ratedWH.kWhHeat * shared.econ.elecPricePerKWh;
    const costCool = ratedWH.kWhCool * shared.econ.elecPricePerKWh;
    return { costHeat, costCool, annualCost: costHeat + costCool };
  }, [ratedWH, shared.econ.elecPricePerKWh]);

  const chartData = [
    { name: "Heating", Cost: wholeHouseCosts.costHeat },
    { name: "Cooling", Cost: wholeHouseCosts.costCool },
  ];

  const refWall = React.useMemo(
    () =>
      calcWholeWallR({
        framingDepthIn:
          FRAMING_OPTIONS.find(
            (f) => f.key === shared.hers.reference.framingKey
          )?.depth || 3.5,
        cavityInsulationKey: shared.hers.reference.cavityKey,
        exteriorSheathingKey: shared.hers.reference.sheathingKey,
        interiorPolyiso: shared.hers.reference.interiorPolyiso,
        framingFactor: state.framingFactor,
      }),
    [shared.hers.reference, state.framingFactor]
  );

  const refWH = React.useMemo(
    () =>
      calcReferenceWholeHouseKWh({
        referenceWholeWallR: refWall.rEff,
        refAch50: shared.hers.reference.ach50,
        ach50ToNatFactor: shared.hers.ach50ToNatFactor,
        shared,
        hers: shared.hers,
      }),
    [refWall.rEff, shared]
  );

  const hersIndex = React.useMemo(
    () =>
      estimateHERSIndex({
        ratedKWhHeat: ratedWH.kWhHeat,
        ratedKWhCool: ratedWH.kWhCool,
        refKWhHeat: refWH.kWhHeat,
        refKWhCool: refWH.kWhCool,
        otherKWh: shared.hers.otherSiteEnergyKWh,
      }),
    [ratedWH, refWH, shared.hers.otherSiteEnergyKWh]
  );

  return (
    <div className="rounded-2xl shadow-lg p-5 bg-white border border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xl font-semibold">{title}</h3>
        <div className="flex gap-4 text-sm text-slate-600">
          <span>
            Whole‑Wall R: <b>{wholeWall.rEff.toFixed(1)}</b>
          </span>
          <span>
            Est. HERS: <b>{hersIndex.toFixed(0)}</b>
          </span>
        </div>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium">Framing</label>
          <select
            className="w-full mt-1 rounded-lg border px-3 py-2"
            value={state.framingKey}
            onChange={(e) => onChange({ framingKey: e.target.value })}
          >
            {FRAMING_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">Cavity Insulation</label>
          <select
            className="w-full mt-1 rounded-lg border px-3 py-2"
            value={state.cavityKey}
            onChange={(e) => onChange({ cavityKey: e.target.value })}
          >
            {CAVITY_INSULATION_TYPES.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">
            Exterior Sheathing
          </label>
          <select
            className="w-full mt-1 rounded-lg border px-3 py-2"
            value={state.sheathingKey}
            onChange={(e) => onChange({ sheathingKey: e.target.value })}
          >
            {EXTERIOR_SHEATHING.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">
            Overall Air Sealing
          </label>
          <select
            className="w-full mt-1 rounded-lg border px-3 py-2"
            value={state.ach50Preset}
            onChange={(e) => {
              const preset = AIR_TIGHTNESS_PRESETS.find(
                (p) => p.key === e.target.value
              );
              onChange({
                ach50Preset: preset?.key ?? "builder",
                ach50: preset?.ach50 ?? 5,
              });
            }}
          >
            {AIR_TIGHTNESS_PRESETS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="mt-2 text-xs text-slate-600">
            ACH50:{" "}
            <input
              type="number"
              step="0.1"
              min={0.1}
              value={state.ach50}
              onChange={(e) =>
                onChange({ ach50: parseFloat(e.target.value) || 0 })
              }
              className="w-24 ml-2 rounded border px-2 py-1"
            />{" "}
            (editable)
          </div>
        </div>

        <div className="col-span-1 md:col-span-2">
          <label className="inline-flex items-center gap-2 mt-2">
            <input
              type="checkbox"
              checked={state.interiorPolyiso}
              onChange={(e) => onChange({ interiorPolyiso: e.target.checked })}
            />
            <span> Add 1/2" Polyiso furring strips (thermal break)</span>
          </label>
        </div>

        <div className="col-span-1 md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
          <div className="text-slate-700">
            Effective U: <b>{(1 / wholeWall.rEff).toFixed(3)}</b> BTU/hr·ft²·°F
          </div>
          <div className="text-slate-700">
            Estimated STC: <b>{stc}</b>
          </div>
          <div className="text-slate-700">
            ACHnat≈<b>{loads.ACHnat.toFixed(2)}</b> h⁻¹ (factor{" "}
            {shared.hers.ach50ToNatFactor})
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="mt-5">
        <div className="text-sm text-slate-600 mb-2">
          Annual Energy Costs (whole-house: walls + windows + ceilings +
          infiltration)
        </div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={(v) => `$${Math.round(v)}`} />
              <Tooltip formatter={(v) => formatUSD(v)} />
              <Legend />
              <Bar dataKey="Cost" /* default color */ radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Totals */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
        <div className="rounded-xl bg-slate-50 p-3 border">
          <div className="text-slate-500">Annual Heating Cost</div>
          <div className="text-lg font-semibold">
            {formatUSD(wholeHouseCosts.costHeat)}
          </div>
          <div className="text-xs text-slate-500">
            Heat load: {((ratedWH.kWhHeat * 3412) / 1e6).toFixed(1)} MMBTU
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 border">
          <div className="text-slate-500">Annual Cooling Cost</div>
          <div className="text-lg font-semibold">
            {formatUSD(wholeHouseCosts.costCool)}
          </div>
          <div className="text-xs text-slate-500">
            Cool load:{" "}
            {(
              (ratedWH.kWhCool * 1000 * Math.max(8, shared.hvac.coolingSEER)) /
              1e6
            ).toFixed(1)}{" "}
            MMBTU
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 border">
          <div className="text-slate-500">Annual (Heating + Cooling)</div>
          <div className="text-lg font-semibold">
            {formatUSD(wholeHouseCosts.annualCost)}
          </div>
          <div className="text-xs text-slate-500">
            ACHnat≈{ratedWH.ACHnat.toFixed(2)} h⁻¹
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 border">
          <div className="text-slate-500">HERS (estimated)</div>
          <div className="text-lg font-semibold">{hersIndex.toFixed(0)}</div>
          <div className="text-xs text-slate-500">
            100 ≈ 2006 ref; 0 ≈ net‑zero (approx)
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [shared, setShared] = useState({
    locationName: CLIMATE_DEFAULTS.locationName,
    HDD65: CLIMATE_DEFAULTS.HDD65,
    CDD65: CLIMATE_DEFAULTS.CDD65,
    wallAreaFt2: DEFAULT_HOME.wallAreaFt2,
    conditionedFloorArea: DEFAULT_HOME.conditionedFloorArea,
    avgCeilingHeight: DEFAULT_HOME.avgCeilingHeight,
    stories: DEFAULT_HOME.stories,
    windowToWallRatio: DEFAULT_HOME.windowToWallRatio,
    econ: { ...DEFAULT_ECON },
    hvac: { ...DEFAULT_HVAC },
    hers: JSON.parse(JSON.stringify(HERS_DEFAULTS)),
  });

  const [A, setA] = useState({
    framingKey: "2x4",
    cavityKey: "fiberglass",
    sheathingKey: "osbwrap",
    interiorPolyiso: false,
    ach50Preset: "builder",
    ach50: 5,
    framingFactor: 0.23,
  });
  const [B, setB] = useState({
    framingKey: "2x6",
    cavityKey: "mineralwool",
    sheathingKey: "zipr6",
    interiorPolyiso: true,
    ach50Preset: "energystar",
    ach50: 3,
    framingFactor: 0.23,
  });

  // Compute totals for comparison summary
  const vol = shared.conditionedFloorArea * shared.avgCeilingHeight;

  const A_whole = calcWholeWallR({
    framingDepthIn:
      FRAMING_OPTIONS.find((f) => f.key === A.framingKey)?.depth || 3.5,
    cavityInsulationKey: A.cavityKey,
    exteriorSheathingKey: A.sheathingKey,
    interiorPolyiso: A.interiorPolyiso,
    framingFactor: A.framingFactor,
  });
  const B_whole = calcWholeWallR({
    framingDepthIn:
      FRAMING_OPTIONS.find((f) => f.key === B.framingKey)?.depth || 5.5,
    cavityInsulationKey: B.cavityKey,
    exteriorSheathingKey: B.sheathingKey,
    interiorPolyiso: B.interiorPolyiso,
    framingFactor: B.framingFactor,
  });

  const A_loads = calcLoadsAndCosts({
    wallAreaFt2: shared.wallAreaFt2,
    volumeFt3: vol,
    HDD65: shared.HDD65,
    CDD65: shared.CDD65,
    rEff: A_whole.rEff,
    ach50: A.ach50,
    ach50ToNatFactor: shared.hers.ach50ToNatFactor,
    econ: shared.econ,
    hvac: shared.hvac,
  });
  const B_loads = calcLoadsAndCosts({
    wallAreaFt2: shared.wallAreaFt2,
    volumeFt3: vol,
    HDD65: shared.HDD65,
    CDD65: shared.CDD65,
    rEff: B_whole.rEff,
    ach50: B.ach50,
    ach50ToNatFactor: shared.hers.ach50ToNatFactor,
    econ: shared.econ,
    hvac: shared.hvac,
  });

  // HERS comparison for A & B
  const A_rated = calcWholeHouseKWh({
    scenarioWholeWallR: A_whole.rEff,
    ach50: A.ach50,
    ach50ToNatFactor: shared.hers.ach50ToNatFactor,
    shared,
    hers: shared.hers,
  });
  const B_rated = calcWholeHouseKWh({
    scenarioWholeWallR: B_whole.rEff,
    ach50: B.ach50,
    ach50ToNatFactor: shared.hers.ach50ToNatFactor,
    shared,
    hers: shared.hers,
  });

  const refWall = calcWholeWallR({
    framingDepthIn:
      FRAMING_OPTIONS.find((f) => f.key === shared.hers.reference.framingKey)
        ?.depth || 3.5,
    cavityInsulationKey: shared.hers.reference.cavityKey,
    exteriorSheathingKey: shared.hers.reference.sheathingKey,
    interiorPolyiso: shared.hers.reference.interiorPolyiso,
    framingFactor: A.framingFactor, // assume same framing factor
  });
  const refKWh = calcReferenceWholeHouseKWh({
    referenceWholeWallR: refWall.rEff,
    refAch50: shared.hers.reference.ach50,
    ach50ToNatFactor: shared.hers.ach50ToNatFactor,
    shared,
    hers: shared.hers,
  });

  const A_HERS = estimateHERSIndex({
    ratedKWhHeat: A_rated.kWhHeat,
    ratedKWhCool: A_rated.kWhCool,
    refKWhHeat: refKWh.kWhHeat,
    refKWhCool: refKWh.kWhCool,
    otherKWh: shared.hers.otherSiteEnergyKWh,
  });
  const B_HERS = estimateHERSIndex({
    ratedKWhHeat: B_rated.kWhHeat,
    ratedKWhCool: B_rated.kWhCool,
    refKWhHeat: refKWh.kWhHeat,
    refKWhCool: refKWh.kWhCool,
    otherKWh: shared.hers.otherSiteEnergyKWh,
  });

  const diff = B_loads.annualCost - A_loads.annualCost;
  const better =
    diff < 0
      ? "Scenario B saves"
      : diff > 0
      ? "Scenario A saves"
      : "No difference";

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-7xl mx-auto p-5 md:p-8">
        <header className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold">
            Home Insulation & Energy Performance Simulator
          </h1>
          <p className="text-slate-600 mt-1">
            Compare two wall assemblies side-by-side for thermal, acoustic, and
            HERS (estimated) in {shared.locationName}.
          </p>
        </header>

        {/* Global/Shared Inputs */}
        <section className="rounded-2xl bg-white shadow p-5 border border-slate-200 mb-6">
          <h2 className="text-lg font-semibold mb-3">Project & House Inputs</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium">
                Heating Degree Days (HDD65)
              </label>
              <input
                type="number"
                className="w-full mt-1 rounded-lg border px-3 py-2"
                value={shared.HDD65}
                onChange={(e) =>
                  setShared((s) => ({ ...s, HDD65: Number(e.target.value) }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium">
                Cooling Degree Days (CDD65)
              </label>
              <input
                type="number"
                className="w-full mt-1 rounded-lg border px-3 py-2"
                value={shared.CDD65}
                onChange={(e) =>
                  setShared((s) => ({ ...s, CDD65: Number(e.target.value) }))
                }
              />
            </div>
            <div>
              <label className="block text	sm font-medium">
                Net Wall Area (ft²)
              </label>
              <input
                type="number"
                className="w-full mt-1 rounded-lg border px-3 py-2"
                value={shared.wallAreaFt2}
                onChange={(e) =>
                  setShared((s) => ({
                    ...s,
                    wallAreaFt2: Number(e.target.value),
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium">
                Conditioned Floor Area (ft²)
              </label>
              <input
                type="number"
                className="w-full mt-1 rounded-lg border px-3 py-2"
                value={shared.conditionedFloorArea}
                onChange={(e) =>
                  setShared((s) => ({
                    ...s,
                    conditionedFloorArea: Number(e.target.value),
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium">
                Average Ceiling Height (ft)
              </label>
              <input
                type="number"
                className="w-full mt-1 rounded-lg border px-3 py-2"
                value={shared.avgCeilingHeight}
                onChange={(e) =>
                  setShared((s) => ({
                    ...s,
                    avgCeilingHeight: Number(e.target.value),
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Stories</label>
              <input
                type="number"
                className="w-full mt-1 rounded-lg border px-3 py-2"
                value={shared.stories}
                onChange={(e) =>
                  setShared((s) => ({ ...s, stories: Number(e.target.value) }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium">
                Window‑to‑Wall Ratio
              </label>
              <input
                type="number"
                step="0.01"
                className="w-full mt-1 rounded-lg border px-3 py-2"
                value={shared.windowToWallRatio}
                onChange={(e) =>
                  setShared((s) => ({
                    ...s,
                    windowToWallRatio: Number(e.target.value),
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium">
                Electricity Price ($/kWh)
              </label>
              <input
                type="number"
                step="0.01"
                className="w-full mt-1 rounded-lg border px-3 py-2"
                value={shared.econ.elecPricePerKWh}
                onChange={(e) =>
                  setShared((s) => ({
                    ...s,
                    econ: {
                      ...s.econ,
                      elecPricePerKWh: Number(e.target.value),
                    },
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium">
                Heat Pump COP (seasonal)
              </label>
              <input
                type="number"
                step="0.1"
                className="w-full mt-1 rounded-lg border px-3 py-2"
                value={shared.hvac.heatPumpCOP}
                onChange={(e) =>
                  setShared((s) => ({
                    ...s,
                    hvac: { ...s.hvac, heatPumpCOP: Number(e.target.value) },
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Cooling SEER</label>
              <input
                type="number"
                step="0.1"
                className="w-full mt-1 rounded-lg border px-3 py-2"
                value={shared.hvac.coolingSEER}
                onChange={(e) =>
                  setShared((s) => ({
                    ...s,
                    hvac: { ...s.hvac, coolingSEER: Number(e.target.value) },
                  }))
                }
              />
            </div>
          </div>

          {/* HERS knobs */}
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold">
              HERS Inputs (advanced)
            </summary>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-3 text-sm">
              <div className="rounded-xl bg-slate-50 p-3 border">
                <div className="font-medium mb-2">Conversions</div>
                <label className="block">
                  ACH50 → ACHnat factor
                  <input
                    type="number"
                    step="0.005"
                    className="w-full mt-1 rounded border px-2 py-1"
                    value={shared.hers.ach50ToNatFactor}
                    onChange={(e) =>
                      setShared((s) => ({
                        ...s,
                        hers: {
                          ...s.hers,
                          ach50ToNatFactor: Number(e.target.value),
                        },
                      }))
                    }
                  />
                </label>
                <label className="block mt-2">
                  Other site energy (kWh/yr)
                  <input
                    type="number"
                    className="w-full mt-1 rounded border px-2 py-1"
                    value={shared.hers.otherSiteEnergyKWh}
                    onChange={(e) =>
                      setShared((s) => ({
                        ...s,
                        hers: {
                          ...s.hers,
                          otherSiteEnergyKWh: Number(e.target.value),
                        },
                      }))
                    }
                  />
                </label>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 border">
                <div className="font-medium mb-2">Rated (this model)</div>
                <label className="block">
                  Window U
                  <input
                    type="number"
                    step="0.01"
                    className="w-full mt-1 rounded border px-2 py-1"
                    value={shared.hers.rated.windowU}
                    onChange={(e) =>
                      setShared((s) => ({
                        ...s,
                        hers: {
                          ...s.hers,
                          rated: {
                            ...s.hers.rated,
                            windowU: Number(e.target.value),
                          },
                        },
                      }))
                    }
                  />
                </label>
                <label className="block mt-2">
                  Ceiling R
                  <input
                    type="number"
                    step="1"
                    className="w-full mt-1 rounded border px-2 py-1"
                    value={shared.hers.rated.ceilingR}
                    onChange={(e) =>
                      setShared((s) => ({
                        ...s,
                        hers: {
                          ...s.hers,
                          rated: {
                            ...s.hers.rated,
                            ceilingR: Number(e.target.value),
                          },
                        },
                      }))
                    }
                  />
                </label>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 border">
                <div className="font-medium mb-2">Reference Home</div>
                <label className="block">
                  ACH50
                  <input
                    type="number"
                    step="0.1"
                    className="w-full mt-1 rounded border px-2 py-1"
                    value={shared.hers.reference.ach50}
                    onChange={(e) =>
                      setShared((s) => ({
                        ...s,
                        hers: {
                          ...s.hers,
                          reference: {
                            ...s.hers.reference,
                            ach50: Number(e.target.value),
                          },
                        },
                      }))
                    }
                  />
                </label>
                <label className="block mt-2">
                  Window U
                  <input
                    type="number"
                    step="0.01"
                    className="w-full mt-1 rounded border px-2 py-1"
                    value={shared.hers.reference.windowU}
                    onChange={(e) =>
                      setShared((s) => ({
                        ...s,
                        hers: {
                          ...s.hers,
                          reference: {
                            ...s.hers.reference,
                            windowU: Number(e.target.value),
                          },
                        },
                      }))
                    }
                  />
                </label>
                <label className="block mt-2">
                  Ceiling R
                  <input
                    type="number"
                    step="1"
                    className="w-full mt-1 rounded border px-2 py-1"
                    value={shared.hers.reference.ceilingR}
                    onChange={(e) =>
                      setShared((s) => ({
                        ...s,
                        hers: {
                          ...s.hers,
                          reference: {
                            ...s.hers.reference,
                            ceilingR: Number(e.target.value),
                          },
                        },
                      }))
                    }
                  />
                </label>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 border">
                <div className="font-medium mb-2">Reference Wall</div>
                <label className="block">
                  Framing
                  <select
                    className="w-full mt-1 rounded border px-2 py-1"
                    value={shared.hers.reference.framingKey}
                    onChange={(e) =>
                      setShared((s) => ({
                        ...s,
                        hers: {
                          ...s.hers,
                          reference: {
                            ...s.hers.reference,
                            framingKey: e.target.value,
                          },
                        },
                      }))
                    }
                  >
                    {FRAMING_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block mt-2">
                  Cavity
                  <select
                    className="w-full mt-1 rounded border px-2 py-1"
                    value={shared.hers.reference.cavityKey}
                    onChange={(e) =>
                      setShared((s) => ({
                        ...s,
                        hers: {
                          ...s.hers,
                          reference: {
                            ...s.hers.reference,
                            cavityKey: e.target.value,
                          },
                        },
                      }))
                    }
                  >
                    {CAVITY_INSULATION_TYPES.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block mt-2">
                  Sheathing
                  <select
                    className="w-full mt-1 rounded border px-2 py-1"
                    value={shared.hers.reference.sheathingKey}
                    onChange={(e) =>
                      setShared((s) => ({
                        ...s,
                        hers: {
                          ...s.hers,
                          reference: {
                            ...s.hers.reference,
                            sheathingKey: e.target.value,
                          },
                        },
                      }))
                    }
                  >
                    {EXTERIOR_SHEATHING.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline-flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    checked={shared.hers.reference.interiorPolyiso}
                    onChange={(e) =>
                      setShared((s) => ({
                        ...s,
                        hers: {
                          ...s.hers,
                          reference: {
                            ...s.hers.reference,
                            interiorPolyiso: e.target.checked,
                          },
                        },
                      }))
                    }
                  />
                  <span>Int. 1/2" polyiso</span>
                </label>
              </div>
            </div>
          </details>
        </section>

        {/* Scenario cards */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ScenarioCard
            title="Scenario A"
            state={A}
            onChange={(patch) => setA((prev) => ({ ...prev, ...patch }))}
            shared={shared}
          />
          <ScenarioCard
            title="Scenario B"
            state={B}
            onChange={(patch) => setB((prev) => ({ ...prev, ...patch }))}
            shared={shared}
          />
        </section>

        {/* Comparison Summary */}
        <section className="rounded-2xl bg-white shadow p-5 border border-slate-200 mt-6">
          <h2 className="text-lg font-semibold mb-3">Comparison Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 text-sm">
            <div className="rounded-xl bg-slate-50 p-3 border">
              <div className="text-slate-500">Scenario A — Annual Cost</div>
              <div className="text-lg font-semibold">
                {formatUSD(A_loads.annualCost)}
              </div>
              <div className="text-xs text-slate-500">
                R{A_whole.rEff.toFixed(1)}, ACH50 {A.ach50}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 border">
              <div className="text-slate-500">Scenario B — Annual Cost</div>
              <div className="text-lg font-semibold">
                {formatUSD(B_loads.annualCost)}
              </div>
              <div className="text-xs text-slate-500">
                R{B_whole.rEff.toFixed(1)}, ACH50 {B.ach50}
              </div>
            </div>
            <div
              className={`rounded-xl p-3 border ${
                diff < 0
                  ? "bg-green-50"
                  : diff > 0
                  ? "bg-amber-50"
                  : "bg-slate-50"
              }`}
            >
              <div className="text-slate-500">Difference</div>
              <div className="text-lg font-semibold">
                {formatUSD(Math.abs(diff))} / yr
              </div>
              <div className="text-xs text-slate-500">{better}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 border">
              <div className="text-slate-500">HERS — Scenario A</div>
              <div className="text-lg font-semibold">{A_HERS.toFixed(0)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 border">
              <div className="text-slate-500">HERS — Scenario B</div>
              <div className="text-lg font-semibold">{B_HERS.toFixed(0)}</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500">
            HERS is an estimate using a simplified whole‑house model (walls,
            windows, ceiling, and infiltration). Solar gains, latent loads,
            ducts, DHW, and equipment sizing are not modeled; edit HERS inputs
            above to calibrate. For code compliance use a certified HERS rater
            with accredited software.
          </div>
        </section>

        {/* Diagnostics */}
        <section className="rounded-2xl bg-white shadow p-5 border border-slate-200 mt-6">
          <details>
            <summary className="cursor-pointer font-semibold text-sm">
              Diagnostics & Unit Tests
            </summary>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
              {TEST_RESULTS.map((t, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-2 ${
                    t.pass
                      ? "bg-green-50 border-green-200"
                      : "bg-red-50 border-red-200"
                  }`}
                >
                  <div className="font-medium">{t.pass ? "PASS" : "FAIL"}</div>
                  <div className="text-slate-700">{t.name}</div>
                </div>
              ))}
            </div>
          </details>
        </section>

        <footer className="text-xs text-slate-500 mt-6">
          © {new Date().getFullYear()} Energy model is approximate for
          comparative design. For permit or code compliance, use REScheck/HERS
          rater or a full energy model.
        </footer>
      </div>
    </div>
  );
}
