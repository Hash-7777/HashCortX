// ==============================================================
// The frame a generated business system is drawn in
//
// Its shell: a sidebar, tabs across the top, an icon dock, a strip of module
// cards, or a command-style bar — each with the system's name, its modules
// and its search, around the screen of the module that is open. Moved out of
// the Systems mode unchanged.
//
// Pure: everything it draws is passed in, and every value from the spec is
// escaped by the `esc` it is given. No DOM, no storage.
//
// Loaded after js/systems/icons.js, before the Systems mode, and published as
// window.HCSystemsShells. Checked by scripts/checks/systems-shells.mjs.
// ==============================================================

(function () {
  'use strict';

  /**
   * The whole app's markup for one shell. `o` carries the spec, the open
   * module and screen, the screen's markup, the search box, the class and
   * style strings, the open module's id, and `esc`.
   */
  function shellHtml(o) {
    const { spec, module, screen, screenDiv, searchInput, cls, vars, activeModuleId, esc } = o;
    const iconSvg = window.HCSystemsIcons.iconSvg;
    const shell = o.shell || "sidebar";
    const moduleNav = (btnClass = "sys-module-btn") => spec.modules.map(m => `
      <button class="${btnClass} ${m.id === activeModuleId ? "active" : ""}" data-module-id="${esc(m.id)}"
        ${m.color ? `style="--mod-color:${esc(m.color)}"` : ""}>
        <span class="sys-module-icon">${iconSvg(m.icon)}</span><span>${esc(m.name)}</span>
      </button>`).join("");

    switch (shell) {

      // ── Shell: SIDEBAR ───────────────────────────────────────────
      case "sidebar":
      default:
        return `
          <div class="sys-app sys-shell-sidebar ${cls}" style="${vars}">
            <nav class="sys-nav-sidebar">
              <div class="sys-nav-brand">
                <div class="sys-nav-logo" style="background:var(--sys-primary)">${esc(spec.name[0])}</div>
                <div><div class="sys-nav-title">${esc(spec.name)}</div><div class="sys-nav-sub">${esc(spec.description)}</div></div>
              </div>
              <div class="sys-module-list">${moduleNav()}</div>
            </nav>
            <section class="sys-app-main">
              <header class="sys-app-topbar">
                <div>
                  <div class="sys-breadcrumb">${esc(spec.name)} / ${esc(module.name)}</div>
                  <div class="sys-screen-title">${esc(module.name)}<span class="sys-screen-badge">${esc(screen)}</span></div>
                </div>
                ${searchInput}
              </header>
              ${screenDiv}
            </section>
          </div>`;

      // ── Shell: TOP TABS ──────────────────────────────────────────
      case "top":
        return `
          <div class="sys-app sys-shell-top ${cls}" style="${vars}">
            <header class="sys-topnav">
              <div class="sys-topnav-brand">
                <div class="sys-topnav-dot" style="background:var(--sys-primary)"></div>
                <span class="sys-topnav-name">${esc(spec.name)}</span>
              </div>
              <div class="sys-topnav-tabs">
                ${spec.modules.map(m => `
                  <button class="sys-topnav-tab ${m.id === activeModuleId ? "active" : ""}" data-module-id="${esc(m.id)}">
                    <span class="sys-module-icon">${iconSvg(m.icon)}</span>${esc(m.name)}
                  </button>`).join("")}
              </div>
              <div class="sys-topnav-right">${searchInput}</div>
            </header>
            <div class="sys-shell-body">
              <div class="sys-top-breadcrumb">
                <span>${esc(module.name)}</span><span class="sys-screen-badge">${esc(screen)}</span>
              </div>
              ${screenDiv}
            </div>
          </div>`;

      // ── Shell: ICON DOCK ─────────────────────────────────────────
      case "dock":
        return `
          <div class="sys-app sys-shell-dock ${cls}" style="${vars}">
            <nav class="sys-dock">
              <div class="sys-dock-logo" style="background:var(--sys-primary)">${esc(spec.name[0])}</div>
              <div class="sys-dock-divider"></div>
              ${spec.modules.map(m => `
                <button class="sys-dock-btn ${m.id === activeModuleId ? "active" : ""}" data-module-id="${esc(m.id)}" title="${esc(m.name)}">
                  <span class="sys-module-icon">${iconSvg(m.icon)}</span>
                  <span class="sys-dock-tooltip">${esc(m.name)}</span>
                </button>`).join("")}
            </nav>
            <section class="sys-app-main">
              <header class="sys-dock-topbar">
                <div class="sys-dock-breadcrumb">
                  <span class="sys-dock-module-name">${esc(module.name)}</span>
                  <span class="sys-screen-badge">${esc(screen)}</span>
                </div>
                ${searchInput}
              </header>
              ${screenDiv}
            </section>
          </div>`;

      // ── Shell: CARD PICKER ───────────────────────────────────────
      case "cards-nav":
        return `
          <div class="sys-app sys-shell-cardsnav ${cls}" style="${vars}">
            <header class="sys-cardsnav-header">
              <div class="sys-cardsnav-brand">
                <div class="sys-cardsnav-logo" style="background:var(--sys-primary)">${esc(spec.name[0])}</div>
                <div>
                  <div class="sys-cardsnav-title">${esc(spec.name)}</div>
                  <div class="sys-cardsnav-desc">${esc(spec.description)}</div>
                </div>
              </div>
              ${searchInput}
            </header>
            <div class="sys-cardsnav-modules">
              ${spec.modules.map(m => `
                <button class="sys-cardsnav-module-btn ${m.id === activeModuleId ? "active" : ""}" data-module-id="${esc(m.id)}"
                  style="${m.color ? `--mod-color:${esc(m.color)}` : `--mod-color:var(--sys-primary)`}">
                  <span class="sys-cardsnav-icon">${iconSvg(m.icon)}</span>
                  <span class="sys-cardsnav-label">${esc(m.name)}</span>
                </button>`).join("")}
            </div>
            <div class="sys-cardsnav-content">
              ${screenDiv}
            </div>
          </div>`;

      // ── Shell: COMMAND (VS Code style) ───────────────────────────
      case "command":
        return `
          <div class="sys-app sys-shell-command ${cls}" style="${vars}">
            <div class="sys-cmd-bar">
              <div class="sys-cmd-brand">
                <span class="sys-cmd-logo" style="background:var(--sys-primary)">${esc(spec.name[0])}</span>
                <span class="sys-cmd-name">${esc(spec.name)}</span>
                <span class="sys-cmd-sep">›</span>
                <span class="sys-cmd-module">${esc(module.name)}</span>
              </div>
              ${searchInput}
            </div>
            <div class="sys-cmd-body">
              <nav class="sys-cmd-sidebar">
                ${spec.modules.map(m => `
                  <button class="sys-cmd-nav-btn ${m.id === activeModuleId ? "active" : ""}" data-module-id="${esc(m.id)}">
                    <span class="sys-module-icon">${iconSvg(m.icon)}</span>
                    <span class="sys-cmd-nav-label">${esc(m.name)}</span>
                    ${m.id === activeModuleId ? `<span class="sys-screen-badge" style="margin-left:auto">${esc(screen)}</span>` : ""}
                  </button>`).join("")}
              </nav>
              <main class="sys-cmd-main">
                ${screenDiv}
              </main>
            </div>
          </div>`;
    }
  }

  window.HCSystemsShells = { shellHtml, SHELLS: ["sidebar", "top", "dock", "cards-nav", "command"] };
})();
