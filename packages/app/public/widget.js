(function () {
  "use strict";
  // Embeddable support widget loader. Drop on any site with:
  //   <script src="https://YOURHOST/widget.js" data-widget-key="KEY"></script>
  // It injects a floating bubble + a hidden <iframe> pointing at the host's
  // /widget page. All chat logic lives in the iframe (same-origin with the
  // API); this script only manages the bubble + open/close.
  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute("data-widget-key");
  if (!key) {
    console.error("[support-widget] missing data-widget-key");
    return;
  }
  var origin = new URL(script.src).origin;
  var Z = 2147483000;

  function el(tag, style) {
    var n = document.createElement(tag);
    for (var k in style) n.style[k] = style[k];
    return n;
  }

  // --- iframe panel --------------------------------------------------------
  var frame = el("iframe", {
    position: "fixed",
    bottom: "90px",
    right: "20px",
    width: "380px",
    height: "600px",
    maxHeight: "calc(100vh - 120px)",
    maxWidth: "calc(100vw - 40px)",
    border: "none",
    borderRadius: "16px",
    boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
    zIndex: String(Z),
    display: "none",
    background: "transparent",
  });
  frame.src = origin + "/widget?key=" + encodeURIComponent(key);
  frame.setAttribute("title", "Support chat");

  // --- bubble button -------------------------------------------------------
  var btn = el("button", {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    background: "#7c3aed",
    color: "#fff",
    boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
    zIndex: String(Z + 1),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
  });
  btn.setAttribute("aria-label", "Open support chat");

  var openIcon =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var closeIcon =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  btn.innerHTML = openIcon;

  var open = false;
  function setOpen(next) {
    open = next;
    frame.style.display = open ? "block" : "none";
    btn.innerHTML = open ? closeIcon : openIcon;
    btn.setAttribute(
      "aria-label",
      open ? "Close support chat" : "Open support chat",
    );
  }
  btn.addEventListener("click", function () {
    setOpen(!open);
  });

  function mount() {
    document.body.appendChild(frame);
    document.body.appendChild(btn);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
