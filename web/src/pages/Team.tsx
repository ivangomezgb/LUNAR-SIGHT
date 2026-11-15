import { t } from '../i18n';
import TerrainBackdrop from '../components/TerrainBackdrop';

const MEMBERS = [
  'Brayan David López Castellanos',
  'Ashly Andrea Osorio Márquez',
  'Rafael Esteban Lozano Vargas',
  'Juan Esteban Vargas González',
  'Iván Leonardo Gómez',
];

const asset = (file: string) => `${import.meta.env.BASE_URL}${file}`;

export default function Team() {
  return (
    <div className="page prose-page team-page">
      <header className="page-head terrain-header">
        <TerrainBackdrop />
        <div>
          <div className="eyebrow">{t('NASA Space Apps Challenge 2026')}</div>
          <h1 className="team-name">Apolo404</h1>
          <p className="lead">{t('We are Systems Engineering students at UPTC (Universidad Pedagógica y Tecnológica de Colombia), Sogamoso campus, and we built this navigator for the NASA Space Apps Challenge.')}</p>
          <p className="lead">{t('Developed by:')}</p>
        </div>
      </header>

      <figure className="card team-photo">
        <picture>
          <source srcSet={asset('team-apolo404.webp')} type="image/webp" />
          <img src={asset('team-apolo404.jpg')} width={1600} height={901} loading="lazy" decoding="async"
            alt={t('Team Apolo404: the five members together')} />
        </picture>
      </figure>

      <section className="card team-members" aria-labelledby="team-members-title">
        <h2 id="team-members-title" className="card-title">{t('We are:')}</h2>
        <ul>
          {MEMBERS.map((name) => <li key={name}>{name}</li>)}
        </ul>
      </section>

      <blockquote className="team-quote">
        <p>{t('Every landing begins on Earth: with a question, real data and a team that refuses to stop asking. From Sogamoso to the lunar south pole.')}</p>
        <footer>{t('Apolo404 — limits not found.')}</footer>
      </blockquote>
    </div>
  );
}
