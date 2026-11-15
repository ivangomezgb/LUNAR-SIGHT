import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { t } from '../i18n';
import TerrainBackdrop from '../components/TerrainBackdrop';
import HorizonStory from '../components/HorizonStory';
import Icon, { type IconName } from '../components/Icon';
import CountUp from '../fx/CountUp';
import { headerOffset, useScrollFx } from '../fx/useScrollFx';
import { STOPS } from '../guide/stops';

// Every number on this page is from the project's own validation and data files
// (web/public/data/validation.json, README "Validation", docs/validation.md).
const MAX_EL_ERR = 2.682e-5, THRESHOLD = 0.05;

const FACTS: Array<{ value: string; unit?: string; label: string }> = [
  { value: '17', label: 'candidate landing sites at the south pole' },
  { value: '720', label: 'directions per horizon, one every 0.5°' },
  { value: '200', unit: 'km', label: 'of terrain read around each site' },
  { value: '19008', label: 'hourly Sun and Earth positions, Nov 2026 – Dec 2028' },
];

const STEPS: Array<{ icon: IconName; title: string; big: string; text: string }> = [
  { icon: 'mountain', title: 'Terrain', big: '5 m', text: 'LOLA elevation models from NASA GSFC PGDA: 5 or 10 m per pixel out to 7.5 km, 20 m out to 60 km and 240 m out to 200 km.' },
  { icon: 'scan', title: 'Horizon', big: '720', text: 'From 1, 2, 5 or 10 m above the ground we trace 720 rays with exact spherical geometry and keep the highest terrain angle in each direction.' },
  { icon: 'sun', title: 'Sky', big: 'DE440', text: 'NAIF SPICE with the JPL DE440 ephemeris gives the apparent Sun and Earth position every hour, turned into local azimuth and elevation.' },
  { icon: 'earth', title: 'Light and link', big: '0.267°', text: 'The Sun is a disk of radius 0.267°: we measure how much of it clears the horizon. The Earth counts as visible when its centre is at least 0.5° above it.' },
  { icon: 'rocket', title: 'Your browser', big: 'No backend', text: 'The site is static: metrics, the delayed-mission ranking, the 3D views and the mission game are computed in your browser from those files.' },
];

const PROOFS: Array<{ big: string; title: string; text: string }> = [
  { big: '0.000027°', title: 'Largest error vs JPL Horizons', text: 'Sun and Earth azimuth and elevation, 3 sites × 10 instants × 2 bodies, compared with the independent JPL Horizons service.' },
  { big: 'r = 0.984', title: 'Earth visibility vs published maps', text: 'Same definition as the LOLA long-term maps of Mazarico et al. (2011) at all 17 sites (Sun: r = 0.914, higher where our site sits on a best-lit peak).' },
  { big: '2.47°', title: 'The IM-2 Athena landing', text: 'On 6 March 2025 our model puts the Sun 2.47° high over a 0.83° horizon at the landing point: fully up, as the real lander saw it.' },
  { big: '≤ 0.2°', title: '360° views vs horizon masks', text: 'Every column of the immersive panorama agrees with the computed horizon within 0.2° at 16 of the 17 sites.' },
];

const SOURCES: Array<{ name: string; what: string; href: string }> = [
  { name: 'NASA GSFC PGDA', what: 'LOLA elevation models (products 81, 90, 78), polar illumination and shadow maps (69)', href: 'https://pgda.gsfc.nasa.gov/' },
  { name: 'NAIF SPICE', what: 'DE440 ephemeris and lunar orientation kernels', href: 'https://naif.jpl.nasa.gov/naif/' },
  { name: 'JPL Horizons', what: 'independent Sun and Earth positions used for validation', href: 'https://ssd.jpl.nasa.gov/horizons/' },
  { name: 'USGS ScienceBase', what: 'Artemis III navigation grids (McClernan 2024, doi:10.5066/P1MEQ6UK)', href: 'https://doi.org/10.5066/P1MEQ6UK' },
  { name: 'LROC', what: 'IM-2 Athena landing point and Quickmap context', href: 'https://quickmap.lroc.asu.edu/' },
  { name: 'NASA SVS CGI Moon Kit', what: 'global colour and relief textures of the 3D Moon (context only)', href: 'https://svs.gsfc.nasa.gov/4720' },
];

