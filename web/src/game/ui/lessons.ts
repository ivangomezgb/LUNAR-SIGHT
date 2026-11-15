import type { ObjectiveId } from '../sim/mission';

/** Objective title, how to do it, and the real science it teaches (English keys, translated by t()). */
export const LESSONS: Record<ObjectiveId, { title: string; how: string; lesson: string }> = {
  drive: {
    title: 'Take the wheel: drive {0} m',
    how: 'Hold W or ↑ (or the ▲ button). Steer with A/D or ←/→.',
    lesson: 'The real rover top speed is 0.2 m/s; time warp makes it look fast. Slopes over 15° stop it: the south pole is rough, cratered terrain.',
  },
  shadow: {
    title: 'Find a shadow',
    how: 'Switch to the Top camera (C) to spot dark ground and drive into it, or speed up time until a ridge hides the Sun. Watch the ☀ gauge.',
    lesson: 'Here the Sun skims the horizon, only a few degrees high, so a ridge a few metres tall can hide it. In shadow the panel gives nothing and the heater drains the battery.',
  },
  scan: {
    title: 'Stop and run a science scan (E)',
    how: 'Stop the rover, then press E or the Scan button.',
    lesson: 'Science costs energy and produces data. Polar rovers look for water ice in the cold soil near permanently shadowed craters.',
  },
  downlink: {
    title: 'Send {0} MB to Earth',
    how: 'Data leaves only while ⊕ says Connected. If not, speed up time with ] until the Earth rises, or climb to higher ground.',
    lesson: 'Without a relay satellite, data goes straight to Earth only while the Earth is above the real horizon. From the south pole the Earth stays low and often hides behind ridges.',
  },
  waypoint: {
    title: 'Reach the sunniest spot nearby',
    how: 'Press Guide me and follow the blue beacon. Switch the map to ☀ 2027 to see where the light lasts all year.',
    lesson: 'Over a year, rims and ridges can see the Sun most of the time while hollows a few hundred metres away stay dark. That is why Artemis candidate sites sit on crater rims and ridges.',
  },
  survive: {
    title: 'Keep the rover alive for {0} h',
    how: 'Park in sunlight and speed time up (3600× or 36000×). If the battery falls, drive back into the light.',
    lesson: 'Use time warp and park in sunlight. At the pole the Sun circles the sky once every 29.5 days instead of rising and setting each day.',
  },
};
