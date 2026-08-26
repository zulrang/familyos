const SKIP_TYPES = new Set([
  "hidden",
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "file",
  "image",
  "range",
  "color",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

function isTextField(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.disabled || el.readOnly) return false;
  if (el.getAttribute("inputmode") === "none") return false;

  const editable = el.closest("[contenteditable]");
  if (editable && editable.getAttribute("contenteditable") !== "false")
    return true;

  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  return !SKIP_TYPES.has((el.type || "text").toLowerCase());
}

function prefersNumeric(el) {
  if (!el) return false;
  const type = (el.type || "").toLowerCase();
  const mode = (el.getAttribute("inputmode") || "").toLowerCase();
  return (
    type === "number" ||
    type === "tel" ||
    mode === "numeric" ||
    mode === "decimal" ||
    mode === "tel"
  );
}

if (typeof module !== "undefined")
  module.exports = { isTextField, prefersNumeric };
