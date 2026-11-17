import { useEffect, useState } from 'react';
import bust from './assets/lula-busto.webp';

// O cartaz do login só existe no computador; o celular mantém a tela anterior.
const POSTER_QUERY = '(min-width: 901px)';
// eslint-disable-next-line react-refresh/only-export-components
export function usePosterLogin() {
  const [matches,setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(POSTER_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(POSTER_QUERY);
    const changed = () => setMatches(media.matches);
    media.addEventListener('change',changed);
    return () => media.removeEventListener('change',changed);
  }, []);
  return matches;
}

// Letras geométricas numa grade 60×100: hastes de 18 e cantos chanfrados a 45°.
const GLYPHS: Record<string,string> = {
  P: 'M0 0H48L60 12V48L48 60H18V100H0Z M18 16H42V44H18Z',
  R: 'M0 0H48L60 12V44L52 52L60 60V100H42V66L36 60H18V100H0Z M18 16H42V44H18Z',
  O: 'M12 0H48L60 12V88L48 100H12L0 88V12Z M18 18H42V82H18Z',
  G: 'M12 0H48L60 12V30H42V18H18V82H42V64H32V48H60V88L48 100H12L0 88V12Z',
  E: 'M0 0H60V18H18V41H50V59H18V82H60V100H0Z',
  S: 'M12 0H60V18H18V41H48L60 53V88L48 100H0V82H42V59H12L0 47V12Z',
  A: 'M12 0H48L60 12V100H42V64H18V100H0V12Z M18 18H42V46H18Z',
  N: 'M0 0H18L42 50V0H60V100H42L18 50V100H0Z',
};
const ADVANCE = 72;
function Letters({text}:{text:string}) {
  return <>{[...text].map((letter,index) => <path key={index} d={GLYPHS[letter]} transform={`translate(${index * ADVANCE} 0)`}/>)}</>;
}
function Lettering({text,className,shadow}:{text:string;className:string;shadow:boolean}) {
  const width = text.length * ADVANCE - 12;
  return <svg className={className} viewBox={`-6 -6 ${width + 20} 120`} fillRule="evenodd" aria-hidden="true" focusable="false">
    {shadow && <g className="poster-letters-shadow" transform="translate(7 7)"><Letters text={text}/></g>}
    <g className="poster-letters"><Letters text={text}/></g>
  </svg>;
}

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Capa construtivista: sol, cunha, barras, ilustração, letreiro, faixa e grão.
export function PosterCover() {
  // A ilustração só é baixada quando a capa aparece (computador).
  const visible = usePosterLogin();
  return <div className="poster-cover">
    <span className="poster-sunburst" aria-hidden="true"/>
    <span className="poster-wedge-shadow" aria-hidden="true"/>
    <span className="poster-wedge" aria-hidden="true"/>
    <span className="poster-bar" aria-hidden="true"/>
    <span className="poster-bar-gold" aria-hidden="true"/>
    {visible && <img className="poster-bust" src={bust} alt="" width={1024} height={849} decoding="async"/>}
    <p className="poster-seal" aria-hidden="true"><b>Nº 01</b><span>Célula digital · Desde 2026</span></p>
    <p className="poster-vertical" aria-hidden="true">ПРОГРЕСС ★ 2026</p>
    <h2 className="poster-title" aria-label="Progresso Gang">
      <Lettering text="PROGRESSO" className="poster-title-main" shadow/>
      <span className="poster-title-block"><Lettering text="GANG" className="poster-title-sub" shadow={false}/></span>
    </h2>
    <p className="poster-ribbon"><span aria-hidden="true">★</span> Jamais poderão deter <em>a chegada da primavera</em></p>
    <span className="poster-grain" aria-hidden="true" style={{backgroundImage:GRAIN}}/>
  </div>;
}
