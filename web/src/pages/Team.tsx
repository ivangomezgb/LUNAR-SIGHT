import { t } from '../i18n';

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
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('NASA Space Apps Challenge 2026')}</div>
          <h1 className="team-name">Apolo404</h1>
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
    </div>
  );
}
