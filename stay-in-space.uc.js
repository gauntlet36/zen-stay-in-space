// ==UserScript==
// @name           Stay in Space on Move
// @description    "Move to..." sends tabs to another Space without switching you there.
// @ignorecache
// ==/UserScript==

(function () {
  "use strict";
  const TAG = "[StayInSpace]";

  const isSplit = t => !!t.group?.hasAttribute?.("split-view-group");
  const isEssential = t => t.hasAttribute("zen-essential");
  const isGlanceChild = t => t.hasAttribute("zen-glance-tab");

  // Everything Zen will ACTUALLY move. Zen's moveTabsToWorkspace moves a whole
  // split view if any one of its tabs is moved, and never moves Essentials.
  function expandMovingSet(tabs) {
    const set = new Set();
    for (const t of tabs) {
      if (isEssential(t)) continue;
      if (isSplit(t)) {
        for (const s of t.group.tabs) set.add(s);
      } else {
        set.add(t);
      }
    }
    return set;
  }

  // A tab in the current Space that's safe to land on: not being moved, not
  // an Essential (selecting one would load e.g. Gmail out of nowhere), not
  // Zen's placeholder empty tab, not a Glance overlay, and not hidden inside
  // a collapsed folder.
  function isLandingCandidate(t, moving) {
    return (
      !moving.has(t) &&
      !t.closing &&
      !t.hidden &&
      !isEssential(t) &&
      !isGlanceChild(t) &&
      !t.hasAttribute("zen-empty-tab") &&
      !(t.group && !isSplit(t) && t.group.collapsed)
    );
  }

  function patch() {
    const ws = window.gZenWorkspaces;
    if (!ws || typeof ws.changeTabWorkspace !== "function" || typeof ws.moveTabsToWorkspace !== "function") {
      return setTimeout(patch, 500); // Spaces manager not ready yet
    }
    if (ws.__stayInSpacePatched) return;
    ws.__stayInSpacePatched = true;

    // Replaces Zen's handler for the tab context menu "Move to..." items.
    // Zen's original: move tabs -> remember last tab for target -> changeWorkspace(target).
    // This version does the same minus the changeWorkspace, after making sure
    // the tab you're looking at isn't one that's about to leave.
    ws.changeTabWorkspace = async function (workspaceID) {
      try {
        const ctxTab = TabContextMenu.contextTab;
        // Capture the selection NOW: changing the selected tab below can clear
        // the multiselection, and we'd lose track of what was chosen.
        const tabs = ctxTab.multiselected ? [...gBrowser.selectedTabs] : [ctxTab];
        document.getElementById("tabContextMenu")?.hidePopup();

        if (!workspaceID) return;
        const moving = expandMovingSet(tabs);
        // Drop tabs already in the target Space.
        for (const t of [...moving]) {
          if (t.getAttribute("zen-workspace-id") === workspaceID) moving.delete(t);
        }
        if (!moving.size) return;

        // Is the tab on screen leaving? Covers: it was right-clicked, it's part of
        // a multiselection (Firefox always includes the selected tab in one), it's
        // the other half of a split being moved, or it's a Glance over a moved tab.
        const current = gBrowser.selectedTab;
        const currentRoot = window.gZenGlanceManager?.getTabOrGlanceParent?.(current) ?? current;
        let landing = null;
        const currentLeaving = moving.has(current) || moving.has(currentRoot);
        if (currentLeaving) {
          // Pick where to land NOW, while the tab strip still shows this Space.
          const visible = gBrowser.visibleTabs;
          const idx = Math.max(visible.indexOf(currentRoot), 0);
          const ok = t => isLandingCandidate(t, moving);
          landing =
            visible.slice(idx + 1).find(ok) ||
            visible.slice(0, idx).reverse().find(ok) ||
            null;
        }

        // Move FIRST, select AFTER - the same order Zen itself uses. Selecting a
        // tab before moving kicks off window sync's tab-switch handling, and while
        // another window is busy with that, Zen's window sync drops the TabMove
        // events for the moved tabs (only the first one reached other windows).
        ws.moveTabsToWorkspace([...moving], workspaceID);

        if (currentLeaving) {
          if (landing && !landing.closing) {
            gBrowser.selectedTab = landing;
          } else {
            // Every tab in this Space was moved: land on Zen's empty tab
            // (same as closing the last tab in a Space).
            ws.selectEmptyTab();
          }
        }

        // Don't leave invisible tabs multiselected in the old Space.
        gBrowser.clearMultiSelectedTabs?.();

        // DIAGNOSTIC (v1.2.1): one second later, report what every other window sees.
        const movedIds = [...moving].map(t => t.id);
        setTimeout(() => {
          try {
            const others = [...Services.wm.getEnumerator("navigator:browser")].filter(w => w !== window);
            console.info(TAG, `moved ${movedIds.length} tab(s) to ${workspaceID}; other windows: ${others.length}`,
              `sync enabled=${Services.prefs.getBoolPref("zen.window-sync.enabled", true)}`,
              `pinnedOnly=${Services.prefs.getBoolPref("zen.window-sync.sync-only-pinned-tabs", false)}`);
            others.forEach((w, i) => {
              const target = w.gZenWorkspaces?.workspaceElement?.(workspaceID);
              const rows = movedIds.map(id => {
                const el = w.document.getElementById(id);
                return {
                  id,
                  existsInWindow: !!el,
                  workspaceAttr: el?.getAttribute("zen-workspace-id") ?? null,
                  attrMatchesTarget: el?.getAttribute("zen-workspace-id") === workspaceID,
                  insideTargetSpace: !!(el && target?.contains(el)),
                  pinned: !!el?.pinned,
                };
              });
              console.info(TAG, `window #${i + 1} is showing Space ${w.gZenWorkspaces?.activeWorkspace}`);
              console.table(rows);
            });
          } catch (e) {
            console.error(TAG, "diagnostic failed:", e);
          }
        }, 1000);

        // Same as Zen: when you later visit that Space, show the moved tab.
        const last = tabs.filter(t => moving.has(t)).pop() ?? [...moving].pop();
        ws.lastSelectedWorkspaceTabs[workspaceID] =
          window.gZenGlanceManager?.getTabOrGlanceParent?.(last) ?? last;
      } catch (e) {
        console.error(TAG, "move failed:", e);
      }
    };

    console.info(TAG, "active");
  }

  if (document.readyState === "complete") {
    patch();
  } else {
    window.addEventListener("load", patch, { once: true });
  }
})();
