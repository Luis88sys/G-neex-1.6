/**
 * Ayuda G-NEEX: overlay propio (sin .modal ni <dialog>), z-index muy alto.
 * Expone window.gneexOpenHelp / window.gneexCloseHelp para HelpCoach y tecla Escape.
 */
(function () {
  function root() {
    return document.getElementById("help-modal");
  }

  function open() {
    if (typeof HelpCoach !== "undefined" && HelpCoach.active && HelpCoach.setActive) {
      HelpCoach.setActive(false);
    }
    var r = root();
    if (!r) return;
    r.hidden = false;
    r.setAttribute("aria-hidden", "false");
    try {
      document.documentElement.style.overflow = "hidden";
    } catch (e) {}
    var panel = r.querySelector(".gneex-help-panel");
    if (panel) {
      try {
        panel.focus();
      } catch (e2) {}
    }
    if (typeof HelpCoach !== "undefined" && HelpCoach.syncToggleButtonLabel) {
      HelpCoach.syncToggleButtonLabel();
    }
    try {
      var pBlock = document.getElementById("help-presentations-block");
      if (pBlock) {
        var isAdmin = typeof Auth !== "undefined" && Auth.isAdmin && Auth.isAdmin();
        pBlock.hidden = !isAdmin;
      }
    } catch (e3) {}
  }

  function close() {
    var r = root();
    if (!r) return;
    r.hidden = true;
    r.setAttribute("aria-hidden", "true");
    try {
      document.documentElement.style.overflow = "";
    } catch (e) {}
  }

  window.gneexOpenHelp = open;
  window.gneexCloseHelp = close;

  function bind() {
    var openBtn = document.getElementById("gneex-help-open");
    var r = root();
    if (openBtn) {
      openBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        open();
      });
    }
    if (!r) return;
    var closers = r.querySelectorAll("[data-gneex-help-close]");
    for (var i = 0; i < closers.length; i++) {
      closers[i].addEventListener("click", function (ev) {
        ev.preventDefault();
        close();
      });
    }
    /** Manuales y presentaciones HTML: evita bfCache / pestaña vieja sin recargar el documento. */
    var docLinks = r.querySelectorAll("a.help-manual-link[href]");
    for (var j = 0; j < docLinks.length; j++) {
      docLinks[j].addEventListener("click", function (ev) {
        var el = ev.currentTarget;
        var raw = el.getAttribute("href");
        if (!raw) return;
        var pathPart = raw.split("#")[0];
        if (pathPart.indexOf(".html") === -1) return;
        ev.preventDefault();
        var hash = raw.indexOf("#") >= 0 ? raw.slice(raw.indexOf("#")) : "";
        var sep = pathPart.indexOf("?") >= 0 ? "&" : "?";
        var url = pathPart + sep + "_cb=" + Date.now() + hash;
        window.open(url, el.target || "_blank", "noopener,noreferrer");
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
