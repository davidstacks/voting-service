// GVote — Voting Hosting Platform Client JS  v3.0

// ===== Animated Counter =====
function animateCounter(el) {
  const raw = el.textContent.replace(/[^0-9.]/g, '');
  const target = parseFloat(raw);
  if (isNaN(target) || target === 0) return;
  const duration = Math.min(1500, 300 + target * 0.4);
  const startTime = performance.now();
  el.textContent = '0';
  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(eased * target);
    el.textContent = current.toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = target.toLocaleString();
  }
  requestAnimationFrame(tick);
}

// ===== Animate Result Bars on Load =====
function animateResultBars() {
  document.querySelectorAll('.result-bar').forEach(bar => {
    const target = bar.style.width;
    bar.style.width = '0%';
    bar.style.transition = 'none';
    setTimeout(() => {
      bar.style.transition = 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
      bar.style.width = target;
    }, 80);
  });
}

// ===== Countdown Timer =====
function startCountdown(el) {
  const end = new Date(el.dataset.end);
  function update() {
    const diff = end - Date.now();
    if (diff <= 0) { el.innerHTML = '<i class="fas fa-clock"></i> Ended'; return; }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (d > 0) el.innerHTML = `<i class="fas fa-clock"></i> Ends in ${d}d ${h}h`;
    else if (h > 0) el.innerHTML = `<i class="fas fa-clock"></i> Ends in ${h}h ${m}m`;
    else el.innerHTML = `<i class="fas fa-clock"></i> Ends in ${m}m ${s}s`;
  }
  update();
  setInterval(update, 1000);
}

// ===== Schedule Countdown (opens in X) =====
function startScheduleCountdown(el) {
  const start = new Date(el.dataset.start);
  function update() {
    const diff = start - Date.now();
    if (diff <= 0) { el.textContent = 'Opening soon…'; return; }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (d > 0) el.textContent = `Opens in ${d}d ${h}h`;
    else if (h > 0) el.textContent = `Opens in ${h}h ${m}m`;
    else el.textContent = `Opens in ${m}m ${s}s`;
  }
  update();
  setInterval(update, 1000);
}

// ===== Device Fingerprinting =====
async function generateDeviceFingerprint() {
  const parts = [];
  parts.push(`s:${screen.width}x${screen.height}x${screen.colorDepth}`);
  parts.push(`a:${screen.availWidth}x${screen.availHeight}`);
  parts.push(`pr:${window.devicePixelRatio || 1}`);
  parts.push(`tz:${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  parts.push(`tzo:${new Date().getTimezoneOffset()}`);
  parts.push(`p:${navigator.platform}`);
  parts.push(`l:${navigator.language}`);
  parts.push(`ls:${(navigator.languages || []).join(',')}`);
  parts.push(`c:${navigator.hardwareConcurrency || '?'}`);
  parts.push(`m:${navigator.deviceMemory || '?'}`);
  parts.push(`t:${navigator.maxTouchPoints || 0}`);

  try {
    const cv = document.createElement('canvas');
    cv.width = 200; cv.height = 50;
    const ctx = cv.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(10, 0, 100, 30);
    ctx.fillStyle = '#069';
    ctx.fillText('GVote FP', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('GVote FP', 4, 17);
    parts.push(`cv:${cv.toDataURL()}`);
  } catch (_) { parts.push('cv:n'); }

  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      const di = gl.getExtension('WEBGL_debug_renderer_info');
      if (di) {
        parts.push(`glv:${gl.getParameter(di.UNMASKED_VENDOR_WEBGL)}`);
        parts.push(`glr:${gl.getParameter(di.UNMASKED_RENDERER_WEBGL)}`);
      }
    }
  } catch (_) { parts.push('gl:n'); }

  const raw = parts.join('|');
  const data = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ===== QR Code Generator (simple canvas-based) =====
function generateQR(text, container) {
  const img = document.createElement('img');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}&bgcolor=0a0d1a&color=818cf8&format=svg`;
  img.alt = 'QR Code';
  img.style.cssText = 'width: 180px; height: 180px; border-radius: 8px; background: #fff; padding: 8px;';
  container.appendChild(img);
}

// ===== Confetti =====
function launchConfetti() {
  if (typeof confetti !== 'function') return;
  confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ['#7c3aed', '#a78bfa', '#06b6d4', '#f59e0b', '#10b981'] });
}

