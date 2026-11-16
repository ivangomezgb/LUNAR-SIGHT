// The guided route through the site: one stop per tab, in the order a newcomer should see them.
// Texts are English keys, translated by t(). Keep each one to a single short sentence.

import type { IconName } from '../components/Icon';

export interface Stop {
  path: string; // route, as in App.tsx
  icon: IconName;
  title: string;
  what: string; // what you do here
  tryIt: string; // one concrete first action
  why: { q: string; a: string }; // a real fact that explains what this tab shows
}

export const STOPS: Stop[] = [
  { path: '/', icon: 'compass', title: 'Explore', what: 'Pick a site and a landing hour: see the real horizon, the Sun and the Earth.', tryIt: 'Click a site on the map, then press ▶ on the panorama.', why: { q: 'Why does the Sun barely rise at the south pole?', a: 'The Moon\'s spin axis is tilted only about 1.5° from the plane of its path around the Sun, so near the pole the Sun always stays within a degree or two of the horizon and circles it once every ~29.5 days.' } },
  { path: '/3d', icon: 'mountain', title: '3D', what: 'Stand on the real terrain of a site, in 3D or in 360°.', tryIt: 'Drag to look around, then switch to First person.', why: { q: 'Why are the shadows so long and so black?', a: 'With the Sun 1.5° high, a rock 1 m tall casts a shadow about 38 m long, and with no air to scatter light there is no blue sky to brighten the shadows.' } },
  { path: '/mission', icon: 'rocket', title: 'Play mission', what: 'From orbit to the surface: land and drive a rover on the real data.', tryIt: 'Travel between the stations with the arrows, then press Land here.', why: { q: 'Why does the rover drive so slowly?', a: 'Polar rovers such as NASA’s VIPER design move at about 0.2 m/s to save power and to avoid hazards hidden in long, low-Sun shadows; the game speeds up time instead.' } },
  { path: '/compare', icon: 'scale', title: 'Compare', what: 'Up to three sites side by side, for the same landing date.', tryIt: 'Add a second site and see which one keeps the light longer.', why: { q: 'Why can two sites a few kilometres apart be so different?', a: 'Light depends on the horizon in every direction: a rim that sees over its neighbours keeps the Sun most of the time, while a hollow nearby can stay dark for days.' } },
  { path: '/replan', icon: 'timer', title: 'Mission delayed', what: 'If the launch slips, find the best new site and landing hour.', tryIt: 'Change the delay and watch the ranking update instantly.', why: { q: 'Why does a delay of a few days change the best site?', a: 'The Sun goes once around the horizon every ~29.5 days, so each site’s light and Earth windows move with the date: a site lit today can be in shadow next week.' } },
  { path: '/free', icon: 'pin', title: 'Any point', what: 'Check any spot of the south pole, computed in your browser.', tryIt: 'Click anywhere on the map.', why: { q: 'Why is this view only approximate?', a: 'Here your browser uses coarser elevation grids (240 m and 960 m) that miss nearby hills, so the horizon is off by 0.25° on average; the curated sites use 5–10 m grids.' } },
  { path: '/validation', icon: 'checkCircle', title: 'Validation', what: 'How we know the numbers are right, against NASA/JPL references.', tryIt: 'Look at the largest error against JPL Horizons.', why: { q: 'Why compare with JPL Horizons?', a: 'Horizons is NASA JPL’s independent service for the positions of solar system bodies; matching it within 0.00003° shows the Sun and Earth directions are right before any terrain is applied.' } },
  { path: '/about', icon: 'info', title: 'About', what: 'The data, the method and the sources behind every number.', tryIt: 'Skim the data sources.', why: { q: 'Why does the Earth matter for a landing site?', a: 'Without a relay satellite a lander can only talk to Earth while the Earth is above its real horizon; from the south pole the Earth sits low in the sky and ridges often hide it.' } },
  { path: '/team', icon: 'users', title: 'Team', what: 'Meet Apolo404, the team that built this.', tryIt: 'Say hi!', why: { q: 'Why is landing on the Moon so demanding?', a: 'Lunar gravity is about one sixth of Earth’s (1.62 m/s²), but there is no air to slow a lander: every metre per second of fall has to be removed by the engine.' } },
];

export const stopOf = (pathname: string): Stop | undefined => STOPS.find((s) => s.path === pathname) ?? (pathname === '' ? STOPS[0] : undefined);
