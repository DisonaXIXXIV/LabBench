// Двухмашинный агрегат: испытуемый двигатель — датчик момента — нагрузочная машина.
const NS = 'http://www.w3.org/2000/svg';

export class MotorsPanel {
  constructor(container, bench) {
    this.bench = bench;
    this.el = container;
    this.angle = 0;
    const [ma, mb] = bench.motors;
    this.el.innerHTML = `
      <svg viewBox="0 0 360 150" class="motors-svg">
        <defs>
          <linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#8a95a3"/><stop offset="0.5" stop-color="#cfd6de"/><stop offset="1" stop-color="#6e7986"/>
          </linearGradient>
          <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#9aa"/><stop offset="0.5" stop-color="#eee"/><stop offset="1" stop-color="#889"/>
          </linearGradient>
        </defs>
        <rect x="0" y="118" width="360" height="8" fill="#556"/>
        <!-- тахогенератор -->
        <rect x="8" y="58" width="26" height="30" rx="4" fill="url(#mg)" stroke="#445"/>
        <text x="21" y="105" class="mt-lbl" text-anchor="middle">ТГ</text>
        <rect x="34" y="70" width="12" height="6" fill="url(#sg)"/>
        <!-- машина A -->
        <rect x="46" y="40" width="100" height="66" rx="8" fill="url(#mg)" stroke="#445"/>
        ${[0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="${54 + i * 13}" y="42" width="4" height="62" fill="#5d6874" opacity="0.5"/>`).join('')}
        <rect x="80" y="26" width="34" height="16" rx="3" fill="#7f8a97" stroke="#445"/>
        <rect x="60" y="106" width="72" height="12" fill="#6e7986" stroke="#445"/>
        <text x="96" y="140" class="mt-lbl" text-anchor="middle">${ma.title}</text>
        <!-- вал + диск -->
        <rect x="146" y="70" width="34" height="6" fill="url(#sg)"/>
        <g class="disc" transform="translate(163,73)">
          <circle r="11" fill="#333" stroke="#000"/>
          <rect x="-11" y="-2" width="22" height="4" fill="#f5c400"/>
          <rect x="-2" y="-11" width="4" height="22" fill="#f5c400"/>
        </g>
        <!-- датчик момента -->
        <rect x="180" y="58" width="36" height="30" rx="3" fill="#39465a" stroke="#223"/>
        <text x="198" y="77" class="mt-lbl2" text-anchor="middle">ДМ</text>
        <rect x="216" y="70" width="14" height="6" fill="url(#sg)"/>
        <!-- машина B -->
        <rect x="230" y="44" width="92" height="62" rx="8" fill="url(#mg)" stroke="#445"/>
        ${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${238 + i * 13}" y="46" width="4" height="58" fill="#5d6874" opacity="0.5"/>`).join('')}
        <rect x="262" y="30" width="30" height="16" rx="3" fill="#7f8a97" stroke="#445"/>
        <rect x="244" y="106" width="64" height="12" fill="#6e7986" stroke="#445"/>
        <text x="276" y="140" class="mt-lbl" text-anchor="middle">${mb.title}</text>
      </svg>
      <div class="motors-info">
        <div><span>n</span><b data-k="speed">0</b><i>об/мин</i></div>
        <div><span>M</span><b data-k="torque">0,0</b><i>Нм</i></div>
        <div class="mt-notes" data-k="notes"></div>
      </div>`;
    this.disc = this.el.querySelector('.disc');
    this.cells = { speed: this.el.querySelector('[data-k=speed]'), torque: this.el.querySelector('[data-k=torque]'), notes: this.el.querySelector('[data-k=notes]') };
  }

  update(view, dt) {
    const { speed, torque } = view.sim.shaft;
    this.angle = (this.angle + speed / 60 * 360 * dt * 0.08) % 360; // замедленная визуализация
    this.disc.setAttribute('transform', `translate(163,73) rotate(${this.angle})`);
    this.cells.speed.textContent = Math.round(speed);
    this.cells.torque.textContent = torque.toFixed(1).replace('.', ',');
    const notes = [];
    for (const m of this.bench.motors) {
      const st = view.sim.motors[m.id];
      if (!st) continue;
      const name = m.title.split(' — ')[0];
      const state = { run: 'работает', stop: 'остановлен', stall: 'под напряжением, не вращается', brake: 'динамическое торможение', runaway: 'РАЗНОС' }[st.state];
      notes.push(`<div class="mt-note st-${st.state}"><b>${name}</b>: ${state}${st.note ? ` (${st.note})` : ''}</div>`);
    }
    this.cells.notes.innerHTML = notes.join('');
  }
}
