(() => {
  const ALPHA = [
    "qwertyuiop".split(""),
    "asdfghjkl".split(""),
    ["shift", ..."zxcvbnm".split(""), "backspace"],
    ["num", "comma", "space", "period", "enter"],
  ];
  const NUMERIC = [
    "1234567890".split(""),
    "-/:;()$&@".split(""),
    ["#+=", ".", ",", "?", "!", "'", "backspace"],
    ["abc", "space", "enter"],
  ];
  const SYMBOLS = [
    "[]{}#%^*+=".split(""),
    "_\\|~<>€£¥•".split(""),
    ["123", ".", ",", "?", "!", "'", "backspace"],
    ["abc", "space", "enter"],
  ];

  const LABELS = {
    shift: "⇧",
    backspace: "⌫",
    enter: "Go",
    space: "",
    num: "123",
    abc: "ABC",
    comma: ",",
    period: ".",
    "#+=": "#+=",
    123: "123",
  };

  let host = null;
  let root = null;
  let shifted = false;
  let caps = false;
  let layout = "alpha";
  let holding = null;
  let focused = null;
  let lastField = null;
  let lastFocusAt = 0;
  let shiftTaps = 0;

  const topFrame = window === window.top;

  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "render" && topFrame) {
      if (msg.visible) showBoard(msg.numeric);
      else hideBoard();
    }
    if (msg.type === "insert") {
      const target = focused || (Date.now() - lastFocusAt < 2000 ? lastField : null);
      if (target) insert(target, msg.key);
    }
  });

  function onFocusIn(e) {
    if (!isTextField(e.target)) return;
    focused = e.target;
    lastField = e.target;
    lastFocusAt = Date.now();
    try {
      focused.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {
      /* ignore */
    }
    send({ type: "show", numeric: prefersNumeric(focused) });
  }

  function onFocusOut() {
    focused = null;
    send({ type: "hide" });
  }

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg);
    } catch {
      /* extension reloaded */
    }
  }

  function showBoard(numeric) {
    ensureBoard();
    if (numeric) layout = "numeric";
    else if (layout === "numeric" || layout === "symbols") layout = "alpha";
    host.style.display = "block";
    renderKeys();
  }

  function hideBoard() {
    if (!host) return;
    host.style.display = "none";
    shifted = false;
    caps = false;
    layout = "alpha";
  }

  function ensureBoard() {
    if (host) return;
    host = document.createElement("div");
    host.id = "familyos-osk";
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.left = "0";
    host.style.right = "0";
    host.style.bottom = "0";
    host.style.zIndex = "2147483647";
    host.style.display = "none";
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${css}</style><div class="bar"></div>`;
    const bar = root.querySelector(".bar");
    bar.addEventListener("pointerdown", onPointerDown);
    bar.addEventListener("pointerup", onPointerUp);
    bar.addEventListener("pointercancel", onPointerUp);
    document.documentElement.appendChild(host);
  }

  function rowsForLayout() {
    if (layout === "numeric") return NUMERIC;
    if (layout === "symbols") return SYMBOLS;
    return ALPHA;
  }

  function renderKeys() {
    const bar = root.querySelector(".bar");
    bar.replaceChildren();
    for (const row of rowsForLayout()) {
      const rowEl = document.createElement("div");
      rowEl.className = "row";
      for (const key of row) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.key = key;
        btn.className = "key" + (wideClass(key) ? ` ${wideClass(key)}` : "");
        if (key === "shift" && (shifted || caps)) btn.classList.add("active");
        btn.textContent = labelFor(key);
        rowEl.appendChild(btn);
      }
      bar.appendChild(rowEl);
    }
  }

  function wideClass(key) {
    if (key === "space") return "space";
    if (key === "shift" || key === "backspace" || key === "enter") return "mod";
    if (key === "num" || key === "abc" || key === "#+=" || key === "123") return "mod";
    return "";
  }

  function labelFor(key) {
    if (LABELS[key] != null) return LABELS[key] || "\u00a0";
    if (layout === "alpha" && key.length === 1) {
      return shifted || caps ? key.toUpperCase() : key;
    }
    return key;
  }

  function onPointerDown(e) {
    e.preventDefault();
    const btn = e.target.closest("[data-key]");
    if (!btn) return;
    btn.classList.add("press");
    const key = btn.dataset.key;
    handleKey(key);
    if (key === "backspace") {
      holding = setTimeout(() => {
        holding = setInterval(() => handleKey("backspace"), 70);
      }, 400);
    }
  }

  function onPointerUp(e) {
    root.querySelectorAll(".press").forEach((n) => n.classList.remove("press"));
    if (holding) {
      clearTimeout(holding);
      clearInterval(holding);
      holding = null;
    }
    e.preventDefault();
  }

  function handleKey(key) {
    if (key === "shift") {
      shiftTaps += 1;
      setTimeout(() => {
        shiftTaps = 0;
      }, 400);
      if (shiftTaps >= 2) {
        caps = !caps;
        shifted = false;
      } else {
        caps = false;
        shifted = !shifted;
      }
      renderKeys();
      return;
    }
    if (key === "num" || key === "123") {
      layout = "numeric";
      shifted = false;
      renderKeys();
      return;
    }
    if (key === "#+=") {
      layout = "symbols";
      renderKeys();
      return;
    }
    if (key === "abc") {
      layout = "alpha";
      renderKeys();
      return;
    }

    let ch = key;
    if (key === "space") ch = " ";
    if (key === "comma") ch = ",";
    if (key === "period") ch = ".";
    if (key === "backspace") ch = "Backspace";
    if (key === "enter") ch = "Enter";
    if (layout === "alpha" && ch.length === 1 && (shifted || caps)) ch = ch.toUpperCase();

    send({ type: "key", key: ch });

    if (shifted && !caps && ch.length === 1) {
      shifted = false;
      renderKeys();
    }
  }

  function insert(el, key) {
    el.focus();
    if (key === "Backspace") {
      if (!document.execCommand("delete") && "value" in el) {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        const next =
          start === end
            ? el.value.slice(0, Math.max(0, start - 1)) + el.value.slice(end)
            : el.value.slice(0, start) + el.value.slice(end);
        setVal(el, next);
        const pos = start === end ? Math.max(0, start - 1) : start;
        try {
          el.setSelectionRange(pos, pos);
        } catch {
          /* some types reject selection */
        }
      }
      fire(el, "deleteContentBackward");
      return;
    }
    if (key === "Enter") {
      if (el.tagName === "TEXTAREA" || el.isContentEditable) {
        document.execCommand("insertText", false, "\n");
        fire(el, "insertLineBreak");
        return;
      }
      const form = el.form;
      if (form) {
        const submit = form.querySelector(
          '[type="submit"], button:not([type]), button[type="submit"]',
        );
        if (submit) submit.click();
        else if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
      } else {
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }),
        );
      }
      return;
    }
    if (!document.execCommand("insertText", false, key) && "value" in el) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      setVal(el, el.value.slice(0, start) + key + el.value.slice(end));
      try {
        el.setSelectionRange(start + key.length, start + key.length);
      } catch {
        /* ignore */
      }
    }
    fire(el, "insertText");
  }

  function setVal(el, v) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  }

  function fire(el, inputType) {
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const css = `
    :host { all: initial; }
    .bar {
      box-sizing: border-box;
      padding: 12px 16px 18px;
      background: #eef4f8;
      border-top: 1px solid #e3ebf1;
      font-family: "Nunito Sans", "DejaVu Sans", system-ui, sans-serif;
      user-select: none;
      -webkit-user-select: none;
      touch-action: manipulation;
    }
    .row {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-top: 8px;
    }
    .row:first-child { margin-top: 0; }
    .key {
      flex: 1 1 0;
      max-width: 108px;
      height: 62px;
      margin: 0;
      border: 0;
      border-radius: 14px;
      background: #ffffff;
      color: #2e3a45;
      font: 700 22px/1 "Nunito Sans", "DejaVu Sans", system-ui, sans-serif;
      box-shadow: 0 1px 2px rgba(31,42,51,.06);
      cursor: default;
    }
    .key.mod { max-width: 132px; background: #e3ebf1; font-size: 18px; font-weight: 600; color: #3f4b55; }
    .key.space { flex: 4 1 0; max-width: none; }
    .key[data-key="enter"] { background: #1878c8; color: #fff; }
    .key.active { background: #dcebf6; color: #1878c8; }
    .key.press { transform: scale(.97); }
  `;
})();
