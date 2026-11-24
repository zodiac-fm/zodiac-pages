// Review-only switch: which reader the page is for. The live page decides this from the
// signed-in member's subscription, not from a control.
document.querySelectorAll('[data-member-set]').forEach((button) => {
  button.addEventListener('click', () => {
    document.body.dataset.member = button.dataset.memberSet;
    document.querySelectorAll('[data-member-set]').forEach((other) => {
      other.setAttribute('aria-pressed', String(other === button));
    });
  });
});
