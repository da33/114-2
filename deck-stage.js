class DeckStage extends HTMLElement {
  connectedCallback() {
    // Defer so children (<section>) are fully parsed before we run
    setTimeout(() => this._init(), 0);
  }

  _init() {
    const w = parseInt(this.getAttribute('width') || 1920);
    const h = parseInt(this.getAttribute('height') || 1080);
    this._w = w;
    this._h = h;
    this._idx = 0;

    // Full-screen container
    Object.assign(this.style, {
      display: 'block',
      position: 'fixed',
      inset: '0',
      background: '#000',
      overflow: 'hidden',
    });

    // Scaler that maintains 16:9 at design resolution
    this._scaler = document.createElement('div');
    Object.assign(this._scaler.style, {
      position: 'absolute',
      width: w + 'px',
      height: h + 'px',
      transformOrigin: 'top left',
    });

    while (this.firstChild) this._scaler.appendChild(this.firstChild);
    this.appendChild(this._scaler);

    this._slides = Array.from(this._scaler.querySelectorAll('section'));
    if (!this._slides.length) return;

    this._slides.forEach((s, i) => {
      Object.assign(s.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        opacity: i === 0 ? '1' : '0',
        pointerEvents: i === 0 ? 'auto' : 'none',
        transition: 'opacity 0.3s ease',
        overflow: 'hidden',
      });
    });

    this._buildUI();

    // Keyboard nav
    document.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault(); this.go(this._idx + 1);
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault(); this.go(this._idx - 1);
      }
      if (e.key === 'f' || e.key === 'F') this._toggleFS();
    });

    // Click left/right half to navigate
    this._scaler.addEventListener('click', e => {
      if (e.target.closest('a, button')) return;
      const rect = this._scaler.getBoundingClientRect();
      const x = (e.clientX - rect.left) / (rect.width / w);
      x > w / 2 ? this.go(this._idx + 1) : this.go(this._idx - 1);
    });

    // Touch swipe
    let tx = 0;
    this._scaler.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
    this._scaler.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - tx;
      if (Math.abs(dx) > 40) dx < 0 ? this.go(this._idx + 1) : this.go(this._idx - 1);
    }, { passive: true });

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._update();
  }

  _buildUI() {
    const ui = document.createElement('div');
    Object.assign(ui.style, {
      position: 'fixed',
      bottom: '18px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      zIndex: '9999',
      background: 'rgba(10,10,10,0.75)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '999px',
      padding: '8px 18px',
      userSelect: 'none',
      fontFamily: "'JetBrains Mono', monospace",
    });

    const mkBtn = (label, fn) => {
      const b = document.createElement('button');
      b.innerHTML = label;
      Object.assign(b.style, {
        background: 'none', border: 'none', color: '#fff',
        fontSize: '18px', cursor: 'pointer', padding: '2px 8px',
        lineHeight: '1', opacity: '0.75', transition: 'opacity 0.15s',
      });
      b.onmouseenter = () => b.style.opacity = '1';
      b.onmouseleave = () => b.style.opacity = '0.75';
      b.onclick = fn;
      return b;
    };

    this._counter = document.createElement('span');
    Object.assign(this._counter.style, {
      fontSize: '12px', color: 'rgba(255,255,255,0.6)',
      letterSpacing: '0.15em', minWidth: '54px', textAlign: 'center',
    });

    ui.append(
      mkBtn('&#8592;', () => this.go(this._idx - 1)),
      this._counter,
      mkBtn('&#8594;', () => this.go(this._idx + 1)),
      mkBtn('&#x26F6;', () => this._toggleFS()),
    );

    document.body.appendChild(ui);
    this._ui = ui;
  }

  _toggleFS() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  }

  _resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const scale = Math.min(vw / this._w, vh / this._h);
    const left = (vw - this._w * scale) / 2;
    const top  = (vh - this._h * scale) / 2;
    this._scaler.style.transform = `translate(${left}px,${top}px) scale(${scale})`;
  }

  go(i) {
    const n = this._slides.length;
    i = Math.max(0, Math.min(n - 1, i));
    if (i === this._idx) return;
    this._slides[this._idx].style.opacity = '0';
    this._slides[this._idx].style.pointerEvents = 'none';
    this._slides[i].style.opacity = '1';
    this._slides[i].style.pointerEvents = 'auto';
    this._idx = i;
    this._update();
  }

  _update() {
    if (this._counter) this._counter.textContent = `${this._idx + 1} / ${this._slides.length}`;
  }
}

customElements.define('deck-stage', DeckStage);
