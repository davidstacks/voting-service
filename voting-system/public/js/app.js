// SecureVote client-side JS

// Device fingerprinting — generates a consistent hash from browser/device properties
async function generateDeviceFingerprint() {
  const components = [];

  // Screen properties
  components.push(`screen:${screen.width}x${screen.height}x${screen.colorDepth}`);
  components.push(`avail:${screen.availWidth}x${screen.availHeight}`);
  components.push(`pixelRatio:${window.devicePixelRatio || 1}`);

  // Timezone
  components.push(`tz:${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  components.push(`tzOffset:${new Date().getTimezoneOffset()}`);

  // Navigator properties
  components.push(`platform:${navigator.platform}`);
  components.push(`lang:${navigator.language}`);
  components.push(`langs:${(navigator.languages || []).join(',')}`);
  components.push(`cores:${navigator.hardwareConcurrency || 'unknown'}`);
  components.push(`memory:${navigator.deviceMemory || 'unknown'}`);
  components.push(`touch:${navigator.maxTouchPoints || 0}`);

  // Canvas fingerprint
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(10, 0, 100, 30);
    ctx.fillStyle = '#069';
    ctx.fillText('SecureVote FP', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('SecureVote FP', 4, 17);
    components.push(`canvas:${canvas.toDataURL()}`);
  } catch (_) { components.push('canvas:unsupported'); }

  // WebGL renderer
  try {
    const glCanvas = document.createElement('canvas');
    const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        components.push(`glVendor:${gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)}`);
        components.push(`glRenderer:${gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)}`);
      }
    }
  } catch (_) { components.push('webgl:unsupported'); }

  // Hash all components together with SHA-256
  const raw = components.join('|');
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  // Inject device fingerprint into vote form
  const fpField = document.getElementById('deviceFingerprint');
  if (fpField) {
    generateDeviceFingerprint().then(fp => { fpField.value = fp; }).catch(() => {});
  }
  // Auto-dismiss alerts
  document.querySelectorAll('.alert').forEach(alert => {
    setTimeout(() => {
      alert.style.opacity = '0';
      alert.style.transform = 'translateY(-10px)';
      setTimeout(() => alert.remove(), 300);
    }, 5000);
  });

  // Candidate selection
  document.querySelectorAll('.candidate-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.candidate-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
      const submitBtn = document.getElementById('vote-submit');
      if (submitBtn) submitBtn.disabled = false;
    });
  });

  // Vote form — ANTI-SPAM: disable button on submit, prevent double-click
  const voteForm = document.getElementById('vote-form');
  if (voteForm) {
    let voteSubmitted = false;

    voteForm.addEventListener('submit', (e) => {
      // Prevent double submission
      if (voteSubmitted) {
        e.preventDefault();
        return;
      }

      const selected = document.querySelector('.candidate-card.selected');
      if (!selected) {
        e.preventDefault();
        alert('Please select a candidate before submitting your vote.');
        return;
      }

      const name = selected.querySelector('.candidate-name')?.textContent || 'your selection';
      if (!confirm(`Are you sure you want to cast your vote for "${name}"?\n\nThis action CANNOT be undone. You can only vote ONCE.`)) {
        e.preventDefault();
        return;
      }

      // Lock the form — prevent any further submissions
      voteSubmitted = true;
      const submitBtn = document.getElementById('vote-submit');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting Vote...';
        submitBtn.style.opacity = '0.6';
        submitBtn.style.cursor = 'not-allowed';
      }
      // Disable all candidate cards
      document.querySelectorAll('.candidate-card').forEach(c => {
        c.style.pointerEvents = 'none';
        c.style.opacity = '0.6';
      });
    });
  }

  // Delete confirmations
  document.querySelectorAll('[data-confirm]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (!confirm(el.dataset.confirm)) {
        e.preventDefault();
      }
    });
  });

  // Sidebar active state
  const currentPath = window.location.pathname;
  document.querySelectorAll('.sidebar-nav a').forEach(link => {
    if (link.getAttribute('href') === currentPath) {
      link.classList.add('active');
    }
  });
});
