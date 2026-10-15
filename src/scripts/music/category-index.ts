const cleanups = new WeakMap<HTMLElement, () => void>();

function initialize(root: HTMLElement): void {
  if (cleanups.has(root)) return;

  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-category-button]')];
  const panels = [...root.querySelectorAll<HTMLElement>('[data-category-panel]')];
  const selectCategory = (key: string) => {
    buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.categoryButton === key)));
    panels.forEach((panel) => { panel.hidden = panel.dataset.categoryPanel !== key; });
    root.dataset.activeCategory = key;
    document.dispatchEvent(new Event('rhine-music:category-change'));
  };
  const listeners = buttons.map((button) => {
    const onClick = () => selectCategory(button.dataset.categoryButton || '');
    button.addEventListener('click', onClick);
    return () => button.removeEventListener('click', onClick);
  });

  cleanups.set(root, () => {
    listeners.forEach((cleanup) => cleanup());
    cleanups.delete(root);
  });
}

function initializeAll(): void {
  document.querySelectorAll<HTMLElement>('[data-rhine-music]').forEach(initialize);
}

function cleanupAll(): void {
  document.querySelectorAll<HTMLElement>('[data-rhine-music]').forEach((root) => cleanups.get(root)?.());
}

document.addEventListener('astro:page-load', initializeAll);
document.addEventListener('astro:before-swap', cleanupAll);
initializeAll();
