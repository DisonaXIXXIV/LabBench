// Органы под монтажным отсеком: кнопки Пуск/Стоп, потенциометры
// «Время 1» / «Время 2» приставок выдержки времени, индикация контакторов.

export class FieldControls {
  constructor(container, bench, runtime) {
    this.bench = bench;
    this.rt = runtime;
    this.el = container;
    const s = runtime.state;
    this.el.innerHTML = `
      <div class="fc-group">
        <div class="pb-wrap"><div class="pb-tag">ПУСК</div><button class="pb pb-on" id="fc-start"><span class="lamp"></span></button></div>
        <div class="pb-wrap"><div class="pb-tag">СТОП</div><button class="pb pb-off" id="fc-stop"><span class="lamp"></span></button></div>
      </div>
      <div class="fc-group timers">
        ${['t1', 't2'].map((t, i) => `
          <div class="ctl pot small" data-t="${t}">
            <div class="ctl-tag">ВРЕМЯ ${i + 1}</div>
            <div class="pot-knob"><div class="pot-mark"></div></div>
            <div class="pot-value"></div>
          </div>`).join('')}
      </div>
      <div class="fc-group km-lamps">
        ${bench.contactors.map(k => `<div class="km-lamp" data-km="${k.id}"><span class="lamp"></span>${k.id.toUpperCase()}</div>`).join('')}
        <div class="km-lamp chain" data-km="chain"><span class="lamp"></span>цепь упр.</div>
      </div>`;
    const hold = (id, fn) => {
      const b = this.el.querySelector(id);
      b.addEventListener('pointerdown', e => { fn(true); b.setPointerCapture(e.pointerId); b.classList.add('down'); });
      b.addEventListener('pointerup', () => { fn(false); b.classList.remove('down'); });
      b.addEventListener('pointercancel', () => { fn(false); b.classList.remove('down'); });
    };
    hold('#fc-start', d => runtime.pressStart(d));
    hold('#fc-stop', d => runtime.pressStop(d));
    for (const p of this.el.querySelectorAll('.pot')) {
      const t = p.dataset.t, knob = p.querySelector('.pot-knob'), val = p.querySelector('.pot-value');
      const render = () => { knob.style.transform = `rotate(${-135 + s.ctrl[t] * 270}deg)`; val.textContent = `${(0.5 + s.ctrl[t] * 9.5).toFixed(1).replace('.', ',')} с`; };
      const set = v => { s.ctrl[t] = Math.max(0, Math.min(1, v)); render(); };
      knob.addEventListener('wheel', e => { e.preventDefault(); set(s.ctrl[t] - Math.sign(e.deltaY) * 0.02); });
      let drag = null;
      knob.addEventListener('pointerdown', e => { drag = { y: e.clientY, v: s.ctrl[t] }; knob.setPointerCapture(e.pointerId); });
      knob.addEventListener('pointermove', e => { if (drag) set(drag.v + (drag.y - e.clientY) / 150); });
      knob.addEventListener('pointerup', () => { drag = null; });
      render();
    }
  }

  update(view) {
    for (const el of this.el.querySelectorAll('.km-lamp')) {
      const id = el.dataset.km;
      el.classList.toggle('lit', id === 'chain' ? view.rt.chainLive : !!view.rt.contactors[id]);
    }
  }
}
