/* @ds-bundle: {"format":4,"namespace":"FamilyOSDesignSystem_68d940","components":[{"name":"AllDayBar","sourcePath":"components/calendar/AllDayBar.jsx"},{"name":"DayHeader","sourcePath":"components/calendar/DayHeader.jsx"},{"name":"EventCard","sourcePath":"components/calendar/EventCard.jsx"},{"name":"MemberChip","sourcePath":"components/calendar/MemberChip.jsx"},{"name":"NowLine","sourcePath":"components/calendar/NowLine.jsx"},{"name":"TimeGutter","sourcePath":"components/calendar/TimeGutter.jsx"},{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"AvatarStack","sourcePath":"components/core/AvatarStack.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Checkbox","sourcePath":"components/core/Checkbox.jsx"},{"name":"Fab","sourcePath":"components/core/Fab.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"ProgressBar","sourcePath":"components/core/ProgressBar.jsx"},{"name":"StatPill","sourcePath":"components/core/StatPill.jsx"},{"name":"ListPanel","sourcePath":"components/lists/ListPanel.jsx"},{"name":"ListRow","sourcePath":"components/lists/ListRow.jsx"},{"name":"AppHeader","sourcePath":"components/nav/AppHeader.jsx"},{"name":"FAMILYOS_NAV","sourcePath":"components/nav/NavRail.jsx"},{"name":"NavRail","sourcePath":"components/nav/NavRail.jsx"},{"name":"MemberColumn","sourcePath":"components/tasks/MemberColumn.jsx"},{"name":"SectionLabel","sourcePath":"components/tasks/SectionLabel.jsx"},{"name":"TaskRow","sourcePath":"components/tasks/TaskRow.jsx"},{"name":"TimeOfDayTabs","sourcePath":"components/tasks/TimeOfDayTabs.jsx"}],"sourceHashes":{"components/calendar/AllDayBar.jsx":"3e99415e58bc","components/calendar/DayHeader.jsx":"a8870b944a52","components/calendar/EventCard.jsx":"46b08f6a6729","components/calendar/MemberChip.jsx":"a2243acc7f56","components/calendar/NowLine.jsx":"24cc18c7bdf3","components/calendar/TimeGutter.jsx":"0dacd3895c4b","components/core/Avatar.jsx":"b9786756a841","components/core/AvatarStack.jsx":"532d42fb044c","components/core/Badge.jsx":"2d232a30550f","components/core/Button.jsx":"560ea8565afa","components/core/Checkbox.jsx":"bbd8d0c0f65e","components/core/Fab.jsx":"7b6bccde6837","components/core/Icon.jsx":"eb3a16c5f170","components/core/IconButton.jsx":"338ac9a11735","components/core/ProgressBar.jsx":"e4c2f81561ea","components/core/StatPill.jsx":"74f5c9f0ab04","components/lists/ListPanel.jsx":"b7c17093b02d","components/lists/ListRow.jsx":"67073314c98a","components/nav/AppHeader.jsx":"96d8de1cdce3","components/nav/NavRail.jsx":"a97114cf380e","components/tasks/MemberColumn.jsx":"7c7d07a7a64f","components/tasks/SectionLabel.jsx":"24390a9fd049","components/tasks/TaskRow.jsx":"cc8208f8c4bf","components/tasks/TimeOfDayTabs.jsx":"0543917afcc4","ui_kits/wall-display/App.jsx":"deb38c317c95","ui_kits/wall-display/CalendarScreen.jsx":"c0e445c85ae2","ui_kits/wall-display/ListsScreen.jsx":"8e3e4543750e","ui_kits/wall-display/TasksScreen.jsx":"d2dd921baf77","ui_kits/wall-display/data.js":"c6aed0b8cea3"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.FamilyOSDesignSystem_68d940 = window.FamilyOSDesignSystem_68d940 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/calendar/AllDayBar.jsx
try { (() => {
function AllDayBar({
  label,
  tone = 'sage',
  multi = false,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      height: 34,
      padding: '0 14px',
      borderRadius: 'var(--radius-pill)',
      background: multi ? 'var(--stripe-multi)' : `var(--member-${tone}-soft)`,
      color: 'var(--text-title)',
      font: 'var(--type-card-title)',
      ...style
    }
  }, label);
}
Object.assign(__ds_scope, { AllDayBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/calendar/AllDayBar.jsx", error: String((e && e.message) || e) }); }

// components/calendar/NowLine.jsx
try { (() => {
function NowLine({
  top = 0,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      top,
      height: 2,
      background: 'var(--now-line)',
      pointerEvents: 'none',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: -5,
      top: -4,
      width: 10,
      height: 10,
      borderRadius: 'var(--radius-pill)',
      background: 'var(--now-line)'
    }
  }));
}
Object.assign(__ds_scope, { NowLine });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/calendar/NowLine.jsx", error: String((e && e.message) || e) }); }

// components/calendar/TimeGutter.jsx
try { (() => {
function TimeGutter({
  hours = ['10 AM', '11 AM', '12 PM', '1 PM'],
  rowHeight = 190,
  width = 76,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width,
      flex: `0 0 ${width}px`,
      position: 'relative',
      ...style
    }
  }, hours.map((h, i) => /*#__PURE__*/React.createElement("span", {
    key: h,
    style: {
      position: 'absolute',
      top: i * rowHeight - 9,
      right: 12,
      font: 'var(--fw-semibold) var(--fs-body)/1 var(--font-sans)',
      color: 'var(--text-muted)'
    }
  }, h)));
}
Object.assign(__ds_scope, { TimeGutter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/calendar/TimeGutter.jsx", error: String((e && e.message) || e) }); }

// components/core/Avatar.jsx
try { (() => {
function Avatar({
  name = '',
  src,
  tone = 'teal',
  size = 34,
  ring = true,
  style
}) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return /*#__PURE__*/React.createElement("span", {
    title: name,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      borderRadius: 'var(--radius-pill)',
      background: `var(--member-${tone}-soft)`,
      color: `var(--member-${tone}-ink)`,
      font: `var(--fw-bold) ${Math.round(size * .42)}px/1 var(--font-sans)`,
      boxShadow: ring ? '0 0 0 2px var(--white)' : 'none',
      overflow: 'hidden',
      flex: '0 0 auto',
      ...style
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : initial);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/calendar/MemberChip.jsx
try { (() => {
function MemberChip({
  name,
  src,
  tone = 'teal',
  count,
  active = true,
  onClick,
  style
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClick,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '5px 18px 5px 6px',
      border: 'none',
      borderRadius: 'var(--radius-pill)',
      background: active ? `var(--member-${tone}-soft)` : 'var(--surface-sunken)',
      color: 'var(--text-body)',
      font: 'var(--type-card-meta)',
      cursor: 'pointer',
      flex: '1 1 0',
      minWidth: 0,
      opacity: active ? 1 : .5,
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
    name: name,
    src: src,
    tone: tone,
    size: 30
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, name), count ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, count) : null);
}
Object.assign(__ds_scope, { MemberChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/calendar/MemberChip.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
const TONE = {
  coral: ['var(--accent-coral)', 'var(--white)'],
  amber: ['var(--accent-amber)', 'var(--white)'],
  teal: ['var(--accent-mint)', 'var(--white)'],
  lilac: ['var(--member-lilac-ink)', 'var(--white)'],
  neutral: ['var(--neutral-300)', 'var(--neutral-700)'],
  quiet: ['transparent', 'var(--text-muted)']
};
function Badge({
  children,
  tone = 'neutral',
  size = 26,
  style
}) {
  const [bg, fg] = TONE[tone] || TONE.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: size,
      height: size,
      padding: '0 7px',
      borderRadius: 'var(--radius-pill)',
      background: bg,
      color: fg,
      font: 'var(--fw-bold) var(--fs-caption)/1 var(--font-sans)',
      border: tone === 'quiet' ? '1px solid var(--border-card)' : 'none',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/calendar/DayHeader.jsx
try { (() => {
function DayHeader({
  weekday,
  date,
  today = false,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '14px 0 8px 18px',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-day-label)',
      color: 'var(--text-title)'
    }
  }, weekday, today ? '' : ' ' + date), today ? /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "coral",
    size: 30
  }, date) : null);
}
Object.assign(__ds_scope, { DayHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/calendar/DayHeader.jsx", error: String((e && e.message) || e) }); }

// components/core/AvatarStack.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function AvatarStack({
  people = [],
  max = 3,
  size = 30,
  style
}) {
  const shown = people.slice(0, max),
    extra = people.length - shown.length;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      ...style
    }
  }, shown.map((p, i) => /*#__PURE__*/React.createElement(__ds_scope.Avatar, _extends({
    key: i
  }, p, {
    size: size,
    style: {
      marginLeft: i ? -8 : 0
    }
  }))), extra > 0 ? /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "quiet",
    size: size,
    style: {
      marginLeft: -8,
      background: 'var(--white)'
    }
  }, "+", extra) : null);
}
Object.assign(__ds_scope, { AvatarStack });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/AvatarStack.jsx", error: String((e && e.message) || e) }); }

// components/calendar/EventCard.jsx
try { (() => {
function EventCard({
  title,
  time,
  tone = 'teal',
  multi = false,
  people = [],
  height,
  onClick,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    style: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      height,
      minHeight: 64,
      padding: '10px 12px',
      borderRadius: 'var(--radius-event)',
      background: multi ? 'var(--stripe-multi)' : `var(--member-${tone})`,
      color: 'var(--text-title)',
      cursor: onClick ? 'pointer' : 'default',
      overflow: 'hidden',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-card-title)'
    }
  }, title), time ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-card-meta)',
      color: 'var(--neutral-700)',
      marginTop: 2
    }
  }, time) : null, people.length ? /*#__PURE__*/React.createElement("span", {
    style: {
      marginTop: 'auto',
      alignSelf: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.AvatarStack, {
    people: people,
    size: 28
  })) : null);
}
Object.assign(__ds_scope, { EventCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/calendar/EventCard.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CDN = 'https://unpkg.com/lucide-static@0.544.0/icons/';
function Icon({
  name,
  size = 20,
  strokeColor = 'currentColor',
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    "aria-hidden": "true"
  }, rest, {
    style: {
      display: 'inline-block',
      width: size,
      height: size,
      flex: '0 0 auto',
      backgroundColor: strokeColor,
      WebkitMaskImage: `url(${CDN}${name}.svg)`,
      maskImage: `url(${CDN}${name}.svg)`,
      WebkitMaskRepeat: 'no-repeat',
      maskRepeat: 'no-repeat',
      WebkitMaskPosition: 'center',
      maskPosition: 'center',
      WebkitMaskSize: 'contain',
      maskSize: 'contain',
      ...style
    }
  }));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
const H = {
  sm: 36,
  md: 44
};
function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  disabled,
  onClick,
  style
}) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: H[size],
    padding: size === 'sm' ? '0 14px' : '0 18px',
    border: '1px solid var(--border-hairline)',
    borderRadius: 'var(--radius-pill)',
    background: 'var(--surface-card)',
    color: 'var(--text-body)',
    font: 'var(--type-card-meta)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? .45 : 1,
    transition: 'background var(--dur-fast) var(--ease-standard),transform var(--dur-fast) var(--ease-standard)',
    boxShadow: 'var(--shadow-raise)'
  };
  const v = variant === 'primary' ? {
    background: 'var(--brand-blue)',
    color: 'var(--text-on-fill)',
    border: '1px solid transparent'
  } : variant === 'ghost' ? {
    background: 'transparent',
    border: '1px solid transparent',
    boxShadow: 'none'
  } : null;
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: disabled,
    onClick: onClick,
    style: {
      ...base,
      ...v,
      ...style
    }
  }, icon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: size === 'sm' ? 16 : 18
  }) : null, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Checkbox.jsx
