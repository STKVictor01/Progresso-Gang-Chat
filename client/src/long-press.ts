export function createLongPress(delay = 550) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startX = 0, startY = 0, suppressClick = false;
  const cancel = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  return {
    start(x: number, y: number, action: () => void) {
      cancel(); suppressClick = false; startX = x; startY = y;
      timer = setTimeout(() => { timer = undefined; suppressClick = true; action(); }, delay);
    },
    move(x: number, y: number) { if (Math.hypot(x - startX, y - startY) > 10) cancel(); },
    cancel,
    contextMenu() { if (timer !== undefined) suppressClick = true; cancel(); },
    consumeClick() { const suppressed = suppressClick; suppressClick = false; return suppressed; },
  };
}
