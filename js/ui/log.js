// Панель диагностики: журнал событий и результаты проверки схемы.

export class Log {
  /** @param els один элемент или список (журнал дублируется в каждый: монитор ПК и панель у поля) */
  constructor(els, onHighlight) {
    this.els = [].concat(els);
    this.onHighlight = onHighlight;
    this.items = [];
    this.max = 60;
  }
  push(level, text, nodes = []) {
    const last = this.items[this.items.length - 1];
    if (last && last.text === text && last.level === level) { last.count++; this.render(); return; }
    this.items.push({ level, text, nodes, count: 1, t: new Date() });
    if (this.items.length > this.max) this.items.shift();
    this.render();
  }
  info(t, n) { this.push('info', t, n); }
  ok(t, n) { this.push('ok', t, n); }
  warn(t, n) { this.push('warn', t, n); }
  error(t, n) { this.push('error', t, n); }
  clear() { this.items = []; this.render(); }

  /** Показать результаты статической проверки блоком. */
  report(msgs) {
    this.push('head', 'Проверка схемы');
    for (const m of msgs) this.push(m.level, m.text, m.nodes);
  }

  render() {
    for (const el of this.els) this.renderTo(el);
  }

  renderTo(el) {
    el.innerHTML = '';
    for (const it of this.items) {
      const d = document.createElement('div');
      d.className = `log-item log-${it.level}`;
      const time = it.t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      d.innerHTML = `<span class="log-time">${time}</span><span class="log-text"></span>${it.count > 1 ? `<span class="log-count">×${it.count}</span>` : ''}`;
      d.querySelector('.log-text').textContent = it.text;
      if (it.nodes && it.nodes.length) {
        d.classList.add('has-nodes');
        d.title = 'Показать клеммы';
        d.addEventListener('mouseenter', () => this.onHighlight(it.nodes));
        d.addEventListener('mouseleave', () => this.onHighlight([]));
      }
      el.appendChild(d);
    }
    el.scrollTop = el.scrollHeight;
  }
}
