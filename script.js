(function(){
  const WORDS = ["ink","blade","mist","honor","strike","calm","edge","storm","focus","stance",
  "swift","guard","spirit","echo","shadow","flow","steel","balance","precision","breath",
  "path","ronin","temple","bamboo","lantern","silence","thunder","lotus","dawn","dusk",
  "resolve","discipline","harmony","fortitude","clarity","momentum","strategy","instinct","reflex","tempo"];

  const arena = document.getElementById('arena');
  const player = document.getElementById('player');
  const bufferEl = document.getElementById('buffer');
  const hpFill = document.getElementById('hp-fill');
  const hudTime = document.getElementById('hud-time');
  const hudWave = document.getElementById('hud-wave');
  const hudScore = document.getElementById('hud-score');
  const hudCombo = document.getElementById('hud-combo');
  const hudWpm = document.getElementById('hud-wpm');
  const hudAcc = document.getElementById('hud-acc');
  const startOverlay = document.getElementById('start-overlay');
  const upgradeOverlay = document.getElementById('upgrade-overlay');
  const gameoverOverlay = document.getElementById('gameover-overlay');
  const gameoverTitle = document.getElementById('gameover-title');
  const gameoverSub = document.getElementById('gameover-sub');
  const perkOptions = document.getElementById('perk-options');
  const pauseBtn = document.getElementById('pause-btn');
  const durationRow = document.getElementById('duration-row');

  let selectedDuration = 180;

  let state, enemies, lastFrame, spawnTimer, killsThisWave, running, paused;
  let correctKeys, mistakeKeys, wordsMissed, startTime, peakWpm, peakCombo, timeLeft;

  const PERKS = [
    {id:'hp', name:'Steady Hand', desc:'+25 max HP, heal to full.', apply:s=>{s.maxHp+=25; s.hp=s.maxHp;}},
    {id:'slow', name:'Swift Ink', desc:'All enemies move 15% slower, permanently.', apply:s=>{s.enemySpeedMult*=0.85;}},
    {id:'combo', name:'Double Strike', desc:'Combo bonus score scales twice as fast.', apply:s=>{s.comboScaling*=2;}},
    {id:'shield', name:'Paper Ward', desc:'Reduce incoming damage by 20%.', apply:s=>{s.damageMult*=0.8;}},
  ];

  durationRow.addEventListener('click', (e)=>{
    const btn = e.target.closest('.duration-btn');
    if(!btn) return;
    selectedDuration = parseInt(btn.dataset.secs, 10);
    durationRow.querySelectorAll('.duration-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
  });

  function freshState(){
    return {
      score:0, combo:0, hp:100, maxHp:100, wave:1,
      enemySpeedMult:1, comboScaling:1, damageMult:1,
      buffer:''
    };
  }

  function reset(){
    state = freshState();
    enemies = [];
    arena.querySelectorAll('.enemy').forEach(e=>e.remove());
    killsThisWave = 0;
    running = false;
    paused = false;
    correctKeys = 0; mistakeKeys = 0; wordsMissed = 0;
    startTime = null; peakWpm = 0; peakCombo = 0;
    timeLeft = selectedDuration;
    updateHud();
    bufferEl.innerHTML = '&nbsp;';
  }

  function formatTime(secs){
    secs = Math.max(0, Math.ceil(secs));
    const m = Math.floor(secs/60);
    const s = secs%60;
    return m + ':' + String(s).padStart(2,'0');
  }

  function updateHud(){
    hudWave.textContent = state.wave;
    hudScore.textContent = state.score;
    hudCombo.textContent = state.combo;
    hpFill.style.width = Math.max(0, (state.hp/state.maxHp*100)) + '%';
    hpFill.style.background = state.hp/state.maxHp < 0.3 ? 'var(--vermillion)' : 'var(--jade)';
    const acc = (correctKeys+mistakeKeys)>0 ? Math.round(100*correctKeys/(correctKeys+mistakeKeys)) : 100;
    hudAcc.textContent = acc + '%';
    let wpm = 0;
    if(startTime){
      const mins = (Date.now()-startTime)/60000;
      wpm = mins>0 ? Math.round((correctKeys/5)/mins) : 0;
    }
    hudWpm.textContent = wpm;
    if(wpm>peakWpm) peakWpm = wpm;
    if(state.combo>peakCombo) peakCombo = state.combo;
    hudTime.textContent = formatTime(timeLeft);
    hudTime.classList.toggle('time-low', timeLeft <= 10);
  }

  function randWord(exclude){
    let w;
    let tries=0;
    do{
      w = WORDS[Math.floor(Math.random()*WORDS.length)];
      tries++;
    } while(exclude.some(e=>e.word===w || e.word.startsWith(w) || w.startsWith(e.word)) && tries<20);
    return w;
  }

  function spawnEnemy(){
    if(enemies.length >= Math.min(3+Math.floor(state.wave/2), 6)) return;
    const word = randWord(enemies);
    const el = document.createElement('div');
    el.className = 'enemy';
    el.style.right = '18px';
    el.style.bottom = '36px';
    el.innerHTML = `
      <svg class="stick-svg" viewBox="0 0 60 100">
        <circle cx="30" cy="14" r="10" class="stick-line"/>
        <path d="M30 24 L30 62" class="stick-line"/>
        <path d="M30 34 L12 48" class="stick-line"/>
        <path d="M30 34 L48 48" class="stick-line"/>
        <path d="M30 62 L14 96" class="stick-line"/>
        <path d="M30 62 L46 96" class="stick-line"/>
      </svg>
      <div class="word-label"><span class="w-text"></span></div>
    `;
    arena.appendChild(el);
    const label = el.querySelector('.w-text');
    renderWord(label, word, '');
    const speedBase = 6 + state.wave*0.6 + Math.random()*3;
    enemies.push({
      word, el, label,
      x: 100, // percent distance from player, 100 = far right
      speed: speedBase * state.enemySpeedMult
    });
  }

  function renderWord(label, word, matched){
    if(matched && word.startsWith(matched)){
      label.innerHTML = `<span class="matched">${matched}</span>${word.slice(matched.length)}`;
    } else {
      label.textContent = word;
    }
  }

  function gameLoop(ts){
    if(!running) return;
    if(!lastFrame) lastFrame = ts;
    const dt = Math.min((ts-lastFrame)/1000, 0.1);
    lastFrame = ts;

    if(!paused){
      timeLeft -= dt;
      if(timeLeft <= 0){
        timeLeft = 0;
        updateHud();
        endGame('time');
        return;
      }

      spawnTimer -= dt;
      if(spawnTimer <= 0){
        spawnEnemy();
        spawnTimer = Math.max(0.9, 2.6 - state.wave*0.12);
      }

      const arenaWidth = arena.clientWidth;
      for(let i=enemies.length-1;i>=0;i--){
        const en = enemies[i];
        en.x -= en.speed * dt;
        const rightPx = (en.x/100) * (arenaWidth - 140) + 18;
        en.el.style.right = rightPx + 'px';
        if(en.x <= 0){
          hitPlayer(en);
          removeEnemy(i, 'dying');
          if(!running) return;
        }
      }
      updateHud();
    }
    requestAnimationFrame(gameLoop);
  }

  function hitPlayer(en){
    const dmg = Math.round((6 + en.word.length*1.4) * state.damageMult);
    state.hp -= dmg;
    state.combo = 0;
    state.buffer = '';
    bufferEl.innerHTML = '&nbsp;';
    player.style.filter = 'drop-shadow(0 0 6px var(--vermillion))';
    setTimeout(()=>{ player.style.filter=''; }, 200);
    if(state.hp <= 0){
      state.hp = 0;
      endGame('hp');
    }
  }

  function removeEnemy(index, mode){
    const en = enemies[index];
    if(mode === 'dying'){
      en.el.classList.add('dying');
      setTimeout(()=>en.el.remove(), 350);
    } else if(mode === 'escaped'){
      en.el.classList.add('escaped');
      setTimeout(()=>en.el.remove(), 300);
    } else {
      en.el.remove();
    }
    enemies.splice(index,1);
  }

  function killEnemy(index){
    const en = enemies[index];
    state.combo += 1;
    const comboBonus = 1 + (state.combo-1) * 0.12 * state.comboScaling;
    const points = Math.round(en.word.length * 12 * comboBonus);
    state.score += points;
    killsThisWave += 1;

    playSlash(en);
    popCombo(en, points, false);
    removeEnemy(index, 'dying');

    if(killsThisWave >= 5 + state.wave){
      killsThisWave = 0;
      state.wave += 1;
      offerUpgrade();
    }
    updateHud();
  }

  // A mistyped letter makes the word currently being fought vanish: no score, combo resets.
  function missWord(index){
    const en = enemies[index];
    en.label.parentElement.classList.add('wrong');
    wordsMissed += 1;
    state.combo = 0;
    popCombo(en, 'MISS', true);
    removeEnemy(index, 'escaped');
    updateHud();
  }

  function playSlash(en) {
    const rect = en.el.getBoundingClientRect();
    const arenaRect = arena.getBoundingClientRect();

    arena.animate([
        { transform: "translate(0px,0px)" },
        { transform: "translate(-5px,2px)" },
        { transform: "translate(5px,-2px)" },
        { transform: "translate(-3px,3px)" },
        { transform: "translate(0px,0px)" }
    ], { duration: 180, easing: "ease-out" });

    player.animate([
        { transform: "translateX(0)" },
        { transform: "translateX(90px)" },
        { transform: "translateX(0)" }
    ], { duration: 220, easing: "ease-out" });

    const slash = document.createElement("div");
    slash.className = "slash play";
    slash.style.left = (rect.left - arenaRect.left - 20) + "px";
    slash.style.top = (rect.top - arenaRect.top + 35) + "px";
    slash.style.width = "130px";
    slash.style.height = "8px";
    slash.style.background = "linear-gradient(90deg, transparent, white, #ff4040, transparent)";
    slash.style.boxShadow = "0 0 20px red";
    arena.appendChild(slash);
    setTimeout(() => slash.remove(), 300);

    for (let i = 0; i < 15; i++) {
        const p = document.createElement("div");
        p.style.position = "absolute";
        p.style.left = (rect.left - arenaRect.left + 20) + "px";
        p.style.top = (rect.top - arenaRect.top + 30) + "px";
        p.style.width = "6px";
        p.style.height = "6px";
        p.style.background = "gold";
        p.style.borderRadius = "50%";
        arena.appendChild(p);

        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 60;
        p.animate([
            { transform: "translate(0,0) scale(1)", opacity: 1 },
            { transform: `translate(${Math.cos(angle)*dist}px,${Math.sin(angle)*dist}px) scale(0)`, opacity: 0 }
        ], { duration: 500, easing: "ease-out" });
        setTimeout(() => p.remove(), 500);
    }

    en.el.animate([
        { filter: "brightness(3)" },
        { filter: "brightness(1)" }
    ], { duration: 120 });

    en.el.animate([
        { transform: "translateX(0px)" },
        { transform: "translateX(-40px) rotate(-10deg)" }
    ], { duration: 180, fill: "forwards" });

    const arm = document.getElementById("p-arm-r");
    arm.setAttribute("d", "M35 42 L68 10");
    setTimeout(() => { arm.setAttribute("d", "M35 42 L58 34"); }, 120);
  }

  function popCombo(en, points, isMiss){
    const rect = en.el.getBoundingClientRect();
    const arenaRect = arena.getBoundingClientRect();
    const p = document.createElement('div');
    p.className = 'combo-pop' + (isMiss ? ' miss' : '');
    p.textContent = isMiss ? points : ('+' + points);
    p.style.left = (rect.left - arenaRect.left) + 'px';
    p.style.top = (rect.top - arenaRect.top) + 'px';
    arena.appendChild(p);
    setTimeout(()=>p.remove(), 620);
  }

  function offerUpgrade(){
    paused = true;
    const choices = [...PERKS].sort(()=>Math.random()-0.5).slice(0,2);
    perkOptions.innerHTML = '';
    choices.forEach(perk=>{
      const card = document.createElement('div');
      card.className = 'perk-card';
      card.innerHTML = `<h3>${perk.name}</h3><p>${perk.desc}</p>`;
      card.onclick = () => {
        perk.apply(state);
        upgradeOverlay.classList.add('hidden');
        paused = false;
        if(isTouchDevice()) setTimeout(focusMobileInput, 50);
      };
      perkOptions.appendChild(card);
    });
    upgradeOverlay.classList.remove('hidden');
  }

  function endGame(cause){
    running = false;
    if(cause === 'time'){
      gameoverTitle.textContent = "Time's Up";
      gameoverSub.textContent = 'The duel bell has rung. Here is how it unfolded.';
    } else {
      gameoverTitle.textContent = 'Defeated';
      gameoverSub.textContent = 'Your ink has run dry. Here is how the duel unfolded.';
    }
    const acc = (correctKeys+mistakeKeys)>0 ? Math.round(100*correctKeys/(correctKeys+mistakeKeys)) : 100;
    document.getElementById('final-score').textContent = state.score;
    document.getElementById('final-wave').textContent = state.wave;
    document.getElementById('final-combo').textContent = peakCombo;
    document.getElementById('final-wpm').textContent = peakWpm;
    document.getElementById('final-acc').textContent = acc + '%';
    document.getElementById('final-missed').textContent = wordsMissed;
    gameoverOverlay.classList.remove('hidden');
    mobileInput.blur();
  }

  function startGame(){
    reset();
    startOverlay.classList.add('hidden');
    gameoverOverlay.classList.add('hidden');
    running = true;
    lastFrame = null;
    spawnTimer = 0.6;
    startTime = Date.now();
    spawnEnemy();
    requestAnimationFrame(gameLoop);
    if(isTouchDevice()) setTimeout(focusMobileInput, 50);
  }

  function isTouchDevice(){
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  }

  function handleBackspace(){
    state.buffer = state.buffer.slice(0,-1);
    refreshBuffer();
    enemies.forEach(en=>{
      if(state.buffer.length && en.word.startsWith(state.buffer)){
        en.label.parentElement.classList.add('target');
        renderWord(en.label, en.word, state.buffer);
      } else {
        en.label.parentElement.classList.remove('target');
        renderWord(en.label, en.word, '');
      }
    });
  }

  function handleLetter(ch){
    if(!/^[a-zA-Z]$/.test(ch)) return;
    const candidate = state.buffer + ch.toLowerCase();
    const matchIdx = enemies.findIndex(en => en.word.startsWith(candidate));
    if(matchIdx >= 0){
      state.buffer = candidate;
      correctKeys++;
      enemies.forEach(en=>{
        if(en.word.startsWith(state.buffer)){
          en.label.parentElement.classList.add('target');
          renderWord(en.label, en.word, state.buffer);
        } else {
          en.label.parentElement.classList.remove('target');
          renderWord(en.label, en.word, '');
        }
      });
      refreshBuffer();
      const exactIdx = enemies.findIndex(en => en.word === state.buffer);
      if(exactIdx >= 0){
        killEnemy(exactIdx);
        state.buffer = '';
        refreshBuffer();
        enemies.forEach(en=>{ en.label.parentElement.classList.remove('target'); renderWord(en.label, en.word, ''); });
      }
    } else {
      // Wrong letter: if we were mid-word on a target, that word is gone.
      mistakeKeys++;
      if(state.buffer.length > 0){
        const targetIdx = enemies.findIndex(en => en.word.startsWith(state.buffer));
        if(targetIdx >= 0){
          missWord(targetIdx);
        }
      }
      state.buffer = '';
      refreshBuffer();
      bufferEl.style.transform = 'translateX(-3px)';
      setTimeout(()=>bufferEl.style.transform='', 60);
    }
    updateHud();
  }

  window.addEventListener('keydown', (e)=>{
    if(!running || paused) return;
    // Skip physical keydown chars if focus is in the mobile input;
    // the 'input' event handler below deals with those instead.
    if(document.activeElement === mobileInput) return;
    if(e.key === 'Backspace'){
      handleBackspace();
      e.preventDefault();
      return;
    }
    if(!/^[a-zA-Z]$/.test(e.key)) return;
    handleLetter(e.key);
  });

  // ===== Mobile on-screen keyboard support =====
  const mobileInput = document.getElementById('mobile-input');
  const stageEl = document.getElementById('stage');
  let mobileInputValue = '';

  function focusMobileInput(){
    if(!running || paused) return;
    mobileInputValue = '';
    mobileInput.value = '';
    mobileInput.focus({ preventScroll: true });
  }

  mobileInput.addEventListener('input', ()=>{
    if(!running || paused) return;
    const val = mobileInput.value;
    if(val.length > mobileInputValue.length){
      const added = val.slice(mobileInputValue.length);
      for(const ch of added){ handleLetter(ch); }
    } else if(val.length < mobileInputValue.length){
      const removed = mobileInputValue.length - val.length;
      for(let i=0;i<removed;i++){ handleBackspace(); }
    }
    mobileInputValue = val;
    // Keep the hidden field short so it never visibly grows.
    if(mobileInput.value.length > 20){
      mobileInput.value = '';
      mobileInputValue = '';
    }
  });

  mobileInput.addEventListener('keydown', (e)=>{
    if(e.key === 'Backspace' && mobileInput.value.length === 0){
      handleBackspace();
      e.preventDefault();
    }
  });

  // Tapping anywhere on the stage while playing brings the keyboard back up.
  stageEl.addEventListener('touchstart', ()=>{
    if(running && !paused) focusMobileInput();
  }, { passive:true });

  function refreshBuffer(){
    bufferEl.innerHTML = state.buffer.length ? `<span class="txt">${state.buffer}</span>` : '&nbsp;';
  }

  pauseBtn.addEventListener('click', ()=>{
    if(!running) return;
    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    if(paused){
      mobileInput.blur();
    } else if(isTouchDevice()){
      setTimeout(focusMobileInput, 50);
    }
  });

  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('restart-btn').addEventListener('click', ()=>{
    startOverlay.classList.remove('hidden');
    gameoverOverlay.classList.add('hidden');
    mobileInput.blur();
    reset();
  });

  const hintEl = document.getElementById('hint');
  if(isTouchDevice() && hintEl){
    hintEl.textContent = 'Tap the arena, then type on your keyboard to strike. One wrong letter and that word is gone.';
  }

  reset();
})();
