import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { Room, RoomEvent, supportsAudioOutputSelection } from 'livekit-client';
import { outputDeviceRemoved } from './call-settings';
import { MenuButton } from './menu';

// O LiveKit troca a saída das faixas remotas; sons locais usam o dispositivo do sistema.
export function AudioOutputControl({icon,onUnsupported}:{icon:ReactNode;onUnsupported:()=>void}) {
  if (!supportsAudioOutputSelection()) return <button className="button output-toggle" type="button" aria-disabled="true" title="Saída escolhida pelo sistema" aria-label="Escolha de saída indisponível neste navegador" onClick={onUnsupported}>{icon}</button>;
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
    <MenuButton label="Escolher saída de áudio" className="button output-toggle output-menu-trigger" items={[
      {key:'default',label:(activeDeviceId==='default'?'✓ ':'')+'Padrão do sistema',disabled:busy,onSelect:()=>void change('default')},
      ...(activeDeviceId && activeDeviceId!=='default' && !choices.some(device=>device.deviceId===activeDeviceId) ? [{key:activeDeviceId,label:'✓ Saída selecionada (verificando…)',disabled:true,onSelect:()=>{}}] : []),
      ...choices.map((device,index)=>({key:device.deviceId,label:(activeDeviceId===device.deviceId?'✓ ':'')+(device.label || 'Saída de áudio '+(index+1)),disabled:busy,onSelect:()=>void change(device.deviceId)}))
    ]}>{icon}</MenuButton>
    <span id="audio-output-status" className="output-status" role="status">{status}</span>
  </div>;
}
