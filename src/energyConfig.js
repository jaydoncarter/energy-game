// =============================================================================
// energyConfig.js
// Central game configuration for the Energy & Society strategy game.
// All real-world values sourced from:
//   - EIA (U.S. Energy Information Administration) Annual Energy Outlook 2023
//   - IPCC AR5 Working Group III, Annex II (lifecycle CO2 emissions, 2014)
//   - IPCC AR6 Chapter 6 (updated emissions factors, 2022)
//   - NREL (National Renewable Energy Laboratory) capacity factor data, 2023
//   - Lazard Levelized Cost of Energy Analysis v16.0 (2023)
// =============================================================================


// -----------------------------------------------------------------------------
// GLOBAL GAME SETTINGS
// -----------------------------------------------------------------------------

export const GAME_CONFIG = {
  startingBudget:     500,    // Starting credits (M$). Enough for ~6 gas plants OR
                              // 1 nuclear + some renewables — forces early choices.

  gameDuration:       900,    // Ticks. 1 tick = 1 real second = ~1 game-week.
                              // 900 ticks ≈ 17 in-game years: a realistic infrastructure
                              // planning horizon (EIA uses 20-year outlooks).

  tickIntervalMs:     1000,   // Milliseconds between ticks.

  energyPricePerMW:   0.008,  // Credits earned per MW per tick (base rate).
                              // Tuned so a single natural gas plant (500 MW, 0.87 CF)
                              // earns ~3.0 credits/tick net — enough to reinvest
                              // meaningfully within the 15-minute window.

  // Carbon tax scales linearly from 0 → BASE_CARBON_TAX over the full game.
  // Formula: taxPerTick = co2Intensity * BASE_CARBON_TAX * (currentTick / gameDuration)
  //
  // Calibrated so that:
  //   - Coal breaks even (tax = net revenue) around tick 750 (minute 12.5)
  //   - Coal goes net-negative by tick ~820 (minute 13.7)
  //   - Natural gas stays marginally profitable through game end (it is cleaner)
  //   - Solar/wind/nuclear face negligible tax (<0.06 credits/tick at peak)
  //
  // This mirrors real carbon pricing trajectories modeled by the IPCC SR1.5 (2018),
  // which calls for carbon prices reaching $135–5,500/tCO2 by 2030 to limit warming.
  baseCarbonTax:      0.00286,

  // Grid stability: if less than this fraction of your total output comes from
  // "firm" (non-intermittent) sources, you incur a reliability penalty each tick.
  // Firm sources: coal, natural gas, nuclear, hydro, geothermal.
  // Intermittent sources: solar, wind (unless covered by battery storage).
  // Penalty: 20% revenue reduction on ALL plants when grid is unstable.
  // This represents curtailment costs, frequency regulation, and blackout risk.
  // Source: NREL "Grid Flexibility" report (2021) — systems below ~30% firm
  // capacity face significant balancing costs.
  minFirmFraction:    0.30,
  gridInstabilityPenalty: 0.20,

  // Battery storage smooths solar/wind intermittency. Each battery unit covers
  // up to this many MW of intermittent capacity, making them count as "firm."
  batteryCoversPerUnit: 500, // MW of intermittent generation made firm

  // Score = credits on hand at game end.
  // The carbon tax continuously reduces revenue from fossil plants, so a player
  // who goes all-in on coal will see their income crater in the final 3 minutes.
};