try { (() => {
function Checkbox({
  checked = false,
  tone = 'teal',
  size = 26,
  shape = 'rounded',
  onChange,
  label
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    role: "checkbox",
    "aria-checked": checked,
    "aria-label": label,
    onClick: () => onChange && onChange(!checked),
    style: {
      width: size,
      height: size,
      flex: '0 0 auto',
      borderRadius: shape === 'circle' ? 'var(--radius-pill)' : 'var(--radius-xs)',
      border: checked ? '1px solid transparent' : '1px solid var(--check-idle-border)',
      background: checked ? `var(--member-${tone})` : 'var(--check-idle)',
      color: checked ? `var(--member-${tone}-ink)` : 'transparent',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      transition: 'background var(--dur-fast) var(--ease-standard)'
    }
  }, checked ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: Math.round(size * .62)
  }) : null);
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/core/Fab.jsx
try { (() => {
function Fab({
  icon = 'plus',
  size = 64,
  label = 'Add',
  onClick,
  style
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": label,
    onClick: onClick,
    style: {
      position: 'absolute',
      right: 26,
      bottom: 26,
      width: size,
      height: size,
      borderRadius: 'var(--radius-pill)',
      border: 'none',
      background: 'var(--brand-blue)',
      color: 'var(--text-on-fill)',
      boxShadow: 'var(--shadow-fab)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: Math.round(size * .44)
  }));
}
Object.assign(__ds_scope, { Fab });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Fab.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function IconButton({
  icon,
  size = 44,
  label,
  onClick,
  style
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": label,
    onClick: onClick,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      borderRadius: 'var(--radius-pill)',
      border: '1px solid var(--border-hairline)',
      background: 'var(--surface-card)',
      color: 'var(--text-body)',
      cursor: 'pointer',
      boxShadow: 'var(--shadow-raise)',
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: Math.round(size * .45)
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/ProgressBar.jsx
try { (() => {
function ProgressBar({
  value = 0,
  max = 100,
  tone = 'teal',
  height = 10,
  style
}) {
  const pct = Math.max(0, Math.min(100, value / (max || 1) * 100));
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      height,
      borderRadius: 'var(--radius-pill)',
      background: `var(--member-${tone}-soft)`,
      overflow: 'hidden',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      width: pct + '%',
      height: '100%',
      borderRadius: 'var(--radius-pill)',
      background: `var(--member-${tone})`,
      transition: 'width var(--dur-slow) var(--ease-out-soft)'
    }
  }));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/core/StatPill.jsx
try { (() => {
function StatPill({
  icon = 'check',
  value,
  tone = 'sage',
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '3px 10px',
      borderRadius: 'var(--radius-pill)',
      background: `var(--member-${tone}-soft)`,
      color: `var(--member-${tone}-ink)`,
      font: 'var(--fw-bold) var(--fs-caption)/1 var(--font-sans)',
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 13
  }), value);
}
Object.assign(__ds_scope, { StatPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatPill.jsx", error: String((e && e.message) || e) }); }

// components/lists/ListPanel.jsx
try { (() => {
function ListPanel({
  title,
  count,
  tone = 'sand',
  children,
  footer,
  style
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      borderRadius: 'var(--radius-panel)',
      background: `var(--member-${tone}-soft)`,
      overflow: 'hidden',
      ...style
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '12px 14px 10px'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: 'var(--type-section)',
      color: 'var(--text-title)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, title), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: tone === 'sand' ? 'amber' : tone === 'teal' ? 'teal' : tone === 'lilac' ? 'lilac' : 'coral',
    size: 24
  }, count))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--gap-list-row)',
      padding: '0 10px 10px'
    }
  }, children), footer !== false ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      margin: 'auto 10px 12px',
      padding: '10px 6px',
      border: 'none',
      background: 'transparent',
      color: 'var(--text-faint)',
      font: 'var(--type-section)',
      cursor: 'pointer'
    }
  }, "Add section", /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-up",
    size: 20,
    style: {
      marginLeft: 'auto'
    }
  })) : null);
}
Object.assign(__ds_scope, { ListPanel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lists/ListPanel.jsx", error: String((e && e.message) || e) }); }

// components/lists/ListRow.jsx
try { (() => {
function ListRow({
  label,
  emoji,
  checked = false,
  tone = 'sand',
  onToggle,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      padding: 'var(--pad-list-row)',
      borderRadius: 'var(--radius-list-row)',
      background: `var(--member-${tone})`,
      opacity: checked ? .55 : 1,
      ...style
    }
  }, emoji ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16,
      lineHeight: 1
    }
  }, emoji) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-card-meta)',
      color: 'var(--text-title)',
      textDecoration: checked ? 'line-through' : 'none',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Checkbox, {
    checked: checked,
    tone: tone,
    onChange: onToggle,
    label: label
  })));
}
Object.assign(__ds_scope, { ListRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lists/ListRow.jsx", error: String((e && e.message) || e) }); }

// components/nav/AppHeader.jsx
try { (() => {
function AppHeader({
  title,
  time,
  temp,
  weatherIcon = 'cloud-sun',
  actions,
  style
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 18,
      padding: '14px 24px 10px',
      ...style
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--type-screen-title)',
      letterSpacing: 'var(--tracking-tight)'
    }
  }, title), time ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--fw-semibold) var(--fs-heading)/1 var(--font-sans)',
      color: 'var(--text-body)'
    }
  }, time) : null, temp ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      font: 'var(--fw-semibold) var(--fs-heading)/1 var(--font-sans)',
      color: 'var(--text-body)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: weatherIcon,
    size: 24,
    strokeColor: "var(--accent-amber)"
  }), temp) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, actions));
}
Object.assign(__ds_scope, { AppHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/nav/AppHeader.jsx", error: String((e && e.message) || e) }); }

// components/nav/NavRail.jsx
try { (() => {
const FAMILYOS_NAV = [{
  id: 'calendar',
  label: 'Calendar',
  icon: 'calendar'
}, {
  id: 'lists',
  label: 'Lists',
  icon: 'list'
}, {
  id: 'tasks',
  label: 'Tasks',
  icon: 'check'
}, {
  id: 'rewards',
  label: 'Rewards',
  icon: 'star'
}, {
  id: 'meals',
  label: 'Meals',
  icon: 'utensils'
}, {
  id: 'recipes',
  label: 'Recipes',
  icon: 'book-open'
}, {
  id: 'photos',
  label: 'Photos',
  icon: 'image'
}, {
  id: 'sleep',
  label: 'Sleep',
  icon: 'moon'
}, {
  id: 'settings',
  label: 'Settings',
  icon: 'settings'
}];
function NavRail({
  items = FAMILYOS_NAV,
  active = 'calendar',
  onSelect,
  brand = 'F',
  style
}) {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      width: 'var(--rail-width)',
      flex: '0 0 var(--rail-width)',
      background: 'var(--surface-rail)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 64,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: 'var(--fw-semibold) 24px/1 var(--font-display)',
      color: 'var(--neutral-600)',
      background: 'var(--surface-rail-active)'
    }
  }, brand), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      flex: 1
    }
  }, items.map(it => {
    const on = it.id === active;
    const spacer = it.id === 'sleep';
    return /*#__PURE__*/React.createElement("button", {
      key: it.id,
      type: "button",
      onClick: () => onSelect && onSelect(it.id),
      style: {
        appearance: 'none',
        border: 'none',
        cursor: 'pointer',
        background: on ? 'var(--white)' : 'transparent',
        color: on ? 'var(--text-title)' : 'var(--neutral-600)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: '13px 2px',
        marginTop: spacer ? 'auto' : 0,
        font: 'var(--type-nav-label)',
        transition: 'background var(--dur-fast) var(--ease-standard)'
      }
    }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: it.icon,
      size: 22
    }), it.label);
  })));
}
Object.assign(__ds_scope, { FAMILYOS_NAV, NavRail });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/nav/NavRail.jsx", error: String((e && e.message) || e) }); }

