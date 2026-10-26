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

  // WORKAROUND for a Zen window-sync bug: when a batch of tabs is moved,
  // ZenWindowSync mirrors each move into other windows. In a window that is
  // SHOWING the destination Space, its drop animation
  // (ZenDragAndDrop.handle_drop_transition) throws "ele is undefined" for the
  // 2nd+ tab, and those tabs end up tagged with the new Space but left outside
  // its tab list (invisible). This puts any such stragglers in place, in the
  // same order as the source window.
  function repairOtherWindows(movedInOrder, workspaceID) {
    const report = [];
    for (const w of Services.wm.getEnumerator("navigator:browser")) {
      if (w === window || w.closed || !w.gZenWorkspaces || !w.gBrowser) continue;
      const target = w.gZenWorkspaces.workspaceElement?.(workspaceID);
      if (!target) continue;
      const doc = w.document;
      const done = new Set();
      let fixed = 0;
      for (const src of movedInOrder) {
        const el = doc.getElementById(src.id);
        if (!el || el.getAttribute("zen-workspace-id") !== workspaceID || target.contains(el)) continue;
        const item = isSplit(el) ? el.group : el;
        if (done.has(item)) continue;
        done.add(item);
        const container = el.pinned ? target.pinnedTabsContainer : target.tabsContainer;
        if (!container) continue;

        // Mirror the source window: go right after the nearest earlier sibling
        // (in the source window) whose copy here is already inside the Space.
        let anchor = null;
        let srcItem = isSplit(src) ? src.group : src;
        for (let prev = srcItem.previousElementSibling; prev; prev = prev.previousElementSibling) {
          if (!prev.id) continue;
          let c = doc.getElementById(prev.id);
          if (c && isSplit(c)) c = c.group;
          if (c && container.contains(c)) { anchor = c; break; }
        }
        try {
          w.gBrowser.zenHandleTabMove(item, () => {
            if (anchor) anchor.after(item);
            else container.insertBefore(item, container.lastChild ?? null);
          });
          fixed++;
        } catch (e) {
          console.error(TAG, "repair failed for", src.id, e);
        }
      }
      if (fixed) {
        w.gBrowser.tabContainer?._invalidateCachedTabs?.();
        report.push(`${fixed} tab(s) in a window showing ${w.gZenWorkspaces.activeWorkspace}`);
      }
    }
    if (report.length) console.info(TAG, "repaired Zen sync glitch:", report.join("; "));
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

        // Let Zen's window sync run, then fix anything it left outside the Space.
        // Two passes because sync processes moves one at a time, asynchronously.
        const movedInOrder = tabs.filter(t => moving.has(t));
        for (const t of moving) if (!movedInOrder.includes(t)) movedInOrder.push(t);
        const safeRepair = () => {
          try { repairOtherWindows(movedInOrder, workspaceID); }
          catch (e) { console.error(TAG, "repair pass failed:", e); }
        };
        setTimeout(safeRepair, 600);
        setTimeout(safeRepair, 1500);

        // Sanity check: only speaks up if a tab is STILL misplaced somewhere.
        setTimeout(() => {
          try {
            for (const w of Services.wm.getEnumerator("navigator:browser")) {
              if (w === window || !w.gZenWorkspaces) continue;
              const target = w.gZenWorkspaces.workspaceElement?.(workspaceID);
              const stuck = movedInOrder.filter(t => {
                const el = w.document.getElementById(t.id);
                return el && !(target && target.contains(el));
              });
              if (stuck.length) {
                console.warn(TAG, `${stuck.length} moved tab(s) still outside the Space in a window showing ${w.gZenWorkspaces.activeWorkspace}`,
                  stuck.map(t => t.id));
              }
            }
          } catch (e) {
            console.error(TAG, "check failed:", e);
          }
        }, 2500);

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
