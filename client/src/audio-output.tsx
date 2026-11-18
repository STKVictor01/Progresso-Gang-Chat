import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { Room, RoomEvent, supportsAudioOutputSelection } from 'livekit-client';
import { outputDeviceRemoved } from './call-settings';

// O LiveKit troca a saída das faixas remotas; sons locais usam o dispositivo do sistema.
// No iPhone (Safari e Chrome usam o WebKit) não há escolha de saída: o controle fica oculto e o sistema decide.
const touchOnly = typeof window !== 'undefined' && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
export function AudioOutputControl({icon,onUnsupported}:{icon:ReactNode;onUnsupported:()=>void}) {
  if (!supportsAudioOutputSelection()) return touchOnly ? null : <button className="button output-toggle" type="button" aria-disabled="true" title="Saída escolhida pelo sistema" aria-label="Escolha de saída indisponível neste navegador" onClick={onUnsupported}>{icon}</button>;
  return <AvailableOutput icon={icon}/>;
}

function AvailableOutput({icon}:{icon:ReactNode}) {
  const room=useRoomContext();
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const [devices,setDevices]=useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId,setActiveDeviceId]=useState(()=>room.getActiveDevice('audiooutput') || 'default');
  const seen=useRef(new Set<string>());
  const changing=useRef(false);
  const change=useCallback(async (id:string,automatic=false)=>{
    if(changing.current)return;
    changing.current=true;setBusy(true);setStatus(automatic?'Saída desconectada. Voltando ao padrão…':'Alterando saída de áudio…');
    try {
      const success=await room.switchActiveDevice('audiooutput',id);
      if(!success)throw new Error('Falha ao trocar saída');
      setStatus(automatic?'Saída desconectada. Usando o padrão do sistema.':'Saída de áudio alterada.');
    } catch {
      setStatus('Não foi possível alterar a saída. Confira as configurações de som do sistema.');
    } finally {changing.current=false;setBusy(false);}
  },[room]);
  useEffect(()=>{
    let alive=true;
    const refresh=(deviceChange=false)=>{
      void Room.getLocalDevices('audiooutput',false).then(current=>{
        if(!alive)return;
        setDevices(current);
        const selected=room.getActiveDevice('audiooutput');
        if(deviceChange && outputDeviceRemoved(selected,seen.current,current)){
          seen.current.delete(selected!);
          void change('default',true);
        }
        for(const device of current)if(device.deviceId)seen.current.add(device.deviceId);
      }).catch(()=>{if(alive)setStatus('Não foi possível listar as saídas de áudio.');});
    };
    const deviceChange=()=>refresh(true);
    const activeChange=(kind:MediaDeviceKind,id:string)=>{if(kind==='audiooutput')setActiveDeviceId(id || 'default');};
    room.on(RoomEvent.ActiveDeviceChanged,activeChange);
    navigator.mediaDevices?.addEventListener('devicechange',deviceChange);
    refresh();
    return ()=>{alive=false;room.off(RoomEvent.ActiveDeviceChanged,activeChange);navigator.mediaDevices?.removeEventListener('devicechange',deviceChange);};
  },[room,change]);
  const choices=devices.filter(device=>device.deviceId && device.deviceId!=='default');
  return <div className="output-control">
    <label className="output-select" title="Escolher saída de áudio">{icon}<span className="sr-only">Escolher saída de áudio</span><select value={activeDeviceId || 'default'} disabled={busy} onChange={event=>void change(event.target.value)} aria-describedby="audio-output-status"><option value="default">Padrão do sistema</option>{activeDeviceId && activeDeviceId!=='default' && !choices.some(device=>device.deviceId===activeDeviceId) && <option value={activeDeviceId}>Saída selecionada (verificando…)</option>}{choices.map((device,index)=><option key={device.deviceId} value={device.deviceId}>{device.label || 'Saída de áudio '+(index+1)}</option>)}</select></label>
    <span id="audio-output-status" className="output-status" role="status">{status}</span>
  </div>;
}
