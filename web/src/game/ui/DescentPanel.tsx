import { t } from '../../i18n';
import { type Field, slopeDeg } from '../sim/field';
import { altitude, type LanderState, stoppingHeight } from '../sim/lander';
import { RULES } from '../sim/rules';
import Icon from '../../components/Icon';

interface Props {
  field: Field;
  lander: LanderState;
  target: { x: number; y: number };
  /** Visible solar fraction at the ground below the lander (real horizon model). */
  sunBelow: number;
}

/** Descent instruments: what a real lander pilot watches, with the touchdown limits in view. */
export default function DescentPanel({ field, lander, target, sunBelow }: Props) {
  const L = RULES.lander;
  const alt = Math.max(0, altitude(field, lander));
  const vh = Math.hypot(lander.vx, lander.vy);
  const slope = slopeDeg(field, lander.x, lander.y);
  const fuel = lander.fuelKg / L.fuelKg;
  const dist = Math.hypot(lander.x - target.x, lander.y - target.y);
  const low = alt < 120;
  const stop = stoppingHeight(lander);
  const brakeNow = alt > 3 && stop > alt * 0.7;
  const bearing = (Math.atan2(target.x - lander.x, target.y - lander.y) * 180) / Math.PI; // camera looks north
  const vzBad = -lander.vz > L.maxTouchVz, vhBad = vh > L.maxTouchVh, slopeBad = !(slope <= L.maxSlopeDeg);
  return (
    <div className="descent" aria-live="off">
      <div className="descent-grid mono">
        <div><span className="hud-label">{t('Altitude')}</span><strong>{alt.toFixed(alt < 100 ? 1 : 0)} m</strong></div>
        <div className={low && vzBad ? 'is-bad' : ''}><span className="hud-label">{t('Vertical speed')}</span><strong>{lander.vz.toFixed(1)} m/s</strong><em>{t('touch < {0}', { 0: L.maxTouchVz })}</em></div>
        <div className={low && vhBad ? 'is-bad' : ''}><span className="hud-label">{t('Drift')}</span><strong>{vh.toFixed(1)} m/s</strong><em>{t('touch < {0}', { 0: L.maxTouchVh })}</em></div>
        <div className={fuel < 0.15 ? 'is-bad' : ''}><span className="hud-label">{t('Fuel')}</span><strong>{(fuel * 100).toFixed(0)}%</strong><meter min={0} max={1} low={0.15} optimum={1} value={fuel} aria-label={t('Fuel')} /></div>
        <div className={slopeBad ? 'is-bad' : ''}><span className="hud-label">{t('Slope below')}</span><strong>{Number.isFinite(slope) ? slope.toFixed(1) : '—'}°</strong><em>{t('legs < {0}°', { 0: L.maxSlopeDeg })}</em></div>
        <div className={sunBelow > 0.5 ? 'is-good' : 'is-warn'}><span className="hud-label"><Icon name="sun" size={13} /> {t('Ground below')}</span><strong>{sunBelow > 0.5 ? t('Sunlit') : t('In shadow')}</strong></div>
        <div><span className="hud-label">{t('To target')}</span><strong><span className="descent-arrow" style={{ transform: `rotate(${bearing}deg)` }} aria-hidden>↑</span> {dist.toFixed(0)} m</strong></div>
      </div>
      {brakeNow && <p className="descent-brake" role="alert">{t('Fire the engine now! You need {0} m to stop', { 0: Math.round(stop) })}</p>}
      <p className="descent-help ctl-keys">{t('Hold SPACE to fire the engine · arrows / WASD slide sideways · land slowly, without drift, on flat sunlit ground')}</p>
      <p className="descent-help ctl-touch">{t('Hold THRUST to fire the engine · arrow pad slides sideways')}</p>
    </div>
  );
}