export default function About() {
  const root = useRef<HTMLDivElement>(null);

  useScrollFx(root, (gsap) => {
    gsap.from('.story-hero .sh-line', { yPercent: 110, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.08 });
    gsap.utils.toArray<HTMLElement>('.fx-up').forEach((el) => {
      gsap.from(el, { y: 48, opacity: 0, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } });
    });
    // How it works: on wide screens the section is tall and its content sticky; scrolling
    // through it slides the steps sideways (CSS sticky, no pin spacer to measure).
    const mm = gsap.matchMedia();
    mm.add('(min-width: 900px)', () => {
      const section = document.querySelector<HTMLElement>('.steps'), track = document.querySelector<HTMLElement>('.steps-track');
      if (!section || !track) return;
      section.classList.add('is-scrubbed');
      const distance = () => Math.max(0, track.scrollWidth - track.clientWidth);
      const size = () => { section.style.setProperty('--steps-dist', `${distance()}px`); section.style.setProperty('--steps-top', `${headerOffset()}px`); };
      size();
      const st = { trigger: section, start: () => `top ${headerOffset()}px`, end: 'bottom bottom', scrub: 0.7, invalidateOnRefresh: true, onRefreshInit: size };
      gsap.to(track, { x: () => -distance(), ease: 'none', scrollTrigger: st });
      gsap.to('.steps-progress i', { scaleX: 1, ease: 'none', scrollTrigger: { ...st, scrub: true } });
      return () => { section.classList.remove('is-scrubbed'); section.style.removeProperty('--steps-dist'); section.style.removeProperty('--steps-top'); };
    });
    gsap.from('.ruler-err', { scaleX: 0, duration: 1.4, ease: 'power2.out', scrollTrigger: { trigger: '.ruler', start: 'top 80%' } });
    gsap.from('.proof', { y: 40, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.1, scrollTrigger: { trigger: '.proofs', start: 'top 80%' } });
  });

  return (
    <div ref={root} className="page story-page">
      <header className="story-hero terrain-header">
        <TerrainBackdrop />
        <div className="story-hero-inner">
          <p className="chapter-kicker"><span>Apolo404</span> {t('NASA Space Apps Challenge 2026')}</p>
          <h1 className="story-title">
            <span className="sh-mask"><span className="sh-line">{t('Light and a line to Earth,')}</span></span>
            <span className="sh-mask"><span className="sh-line display-accent">{t('hour by hour.')}</span></span>
          </h1>
          <p className="lead sh-mask"><span className="sh-line">{t('Near the lunar south pole the Sun skims the horizon. A few metres of ridge decide whether a lander has power, and whether it can see Earth to talk home. This tool answers, hour by hour and for every candidate site:')} <em>{t('is the Sun up, and is Earth in view?')}</em></span></p>
          <ul className="fact-strip" aria-label={t('The project in numbers')}>
            {FACTS.map((f) => (
              <li key={f.label}><strong><CountUp value={f.value} />{f.unit && <small> {f.unit}</small>}</strong><span>{t(f.label)}</span></li>
            ))}
          </ul>
          <p className="scroll-cue" aria-hidden><i /> {t('Scroll')}</p>
        </div>
      </header>

      <HorizonStory />

      <section className="steps" aria-labelledby="steps-title">
        <div className="steps-sticky">
        <div className="steps-head">
          <p className="chapter-kicker"><span>02</span> {t('How it works')}</p>
          <h2 id="steps-title">{t('From NASA data to an answer in five steps')}</h2>
          <div className="steps-progress" aria-hidden><i /></div>
        </div>
        <ol className="steps-track">
          {STEPS.map((s, k) => (
            <li key={s.title} className="step">
              <span className="step-n mono">{String(k + 1).padStart(2, '0')}</span>
              <span className="step-icon"><Icon name={s.icon} size={28} /></span>
              <h3>{t(s.title)}</h3>
              <strong className="step-big">{t(s.big)}</strong>
              <p>{t(s.text)}</p>
            </li>
          ))}
        </ol>
        </div>
      </section>

      <section className="proofs-wrap" aria-labelledby="proof-title">
        <p className="chapter-kicker fx-up"><span>03</span> {t('How we know it is right')}</p>
        <h2 id="proof-title" className="fx-up">{t('Checked against independent references')}</h2>
        <div className="ruler fx-up" role="img" aria-label={t('Largest position error compared with the 0.05° threshold')}>
          <div className="ruler-bar"><span className="ruler-err" style={{ width: `${Math.max(0.6, (MAX_EL_ERR / THRESHOLD) * 100)}%` }} /></div>
          <div className="ruler-labels mono small">
            <span>{t('our largest error: {0}°', { 0: MAX_EL_ERR.toExponential(2) })}</span>
            <span>{t('threshold: {0}°', { 0: THRESHOLD })}</span>
          </div>
          <p className="small muted">{t('About {0} times smaller than the threshold (the red sliver is drawn wider than it really is so it can be seen).', { 0: Math.round(THRESHOLD / MAX_EL_ERR / 10) * 10 })}</p>
        </div>
        <ul className="proofs">
          {PROOFS.map((p) => (
            <li key={p.title} className="proof">
              <strong className="proof-big">{t(p.big)}</strong>
              <h3>{t(p.title)}</h3>
              <p>{t(p.text)}</p>
            </li>
          ))}
        </ul>
        <Link className="btn btn-ghost fx-up" to="/validation"><Icon name="checkCircle" /> {t('See every comparison')}</Link>
      </section>

      <section className="tour-map" aria-labelledby="tour-title">
        <p className="chapter-kicker fx-up"><span>04</span> {t('What you can do')}</p>
        <h2 id="tour-title" className="fx-up">{t('Nine stops, one landing')}</h2>
        <ol className="tour-grid">
          {STOPS.map((s, k) => (
            <li key={s.path} className="fx-up">
              <Link to={s.path} className="tour-card">
                <span className="tour-n mono">{String(k + 1).padStart(2, '0')}</span>
                <Icon name={s.icon} size={22} />
                <strong>{t(s.title)}</strong>
                <span>{t(s.what)}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="sources" aria-labelledby="sources-title">
        <p className="chapter-kicker fx-up"><span>05</span> {t('Sources')}</p>
        <h2 id="sources-title" className="fx-up">{t('Open NASA and JPL data, cited')}</h2>
        <ul className="source-grid">
          {SOURCES.map((s) => (
            <li key={s.name} className="fx-up">
              <a className="source-card" href={s.href} target="_blank" rel="noreferrer">
                <strong>{s.name}</strong>
                <span>{t(s.what)}</span>
                <Icon name="chevronRight" size={16} />
              </a>
            </li>
          ))}
        </ul>
        <p className="small muted fx-up">{t('Illumination literature: Bussey et al. (2010) and Mazarico et al. (2011) in Icarus; LOLA site models and error clones: Barker et al. (2021). Every site’s source is listed in the project repository.')}</p>
      </section>

      <section className="honest" aria-labelledby="honest-title">
        <p className="chapter-kicker fx-up"><span>06</span> {t('Honest notes')}</p>
        <h2 id="honest-title" className="fx-up">{t('What it does not do, and how it was built')}</h2>
        <div className="honest-grid">
          <div className="honest-card fx-up">
            <h3><Icon name="info" /> {t('Limitations')}</h3>
            <ul className="bullets">
              <li>{t('Hourly resolution; DEM resolution limits nearby horizon detail.')}</li>
              <li>{t('No line of sight to relay satellites: the Earth link is direct only.')}</li>
              <li>{t('Thresholds (day ≥ 50% disk, Earth ≥ 0.5°) are our assumptions, not NASA requirements.')}</li>
              <li>{t('The mission game adds declared assumptions (rover, battery, heater, lander); the site metrics do not use them.')}</li>
            </ul>
          </div>
          <div className="honest-card fx-up">
            <h3><Icon name="users" /> {t('Use of AI')}</h3>
            <p>{t('This project was built with AI coding agents:')} <b>{t('Claude Code')}</b> {t('(Anthropic) and')} <b>{t('OpenAI Codex')}</b> {t('worked in parallel on the data pipeline, the metrics engine and this interface, under human direction and review. All numbers come from the public NASA / JPL data above — no value is generated by an AI model, and no fake data is published.')}</p>
            <p className="small muted">{t('Code: MIT License. NASA data is public domain; cite the original data products.')}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