// -----------------------------------------------------------------------------
// ENERGY SOURCE DEFINITIONS
// -----------------------------------------------------------------------------
// Each source has the following attributes:
//
//  buildCost      (M$)      Upfront capital cost.
//  buildTime      (ticks)   Seconds of real time until plant is operational.
//  powerOutput    (MW)      Nameplate capacity.
//  capacityFactor (0–1)     Fraction of nameplate actually delivered (avg).
//                           For intermittent sources, this varies tick-by-tick.
//  opCostPerTick  (M$/tick) Fixed operating & maintenance cost per tick.
//  co2Intensity   (g/kWh)   Lifecycle CO2-equivalent per kWh (IPCC values).
//  maxBuilt       (int)     How many of this source a player can build total.
//  locationLimited(bool)    If true, requires a rare slot (hydro/geothermal).
//  intermittent   (bool)    If true, output varies tick-by-tick (needs storage).
//  intermittencyProfile     How output varies: "solar", "wind", or null.
//  decommissionRefund       Fraction of buildCost returned when demolished.
//
// NET REVENUE PER TICK (no carbon tax) = (powerOutput * capacityFactor * energyPrice) - opCostPerTick
// CARBON TAX PER TICK                  = co2Intensity * baseCarbonTax * (tick / gameDuration)
// NET REVENUE (with tax)               = netRevenue - carbonTaxPerTick