// ===== Chart.js Pie/Bar Chart =====
let chartInstance = null;
let chartVisible = false;

function initChart() {
  const dataEl = document.getElementById('chart-data');
  const canvas = document.getElementById('resultsChart');
  if (!dataEl || !canvas || typeof Chart === 'undefined') return;

  let chartData;
  try { chartData = JSON.parse(dataEl.textContent); } catch (_) { return; }

  const palette = ['#7c3aed','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#3b82f6','#ec4899','#14b8a6','#f97316'];
  const colors = chartData.labels.map((_, i) => palette[i % palette.length]);

  chartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: chartData.labels,
      datasets: [{ data: chartData.values, backgroundColor: colors, borderColor: '#0d1224', borderWidth: 3, hoverOffset: 8 }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 12 }, padding: 16, boxWidth: 14 } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed} vote${ctx.parsed !== 1 ? 's' : ''} (${ctx.dataset.data.reduce((a,b)=>a+b,0)>0?(ctx.parsed/ctx.dataset.data.reduce((a,b)=>a+b,0)*100).toFixed(1):0}%)` } },
      },
      cutout: '55%',
    },
  });
}

function toggleChart() {
  const container = document.getElementById('chart-container');
  const list = document.getElementById('results-list');
  const btn = document.getElementById('chart-toggle');
  if (!container) return;

  chartVisible = !chartVisible;

  if (chartVisible) {
    container.style.display = '';
    if (!chartInstance) initChart();
    if (list) list.style.display = 'none';
    if (btn) btn.innerHTML = '<i class="fas fa-chart-bar"></i> Bars';
  } else {
    container.style.display = 'none';
    if (list) list.style.display = '';
    if (btn) btn.innerHTML = '<i class="fas fa-chart-pie"></i> Chart';
  }
}

// ===== Comment Submission =====
function setupCommentForm() {
  const form = document.getElementById('comment-form');
  if (!form) return;
  const slug = form.dataset.slug;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const bodyEl = document.getElementById('comment-body');
    const authorEl = document.getElementById('comment-author');
    const submitBtn = form.querySelector('.comment-submit-btn');
    const body = (bodyEl ? bodyEl.value : '').trim();
    if (!body) return;

    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

    try {
      const res = await fetch(`/v/${slug}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, authorName: authorEl ? authorEl.value : '' }),
      });
      const data = await res.json();

      if (data.success) {
        // Prepend new comment to list
        const list = document.getElementById('comments-list');
        const empty = document.getElementById('comments-empty');
        if (empty) empty.remove();

        const now = new Date().toLocaleString();
        const author = (authorEl && authorEl.value.trim()) ? escapeHtml(authorEl.value.trim()) : 'Anonymous';
        const item = document.createElement('div');
        item.className = 'comment-item';
        item.innerHTML = `
          <div class="comment-avatar"><i class="fas fa-user-circle"></i></div>
          <div class="comment-body-wrap">
            <div class="comment-meta">
              <span class="comment-author">${author}</span>
              <span class="comment-time">${now}</span>
            </div>
            <div class="comment-text">${escapeHtml(body)}</div>
          </div>
        `;
        if (list) list.insertBefore(item, list.firstChild);

        // Update count
        const countEl = document.getElementById('comments-count');
        if (countEl) {
          const cur = parseInt(countEl.textContent.replace(/\D/g,'')) || 0;
          countEl.textContent = `(${cur + 1})`;
        }

        // Reset form
        if (bodyEl) bodyEl.value = '';
      } else {
        alert(data.error || 'Could not post comment.');
      }
    } catch (_) {
      alert('Could not post comment. Please try again.');
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Post Comment'; }
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {

  // ===== Fingerprint Injection =====
  const fpField = document.getElementById('deviceFingerprint');
  if (fpField) {
    generateDeviceFingerprint().then(fp => { fpField.value = fp; }).catch(() => {});
  }

  // ===== Animated Counters (landing stats) =====
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('.stat-num').forEach(el => observer.observe(el));

  // ===== Animate Result Bars on Load =====
  animateResultBars();

  // ===== Countdown Timers =====
  document.querySelectorAll('[data-end]').forEach(el => startCountdown(el));
  document.querySelectorAll('[data-start]').forEach(el => startScheduleCountdown(el));

  // ===== Auto-dismiss Alerts =====
  document.querySelectorAll('.alert').forEach(el => {
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-8px)';
      setTimeout(() => el.remove(), 300);
    }, 5000);
  });

  // ===== Confetti on voted banner load =====
  const votedBanner = document.querySelector('.voted-banner');
  if (votedBanner && !sessionStorage.getItem('confetti_fired')) {
    sessionStorage.setItem('confetti_fired', '1');
    setTimeout(launchConfetti, 300);
  }

  // ===== Vote Form Handling =====
  const voteForm = document.getElementById('vote-form');
  if (voteForm) {
    const submitBtn = document.getElementById('vote-submit');
    voteForm.addEventListener('change', () => {
      const checked = voteForm.querySelectorAll('input[name="optionId"]:checked');
      if (submitBtn) submitBtn.disabled = checked.length === 0;
    });

    let submitted = false;
    voteForm.addEventListener('submit', (e) => {
      if (submitted) { e.preventDefault(); return; }
      const checked = voteForm.querySelectorAll('input[name="optionId"]:checked');
      if (checked.length === 0) { e.preventDefault(); return; }
      // Clear confetti guard so it fires after redirect
      sessionStorage.removeItem('confetti_fired');
      submitted = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Voting...';
      }
    });
  }

  // ===== Create Form — Poll Type Switching =====
  const pollTypeInputs = document.querySelectorAll('input[name="pollType"]');
  const optionsSection = document.getElementById('options-section');
  const allowMultipleLabel = document.getElementById('allow-multiple-label');

  if (pollTypeInputs.length > 0 && optionsSection) {
    pollTypeInputs.forEach(input => {
      input.addEventListener('change', () => {
        const type = input.value;
        if (type === 'choice') {
          optionsSection.style.display = '';
          if (allowMultipleLabel) allowMultipleLabel.style.display = '';
        } else {
          optionsSection.style.display = 'none';
          if (allowMultipleLabel) allowMultipleLabel.style.display = 'none';
        }
        document.querySelectorAll('.poll-type-card').forEach(card => card.classList.remove('selected'));
        input.closest('.poll-type-card').classList.add('selected');
      });
    });
  }

  // ===== Create Form — Add/Remove Options =====
  const addBtn = document.getElementById('add-option');
  const optContainer = document.getElementById('options-container');
  if (addBtn && optContainer) {
    let optionCount = optContainer.querySelectorAll('.option-row').length;

    addBtn.addEventListener('click', () => {
      if (optionCount >= 50) return;
      optionCount++;
      const row = document.createElement('div');
      row.className = 'option-row';
      row.innerHTML = `
        <input type="text" name="options" placeholder="Option ${optionCount}" maxlength="200">
        <button type="button" class="option-remove" title="Remove"><i class="fas fa-times"></i></button>
      `;
      optContainer.appendChild(row);
      row.querySelector('input').focus();
    });

    optContainer.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.option-remove');
      if (removeBtn) {
        removeBtn.closest('.option-row').remove();
        optionCount--;
      }
    });
  }

  // ===== Share Tabs =====
  const shareTabs = document.querySelectorAll('.share-tab');
  if (shareTabs.length > 0) {
    shareTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        shareTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.share-content').forEach(c => c.style.display = 'none');
        const target = document.getElementById(`share-${tab.dataset.tab}`);
        if (target) target.style.display = '';
      });
    });

    const qrContainer = document.getElementById('qr-code');
    let qrGenerated = false;
    const qrTab = document.querySelector('.share-tab[data-tab="qr"]');
    if (qrTab && qrContainer) {
      qrTab.addEventListener('click', () => {
        if (!qrGenerated) {
          generateQR(window.location.href.replace('/embed', ''), qrContainer);
          qrGenerated = true;
        }
      });
    }
  }

  // ===== Copy Link Button =====
  function setupCopy(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (btn && input) {
      btn.addEventListener('click', () => {
        input.select();
        navigator.clipboard.writeText(input.value).then(() => {
          btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
          setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 2000);
        });
      });
    }
  }
  setupCopy('copy-link', 'share-url');
  setupCopy('copy-embed', 'embed-code');

  // ===== Social Share Copy Link =====
  const socialCopyBtn = document.getElementById('social-copy-btn');
  if (socialCopyBtn) {
    socialCopyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.href.split('/results')[0].split('/export')[0]).then(() => {
        socialCopyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => { socialCopyBtn.innerHTML = '<i class="fas fa-link"></i> Copy Link'; }, 2000);
      });
    });
  }

  // ===== Chart Toggle =====
  const chartToggleBtn = document.getElementById('chart-toggle');
  if (chartToggleBtn) {
    chartToggleBtn.addEventListener('click', toggleChart);
  }

  // ===== Comments =====
  setupCommentForm();

  // ===== Dashboard — copy link buttons =====
  document.querySelectorAll('.dash-copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = window.location.origin + btn.dataset.url;
      navigator.clipboard.writeText(url).then(() => {
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i>'; }, 2000);
      });
    });
  });

  // ===== Live Results Auto-Refresh =====
  const resultsCard = document.getElementById('results-card');
  if (resultsCard) {
    const slug = resultsCard.dataset.slug;
    if (slug) {
      setInterval(async () => {
        try {
          const res = await fetch(`/v/${slug}/results.json`);
          if (!res.ok) return;
          const data = await res.json();
          updateResultsUI(data);
          const liveDot = document.getElementById('live-dot');
          if (liveDot) {
            liveDot.style.opacity = '0.3';
            setTimeout(() => { liveDot.style.opacity = '1'; }, 300);
          }
        } catch (_) {}
      }, 5000);
    }
  }

  function updateResultsUI(data) {
    const list = document.getElementById('results-list');
    const totalEl = document.getElementById('total-votes-num');
    if (!list || !data.results) return;

    if (totalEl) totalEl.textContent = data.totalVotes.toLocaleString();

    if (!chartVisible) {
      list.innerHTML = data.results.map((r, i) => {
        const pct = data.totalVotes > 0 ? ((r.vote_count / data.totalVotes) * 100).toFixed(1) : 0;
        const isWinner = i === 0 && r.vote_count > 0;
        return `
          <div class="result-row${isWinner ? ' winner' : ''}">
            <div class="result-label">
              <span class="result-name">${isWinner ? '<i class="fas fa-trophy" style="color: #f59e0b;"></i> ' : ''}${escapeHtml(r.label)}</span>
              <span class="result-pct">${pct}%</span>
            </div>
            <div class="result-bar-bg">
              <div class="result-bar" style="width: ${pct}%"></div>
            </div>
            <div class="result-votes">${r.vote_count.toLocaleString()} vote${r.vote_count !== 1 ? 's' : ''}</div>
          </div>
        `;
      }).join('');
      animateResultBars();
    } else if (chartInstance) {
      chartInstance.data.datasets[0].data = data.results.map(r => r.vote_count);
      chartInstance.data.labels = data.results.map(r => r.label);
      chartInstance.update();
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

});

