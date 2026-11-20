/**
 * Two-step button for actions that can't be undone (remove a key, clear history):
 * the first click shows "Confirm" for 4 seconds, the second click runs the action.
 * The button keeps its width, so the second click lands in the same place, and a
 * screen reader hears what to do.
 * @param {HTMLButtonElement} btn
 * @param {(e: Event) => any} action
 * @param {string} [armedLabel]
 */
export function confirmClick(btn, action, armedLabel = "Confirm") {
  if (!btn) return;
  let timer = null;
  const disarm = () => {
    clearTimeout(timer);
    if (btn.dataset.armed === "1") {
      btn.dataset.armed = "";
      btn.textContent = btn.dataset.idleLabel;
      btn.style.minWidth = "";
    }
  };
  btn.addEventListener("click", async (e) => {
    if (btn.dataset.armed !== "1") {
      btn.dataset.idleLabel = btn.textContent;
      btn.style.minWidth = `${btn.offsetWidth}px`;
      btn.dataset.armed = "1";
      btn.textContent = armedLabel;
      say(`Press again to confirm: ${btn.dataset.idleLabel}`);
      timer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    await action(e);
  });
  btn.addEventListener("blur", disarm);
}

/** A polite live region shared by every two-step button on the page. */
function say(text) {
  let el = document.getElementById("confirm-live");
  if (!el) {
    el = document.createElement("div");
    el.id = "confirm-live";
    el.className = "visually-hidden";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = "";
  setTimeout(() => { el.textContent = text; }, 30);
}
