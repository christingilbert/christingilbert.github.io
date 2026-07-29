/* Shared contact modal — injects the dialog and wires #open-contact / .js-open-contact.
   No-ops if a page already has its own inline #contact-modal. */
(function () {
  if (document.getElementById('contact-modal')) return;

  var F = "'Hanken Grotesk',sans-serif";
  var html =
    '<div id="contact-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" style="display:none; position:fixed; inset:0; z-index:1000; background:rgba(26,20,35,0.85); backdrop-filter:blur(4px); padding:2rem; align-items:center; justify-content:center;" hidden>' +
      '<div style="background:#FAF3EF; max-width:520px; width:100%; padding:3rem; position:relative;">' +
        '<button id="modal-close" aria-label="Close contact form" style="position:absolute; top:1.2rem; right:1.4rem; background:none; border:none; cursor:pointer; font-family:' + F + '; font-size:12px; letter-spacing:0.14em; text-transform:uppercase; color:#1A1423;">&#x2715; Close</button>' +
        '<div style="font-family:' + F + '; font-size:12px; letter-spacing:0.22em; text-transform:uppercase; color:#6E4658; margin-bottom:0.75rem;">Get in touch</div>' +
        '<h2 id="modal-title" style="font-family:\'Playfair Display\',serif; font-size:1.6rem; font-weight:400; color:#1A1423; margin-bottom:2rem; line-height:1.2;">Let’s work together</h2>' +
        '<form id="contact-form" action="https://formspree.io/f/maqpbolp" method="POST">' +
          '<div style="margin-bottom:1.25rem;"><label for="contact-name" style="display:block; font-family:' + F + '; font-size:12px; letter-spacing:0.16em; text-transform:uppercase; color:#1A1423; margin-bottom:0.4rem;">Name</label>' +
          '<input type="text" id="contact-name" name="name" required style="width:100%; padding:0.7rem 0.9rem; background:transparent; border:1px solid #CBB4C3; font-family:' + F + '; font-size:1rem; color:#1A1423; outline:none;" placeholder="Your name"></div>' +
          '<div style="margin-bottom:1.25rem;"><label for="contact-email" style="display:block; font-family:' + F + '; font-size:12px; letter-spacing:0.16em; text-transform:uppercase; color:#1A1423; margin-bottom:0.4rem;">Email</label>' +
          '<input type="email" id="contact-email" name="email" required style="width:100%; padding:0.7rem 0.9rem; background:transparent; border:1px solid #CBB4C3; font-family:' + F + '; font-size:1rem; color:#1A1423; outline:none;" placeholder="your@email.com"></div>' +
          '<div style="margin-bottom:1.75rem;"><label for="contact-message" style="display:block; font-family:' + F + '; font-size:12px; letter-spacing:0.16em; text-transform:uppercase; color:#1A1423; margin-bottom:0.4rem;">Message</label>' +
          '<textarea id="contact-message" name="message" required rows="5" style="width:100%; padding:0.7rem 0.9rem; background:transparent; border:1px solid #CBB4C3; font-family:' + F + '; font-size:1rem; color:#1A1423; outline:none; resize:vertical;" placeholder="What’s on your mind?"></textarea></div>' +
          '<div id="form-status" style="display:none; font-family:' + F + '; font-size:12px; letter-spacing:0.1em; margin-bottom:1rem;"></div>' +
          '<button type="submit" style="font-family:' + F + '; font-size:12px; letter-spacing:0.14em; text-transform:uppercase; color:#FAF3EF; background:#6E4658; border:1px solid #6E4658; padding:0.7rem 1.6rem; border-radius:999px; cursor:pointer; transition:background 0.2s;">Send Message</button>' +
        '</form>' +
      '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', html);

  var modal = document.getElementById('contact-modal');
  var openBtns = Array.prototype.slice.call(document.querySelectorAll('#open-contact, .js-open-contact'));
  var closeBtn = document.getElementById('modal-close');
  var form = document.getElementById('contact-form');
  var status = document.getElementById('form-status');
  var lastTrigger = null;
  if (!openBtns.length || !modal) return;

  function openModal() {
    modal.hidden = false;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }
  function closeModal() {
    modal.hidden = true;
    modal.style.display = 'none';
    document.body.style.overflow = '';
    if (lastTrigger) lastTrigger.focus();
  }

  openBtns.forEach(function (btn) {
    btn.addEventListener('click', function (e) { e.preventDefault(); lastTrigger = btn; openModal(); });
  });

  modal.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || modal.hidden) return;
    var els = modal.querySelectorAll('button, [href], input, select, textarea');
    if (!els.length) return;
    var first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = new FormData(form);
    fetch(form.action, { method: 'POST', body: data, headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (res.ok) {
          status.style.display = 'block';
          status.style.color = '#6E4658';
          status.textContent = 'Message sent, thank you. I’ll be in touch soon.';
          form.reset();
          if (window.cgBurst) window.cgBurst(form.querySelector('button[type="submit"]'));
        } else {
          status.style.display = 'block';
          status.style.color = '#c0392b';
          status.textContent = 'Something went wrong. Please try again.';
        }
      })
      .catch(function () {
        status.style.display = 'block';
        status.style.color = '#c0392b';
        status.textContent = 'Something went wrong. Please try again.';
      });
  });
})();