// ===== Animated Counter =====
function animateCounter(el) {
  const raw = el.textContent.replace(/[^0-9.]/g, '');
  const target = parseFloat(raw);
  if (isNaN(target) || target === 0) return;
  const duration = Math.min(1500, 300 + target * 0.4);
  const startTime = performance.now();
  el.textContent = '0';
  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(eased * target);
    el.textContent = current.toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = target.toLocaleString();
  }
  requestAnimationFrame(tick);
}

// ===== Animate Result Bars on Load =====
function animateResultBars() {
  document.querySelectorAll('.result-bar').forEach(bar => {
    const target = bar.style.width;
    bar.style.width = '0%';
    bar.style.transition = 'none';
    setTimeout(() => {
      bar.style.transition = 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
      bar.style.width = target;
    }, 80);
  });
}

// ===== Countdown Timer =====
function startCountdown(el) {
  const end = new Date(el.dataset.end);
  function update() {
    const diff = end - Date.now();
    if (diff <= 0) { el.innerHTML = '<i class="fas fa-clock"></i> Ended'; return; }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (d > 0) el.innerHTML = `<i class="fas fa-clock"></i> Ends in ${d}d ${h}h`;
    else if (h > 0) el.innerHTML = `<i class="fas fa-clock"></i> Ends in ${h}h ${m}m`;
    else el.innerHTML = `<i class="fas fa-clock"></i> Ends in ${m}m ${s}s`;
  }
  update();
  setInterval(update, 1000);
}


