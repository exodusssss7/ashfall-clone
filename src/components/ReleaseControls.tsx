import { useState } from 'react';

export function ReleaseControls() {
  const [notice, setNotice] = useState('');
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setNotice('');
    } catch { setNotice('Fullscreen unavailable here. Try your browser fullscreen key.'); }
  };
  return <aside style={{position:'fixed',right:12,top:8,zIndex:1000,font:'12px monospace',color:'#e6e2d8',textAlign:'right'}}>
    <div style={{background:'#141b1de8',padding:'6px 9px',border:'1px solid #665f4a'}}>TEST RELEASE v1.9.10</div>
    <button onClick={fullscreen} style={{background:'#d9c997',color:'#151b1d',padding:'7px 10px',marginTop:4,cursor:'pointer'}}>Fullscreen</button>{' '}
    <a href={`${import.meta.env.BASE_URL}audio/CREDITS.txt`} target="_blank" rel="noreferrer" style={{color:'#e6e2d8',background:'#141b1de8',padding:7}}>Audio credits</a>
    {notice && <div role="status" style={{maxWidth:260,background:'#141b1d',padding:6}}>{notice}</div>}
  </aside>;
}
