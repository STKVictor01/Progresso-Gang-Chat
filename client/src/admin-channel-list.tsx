import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Channel } from './accounts';
import { MenuButton } from './menu';

type Kind = Channel['kind'];
const names = { text: 'Conversa', voice: 'Canais de voz' };

function moved<T>(items: T[], from: number, to: number) {
  const result = items.slice();
  result.splice(to, 0, ...result.splice(from, 1));
  return result;
}

function SortableList({ sections = false, busy, onMove, children, label }: {
  sections?: boolean; busy: boolean; onMove: (from: number, to: number) => void; children: ReactNode; label: string;
}) {
  const list = useRef<HTMLOListElement>(null);
  const move = useEffectEvent(onMove);
  useEffect(() => {
    if (busy || !list.current) return;
    const element = list.current;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void import('sortablejs').then(({ default: Sortable }) => {
      if (cancelled) return;
      const sortable = Sortable.create(element, {
        handle: sections ? '.section-grip' : '.channel-grip',
        draggable: '>li',
        forceFallback: true,
        fallbackTolerance: 5,
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140,
        ghostClass: 'channel-drop-target',
        onEnd({ from, item, oldIndex, newIndex }) {
          if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
          // React owns the list. Restore its DOM order before committing the move.
          item.remove();
          from.insertBefore(item, from.children[oldIndex] ?? null);
          move(oldIndex, newIndex);
        },
      });
      dispose = () => sortable.destroy();
    }).catch(() => { /* The position menu stays available if the drag module cannot load. */ });
    return () => { cancelled = true; dispose?.(); };
  }, [busy, sections]);
  return <ol aria-label={label} ref={list}>{children}</ol>;
}

function Grip({ label, sections, options, index, onMove }: {
  label: string; sections?: boolean; options: string[]; index: number; onMove: (to: number) => void;
}) {
  return <MenuButton menuClassName="order-positions" label={'Mover ' + label} className={'order-grip ' + (sections ? 'section-grip' : 'channel-grip')}
    items={options.map((name, to) => ({
      key: String(to), label: 'Posição ' + (to + 1) + ' · ' + name, disabled: to === index, onSelect: () => onMove(to),
    }))}>
    <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
      <path d="M4 3h3v3H4zm5 0h3v3H9zM4 8h3v3H4zm5 0h3v3H9zM4 13h3v3H4zm5 0h3v3H9z"/>
    </svg>
  </MenuButton>;
}

export function AdminChannelList({ text, voice, busy, onEdit, onCreate, onSave }: {
  text: Channel[]; voice: Channel[]; busy: boolean; onEdit: (channel: Channel) => void; onCreate: (kind: Kind) => void;
  onSave: (channels: Channel[]) => void;
}) {
  const sections: Kind[] = (voice[0]?.position ?? Infinity) < (text[0]?.position ?? Infinity) ? ['voice', 'text'] : ['text', 'voice'];
  const lists = { text, voice };
  const [filter, setFilter] = useState('');
  const matching = (channel: Channel) => channel.name.toLocaleLowerCase('pt-BR').includes(filter.trim().toLocaleLowerCase('pt-BR'));
  const filtering = Boolean(filter.trim());
  function moveChannel(kind: Kind, from: number, to: number) {
    onSave(sections.flatMap(section => section === kind ? moved(lists[section], from, to) : lists[section]));
  }
  const moveSection = (from: number, to: number) => onSave(moved(sections, from, to).flatMap(kind => lists[kind]));
  return <section className="admin-channels" aria-label="Gerenciar canais">
    <p>Arraste pela alça para reordenar ou toque nela para escolher a posição. Selecione o nome para editar.</p>
    {text.length + voice.length > 8 && <label>Buscar canal<input type="search" value={filter} onChange={event => setFilter(event.target.value)}/></label>}
    <fieldset disabled={busy}>
      <SortableList label="Seções de canais" sections busy={busy || filtering} onMove={moveSection}>
        {sections.map((kind, groupIndex) => <li key={kind} className="channel-group">
          <div className="admin-group-heading">
            {!filtering && text.length > 0 && voice.length > 0 && <Grip sections label={names[kind]} options={sections.map(key => names[key])} index={groupIndex} onMove={to => moveSection(groupIndex, to)}/>}
            <h3>{names[kind]}</h3>
            <button type="button" className="group-add" aria-label={'Criar canal de ' + (kind === 'text' ? 'texto' : 'voz')} onClick={() => onCreate(kind)}>+ Criar</button>
          </div>
          <SortableList label={names[kind]} busy={busy || filtering} onMove={(from, to) => moveChannel(kind, from, to)}>
            {lists[kind].filter(matching).map((channel, index) => <li key={channel.id} className="admin-channel-row">
              {!filtering && lists[kind].length > 1 && <Grip label={channel.name} options={lists[kind].map(item => item.name)} index={index} onMove={to => moveChannel(kind, index, to)}/>}
              <button type="button" className="channel-edit" aria-label={'Editar ' + channel.name} onClick={() => onEdit(channel)}>
                <span className="channel-kind" aria-hidden="true">{kind === 'text' ? '#' : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 9h4l5-4v14l-5-4H4zM16 8q4 4 0 8m3-11q7 7 0 14"/></svg>}</span>
                <span>{channel.name}</span><span className="edit-chevron" aria-hidden="true">›</span>
              </button>
            </li>)}
          </SortableList>
          {!lists[kind].some(matching) && <p>{filtering ? 'Nenhum canal encontrado.' : 'Nenhum canal nesta seção.'}</p>}
        </li>)}
      </SortableList>
    </fieldset>
  </section>;
}