// ===== Device Fingerprinting =====
async function generateDeviceFingerprint() {
  const parts = [];
  parts.push(`s:${screen.width}x${screen.height}x${screen.colorDepth}`);
  parts.push(`a:${screen.availWidth}x${screen.availHeight}`);
  parts.push(`pr:${window.devicePixelRatio || 1}`);
  parts.push(`tz:${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  parts.push(`tzo:${new Date().getTimezoneOffset()}`);
  parts.push(`p:${navigator.platform}`);
  parts.push(`l:${navigator.language}`);
  parts.push(`ls:${(navigator.languages || []).join(',')}`);
  parts.push(`c:${navigator.hardwareConcurrency || '?'}`);
  parts.push(`m:${navigator.deviceMemory || '?'}`);
  parts.push(`t:${navigator.maxTouchPoints || 0}`);

  try {
    const cv = document.createElement('canvas');
    cv.width = 200; cv.height = 50;
    const ctx = cv.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(10, 0, 100, 30);
    ctx.fillStyle = '#069';
    ctx.fillText('GVote FP', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('GVote FP', 4, 17);
    parts.push(`cv:${cv.toDataURL()}`);
  } catch (_) { parts.push('cv:n'); }

  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      const di = gl.getExtension('WEBGL_debug_renderer_info');
      if (di) {
        parts.push(`glv:${gl.getParameter(di.UNMASKED_VENDOR_WEBGL)}`);
        parts.push(`glr:${gl.getParameter(di.UNMASKED_RENDERER_WEBGL)}`);
      }
    }
  } catch (_) { parts.push('gl:n'); }

  const raw = parts.join('|');
  const data = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ===== QR Code Generator (simple canvas-based) =====
function generateQR(text, container) {
  // Create a simple QR-like visual using a QR API image
  const img = document.createElement('img');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}&bgcolor=0a0d1a&color=818cf8&format=svg`;
  img.alt = 'QR Code';
  img.style.cssText = 'width: 180px; height: 180px; border-radius: 8px; background: #fff; padding: 8px;';
  container.appendChild(img);
}

document.addEventListener('DOMContentLoaded', () => {

  // ===== Fingerprint Injection =====
  const fpField = document.getElementById('deviceFingerprint');
  if (fpField) {
    generateDeviceFingerprint().then(fp => { fpField.value = fp; }).catch(() => {});
  }

  // ===== Animated Counters (landing stats) =====
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('.stat-num').forEach(el => observer.observe(el));

  // ===== Animate Result Bars on Load =====
  animateResultBars();

  // ===== Countdown Timers =====
  document.querySelectorAll('[data-end]').forEach(el => startCountdown(el));

  // ===== Auto-dismiss Alerts =====
  document.querySelectorAll('.alert').forEach(el => {
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-8px)';
      setTimeout(() => el.remove(), 300);
    }, 5000);
  });

  // ===== Vote Form Handling =====
  const voteForm = document.getElementById('vote-form');
  if (voteForm) {
    const submitBtn = document.getElementById('vote-submit');
    voteForm.addEventListener('change', () => {
      const checked = voteForm.querySelectorAll('input[name="optionId"]:checked');
      if (submitBtn) submitBtn.disabled = checked.length === 0;
    });

    let submitted = false;
    voteForm.addEventListener('submit', (e) => {
      if (submitted) { e.preventDefault(); return; }
      const checked = voteForm.querySelectorAll('input[name="optionId"]:checked');
      if (checked.length === 0) { e.preventDefault(); return; }
      submitted = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Voting...';
      }
    });
  }

  // ===== Create Form — Poll Type Switching =====
  const pollTypeInputs = document.querySelectorAll('input[name="pollType"]');
  const optionsSection = document.getElementById('options-section');
  const allowMultipleLabel = document.getElementById('allow-multiple-label');

  if (pollTypeInputs.length > 0 && optionsSection) {
    pollTypeInputs.forEach(input => {
      input.addEventListener('change', () => {
        const type = input.value;
        if (type === 'choice') {
          optionsSection.style.display = '';
          if (allowMultipleLabel) allowMultipleLabel.style.display = '';
        } else {
          optionsSection.style.display = 'none';
          if (allowMultipleLabel) allowMultipleLabel.style.display = 'none';
        }
        // Update visual selection
        document.querySelectorAll('.poll-type-card').forEach(card => card.classList.remove('selected'));
        input.closest('.poll-type-card').classList.add('selected');
      });
    });
  }

  // ===== Create Form — Add/Remove Options =====
  const addBtn = document.getElementById('add-option');
  const optContainer = document.getElementById('options-container');
  if (addBtn && optContainer) {
    let optionCount = optContainer.querySelectorAll('.option-row').length;

    addBtn.addEventListener('click', () => {
      if (optionCount >= 50) return;
      optionCount++;
      const row = document.createElement('div');
      row.className = 'option-row';
      row.innerHTML = `
        <input type="text" name="options" placeholder="Option ${optionCount}" maxlength="200">
        <button type="button" class="option-remove" title="Remove"><i class="fas fa-times"></i></button>
      `;
      optContainer.appendChild(row);
      row.querySelector('input').focus();
    });

    optContainer.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.option-remove');
      if (removeBtn) {
        removeBtn.closest('.option-row').remove();
        optionCount--;
      }
    });
  }

  // ===== Share Tabs =====
  const shareTabs = document.querySelectorAll('.share-tab');
  if (shareTabs.length > 0) {
    shareTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        shareTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.share-content').forEach(c => c.style.display = 'none');
        const target = document.getElementById(`share-${tab.dataset.tab}`);
        if (target) target.style.display = '';
      });
    });

    // Generate QR code on first QR tab click
    const qrContainer = document.getElementById('qr-code');
    let qrGenerated = false;
    const qrTab = document.querySelector('.share-tab[data-tab="qr"]');
    if (qrTab && qrContainer) {
      qrTab.addEventListener('click', () => {
        if (!qrGenerated) {
          generateQR(window.location.href.replace('/embed', ''), qrContainer);
          qrGenerated = true;
        }
      });
    }
  }

  // ===== Copy Link Button =====
  function setupCopy(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (btn && input) {
      btn.addEventListener('click', () => {
        input.select();
        navigator.clipboard.writeText(input.value).then(() => {
          btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
          setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 2000);
        });
      });
    }
  }
  setupCopy('copy-link', 'share-url');
  setupCopy('copy-embed', 'embed-code');

  // ===== Live Results Auto-Refresh =====
  const resultsCard = document.getElementById('results-card');
  if (resultsCard) {
    const slug = resultsCard.dataset.slug;
    if (slug) {
      setInterval(async () => {
        try {
          const res = await fetch(`/v/${slug}/results.json`);
          if (!res.ok) return;
          const data = await res.json();
          updateResultsUI(data);
          // Flash the live indicator
          const liveDot = document.getElementById('live-dot');
          if (liveDot) {
            liveDot.style.opacity = '0.3';
            setTimeout(() => { liveDot.style.opacity = '1'; }, 300);
          }
        } catch (_) {}
      }, 5000);
    }
  }

  function updateResultsUI(data) {
    const list = document.getElementById('results-list');
    const totalEl = document.getElementById('total-votes-num');
    if (!list || !data.results) return;

    if (totalEl) totalEl.textContent = data.totalVotes.toLocaleString();

    list.innerHTML = data.results.map((r, i) => {
      const pct = data.totalVotes > 0 ? ((r.vote_count / data.totalVotes) * 100).toFixed(1) : 0;
      const isWinner = i === 0 && r.vote_count > 0;
      return `
        <div class="result-row${isWinner ? ' winner' : ''}">
          <div class="result-label">
            <span class="result-name">${isWinner ? '<i class="fas fa-trophy" style="color: #f59e0b;"></i> ' : ''}${escapeHtml(r.label)}</span>
            <span class="result-pct">${pct}%</span>
          </div>
          <div class="result-bar-bg">
            <div class="result-bar" style="width: ${pct}%"></div>
          </div>
          <div class="result-votes">${r.vote_count.toLocaleString()} vote${r.vote_count !== 1 ? 's' : ''}</div>
        </div>
      `;
    }).join('');
    // Animate new bars
    animateResultBars();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

});
