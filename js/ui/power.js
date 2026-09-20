// Панели подключения питающих напряжений: автоматы на DIN-рейке и кнопка
// аварийного отключения (верх шкафа А1/Б6) и кнопки Вкл/Выкл вводов
// (верх шкафа А2/Б5, над приборами).

export class PowerPanel {
  constructor(topEl, inputsEl, bench, runtime) {
    this.bench = bench;
    this.rt = runtime;
    this.topEl = topEl;
    this.inEl = inputsEl;
    this.build();
  }

  build() {
    const b = this.bench;
    const main = b.breakers.filter(x => !x.separate);
    const sep = b.breakers.filter(x => x.separate);
    const brk = x => `
      <div class="brk" data-id="${x.id}" title="${x.label}">
        <div class="brk-label">${x.label.replace(/ (~|=)/, '<br>$1')}</div>
        <div class="brk-body poles-${x.poles}">
          ${Array.from({ length: x.poles }).map(() => `<div class="pole"><div class="lever"></div></div>`).join('')}
          <div class="brk-brand">ABB</div>
        </div>
      </div>`;
    this.topEl.innerHTML = `
      <div class="power-top">
        <div class="din-rail">${main.map(brk).join('')}</div>
        <div class="estop-wrap">
          <div class="estop" id="estop" title="Аварийное отключение (нажать / повернуть для возврата)">
            <div class="estop-ring"><span>Emergency</span><span class="bottom">Stop</span></div>
            <div class="estop-btn"></div>
          </div>
          <div class="estop-label">АВАРИЙНОЕ<br>ОТКЛЮЧЕНИЕ</div>
        </div>
        ${sep.length ? `<div class="din-rail sep">${sep.map(brk).join('')}</div>` : ''}
      </div>`;
    this.inEl.innerHTML = `
      <div class="power-inputs">
        ${b.inputs.map(i => `
          <div class="input-group" data-id="${i.id}">
            <div class="input-title">${i.label}<br>${i.voltage}</div>
            <div class="pb-row">
              <div class="pb-wrap"><div class="pb-tag">ВКЛ.</div><button class="pb pb-on" data-in="${i.id}" data-on="1"><span class="lamp"></span></button></div>
              <div class="pb-wrap"><div class="pb-tag">ВЫКЛ.</div><button class="pb pb-off" data-in="${i.id}" data-on="0"><span class="lamp"></span></button></div>
            </div>
          </div>`).join('')}
      </div>`;
    for (const el of this.topEl.querySelectorAll('.brk')) el.addEventListener('click', () => this.rt.toggleBreaker(el.dataset.id));
    this.topEl.querySelector('#estop').addEventListener('click', () => this.rt.pressEstop());
    for (const btn of this.inEl.querySelectorAll('.pb')) btn.addEventListener('click', () => this.rt.setInput(btn.dataset.in, btn.dataset.on === '1'));
  }

  update(view) {
    const s = this.rt.state;
    for (const el of this.topEl.querySelectorAll('.brk')) {
      const id = el.dataset.id;
      el.classList.toggle('on', !!s.breakers[id]);
      el.classList.toggle('live', this.rt.breakerLive(id));
    }
    this.topEl.querySelector('#estop').classList.toggle('pressed', s.estop);
    for (const inp of this.bench.inputs) {
      const g = this.inEl.querySelector(`.input-group[data-id="${inp.id}"]`);
      const live = view.live.inputs[inp.id];
      const ready = this.rt.breakerLive(inp.breaker);
      g.querySelector('.pb-on').classList.toggle('lit', live);
      g.querySelector('.pb-off').classList.toggle('lit', ready && !live);
      g.classList.toggle('flash', this.rt.rt.tripFlash > 0 && !live);
    }
  }
}