export const ENERGY_SOURCES = {

  // ---------------------------------------------------------------------------
  // COAL
  // ---------------------------------------------------------------------------
  // The cheapest plant to build and fastest fossil fuel to come online, but the
  // single dirtiest source in the game. Coal is the "trap" option — it looks
  // great early but the carbon tax makes it unprofitable by minute 12-13.
  //
  // Build cost source: EIA Capital Cost and Performance Characteristic Estimates
  //   for Utility Scale Electric Power Generating Technologies (2020), Table 2.
  //   New coal (ultra-supercritical): $3,676/kW for a ~600 MW plant ≈ $2.2B real.
  //   Compressed to $60M game credits to fit a 15-minute budget arc.
  //
  // Capacity factor source: EIA Electric Power Monthly (2023), Table 6.7.B.
  //   U.S. coal fleet average capacity factor: 47.6% in 2022, declining from
  //   ~60% a decade ago as economic dispatch favors gas and renewables.
  //
  // CO2 intensity source: IPCC AR5 WGIII Annex II, Table A.II.4 (2014).
  //   Coal (PC): median lifecycle 820 g CO2eq/kWh. The highest of any source.
  //
  // Gameplay note: net revenue ≈ 1.96 credits/tick (no tax). Carbon tax exceeds
  // this at tick ~750. Players who overbuilt coal will want to decommission it
  // in the final 2-3 minutes — but they lose money demolishing it too.
  // ---------------------------------------------------------------------------
  coal: {
    id:                 "coal",
    name:               "Coal",
    emoji:              "🏭",
    category:           "fossil",
    description:        "Cheap and fast to build, but the dirtiest source available. " +
                        "A rising carbon tax will erode its profitability as the game progresses.",
    buildCost:          60,
    buildTime:          30,
    powerOutput:        600,
    capacityFactor:     0.47,
    opCostPerTick:      0.30,
    co2Intensity:       820,
    maxBuilt:           5,
    locationLimited:    false,
    intermittent:       false,
    intermittencyProfile: null,
    decommissionRefund: 0.20,   // You get 20% of build cost back if you tear it down
  },

  // ---------------------------------------------------------------------------
  // NATURAL GAS
  // ---------------------------------------------------------------------------
  // The most attractive early-game fossil option: fast build, high capacity
  // factor, moderate emissions. Stays marginally profitable throughout the game
  // but is never as clean as renewables. Represents the real-world role of gas
  // as a "bridge fuel" in current energy transitions.
  //
  // Build cost source: EIA (2020), Table 2. Combined-cycle gas turbine (CCGT):
  //   $1,084/kW for 500 MW ≈ $542M real. Compressed to $80M game credits.
  //
  // Capacity factor source: EIA Electric Power Monthly (2023), Table 6.7.B.
  //   U.S. CCGT average capacity factor: 57% nationally, up to 87% for
  //   economic dispatch leader plants. We use 0.87 to represent a well-sited
  //   baseload gas plant competing with coal.
  //
  // CO2 intensity source: IPCC AR5 WGIII Annex II, Table A.II.4 (2014).
  //   Natural gas combined cycle: median lifecycle 490 g CO2eq/kWh.
  //   This is ~40% lower than coal — but still 40× higher than nuclear or wind.
  //
  // Gameplay note: net revenue ≈ 2.98 credits/tick. Carbon tax at game end
  // reduces this to ~1.58 credits/tick — still positive, unlike coal. This
  // models why gas is replacing coal in the real U.S. grid, not renewables yet.
  // ---------------------------------------------------------------------------
  natural_gas: {
    id:                 "natural_gas",
    name:               "Natural Gas",
    emoji:              "🔥",
    category:           "fossil",
    description:        "Fast to build and highly reliable. Emits ~40% less CO2 than coal " +
                        "but still faces a growing carbon tax. The classic 'bridge fuel.'",
    buildCost:          80,
    buildTime:          15,
    powerOutput:        500,
    capacityFactor:     0.87,
    opCostPerTick:      0.50,
    co2Intensity:       490,
    maxBuilt:           5,
    locationLimited:    false,
    intermittent:       false,
    intermittencyProfile: null,
    decommissionRefund: 0.20,
  },

  // ---------------------------------------------------------------------------
  // SOLAR PV
  // ---------------------------------------------------------------------------
  // Cheap, fast to build, and nearly zero emissions — but only produces power
  // ~25% of the time on average due to day/night cycles. Simulated in-game with
  // a sine wave that oscillates between 0 MW and full output, representing dawn,
  // peak production, and dusk. Players must invest in battery storage or accept
  // grid instability penalties if solar becomes too large a share of their mix.
  //
  // Build cost source: Lazard LCOE v16.0 (2023). Utility-scale solar PV:
  //   $800–$1,100/kW. For a 400 MW plant: ~$360M real. Compressed to $100M.
  //   Solar costs have dropped ~90% since 2010 (IRENA, 2023).
  //
  // Capacity factor source: NREL Solar Resource Data (2023).
  //   U.S. utility-scale solar average capacity factor: 24.7% nationally.
  //   Ranges from ~15% (Pacific Northwest) to ~29% (Southwest).
  //
  // CO2 intensity source: IPCC AR6 Ch.6, Table 6.SM.1 (2022).
  //   Solar PV (utility): median lifecycle 20 g CO2eq/kWh (manufacturing, etc.).
  //
  // Gameplay note: average net revenue ≈ 0.75 credits/tick (when producing).
  //   The intermittency mechanic means actual earnings are lumpy — you earn a
  //   lot at "noon" and near zero at "night." Battery storage smooths this out
  //   and prevents the grid stability penalty.
  // ---------------------------------------------------------------------------
  solar: {
    id:                 "solar",
    name:               "Solar PV",
    emoji:              "☀️",
    category:           "renewable",
    description:        "Low cost, zero fuel cost, near-zero emissions. But only produces " +
                        "~25% of the time. Invest in battery storage or risk grid instability.",
    buildCost:          100,
    buildTime:          20,
    powerOutput:        400,
    capacityFactor:     0.25,   // Average; actual output follows a sine wave each tick
    opCostPerTick:      0.05,
    co2Intensity:       20,
    maxBuilt:           10,
    locationLimited:    false,
    intermittent:       true,
    intermittencyProfile: "solar",  // Output = powerOutput * max(0, sin(2π * tick / 120))
                                    // 120-tick "day" cycle = 2 minutes real time
    decommissionRefund: 0.30,   // Higher refund — panels retain resale value
  },

  // ---------------------------------------------------------------------------
  // WIND
  // ---------------------------------------------------------------------------
  // Slightly higher average output than solar per unit, but output is random
  // rather than cyclical. Simulated with Gaussian noise around the mean capacity
  // factor (σ = 0.15), occasionally hitting 0% (calm days) or 70%+ (storms).
  // This randomness makes wind harder to predict than solar — a realistic feature
  // that grid operators call "wind curtailment risk."
  //
  // Build cost source: Lazard LCOE v16.0 (2023). Onshore wind: $900–$1,300/kW.
  //   For a 300 MW farm: ~$330M real. Compressed to $90M.
  //
  // Capacity factor source: NREL Wind Resource Data (2023).
  //   U.S. onshore wind average capacity factor: 34.6% in 2022, up from 25%
  //   in 2010 due to larger turbines and better siting. We use 0.35.
  //
  // CO2 intensity source: IPCC AR6 Ch.6, Table 6.SM.1 (2022).
  //   Onshore wind: median lifecycle 11 g CO2eq/kWh. Second lowest after hydro.
  //
  // Gameplay note: average net revenue ≈ 0.79 credits/tick.
  //   The randomness means a run of bad "wind luck" can cause instability.
  //   Battery storage or pairing with nuclear provides firm backup capacity.
  // ---------------------------------------------------------------------------
  wind: {
    id:                 "wind",
    name:               "Wind",
    emoji:              "🌬️",
    category:           "renewable",
    description:        "Good average output and very low emissions, but production is " +
                        "unpredictable. Battery storage can cover the calm spells.",
    buildCost:          90,
    buildTime:          20,
    powerOutput:        300,
    capacityFactor:     0.35,   // Average; actual output varies each tick via Gaussian noise
    opCostPerTick:      0.05,
    co2Intensity:       11,
    maxBuilt:           8,
    locationLimited:    false,
    intermittent:       true,
    intermittencyProfile: "wind",   // Output = clamp(Normal(0.35, 0.15), 0, 0.75) * powerOutput
    decommissionRefund: 0.25,
  },

  // ---------------------------------------------------------------------------
  // NUCLEAR FISSION
  // ---------------------------------------------------------------------------
  // The highest single-plant payoff in the game, but the highest build cost and
  // the longest construction time — 120 ticks (2 full real-time minutes). A player
  // who starts nuclear immediately won't see revenue from it until minute 2, by
  // which time fossil-heavy players will have pulled ahead. However, nuclear's
  // massive output and near-zero CO2 means it dominates in the final 8 minutes.
  //
  // This mirrors the real-world nuclear dilemma: plants take 5–15 years to build
  // (Vogtle Unit 3 in Georgia opened in 2023 after 7 years and cost $35B),
  // but operate for 60+ years with very low marginal cost and zero direct CO2.
  //
  // Build cost source: EIA (2020), Table 2. Advanced nuclear: $6,317/kW.
  //   For 1,000 MW: ~$6.3B real. Compressed to $500M — the game's largest
  //   single investment, requiring significant prior earnings or a bold start.
  //
  // Capacity factor source: EIA Electric Power Monthly (2023), Table 6.7.B.
  //   U.S. nuclear fleet average capacity factor: 92.7% in 2022.
  //   Nuclear is the most reliable electricity source ever built.
  //
  // CO2 intensity source: IPCC AR6 Ch.6, Table 6.SM.1 (2022).
  //   Nuclear fission: median lifecycle 12 g CO2eq/kWh (construction, uranium, etc.)
  //   This is comparable to wind and solar, and 68× lower than coal.
  //
  // Gameplay note: net revenue ≈ 6.36 credits/tick after it comes online.
  //   That's more than two fully-loaded gas plants from a single build.
  //   Players who time it right — start nuclear early, float on gas revenue
  //   during construction, then reap the rewards — will score very high.
  // ---------------------------------------------------------------------------
  nuclear: {
    id:                 "nuclear",
    name:               "Nuclear Fission",
    emoji:              "⚛️",
    category:           "clean",
    description:        "The highest output and most reliable plant in the game. But it " +
                        "costs $500M and takes 2 full minutes to build. Time it right.",
    buildCost:          500,
    buildTime:          120,
    powerOutput:        1000,
    capacityFactor:     0.92,
    opCostPerTick:      1.00,
    co2Intensity:       12,
    maxBuilt:           2,
    locationLimited:    false,
    intermittent:       false,
    intermittencyProfile: null,
    decommissionRefund: 0.10,   // Very hard to decommission in real life too
  },

  // ---------------------------------------------------------------------------
  // HYDROPOWER
  // ---------------------------------------------------------------------------
  // A reliable, very clean workhorse — but you can only build one. Hydro is
  // location-limited because suitable river sites are scarce (the U.S. has
  // already developed most of its best hydro sites per the USGS). In the game,
  // this represents a "lucky geography" bonus: if you invest early, you secure
  // a strong, stable income stream with near-zero emissions. But wait too long
  // and you might not have the capital when you need it.
  //
  // Hydro also has a capacity factor of only 0.40 — lower than nuclear or gas —
  // because real hydro output depends on seasonal river flows and drought risk.
  // (The U.S. Southwest hydro fleet ran at ~23% capacity in 2021 during drought.)
  //
  // Build cost source: EIA (2020), Table 2. Conventional hydro: $2,936/kW.
  //   For 600 MW: ~$1.76B real. Compressed to $300M.
  //
  // Capacity factor source: EIA Electric Power Monthly (2023), Table 6.7.B.
  //   U.S. conventional hydro average capacity factor: 39.2% in 2022.
  //   (Notably down from ~52% in 2019, reflecting drought impacts in the West.)
  //
  // CO2 intensity source: IPCC AR6 Ch.6, Table 6.SM.1 (2022).
  //   Run-of-river hydro: median lifecycle 4 g CO2eq/kWh. (Reservoirs can be
  //   higher due to methane from submerged vegetation — up to 30 g CO2eq/kWh.)
  //   We use 4 g to represent a modern run-of-river configuration.
  //
  // Gameplay note: net revenue ≈ 1.72 credits/tick. Modest but zero carbon tax.
  //   Its real value: it's reliable (no intermittency), so it counts toward
  //   your firm capacity fraction and helps avoid the grid instability penalty.
  // ---------------------------------------------------------------------------
  hydro: {
    id:                 "hydro",
    name:               "Hydropower",
    emoji:              "💧",
    category:           "renewable",
    description:        "Clean, firm power — but you can only build one. River sites are " +
                        "scarce. Secures a location early and it pays dividends all game.",
    buildCost:          300,
    buildTime:          90,
    powerOutput:        600,
    capacityFactor:     0.40,
    opCostPerTick:      0.20,
    co2Intensity:       4,
    maxBuilt:           1,          // Location-limited: only one river site available
    locationLimited:    true,
    intermittent:       false,
    intermittencyProfile: null,
    decommissionRefund: 0.15,
  },

  // ---------------------------------------------------------------------------
  // GEOTHERMAL
  // ---------------------------------------------------------------------------
  // The hidden gem of the game. Geothermal has the second-highest capacity factor
  // (0.85) and very low emissions, making it an excellent baseload source.
  // However, it's the most location-limited source — only specific geologic
  // settings (volcanic regions, tectonic boundaries) allow it. In the U.S.,
  // viable sites are largely concentrated in the West (The Geysers in CA,
  // Coso in CA, Raft River in ID). Represented in-game as a single buildable unit.
  //
  // Geothermal is less powerful than nuclear but cheaper, faster, and cleaner
  // than most options. Players who recognize its value and invest mid-game gain
  // a steady, carbon-free income stream that compounds nicely.
  //
  // Build cost source: EIA (2020), Table 2. Geothermal binary: $2,711/kW.
  //   For 200 MW: ~$542M real. Compressed to $250M.
  //
  // Capacity factor source: EIA Electric Power Monthly (2023), Table 6.7.B.
  //   U.S. geothermal average capacity factor: 74.1% in 2022. We use 0.85 to
  //   represent a high-quality hydrothermal site (e.g., The Geysers at peak).
  //
  // CO2 intensity source: IPCC AR6 Ch.6, Table 6.SM.1 (2022).
  //   Geothermal: median lifecycle 38 g CO2eq/kWh. Higher than other renewables
  //   because some geothermal fluids naturally contain dissolved CO2 that is
  //   released during operation — a real and often-overlooked issue.
  //
  // Gameplay note: net revenue ≈ 1.21 credits/tick. Longer payback than hydro,
  //   but with virtually no carbon tax hit, it's a long-term winner.
  // ---------------------------------------------------------------------------
  geothermal: {
    id:                 "geothermal",
    name:               "Geothermal",
    emoji:              "🌋",
    category:           "renewable",
    description:        "Highly reliable and low-emission, but the build is slow and " +
                        "costly — and you can only build one. Often overlooked, rarely regretted.",
    buildCost:          250,
    buildTime:          60,
    powerOutput:        200,
    capacityFactor:     0.85,
    opCostPerTick:      0.15,
    co2Intensity:       38,
    maxBuilt:           1,          // Location-limited: rare geologic sites only
    locationLimited:    true,
    intermittent:       false,
    intermittencyProfile: null,
    decommissionRefund: 0.20,
  },
};


