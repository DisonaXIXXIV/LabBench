// Монитор ПК: вкладки «Диагностика» (журнал), «Таблица» (снятые точки и
// секундомер) и «Осциллограф». Экран монитора в шкафу узкий, поэтому
// вкладку можно развернуть крупно под стендом (как наборное поле): её
// элемент переносится в широкую секцию и обратно.

export class PcMonitor {
  constructor(app) {
    this.app = app;
    this.screen = document.querySelector('.pc-screen');
    this.bigRow = document.getElementById('pc-big-row');
    this.big = document.getElementById('pc-big');
    this.tab = localStorage.getItem('abblab.pcTab') || 'log';
    this.bigOpen = localStorage.getItem('abblab.pcBig') === '1';
    for (const b of this.screen.querySelectorAll('.pc-tabs button')) b.addEventListener('click', () => this.select(b.dataset.tab));
    document.getElementById('btn-pc-big').addEventListener('click', () => this.setBig(!this.bigOpen));
    document.getElementById('btn-pc-big-close').addEventListener('click', () => this.setBig(false));
    this.apply();
  }

  select(tab) {
    this.tab = tab;
    localStorage.setItem('abblab.pcTab', tab);
    this.apply();
    if (tab !== 'log' && this.bigOpen) this.bigRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  setBig(open) {
    this.bigOpen = open;
    localStorage.setItem('abblab.pcBig', open ? '1' : '0');
    this.apply();
    if (open) this.bigRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.app.fitHeight?.();
  }

  /** Показать активную вкладку; развёрнутая вкладка живёт в широкой секции под стендом. */
  apply() {
    const mobile = this.app.mobile?.active;
    const big = this.bigOpen && this.tab !== 'log' && !mobile;
    for (const b of this.screen.querySelectorAll('.pc-tabs button')) b.classList.toggle('active', b.dataset.tab === this.tab);
    for (const el of document.querySelectorAll('.pc-tab')) {
      const active = el.dataset.tab === this.tab;
      const target = active && big ? this.big : this.screen;
      if (el.parentElement !== target) target.appendChild(el);
      el.hidden = !active;
    }
    this.bigRow.classList.toggle('open', big);
    document.getElementById('btn-pc-big').hidden = this.tab === 'log' || !!mobile;
    document.getElementById('btn-log-clear').hidden = this.tab !== 'log';
    document.getElementById('pc-big-title').textContent = `Монитор ПК · ${{ points: 'таблица снятых точек', scope: 'осциллограф' }[this.tab] || ''}`;
    this.screen.classList.toggle('big-out', big);
    this.app.scope?.draw();
  }
}
