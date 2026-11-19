export function bindWorkspaceWheel(dialog, trigger, currentDesk, navigate) {
  const stage = dialog.querySelector('#wheelStage');
  const options = [...stage.querySelectorAll('.wheel-option')];
  const enter = dialog.querySelector('#wheelEnter');
  const destination = enter.querySelector('strong');
  const description = dialog.querySelector('#wheelDescription');
  const anglePerStep = 360 / options.length;
  let step = 0;
  let gesture = null;
  let blockPointerClick = false;
  const selected = () => options[(step % options.length + options.length) % options.length];

  function rotate(offset = 0) {
    stage.style.setProperty('--wheel-turn', (offset - step * anglePerStep) + 'deg');
  }

  function select(next) {
    step = next;
    const option = selected();
    for (const button of options) {
      if (button === option) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    stage.dataset.destination = option.dataset.destination;
    destination.textContent = option.querySelector('strong').textContent;
    description.textContent = option.dataset.description;
    rotate();
  }

  function go(option) {
    dialog.close('navigate');
    navigate(option.dataset.destination);
  }

  function finishGesture(next = step) {
    gesture = null;
    stage.classList.remove('wheel-dragging');
    select(next);
  }

  trigger.addEventListener('click', () => {
    blockPointerClick = false;
    select(Math.max(0, options.findIndex(button => button.dataset.destination === currentDesk())));
    dialog.showModal();
  });
  dialog.querySelector('#wheelClose').addEventListener('click', () => dialog.close());
  enter.addEventListener('click', () => go(selected()));
  for (const option of options) option.addEventListener('click', () => go(option));

  // A completed swipe changes the selection. A subsequent intentional press opens it.
  dialog.addEventListener('pointerdown', event => {
    if (event.isPrimary) blockPointerClick = false;
  }, true);
  dialog.addEventListener('click', event => {
    if (blockPointerClick && event.detail > 0) {
      event.preventDefault();
      event.stopPropagation();
    } else if (event.target === dialog) {
      dialog.close();
    }
  }, true);

  stage.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    gesture = {id: event.pointerId, x: event.clientX, y: event.clientY, turning: false};
  });
  stage.addEventListener('pointermove', event => {
    if (gesture?.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.turning) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      blockPointerClick = true;
      if (Math.abs(dy) > Math.abs(dx)) {
        gesture = null;
        return;
      }
      gesture.turning = true;
      stage.setPointerCapture(event.pointerId);
      stage.classList.add('wheel-dragging');
    }
    const degrees = dx * anglePerStep / (stage.clientWidth * 0.35);
    rotate(Math.max(-anglePerStep, Math.min(anglePerStep, degrees)));
  });
  stage.addEventListener('pointerup', event => {
    if (gesture?.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const advance = gesture.turning && Math.abs(dx) >= 32 ? -Math.sign(dx) : 0;
    finishGesture(step + advance);
  });
  for (const type of ['pointercancel', 'lostpointercapture', 'pointerleave']) {
    stage.addEventListener(type, event => {
      if (gesture?.id !== event.pointerId) return;
      // Touch first captures on the pressed button, then hands off to the dial.
      if (type === 'lostpointercapture' && event.target !== stage) return;
      if (type === 'pointerleave' && gesture.turning) return;
      finishGesture();
    });
  }
  dialog.addEventListener('close', () => {
    gesture = null;
    stage.classList.remove('wheel-dragging');
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') return;
    event.stopPropagation();
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    select(step + (event.key === 'ArrowRight' ? 1 : -1));
    enter.focus({preventScroll: true});
  });
}
