import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { t } from '../i18n';
import Icon from '../components/Icon';
import { CrewAvatar, MissionPatch } from '../components/CrewArt';
import { useScrollFx } from '../fx/useScrollFx';

const UPTC = 'Systems Engineering · UPTC Sogamoso';
const MEMBERS: Array<{ name: string; study: string }> = [
  { name: 'Brayan David López Castellanos', study: UPTC },
  { name: 'Ashly Andrea Osorio Márquez', study: UPTC },
  { name: 'Rafael Esteban Lozano Vargas', study: UPTC },
  { name: 'Juan Esteban Vargas González', study: UPTC },
  { name: 'Iván Leonardo Gómez', study: 'Software Analysis and Development Technologist · SENA' },
];

const initials = (name: string) => { const w = name.split(' '); return (w[0][0] + (w[2] ?? w[1])[0]).toUpperCase(); };
const asset = (file: string) => `${import.meta.env.BASE_URL}${file}`;

export default function Team() {
  const root = useRef<HTMLDivElement>(null);

  useScrollFx(root, (gsap) => {
    gsap.from('.team-hero .th-in', { y: 40, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.09 });
    gsap.from('.team-hero .patch', { scale: 0.6, rotate: -40, opacity: 0, duration: 1.4, ease: 'expo.out' });
    gsap.to('.team-hero .patch-rim', { rotate: 360, transformOrigin: '130px 130px', ease: 'none', scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom bottom', scrub: 1 } });
    // the photo opens like a hatch as it scrolls in
    gsap.fromTo('.team-photo-frame', { clipPath: 'inset(18% 22% 18% 22% round 28px)' }, { clipPath: 'inset(0% 0% 0% 0% round 18px)', ease: 'none', scrollTrigger: { trigger: '.team-photo-frame', start: 'top 85%', end: 'center 55%', scrub: 0.6 } });
    gsap.fromTo('.team-photo-frame img', { scale: 1.18 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.team-photo-frame', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.from('.crew-card', { y: 60, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12, scrollTrigger: { trigger: '.crew-grid', start: 'top 82%' } });
    // the trajectory from Sogamoso to the south pole draws itself with the scroll
    const path = document.querySelector<SVGPathElement>('.journey-path');
    if (path) {
      const len = path.getTotalLength();
      gsap.fromTo(path, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: '.journey', start: 'top 75%', end: 'bottom 60%', scrub: 0.6 } });
    }
    gsap.from('.team-quote', { y: 40, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '.team-quote', start: 'top 85%' } });
  });

  return (
    <div ref={root} className="page team-page story-page">
      <header className="team-hero">
        <div className="team-hero-copy">
          <p className="chapter-kicker th-in"><span>{t('Crew')}</span> {t('NASA Space Apps Challenge 2026')}</p>
          <h1 className="th-in">
            <picture>
              <source srcSet={asset('media/apolo404-logo-large.webp')} type="image/webp" />
              <img className="team-logo" src={asset('media/apolo404-logo.png')} width={510} height={224} alt="Apolo404" />
            </picture>
          </h1>
          <p className="lead th-in">{t('We are Systems Engineering students at UPTC (Universidad Pedagógica y Tecnológica de Colombia), Sogamoso campus, and we built this navigator for the NASA Space Apps Challenge.')}</p>
          <p className="team-motto th-in mono">{t('Apolo404 — limits not found.')}</p>
        </div>
        <div className="team-hero-patch"><MissionPatch /></div>
      </header>

      <figure className="team-photo">
        <div className="team-photo-frame">
          <picture>
            <source srcSet={asset('team-apolo404.webp')} type="image/webp" />
            <img src={asset('team-apolo404.jpg')} width={1600} height={901} loading="lazy" decoding="async" alt={t('Team Apolo404: the five members together')} />
          </picture>
        </div>
      </figure>

      <section className="crew" aria-labelledby="crew-title">
        <p className="chapter-kicker"><span>05</span> {t('The crew')}</p>
        <h2 id="crew-title">{t('Developed by:')}</h2>
        <ul className="crew-grid">
          {MEMBERS.map(({ name, study }, k) => (
            <li key={name} className="crew-card">
              <CrewAvatar initials={initials(name)} index={k} />
              <span className="crew-n mono">{t('Crew {0}', { 0: String(k + 1).padStart(2, '0') })}</span>
              <strong>{name}</strong>
              <span className="small muted">{t(study)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="journey" aria-labelledby="journey-title">
        <p className="chapter-kicker"><span>384 400 km</span> {t('Our trajectory')}</p>
        <h2 id="journey-title">{t('From Sogamoso to the lunar south pole')}</h2>
        <svg className="journey-art" viewBox="0 0 1000 300" role="img" aria-label={t('A trajectory from Sogamoso, Colombia, on Earth to the lunar south pole')}>
          <defs>
            <radialGradient id="j-earth" cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#6fb2ff" /><stop offset=".6" stopColor="#0a5cc4" /><stop offset="1" stopColor="#04224d" /></radialGradient>
            <radialGradient id="j-moon" cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#f2f4f8" /><stop offset="1" stopColor="#6f7787" /></radialGradient>
          </defs>
          <circle cx="150" cy="170" r="92" fill="url(#j-earth)" />
          <circle cx="150" cy="170" r="98" fill="none" stroke="#4a9bff" strokeOpacity=".35" strokeWidth="6" />
          <circle cx="128" cy="150" r="6" fill="#fff" className="journey-dot" />
          <text x="150" y="292" textAnchor="middle" className="journey-label">{t('Sogamoso, Colombia · 5.7° N')}</text>
          <circle cx="860" cy="150" r="62" fill="url(#j-moon)" />
          <circle cx="860" cy="210" r="5" fill="#0a7cff" stroke="#fff" strokeWidth="2" className="journey-dot" />
          <text x="860" y="292" textAnchor="middle" className="journey-label">{t('Lunar south pole · 83°–90° S')}</text>
          <path className="journey-path" d="M134,146 C300,-20 640,-10 780,80 S880,200 860,208" fill="none" stroke="#4a9bff" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <p className="muted">{t('The Moon is about 384 400 km away on average; the 17 sites in this navigator lie between 83° and 90° south.')}</p>
      </section>

      <blockquote className="team-quote">
        <p>{t('Every landing begins on Earth: with a question, real data and a team that refuses to stop asking. From Sogamoso to the lunar south pole.')}</p>
        <footer>{t('Apolo404 — limits not found.')}</footer>
      </blockquote>

      <div className="team-cta">
        <Link className="btn btn-primary" to="/mission"><Icon name="rocket" /> {t('Play mission')}</Link>
        <Link className="btn btn-ghost" to="/about"><Icon name="info" /> {t('How the project works')}</Link>
      </div>
    </div>
  );
}
