const assert = require("node:assert/strict");
const { isTextField, prefersNumeric } = require("./field.js");

function el(tag, attrs = {}) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    disabled: !!attrs.disabled,
    readOnly: !!attrs.readOnly,
    type: attrs.type,
    getAttribute: (name) => attrs[name] ?? null,
    closest: (sel) => {
      if (sel === "[contenteditable]" && attrs.contenteditable != null) return node;
      return null;
    },
  };
  return node;
}

assert.equal(isTextField(el("input")), true);
assert.equal(isTextField(el("input", { type: "email" })), true);
assert.equal(isTextField(el("input", { type: "password" })), true);
assert.equal(isTextField(el("textarea")), true);
assert.equal(isTextField(el("input", { type: "checkbox" })), false);
assert.equal(isTextField(el("input", { type: "date" })), false);
assert.equal(isTextField(el("input", { disabled: true })), false);
assert.equal(isTextField(el("input", { inputmode: "none" })), false);
assert.equal(isTextField(el("div", { contenteditable: "true" })), true);
assert.equal(isTextField(el("button")), false);
assert.equal(prefersNumeric(el("input", { type: "tel" })), true);
assert.equal(prefersNumeric(el("input", { inputmode: "numeric" })), true);
assert.equal(prefersNumeric(el("input", { type: "email" })), false);

console.log("ok");
