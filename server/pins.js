// Mensagens fixadas: guarda só referências (id da mensagem, quem fixou e quando) num arquivo pequeno
// em server/data, sem tabela nova no banco. O texto continua vindo da própria mensagem.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const MAX_PINS_PER_CHANNEL = 50;
const CHANNEL = /^[\w:-]{1,80}$/;
const USER = /^[\w-]{1,80}$/;

function sanitize(channels) {
  const clean = {};
  if (!channels || typeof channels !== 'object') return clean;
  for (const [channel, pins] of Object.entries(channels)) {
    if (!CHANNEL.test(channel) || !Array.isArray(pins)) continue;
    const seen = new Set();
    const valid = pins.filter(pin => pin && Number.isSafeInteger(pin.id) && pin.id > 0 && typeof pin.pinnedBy === 'string' && USER.test(pin.pinnedBy) && Number.isSafeInteger(pin.pinnedAt) && !seen.has(pin.id) && seen.add(pin.id))
      .slice(-MAX_PINS_PER_CHANNEL).map(({id, pinnedBy, pinnedAt}) => ({id, pinnedBy, pinnedAt}));
    if (valid.length) clean[channel] = valid;
  }
  return clean;
}

export function createPinStore(file) {
  let channels = {};
  if (file) {
    try { channels = sanitize(JSON.parse(readFileSync(file, 'utf8')).channels); }
    catch (error) { if (error.code !== 'ENOENT') channels = {}; }
  }
  // Grava num arquivo temporário e troca de uma vez: uma queda no meio não corrompe o arquivo.
  function save() {
    if (!file) return;
    mkdirSync(dirname(file), {recursive:true});
    const temporary = file + '.tmp';
    writeFileSync(temporary, JSON.stringify({version:1, channels}), {mode:0o600});
    renameSync(temporary, file);
  }
  function write(channel, pins) {
    if (pins.length) channels[channel] = pins; else delete channels[channel];
    save();
  }
  return {
    // Mais recentes primeiro.
    list(channel) { return [...(channels[channel] ?? [])].reverse(); },
    find(id) {
      for (const [channel, pins] of Object.entries(channels)) { const pin = pins.find(item => item.id === id); if (pin) return {channel, ...pin}; }
      return null;
    },
    add(channel, id, pinnedBy, pinnedAt = Date.now()) {
      const pins = channels[channel] ?? [];
      if (pins.some(pin => pin.id === id)) return 'exists';
      if (pins.length >= MAX_PINS_PER_CHANNEL) return 'full';
      write(channel, [...pins, {id, pinnedBy, pinnedAt}]);
      return 'added';
    },
    remove(id) {
      let removed = false;
      for (const [channel, pins] of Object.entries(channels)) {
        const next = pins.filter(pin => pin.id !== id);
        if (next.length !== pins.length) { removed = true; write(channel, next); }
      }
      return removed;
    },
    // Remove referências a mensagens que não existem mais (excluídas ou de canal apagado).
    keepOnly(channel, ids) {
      const pins = channels[channel] ?? [];
      const next = pins.filter(pin => ids.has(pin.id));
      if (next.length !== pins.length) write(channel, next);
    },
  };
}