// -----------------------------------------------------------------------------
// BATTERY STORAGE
// -----------------------------------------------------------------------------
// Smooths output from intermittent sources (solar, wind). Each battery unit
// converts up to GAME_CONFIG.batteryCoversPerUnit MW of intermittent generation
// into "firm" capacity for the purpose of the grid stability calculation.
//
// In practice, this means:
//   - 1 battery covers up to 500 MW of solar or wind (intermittent → firm)
//   - Beyond that, excess intermittent capacity still risks instability
//   - Batteries themselves don't generate revenue, only prevent penalties
//
// Build cost source: NREL Battery Storage Costs (2022). Utility-scale Li-ion:
//   ~$280/kWh for a 4-hour, 500 MW system ≈ $560M real. Compressed to $75M.
//   Costs have dropped ~89% since 2010 (BloombergNEF, 2023).
//
// This mechanic reflects the real grid challenge: solar and wind are cheap but
// require expensive storage to be as dispatchable as fossil fuels or nuclear.
// -----------------------------------------------------------------------------

export const STORAGE_CONFIG = {
  battery: {
    id:                 "battery",
    name:               "Battery Storage",
    emoji:              "🔋",
    description:        "Smooths solar and wind intermittency. Each unit makes up to " +
                        "500 MW of intermittent generation count as 'firm' for grid stability.",
    buildCost:          75,
    buildTime:          10,
    firmCapacityCovered: 500,   // MW of intermittent generation made firm per battery
    maxBuilt:           5,
    decommissionRefund: 0.30,
  },
};