// components/tasks/SectionLabel.jsx
try { (() => {
function SectionLabel({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("h3", {
    style: {
      font: 'var(--type-section)',
      color: 'var(--text-title)',
      padding: '14px 4px 8px',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { SectionLabel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/tasks/SectionLabel.jsx", error: String((e && e.message) || e) }); }

// components/tasks/TaskRow.jsx
try { (() => {
function TaskRow({
  label,
  time,
  checked = false,
  tone = 'blush',
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: 'var(--pad-list-row)',
      borderRadius: 'var(--radius-list-row)',
      background: checked ? `var(--member-${tone})` : `var(--member-${tone}-soft)`,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-card-meta)',
      color: 'var(--text-title)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, label), time ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--fw-semibold) var(--fs-caption)/1.2 var(--font-sans)',
      color: 'var(--text-muted)',
      marginTop: 2
    }
  }, time) : null), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Checkbox, {
    checked: checked,
    tone: tone,
    shape: "circle",
    label: label
  })));
}
Object.assign(__ds_scope, { TaskRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/tasks/TaskRow.jsx", error: String((e && e.message) || e) }); }

// components/tasks/TimeOfDayTabs.jsx
try { (() => {
const TABS = [{
  id: 'morning',
  label: 'Morning',
  icon: 'sunrise'
}, {
  id: 'afternoon',
  label: 'Afternoon',
  icon: 'sun'
}, {
  id: 'evening',
  label: 'Evening',
  icon: 'moon'
}, {
  id: 'chores',
  label: 'Chores',
  icon: 'sparkles'
}];
function TimeOfDayTabs({
  tabs = TABS,
  active = 'morning',
  tone = 'blush',
  onSelect,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      justifyContent: 'space-between',
      ...style
    }
  }, tabs.map(t => {
    const on = t.id === active;
    return /*#__PURE__*/React.createElement("button", {
      key: t.id,
      type: "button",
      onClick: () => onSelect && onSelect(t.id),
      style: {
        flex: '1 1 0',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 5,
        padding: 0,
        color: on ? 'var(--text-title)' : 'var(--text-faint)',
        font: on ? 'var(--fw-bold) var(--fs-micro)/1.1 var(--font-sans)' : 'var(--fw-semibold) var(--fs-micro)/1.1 var(--font-sans)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 36,
        height: 36,
        borderRadius: 'var(--radius-pill)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: on ? `var(--member-${tone}-soft)` : 'transparent',
        border: on ? '2px solid var(--member-' + tone + ')' : '2px solid transparent'
      }
    }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: t.icon,
      size: 18,
      strokeColor: on ? `var(--member-${tone}-ink)` : 'var(--text-faint)'
    })), t.label);
  }));
}
Object.assign(__ds_scope, { TimeOfDayTabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/tasks/TimeOfDayTabs.jsx", error: String((e && e.message) || e) }); }

// components/tasks/MemberColumn.jsx
try { (() => {
function MemberColumn({
  name,
  src,
  tone = 'blush',
  done = 0,
  total = 20,
  points,
  activeTab = 'morning',
  onTab,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      flex: '1 1 0',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 'var(--radius-panel)',
      background: `var(--member-${tone}-soft)`,
      padding: '12px 14px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
    name: name,
    src: src,
    tone: tone,
    size: 38
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-section)',
      color: 'var(--text-title)'
    }
  }, name)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.StatPill, {
    icon: "check",
    value: `${done}/${total}`,
    tone: tone
  }), points != null ? /*#__PURE__*/React.createElement(__ds_scope.StatPill, {
    icon: "star",
    value: points,
    tone: "sand"
  }) : null), /*#__PURE__*/React.createElement(__ds_scope.ProgressBar, {
    value: done,
    max: total,
    tone: tone
  }), /*#__PURE__*/React.createElement(__ds_scope.TimeOfDayTabs, {
    active: activeTab,
    tone: tone,
    onSelect: onTab
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--gap-list-row)'
    }
  }, children));
}
Object.assign(__ds_scope, { MemberColumn });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/tasks/MemberColumn.jsx", error: String((e && e.message) || e) }); }

// ui_kits/wall-display/App.jsx
try { (() => {
const {
  NavRail
} = window.DS;
function App() {
  const [screen, setScreen] = React.useState('calendar');
  const [toast, setToast] = React.useState(null);
  const add = () => {
    setToast('New item sheet would open here');
    setTimeout(() => setToast(null), 1800);
  };
  const Screen = {
    calendar: window.CalendarScreen,
    lists: window.ListsScreen,
    tasks: window.TasksScreen
  }[screen];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100%',
      background: 'var(--surface-screen)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement(NavRail, {
    active: screen,
    onSelect: setScreen
  }), Screen ? /*#__PURE__*/React.createElement(Screen, {
    onAdd: add
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: 'var(--type-section)',
      color: 'var(--text-faint)'
    }
  }, "Not recreated \u2014 no source screenshot for this section"), toast ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: '50%',
      bottom: 26,
      transform: 'translateX(-50%)',
      background: 'var(--neutral-800)',
      color: '#fff',
      padding: '10px 18px',
      borderRadius: 'var(--radius-pill)',
      font: 'var(--type-card-meta)',
      boxShadow: 'var(--shadow-panel)'
    }
  }, toast) : null);
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/wall-display/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/wall-display/CalendarScreen.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  AppHeader,
  Button,
  MemberChip,
  DayHeader,
  AllDayBar,
  EventCard,
  TimeGutter,
  NowLine,
  Fab
} = window.DS;
const DAYS = [{
  key: 'wed',
  weekday: 'Wed',
  date: 18,
  today: true
}, {
  key: 'thu',
  weekday: 'Thu',
  date: 19
}, {
  key: 'fri',
  weekday: 'Fri',
  date: 20
}, {
  key: 'sat',
  weekday: 'Sat',
  date: 21
}, {
  key: 'sun',
  weekday: 'Sun',
  date: 22
}];
const ALLDAY = {
  wed: {
    label: 'Camping Trip',
    tone: 'sage'
  },
  sat: {
    label: 'Cousins Visit',
    multi: true
  }
};
function CalendarScreen({
  onAdd
}) {
  const [off, setOff] = React.useState({});
  const person = id => window.FAMILY.find(p => p.id === id) || {};
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minWidth: 0,
      background: 'var(--surface-screen)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement(AppHeader, {
    title: "Miller Family",
    time: "11:20 AM",
    temp: "80\xB0",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      icon: "columns-3"
    }, "Schedule"), /*#__PURE__*/React.createElement(Button, {
      icon: "eye-off"
    }, "Filter"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      padding: '0 24px 12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '5px 20px',
      border: '1px solid var(--border-card)',
      borderRadius: 'var(--radius-pill)',
      font: 'var(--type-card-meta)',
      whiteSpace: 'nowrap'
    }
  }, "\uD83C\uDF34 Vacation ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "48 days")), window.FAMILY.map(p => /*#__PURE__*/React.createElement(MemberChip, _extends({
    key: p.id
  }, p, {
    active: !off[p.id],
    onClick: () => setOff(o => ({
      ...o,
      [p.id]: !o[p.id]
    }))
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flex: 1,
      minHeight: 0,
      borderTop: '1px solid var(--surface-grid-line)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 76,
      flex: '0 0 76px'
    }
  }), DAYS.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: d.key,
    style: {
      flex: '1 1 0',
      minWidth: 0,
      borderLeft: '1px solid var(--surface-grid-line)',
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement(DayHeader, {
    weekday: d.weekday,
    date: d.date,
    today: d.today
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 34,
      padding: '0 6px'
    }
  }, ALLDAY[d.key] ? /*#__PURE__*/React.createElement(AllDayBar, _extends({}, ALLDAY[d.key], {
    style: {
      height: 30
    }
  })) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      flex: 1,
      overflow: 'hidden',
      borderTop: '1px solid var(--surface-grid-line)',
      marginTop: 8
    }
  }, i === 0 ? /*#__PURE__*/React.createElement(TimeGutter, {
    hours: ['10 AM', '11 AM', '12 PM', '1 PM'],
    rowHeight: 190,
    width: 70,
    style: {
      position: 'absolute',
      left: -76,
      top: 44,
      zIndex: 2
    }
  }) : null, [1, 2, 3].map(n => /*#__PURE__*/React.createElement("div", {
    key: n,
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: n * 190 + 44,
      borderTop: '1px solid var(--surface-grid-line)'
    }
  })), (window.EVENTS[d.key] || []).filter(e => !e.people.length || e.people.some(id => !off[id])).map((e, k) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      position: 'absolute',
      left: 6,
      right: 6,
      top: e.top + 44,
      height: e.height
    }
  }, /*#__PURE__*/React.createElement(EventCard, {
    title: e.title,
    time: e.time,
    tone: e.tone,
    multi: e.multi,
    height: "100%",
    people: e.people.map(id => ({
      name: person(id).name,
      tone: person(id).tone
    }))
  }))), d.today ? /*#__PURE__*/React.createElement(NowLine, {
    top: 224
  }) : null)))), /*#__PURE__*/React.createElement(Fab, {
    onClick: onAdd
  }));
}
window.CalendarScreen = CalendarScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/wall-display/CalendarScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/wall-display/ListsScreen.jsx
try { (() => {
const {
  AppHeader,
  Button,
  IconButton,
  ListPanel,
  ListRow,
  Fab
} = window.DS;
function ListsScreen({
  onAdd
}) {
  const [done, setDone] = React.useState({});
  const tog = k => setDone(p => ({
    ...p,
    [k]: !p[k]
  }));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minWidth: 0,
      background: 'var(--surface-screen)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement(AppHeader, {
    title: "Wed, Mar 12",
    time: "11:20 AM",
    temp: "80\xB0",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      icon: "eye-off"
    }, "Filter"), /*#__PURE__*/React.createElement(IconButton, {
      icon: "chevron-left",
      label: "Previous day",
      size: 40
    }), /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, "Today"), /*#__PURE__*/React.createElement(IconButton, {
      icon: "chevron-right",
      label: "Next day",
      size: 40
    }))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 14,
      padding: '4px 24px 24px',
      flex: 1,
      minHeight: 0
    }
  }, window.LISTS.map(l => /*#__PURE__*/React.createElement(ListPanel, {
    key: l.title,
    title: l.title,
    count: l.count,
    tone: l.tone,
    footer: l.title === 'Grocery List',
    style: {
      overflow: 'hidden'
    }
  }, l.items.map(([label, emoji]) => /*#__PURE__*/React.createElement(ListRow, {
    key: label,
    label: label,
    emoji: emoji,
    tone: l.tone,
    checked: !!done[l.title + label],
    onToggle: () => tog(l.title + label)
  }))))), /*#__PURE__*/React.createElement(Fab, {
    onClick: onAdd
  }));
}
window.ListsScreen = ListsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/wall-display/ListsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/wall-display/TasksScreen.jsx
try { (() => {
const {
  AppHeader,
  Button,
  IconButton,
  MemberColumn,
  SectionLabel,
  TaskRow,
  Fab
} = window.DS;
function TasksScreen({
  onAdd
}) {
  const [tabs, setTabs] = React.useState({});
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minWidth: 0,
      background: 'var(--surface-screen)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement(AppHeader, {
    title: "Wed, Mar 22",
    time: "8:00 AM",
    temp: "88\xB0",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      icon: "eye-off"
    }, "Filter"), /*#__PURE__*/React.createElement(IconButton, {
      icon: "chevron-left",
      label: "Previous day",
      size: 40
    }), /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, "Today"), /*#__PURE__*/React.createElement(IconButton, {
      icon: "chevron-right",
      label: "Next day",
      size: 40
    }))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 14,
      padding: '4px 24px 24px',
      flex: 1,
      minHeight: 0,
      overflow: 'hidden'
    }
  }, window.TASKS.map(m => /*#__PURE__*/React.createElement(MemberColumn, {
    key: m.name,
    name: m.name,
    tone: m.tone,
    done: m.done,
    total: m.total,
    points: m.points,
    activeTab: tabs[m.name] || 'morning',
    onTab: v => setTabs(t => ({
      ...t,
      [m.name]: v
    }))
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "Morning"), m.morning.map(([label, time, checked]) => /*#__PURE__*/React.createElement(TaskRow, {
    key: label,
    label: label,
    time: time,
    checked: checked,
    tone: m.tone
  })), /*#__PURE__*/React.createElement(SectionLabel, null, "Chores"), m.chores.map(([label, time, checked]) => /*#__PURE__*/React.createElement(TaskRow, {
    key: label,
    label: label,
    time: time,
    checked: checked,
    tone: m.tone
  }))))), /*#__PURE__*/React.createElement(Fab, {
    onClick: onAdd
  }));
}
window.TasksScreen = TasksScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/wall-display/TasksScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/wall-display/data.js
try { (() => {
window.FAMILY = [{
  id: 'dad',
  name: 'Dad',
  tone: 'teal',
  count: '1/20'
}, {
  id: 'ellie',
  name: 'Ellie',
  tone: 'blush',
  count: '1/20'
}, {
  id: 'harper',
  name: 'Harper',
  tone: 'lilac',
  count: '1/20'
}, {
  id: 'luke',
  name: 'Luke',
  tone: 'sage',
  count: '1/20'
}, {
  id: 'mom',
  name: 'Mom',
  tone: 'coral',
  count: '1/20'
}];
window.EVENTS = {
  wed: [{
    title: 'Grocery Run',
    time: '10 - 11:30 AM',
    tone: 'teal',
    top: 60,
    height: 150,
    people: ['dad']
  }, {
    title: "Amelia's Baby Shower",
    time: '12 - 1:30 PM',
    tone: 'coral',
    top: 280,
    height: 190,
    people: ['mom']
  }],
  thu: [{
    title: 'Coffee With Diane',
    time: '9:45 - 11 AM',
    tone: 'blush',
    top: 16,
    height: 180,
    people: ['mom']
  }, {
    title: "Dog's Big Bath Day!",
    time: '11 AM -12 PM',
    multi: true,
    top: 202,
    height: 150,
    people: ['luke', 'dad', 'mom']
  }, {
    title: 'Tutoring',
    time: '12:30 - 4 PM',
    tone: 'lilac',
    top: 358,
    height: 170,
    people: ['harper']
  }],
  fri: [{
    title: 'Pickup Dry Cleaning',
    time: '9:30 - 10:15 AM',
    tone: 'teal',
    top: 0,
    height: 96,
    people: ['dad']
  }, {
    title: 'History Test',
    time: '10:30 - 11 AM',
    tone: 'blush',
    top: 104,
    height: 96,
    people: ['ellie']
  }, {
    title: 'House Cleaner',
    time: '11:30 AM - 1:15 PM',
    tone: 'coral',
    top: 230,
    height: 210,
    people: ['harper']
  }],
  sat: [{
    title: "Emma's Birthday Party!",
    time: '10:30 - 12 PM',
    tone: 'lilac',
    top: 60,
    height: 250,
    people: ['harper']
  }, {
    title: 'Lunch with Grandma',
    time: '12-1:30 PM',
    multi: true,
    top: 318,
    height: 170,
    people: ['mom', 'harper', 'luke', 'ellie']
  }],
  sun: [{
    title: 'Golf',
    time: '10:30 - 11:45 AM',
    tone: 'teal',
    top: 70,
    height: 170,
    people: ['dad']
  }, {
    title: 'Guitar Lesson',
    time: '11 AM - 12:30 PM',
    tone: 'sage',
    top: 190,
    height: 200,
    people: ['ellie']
  }, {
    title: 'Pottery Class',
    time: '12:30 PM',
    tone: 'coral',
    top: 400,
    height: 150,
    people: []
  }]
};
window.LISTS = [{
  title: 'Grocery List',
  count: 5,
  tone: 'sand',
  items: [['Eggs', '🥚'], ['Milk', '🥛'], ['Bread', '🍞'], ['Apples', '🍎'], ['Lettuce', '🥬'], ['Hot Sauce', '🌶️'], ['Cookies', '🍪']]
}, {
  title: 'Packing List',
  count: 15,
  tone: 'blush',
  items: [['Shirts x5'], ['Jeans x2'], ['Undies x7'], ['Swimsuits x3'], ['Towel x2'], ['Sunscreen'], ['Aloe'], ['Shorts'], ['Dress x2']]
}, {
  title: 'To-Do',
  count: 7,
  tone: 'lilac',
  items: [['Pack for trip'], ['Pet sitter (Allie?)'], ['Stop mail'], ['Copy of keys'], ['Set up sprinklers'], ['Clean out fridge']]
}, {
  title: 'Travel Bucket Li…',
  count: 12,
  tone: 'teal',
  items: [['Japan', '🇯🇵'], ['Ireland', '🇮🇪'], ['Croatia', '🇭🇷'], ['Spain', '🇪🇸'], ['Costa Rica', '🇨🇷'], ['Easter Islands', '🗿'], ['Galapagos Islands', '🐢'], ['Greece', '🇬🇷'], ['Albania', '🇦🇱']]
}];
window.TASKS = [{
  name: 'Ellie',
  tone: 'blush',
  done: 3,
  total: 20,
  points: 10,
  morning: [['Make bed'], ['Get dressed'], ['Wash face'], ['Brush teeth']],
  chores: [['Wash dishes', '7 AM'], ['Feed dog', '7 PM'], ['Help parents']]
}, {
  name: 'Harper',
  tone: 'lilac',
  done: 2,
  total: 20,
  morning: [['Brush teeth'], ['Wash face'], ['Get dressed', null, true], ['Make bed', null, true]],
  chores: [['Water plants', '7 AM'], ['Put dishes away', '8 AM'], ['Help parents']]
}, {
  name: 'Luke',
  tone: 'teal',
  done: 4,
  total: 30,
  morning: [['Brush teeth', null, true], ['Get dressed', null, true], ['Make bed', null, true], ['Wash face', null, true]],
  chores: [['Take out trash', '7 AM'], ['Walk dog', '8 AM'], ['Help parents']]
}, {
  name: 'Mom',
  tone: 'coral',
  done: 1,
  total: 20,
  morning: [['Get dressed'], ['Make bed'], ['Wash face'], ['Brush teeth', null, true]],
  chores: [['Water garden', '7 AM'], ['Feed cat', '8 AM'], ['Help parents']]
}];
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/wall-display/data.js", error: String((e && e.message) || e) }); }

__ds_ns.AllDayBar = __ds_scope.AllDayBar;

__ds_ns.DayHeader = __ds_scope.DayHeader;

__ds_ns.EventCard = __ds_scope.EventCard;

__ds_ns.MemberChip = __ds_scope.MemberChip;

__ds_ns.NowLine = __ds_scope.NowLine;

__ds_ns.TimeGutter = __ds_scope.TimeGutter;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.AvatarStack = __ds_scope.AvatarStack;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Fab = __ds_scope.Fab;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.StatPill = __ds_scope.StatPill;

__ds_ns.ListPanel = __ds_scope.ListPanel;

__ds_ns.ListRow = __ds_scope.ListRow;

__ds_ns.AppHeader = __ds_scope.AppHeader;

__ds_ns.FAMILYOS_NAV = __ds_scope.FAMILYOS_NAV;

__ds_ns.NavRail = __ds_scope.NavRail;

__ds_ns.MemberColumn = __ds_scope.MemberColumn;

__ds_ns.SectionLabel = __ds_scope.SectionLabel;

__ds_ns.TaskRow = __ds_scope.TaskRow;

__ds_ns.TimeOfDayTabs = __ds_scope.TimeOfDayTabs;

})();
