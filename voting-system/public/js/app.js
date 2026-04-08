// GVote — Voting Hosting Platform Client JS

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
        } catch (_) {}
      }, 5000);
    }
  }

  function updateResultsUI(data) {
    const list = document.getElementById('results-list');
    const totalEl = document.getElementById('total-votes-num');
    if (!list || !data.results) return;

    if (totalEl) totalEl.textContent = data.totalVotes;

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
          <div class="result-votes">${r.vote_count} vote${r.vote_count !== 1 ? 's' : ''}</div>
        </div>
      `;
    }).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

});
