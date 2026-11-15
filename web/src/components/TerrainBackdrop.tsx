import { t } from '../i18n';

/** The published LOLA hillshade is context, not illumination at the selected hour. */
export default function TerrainBackdrop() {
  const asset = (name: string) => `${import.meta.env.BASE_URL}media/${name}`;
  return (
    <>
      <picture>
        <source media="(max-width: 720px)" type="image/webp" srcSet={asset('south-polar-hillshade-mobile.webp')} />
        <source media="(max-width: 720px)" srcSet={asset('south-polar-hillshade-mobile.jpg')} />
        <source type="image/webp" srcSet={asset('south-polar-hillshade.webp')} />
        <img className="terrain-backdrop" src={asset('south-polar-hillshade.jpg')} width={1920} height={1920} alt="" decoding="async" loading="lazy" />
      </picture>
      <p className="terrain-credit">{t('NASA LOLA · South polar hillshade · Context image, not selected-hour illumination')}</p>
    </>
  );
}