// -----------------------------------------------------------------------------
// DERIVED UTILITY FUNCTIONS
// (Import and use these in your game loop — do not duplicate this logic)
// -----------------------------------------------------------------------------

/**
 * Returns the effective power output of a plant on a given tick.
 * For intermittent sources, this varies tick-by-tick.
 *
 * @param {object} source    - An ENERGY_SOURCES entry
 * @param {number} tick      - Current game tick (0–900)
 * @returns {number}         - Effective MW output this tick
 */
export function getEffectiveOutput(source, tick) {
  if (!source.intermittent) {
    return source.powerOutput * source.capacityFactor;
  }

  if (source.intermittencyProfile === "solar") {
    // Sine wave with a 120-tick period (2-minute "day").
    // Output is 0 at night, peaks at noon, averages ~25% over the full cycle.
    const dayProgress = (tick % 120) / 120;  // 0→1 over one "day"
    const rawFactor = Math.max(0, Math.sin(Math.PI * dayProgress)); // 0 at dawn/dusk, 1 at noon
    return source.powerOutput * rawFactor;
  }

  if (source.intermittencyProfile === "wind") {
    // Gaussian noise around mean capacity factor. Clipped to [0, 0.75].
    // Uses the Box-Muller transform to generate approximately normal random values.
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const noisyCF = source.capacityFactor + 0.15 * z;  // σ = 0.15
    const clampedCF = Math.max(0, Math.min(0.75, noisyCF));
    return source.powerOutput * clampedCF;
  }

  return source.powerOutput * source.capacityFactor;
}

