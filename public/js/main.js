// ── Hamburger nav ─────────────────────────────────────────────────
const navToggle = document.getElementById('navToggle');
const navLinks  = document.getElementById('navLinks');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', open);
    // Animate the three bars into an X
    navToggle.classList.toggle('open', open);
  });

  // Close when a link is clicked (SPA-feel on mobile)
  navLinks.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      navToggle.classList.remove('open');
    });
  });

  // Close when clicking outside the nav
  document.addEventListener('click', e => {
    if (!navToggle.contains(e.target) && !navLinks.contains(e.target)) {
      navLinks.classList.remove('open');
      navToggle.classList.remove('open');
    }
  });
}

// ── Animate hamburger bars into X ────────────────────────────────
// (CSS handles the transform, JS just toggles the class)
// Add to main.css via the existing .nav-toggle.open rules below if needed

// ── Active nav link highlight ─────────────────────────────────────
const currentPath = window.location.pathname;
document.querySelectorAll('.nav-link').forEach(link => {
  if (link.getAttribute('href') === currentPath) {
    link.classList.add('nav-link-active');
  }
});

// ── Scroll: add background opacity to navbar on scroll ───────────
const navbar = document.querySelector('.navbar');
if (navbar) {
  const onScroll = () => {
    navbar.classList.toggle('navbar-scrolled', window.scrollY > 20);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ── Password eyeball — hold to reveal ────────────────────────────
document.querySelectorAll('.pw-eye').forEach(btn => {
  const input = document.getElementById(btn.dataset.target);
  if (!input) return;

  function reveal() {
    input.type = 'text';
    btn.classList.add('revealing');
    btn.setAttribute('aria-label', 'Revealing password');
  }
  function hide() {
    input.type = 'password';
    btn.classList.remove('revealing');
    btn.setAttribute('aria-label', 'Hold to reveal password');
  }

  // Mouse — hold down reveals, release hides
  btn.addEventListener('mousedown',  reveal);
  btn.addEventListener('mouseup',    hide);
  btn.addEventListener('mouseleave', hide);

  // Touch — press and hold reveals, lift hides
  btn.addEventListener('touchstart', e => { e.preventDefault(); reveal(); }, { passive: false });
  btn.addEventListener('touchend',   e => { e.preventDefault(); hide();   }, { passive: false });
});

// ── Admin check-in toggle ─────────────────────────────────────────
const checkinBtn = document.getElementById('checkinBtn');
if (checkinBtn) {
  checkinBtn.addEventListener('click', async () => {
    try {
      const res  = await fetch('/admin/checkin', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        const isIn = data.checkedIn;
        checkinBtn.className = `checkin-btn ${isIn ? 'checkin-in' : 'checkin-out'}`;
        checkinBtn.querySelector('.checkin-label').textContent = isIn ? 'On shift' : 'Off shift';
        checkinBtn.title = isIn
          ? 'You are checked in — click to check out'
          : 'Click to check in for your shift';
      }
    } catch(e) {}
  });
}
