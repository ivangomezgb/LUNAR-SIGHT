// Game rules: every number here is a declared GAME ASSUMPTION (rounded, VIPER-like where a
// public order of magnitude exists), not mission data. Shown in the "Game rules" panel and
// listed in docs/assumptions.md. Physics of the environment (terrain, Sun, Earth, gravity) is real.

export const RULES = {
  gravity: 1.62, // m/s^2, real lunar surface gravity
  rover: {
    massKg: 430, // VIPER-class rover
    maxSpeed: 0.2, // m/s, VIPER-class top speed (time warp makes it feel faster)
    mu: 0.45, // wheel–regolith traction coefficient (loose lunar soil, order of magnitude)
    crr: 0.15, // rolling resistance in loose regolith
    responseS: 0.5, // speed controller time constant
    motorW: 150, // max mechanical power of the wheel motors
    motorEff: 0.6, // electrical → mechanical efficiency
    driveBaseW: 40, // motor drives and steering electronics while moving
    maxSlideSpeed: 1.5, // m/s cap while sliding down a slope it cannot hold
    turnRate: 12, // deg/s at full steer
    tipDeg: 25, // cross slope that rolls it over (side-slip starts near atan(mu) ≈ 24°)
    eyeH: 2, // m, panel/antenna height used for Sun and Earth visibility
    edgeMarginM: 60, // keep this far inside the 10 m terrain grid
  },
  power: {
    batteryWh: 2000,
    solarWm2: 1361, // solar constant at 1 AU (no atmosphere on the Moon)
    panelAreaM2: 1.15, // vertical array that turns to face the Sun's azimuth
    panelEff: 0.29, // triple-junction cells at 28 °C
    panelTempCoef: -0.003, // relative efficiency change per °C
    hotelW: 90, // avionics, always on (off when the rover is dormant)
    heaterW: 150, // survival heater, thermostat controlled
    reviveFrac: 0.05, // a dormant rover reboots when the battery is back at 5 %
  },
  thermal: {
    capacityJK: 6.0e4, // lumped heat capacity of the warm electronics box
    radiatorM2: 1.2,
    emissivity: 0.85,
    absorptivity: 0.25, // white-paint / foil average for sunlight
    sunAreaM2: 1.0, // area facing the grazing Sun
    sinkSunK: 220, // effective radiative environment in sunlight (lit polar ground + sky)
    sinkShadowK: 100, // in shadow (cold ground + 3 K sky)
    heaterOnC: -10,
    heaterOffC: 0,
    freezeC: -40, // electronics survival limit
    hotC: 60, // above this the drives stop to cool down
    startC: 20,
  },
  science: {
    scanWh: 20, // energy of one science scan (spectrometer + drill sample), rover stopped
    scanMB: 2, // data it produces
  },
  mission: {
    driveM: 100, // objective: first drive
    waypointRingM: 900, // the waypoint is the highest gentle point at this distance
    waypointRadiusM: 25,
    downlinkMB: 4,
    surviveH: 48,
  },
  lander: {
    // Small robotic lander (CLPS-class order of magnitude), declared game numbers.
    dryKg: 1200,
    fuelKg: 700,
    maxThrustN: 6500, // throttleable main engine; hover throttle ~0.47 when full
    ispS: 311,
    rcsAccel: 1.2, // m/s^2 lateral translation
    rcsKgPerS: 0.25,
    maxTouchVz: 2.0, // m/s
    maxTouchVh: 1.0, // m/s
    maxSlopeDeg: 8, // under the legs, from the real 10 m terrain
    start: { altitude: 900, vDown: -18, offsetEast: 140, offsetNorth: -90, vEast: -4, vNorth: 3 },
  },
  comms: {
    earthMarginDeg: 0.5, // same Earth-visible margin as the rest of the app
    downlinkMBps: 0.25, // MB per simulated second while the Earth is in view
  },
} as const;