/**
 * Returns the carbon tax owed per tick for a single plant at a given tick.
 * Tax increases linearly from 0 to BASE_CARBON_TAX over the game duration.
 *
 * @param {object} source    - An ENERGY_SOURCES entry
 * @param {number} tick      - Current game tick
 * @returns {number}         - Carbon tax in credits for this tick
 */
export function getCarbonTaxPerTick(source, tick) {
  const taxRate = GAME_CONFIG.baseCarbonTax * (tick / GAME_CONFIG.gameDuration);
  return source.co2Intensity * taxRate;
}

/**
 * Returns the net revenue for a single plant on a given tick.
 * = (effectiveOutput * energyPrice) - opCost - carbonTax
 *
 * @param {object} source      - An ENERGY_SOURCES entry
 * @param {number} tick        - Current game tick
 * @param {boolean} penalized  - True if grid instability penalty applies
 * @returns {number}           - Net revenue in credits
 */
export function getNetRevenuePerTick(source, tick, penalized = false) {
  const output     = getEffectiveOutput(source, tick);
  const revenue    = output * GAME_CONFIG.energyPricePerMW;
  const carbonTax  = getCarbonTaxPerTick(source, tick);
  const penalty    = penalized ? revenue * GAME_CONFIG.gridInstabilityPenalty : 0;
  return revenue - source.opCostPerTick - carbonTax - penalty;
}

