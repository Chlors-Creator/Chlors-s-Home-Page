export function bindPlayerMotion(root: HTMLElement, expand: HTMLButtonElement | null, lyrics: HTMLElement | null): () => void {
  if (!expand) return () => {};

  let playerAnimation: Animation | null = null;
  let componentAnimations: Animation[] = [];

  const setExpandLabel = (expanded: boolean) => {
    expand.setAttribute('aria-expanded', String(expanded));
    expand.setAttribute('aria-label', expanded ? '收起播放器' : '展开播放器');
    expand.title = expanded ? '收起播放器' : '展开播放器';
  };
  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animatedParts = () => [...root.querySelectorAll<HTMLElement>('[data-expand-player],.player-heading,.player-controls,.progress-control,.lyrics-panel')];
  const partRects = () => new Map(animatedParts().filter((part) => !part.hidden).map((part) => [part, part.getBoundingClientRect()]));
  const stopAnimations = () => {
    playerAnimation?.cancel();
    componentAnimations.forEach((animation) => animation.cancel());
    componentAnimations = [];
  };
  const animateParts = (from: Map<HTMLElement, DOMRect>, to: Map<HTMLElement, DOMRect>, reverse = false) => {
    componentAnimations = animatedParts().map((part, index) => {
      const first = from.get(part);
      const last = to.get(part);
      const deltaX = first && last ? first.left - last.left : 0;
      const deltaY = first && last ? first.top - last.top : 18;
      const startFrame = { transform: `translate(${deltaX}px,${deltaY}px)`, opacity: first ? .72 : 0 };
      const endFrame = { transform: 'translate(0,0)', opacity: 1 };
      return part.animate(reverse ? [endFrame, startFrame] : [startFrame, endFrame], {
        duration: 320,
        delay: index * 24,
        easing: 'cubic-bezier(.22,.8,.24,1)',
        fill: reverse ? 'forwards' : 'backwards',
      });
    });
  };

  const toggleExpanded = async () => {
    const expanded = root.dataset.expanded !== 'true';
    const start = root.getBoundingClientRect();
    stopAnimations();

    if (expanded) {
      const beforeParts = partRects();
      root.dataset.expanded = 'true';
      document.documentElement.classList.add('player-expanded');
      if (lyrics) lyrics.hidden = false;
      const end = root.getBoundingClientRect();
      const afterParts = partRects();
      const inset = `${Math.max(0, start.top - end.top)}px ${Math.max(0, end.right - start.right)}px ${Math.max(0, end.bottom - start.bottom)}px ${Math.max(0, start.left - end.left)}px`;
      if (!prefersReducedMotion()) {
        playerAnimation = root.animate([
          { clipPath: `inset(${inset} round 24px)`, opacity: .82 },
          { clipPath: 'inset(0 round var(--radius) 0 0 0)', opacity: 1 },
        ], { duration: 440, easing: 'cubic-bezier(.22,.8,.24,1)' });
        animateParts(beforeParts, afterParts);
      }
    } else {
      const beforeParts = partRects();
      const end = root.getBoundingClientRect();
      root.dataset.expanded = 'false';
      document.documentElement.classList.remove('player-expanded');
      const target = root.getBoundingClientRect();
      const afterParts = partRects();
      root.dataset.expanded = 'true';
      document.documentElement.classList.add('player-expanded');
      const inset = `${Math.max(0, target.top - end.top)}px ${Math.max(0, end.right - target.right)}px ${Math.max(0, end.bottom - target.bottom)}px ${Math.max(0, target.left - end.left)}px`;
      if (!prefersReducedMotion()) {
        playerAnimation = root.animate([
          { clipPath: 'inset(0 round var(--radius) 0 0 0)', opacity: 1 },
          { clipPath: `inset(${inset} round 24px)`, opacity: .82 },
        ], { duration: 420, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
        animateParts(afterParts, beforeParts, true);
        await Promise.all([
          playerAnimation.finished,
          ...componentAnimations.map((animation) => animation.finished),
        ].map((finished) => finished.catch(() => {})));
      }
      root.dataset.expanded = 'false';
      document.documentElement.classList.remove('player-expanded');
      if (lyrics) lyrics.hidden = true;
      stopAnimations();
    }
    setExpandLabel(expanded);
  };

  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && root.dataset.expanded === 'true') void toggleExpanded();
  };
  expand.addEventListener('click', toggleExpanded);
  document.addEventListener('keydown', onDocumentKeydown);

  return () => {
    expand.removeEventListener('click', toggleExpanded);
    document.removeEventListener('keydown', onDocumentKeydown);
    stopAnimations();
    document.documentElement.classList.remove('player-expanded');
  };
}
