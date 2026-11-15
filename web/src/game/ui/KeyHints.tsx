import { t } from '../../i18n';
import Icon from '../../components/Icon';

const Key = ({ k, wide = false }: { k: string; wide?: boolean }) => <kbd className={`keycap${wide ? ' is-wide' : ''}`}>{k}</kbd>;

/** On-screen keyboard legend for the current phase (hidden on touch screens, which show the pad). */
export default function KeyHints({ phase, onClose }: { phase: 'descent' | 'surface'; onClose: () => void }) {
  return (
    <div className="key-hints ctl-keys" role="note" aria-label={t('Keyboard controls')}>
      <button type="button" className="key-hints-x" onClick={onClose} aria-label={t('Hide the controls')}><Icon name="close" size={14} /></button>
      {phase === 'descent' ? (
        <>
          <div className="kh-group"><Key k={t('SPACE')} wide /><span>{t('Hold: main engine (brake the fall)')}</span></div>
          <div className="kh-group">
            <div className="kh-pad"><span /><Key k="↑" /><span /><Key k="←" /><Key k="↓" /><Key k="→" /></div>
            <span>{t('Slide sideways (or W A S D)')}</span>
          </div>
        </>
      ) : (
        <>
          <div className="kh-group">
            <div className="kh-pad"><span /><Key k="W" /><span /><Key k="A" /><Key k="S" /><Key k="D" /></div>
            <span>{t('Drive (or the arrow keys)')}</span>
          </div>
          <div className="kh-group"><Key k="E" /><span>{t('Science scan (stopped)')}</span></div>
          <div className="kh-group"><Key k="−" /><Key k="+" /><span>{t('Slower / faster time')}</span></div>
          <div className="kh-group"><Key k="C" /><span>{t('Camera')}</span></div>
          <div className="kh-group"><Key k="P" /><span>{t('Pause')}</span></div>
          <div className="kh-group"><span className="kh-mouse"><Icon name="mouse" size={18} /></span><span>{t('Drag to look · wheel to zoom')}</span></div>
        </>
      )}
    </div>
  );
}