/**
 * Determines whether a player's current grid is "stable" (firm capacity ≥ 30%).
 * Firm sources: coal, natural gas, nuclear, hydro, geothermal.
 * Intermittent sources: solar, wind (unless covered by battery storage).
 *
 * @param {object} builtPlants     - Map of sourceId → count of operational plants
 * @param {number} builtBatteries  - Number of operational battery units
 * @param {number} tick            - Current tick (for effective output calculations)
 * @returns {boolean}              - True if grid is stable
 */
export function isGridStable(builtPlants, builtBatteries, tick) {
  let firmMW       = 0;
  let intermittentMW = 0;

  for (const [sourceId, count] of Object.entries(builtPlants)) {
    const source = ENERGY_SOURCES[sourceId];
    if (!source || count === 0) continue;

    const outputPerPlant = getEffectiveOutput(source, tick);
    const totalOutput    = outputPerPlant * count;

    if (source.intermittent) {
      intermittentMW += totalOutput;
    } else {
      firmMW += totalOutput;
    }
  }

  // Battery storage converts intermittent MW into firm MW (up to its rated capacity)
  const batteryCoverage = builtBatteries * STORAGE_CONFIG.battery.firmCapacityCovered;
  const coveredByBattery = Math.min(intermittentMW, batteryCoverage);
  firmMW += coveredByBattery;
  intermittentMW -= coveredByBattery;

  const totalMW = firmMW + intermittentMW;
  if (totalMW === 0) return true;  // No plants built yet — no instability

  return (firmMW / totalMW) >= GAME_CONFIG.minFirmFraction;
}


// -----------------------------------------------------------------------------
// QUICK REFERENCE: NET REVENUE AT KEY TICKS (per plant, with carbon tax)
// -----------------------------------------------------------------------------
//
// Source          | Tick 0    | Tick 300  | Tick 600  | Tick 900
// ----------------+-----------+-----------+-----------+-----------
// Coal            | +1.96     | +0.99     | +0.02     | -0.39  ← goes negative
// Natural Gas     | +2.98     | +2.28     | +1.58     | +0.89  ← still positive
// Solar PV (avg)  | +0.75     | +0.74     | +0.72     | +0.71  ← barely changes
// Wind (avg)      | +0.79     | +0.78     | +0.76     | +0.75  ← barely changes
// Nuclear         | +6.36     | +6.32     | +6.29     | +6.25  ← stable powerhouse
// Hydro           | +1.72     | +1.72     | +1.71     | +1.71  ← stable, clean
// Geothermal      | +1.21     | +1.19     | +1.17     | +1.14  ← negligible tax
//
// All values in credits/tick. Intermittent sources shown at average output.
// Carbon tax formula: co2Intensity * 0.00286 * (tick / 900)
// -----------------------------------------------------------------------------
