// Game rules: every number here is a declared GAME ASSUMPTION (rounded, VIPER-like where a
// public order of magnitude exists), not mission data. Shown in the "Game rules" panel and
// listed in docs/assumptions.md. Physics of the environment (terrain, Sun, Earth, gravity) is real.

export const RULES = {
  gravity: 1.62, // m/s^2, real lunar surface gravity
  rover: {
    maxSpeed: 0.2, // m/s, VIPER-class top speed (time warp makes it feel faster)
    accel: 0.05, // m/s^2
    turnRate: 12, // deg/s at full steer
    maxClimbDeg: 15, // steepest grade it can drive up
    tipDeg: 25, // cross slope that tips it over
    eyeH: 2, // m, panel/antenna height used for Sun and Earth visibility
    edgeMarginM: 60, // keep this far inside the 10 m terrain grid
  },
  power: {
    batteryWh: 2000,
    panelW: 450, // vertical panel that tracks the Sun azimuth; output ∝ visible solar disk
    hotelW: 90, // avionics, always on
    driveW: 200, // extra while moving
    heaterW: 150, // extra survival heating while in shadow
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
