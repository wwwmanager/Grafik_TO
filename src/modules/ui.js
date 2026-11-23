// Wires the static scaffold: minimal tab switching and status line helpers.
export function initUi(root = document) {
  const tabs = root.querySelectorAll('.tab');
  const panels = root.querySelectorAll('.tab-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      tabs.forEach((other) => other.classList.toggle('is-active', other === tab));
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.panel !== name;
      });
    });
  });
}