// The guided route through the site: one stop per tab, in the order a newcomer should see them.
// Texts are English keys, translated by t(). Keep each one to a single short sentence.

import type { IconName } from '../components/Icon';

export interface Stop {
  path: string; // route, as in App.tsx
  icon: IconName;
  title: string;
  what: string; // what you do here
  tryIt: string; // one concrete first action
}

export const STOPS: Stop[] = [
  { path: '/', icon: 'compass', title: 'Explore', what: 'Pick a site and a landing hour: see the real horizon, the Sun and the Earth.', tryIt: 'Click a site on the map, then press ▶ on the panorama.' },
  { path: '/3d', icon: 'mountain', title: '3D', what: 'Stand on the real terrain of a site, in 3D or in 360°.', tryIt: 'Drag to look around, then switch to First person.' },
  { path: '/mission', icon: 'rocket', title: 'Play mission', what: 'From orbit to the surface: land and drive a rover on the real data.', tryIt: 'Zoom into the south pole, choose a site and press Descend.' },
  { path: '/compare', icon: 'scale', title: 'Compare', what: 'Up to three sites side by side, for the same landing date.', tryIt: 'Add a second site and see which one keeps the light longer.' },
  { path: '/replan', icon: 'timer', title: 'Mission delayed', what: 'If the launch slips, find the best new site and landing hour.', tryIt: 'Change the delay and watch the ranking update instantly.' },
  { path: '/free', icon: 'pin', title: 'Any point', what: 'Check any spot of the south pole, computed in your browser.', tryIt: 'Click anywhere on the map.' },
  { path: '/validation', icon: 'checkCircle', title: 'Validation', what: 'How we know the numbers are right, against NASA/JPL references.', tryIt: 'Look at the largest error against JPL Horizons.' },
  { path: '/about', icon: 'info', title: 'About', what: 'The data, the method and the sources behind every number.', tryIt: 'Skim the data sources.' },
  { path: '/team', icon: 'users', title: 'Team', what: 'Meet Apolo404, the team that built this.', tryIt: 'Say hi!' },
];

export const stopOf = (pathname: string): Stop | undefined => STOPS.find((s) => s.path === pathname) ?? (pathname === '' ? STOPS[0] : undefined);
