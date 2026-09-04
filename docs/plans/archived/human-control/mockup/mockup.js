/**
 * Human-control decision panel mockup — all behavior.
 *
 * Renders the OptionsReport from sample-options.js the way the real in-game
 * panel will (master-detail dialog, trigger button above the minimap), tracks
 * staged changes as deltas, and on submit prints the exact
 * Game.BroadcastEvent("HumanDecision", ...) payload the panel would fire.
 *
 * The session-state machine (auto-playing → decision pending → accepted) is
 * simulated with the dev controls in the bottom-left corner.
 */
(() => {
  "use strict";

  const report = SAMPLE_OPTIONS_REPORT;
  const display = MOCKUP_DISPLAY;

  // ---------------------------------------------------------------- helpers

  /** Plain-language label for a PascalCase key (spec §2: no identifiers). */
  function displayName(key) {
    if (display.displayNames[key]) return display.displayNames[key];
    return key.replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  /** Short policy label without the parenthetical display suffix. */
  function shortPolicy(key) {
    return key === "None" ? "None" : key.replace(/\s*\([^)]*\)/g, "");
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function $(id) { return document.getElementById(id); }

  // ------------------------------------------------------------------ state

  const state = {
    phase: "autoplay",            // autoplay | pending | accepted
    turn: display.session.turn,
    lastDecision: { ...display.session.lastDecision },
    lastRationale: display.session.lastRationale || "",  // pre-filled next turn
    dialogOpen: false,
    deliberationStarted: false,   // has the human opened the dialog this turn?
    activeCategory: "strategy",
    // Staged (not yet submitted) changes — deltas against the report.
    staged: {
      GrandStrategy: undefined,   // string when changed
      Flavors: {},                // flavor key -> new value
      Technology: undefined,      // tech name
      Policy: undefined,          // policy display key (suffix stripped server-side)
      Persona: {},                // persona key -> new value
      Relationships: {}           // civ name -> { Public?, Private? }
    }
  };

  // Current values as the report carries them (updated after each submission
  // to demonstrate that the next decision turn pre-fills from current state).
  const current = {
    grandStrategy: () => report.Strategy.GrandStrategy,
    flavor: (key) => report.Strategy.Flavors[key],
    technology: () => report.Technology.Next,
    policy: () => report.Policy.Next,
    persona: (key) => report.Persona[key],
    relationship: (civ) => {
      const rel = (report.Relationships || {})[civ];
      return { Public: rel ? rel.Public : 0, Private: rel ? rel.Private : 0, Rationale: rel && rel.Rationale, UpdatedTurn: rel && rel.UpdatedTurn };
    }
  };

  // ------------------------------------------------- staged-change plumbing

  /** Stage a value, or unstage it when it equals the current value. */
  function stageValue(bucket, key, value, currentValue) {
    if (value === currentValue) delete state.staged[bucket][key];
    else state.staged[bucket][key] = value;
  }

  /** Flat list of atomic changes, used for chips, counting, and summaries. */
  function listChanges() {
    const changes = [];
    const s = state.staged;
    if (s.GrandStrategy !== undefined) {
      changes.push({
        label: `Grand Strategy: ${displayName(current.grandStrategy())} → ${displayName(s.GrandStrategy)}`,
        undo: () => { s.GrandStrategy = undefined; }
      });
    }
    for (const key of Object.keys(s.Flavors)) {
      changes.push({
        label: `${displayName(key)}: ${current.flavor(key)} → ${s.Flavors[key]}`,
        undo: () => { delete s.Flavors[key]; }
      });
    }
    if (s.Technology !== undefined) {
      changes.push({
        label: `Research: ${current.technology()} → ${s.Technology}`,
        undo: () => { s.Technology = undefined; }
      });
    }
    if (s.Policy !== undefined) {
      changes.push({
        label: `Policy: ${shortPolicy(current.policy())} → ${shortPolicy(s.Policy)}`,
        undo: () => { s.Policy = undefined; }
      });
    }
    for (const key of Object.keys(s.Persona)) {
      changes.push({
        label: `${displayName(key)}: ${current.persona(key)} → ${s.Persona[key]}`,
        undo: () => { delete s.Persona[key]; }
      });
    }
    for (const civ of Object.keys(s.Relationships)) {
      const rel = s.Relationships[civ];
      const cur = current.relationship(civ);
      for (const dim of ["Public", "Private"]) {
        if (rel[dim] !== undefined) {
          changes.push({
            label: `${civ} ${dim}: ${cur[dim]} → ${rel[dim]}`,
            undo: () => {
              delete state.staged.Relationships[civ][dim];
              if (Object.keys(state.staged.Relationships[civ]).length === 0) delete state.staged.Relationships[civ];
            }
          });
        }
      }
    }
    return changes;
  }

  function clearStaged() {
    state.staged = { GrandStrategy: undefined, Flavors: {}, Technology: undefined, Policy: undefined, Persona: {}, Relationships: {} };
  }

  // -------------------------------------------------------------- categories

  const categories = [
    {
      id: "strategy", title: "Grand Strategy",
      summary() {
        const cur = displayName(current.grandStrategy());
        return state.staged.GrandStrategy !== undefined ? `${cur} → ${displayName(state.staged.GrandStrategy)}` : cur;
      },
      changed: () => state.staged.GrandStrategy !== undefined,
      render: renderStrategyPane
    },
    {
      id: "flavors", title: "Flavors",
      summary() {
        const n = Object.keys(state.staged.Flavors).length;
        if (n > 0) return `${n} change${n > 1 ? "s" : ""} staged`;
        const customized = Object.values(report.Strategy.Flavors).filter(v => v !== 50).length;
        return `34 priorities · ${customized} customized`;
      },
      changed: () => Object.keys(state.staged.Flavors).length > 0,
      render: renderFlavorsPane
    },
    {
      id: "research", title: "Next Research",
      summary() {
        return state.staged.Technology !== undefined ? `${current.technology()} → ${state.staged.Technology}` : current.technology();
      },
      changed: () => state.staged.Technology !== undefined,
      render: renderResearchPane
    },
    {
      id: "policy", title: "Next Policy",
      summary() {
        const cur = shortPolicy(current.policy());
        if (state.staged.Policy !== undefined) return `${cur} → ${shortPolicy(state.staged.Policy)}`;
        return cur === "None" ? "None queued" : cur;
      },
      changed: () => state.staged.Policy !== undefined,
      render: renderPolicyPane
    },
    {
      id: "persona", title: "Persona",
      summary() {
        const n = Object.keys(state.staged.Persona).length;
        return n > 0 ? `${n} change${n > 1 ? "s" : ""} staged` : "26 diplomatic traits";
      },
      changed: () => Object.keys(state.staged.Persona).length > 0,
      render: renderPersonaPane
    },
    {
      id: "relations", title: "Relationships",
      summary() {
        const n = Object.keys(state.staged.Relationships).length;
        return n > 0 ? `${n} civ${n > 1 ? "s" : ""} changed` : `${display.metCivs.length} civilizations met`;
      },
      changed: () => Object.keys(state.staged.Relationships).length > 0,
      render: renderRelationsPane
    }
  ];

  // ------------------------------------------------------------ pane pieces

  /** Radio-style option list (grand strategy / research / policy). */
  function renderOptionList(container, options, currentKey, stagedKey, onPick) {
    const selectedKey = stagedKey !== undefined ? stagedKey : currentKey;
    for (const opt of options) {
      const row = el("div", "option-row" + (opt.key === selectedKey ? " selected" : ""));
      const radio = el("input", "option-radio");
      radio.type = "radio";
      radio.checked = opt.key === selectedKey;
      const icon = el("div", "option-icon", opt.icon || "");
      const text = el("div", "option-text");
      const name = el("div", "option-name", opt.name);
      if (opt.key === currentKey) name.appendChild(el("span", "current-tag", "current"));
      if (opt.rationale) {
        name.appendChild(document.createTextNode(" "));
        name.appendChild(el("span", "rationale-tag", `— your rationale: “${opt.rationale}”`));
      }
      text.appendChild(name);
      if (opt.desc) text.appendChild(el("div", "option-desc", opt.desc));
      row.append(radio, icon, text);
      row.addEventListener("click", () => { onPick(opt.key); renderPane(); updateShell(); });
      container.appendChild(row);
    }
  }

  /**
   * Slider row with tick labels and −/+ steppers, used for flavors (0–100),
   * persona (1–10), and relationship dimensions (−100..100). Updates itself in
   * place on input so dragging is never interrupted by a re-render.
   */
  function makeValueRow(cfg) {
    const row = el("div", "value-row");
    const head = el("div", "value-row-head");
    const name = el("span", "value-name", cfg.name);
    const badge = el("span", "nav-badge", " ●");
    badge.style.display = "none";
    name.appendChild(badge);
    const numbers = el("span", "value-numbers");
    head.append(name, numbers);
    row.appendChild(head);
    if (cfg.desc) row.appendChild(el("div", "value-desc", cfg.desc));

    const line = el("div", "slider-line");
    const minus = el("button", "stepper", "−");
    minus.type = "button";
    const slider = el("input");
    slider.type = "range";
    slider.min = cfg.min; slider.max = cfg.max; slider.step = cfg.step;
    const plus = el("button", "stepper", "+");
    plus.type = "button";
    const reset = el("button", "reset-btn", "↺");
    reset.type = "button";
    reset.title = "Reset to current value";
    line.append(minus, slider, plus, reset);
    row.appendChild(line);

    if (cfg.ticks) {
      const ticks = el("div", "tick-labels");
      for (const t of cfg.ticks) ticks.appendChild(el("span", "", t));
      row.appendChild(ticks);
    }

    function refresh() {
      const cur = cfg.getCurrent();
      const staged = cfg.getStaged();
      const value = staged !== undefined ? staged : cur;
      slider.value = value;
      numbers.innerHTML = "";
      numbers.appendChild(document.createTextNode(String(cur)));
      if (staged !== undefined) {
        numbers.appendChild(document.createTextNode(" → "));
        numbers.appendChild(el("span", "new-value", String(staged)));
      }
      row.classList.toggle("changed", staged !== undefined);
      badge.style.display = staged !== undefined ? "" : "none";
    }

    function setValue(value) {
      const clamped = Math.max(cfg.min, Math.min(cfg.max, value));
      cfg.setStaged(clamped);
      refresh();
      updateShell();
    }

    slider.addEventListener("input", () => setValue(Number(slider.value)));
    minus.addEventListener("click", () => setValue(Number(slider.value) - cfg.step));
    plus.addEventListener("click", () => setValue(Number(slider.value) + cfg.step));
    reset.addEventListener("click", () => { cfg.setStaged(cfg.getCurrent()); refresh(); updateShell(); });

    refresh();
    return row;
  }

  /** Collapsible group wrapper for flavor/persona sections. */
  function makeGroup(title, openByDefault, metaText) {
    const details = el("details", "group");
    details.dataset.group = title;
    if (openByDefault) details.open = true;
    const summary = el("summary", "", title);
    const meta = el("span", "group-meta", metaText || "");
    summary.appendChild(meta);
    details.appendChild(summary);
    const body = el("div", "group-body");
    details.appendChild(body);
    return { details, body, meta };
  }

  // ------------------------------------------------------------------ panes

  function renderStrategyPane(pane) {
    const intro = el("p", "pane-intro",
      "The grand strategy sets your civilization's overall direction — the in-game AI weighs " +
      "all its choices toward this goal. The descriptions below are the same guidance the LLM strategists receive.");
    pane.appendChild(intro);
    if (report.Strategy.Rationale) {
      pane.appendChild(el("p", "pane-intro", `Your last strategy rationale: “${report.Strategy.Rationale}”`));
    }
    const options = Object.entries(report.Options.GrandStrategies).map(([key, desc]) => ({
      key, desc,
      name: displayName(key),
      icon: display.grandStrategyIcons[key]
    }));
    renderOptionList(pane, options, current.grandStrategy(), state.staged.GrandStrategy, (key) => {
      state.staged.GrandStrategy = key === current.grandStrategy() ? undefined : key;
    });
  }

  function renderFlavorsPane(pane) {
    pane.appendChild(el("p", "pane-intro",
      "Flavors tune how the in-game AI runs your empire: 0 forbids an activity, 30 keeps it minimal, " +
      "50 is balanced, 70 prioritizes it, 100 makes it an emergency focus. Change only what you mean to change — " +
      "everything else stays as it is."));
    const ticks = ["0 forbid", "30 enough", "50 balanced", "70 prioritize", "100 emergency"];
    for (let g = 0; g < display.flavorGroups.length; g++) {
      const groupCfg = display.flavorGroups[g];
      const group = makeGroup(groupCfg.title, isGroupOpen(groupCfg.title, true), "");
      const refreshMeta = () => {
        const changed = groupCfg.keys.filter(k => state.staged.Flavors[k] !== undefined).length;
        group.meta.textContent = changed > 0 ? `● ${changed} changed` : `${groupCfg.keys.length} flavors`;
        group.meta.classList.toggle("nav-badge", changed > 0);
      };
      groupMetaRefreshers.push(refreshMeta);
      refreshMeta();
      for (const key of groupCfg.keys) {
        group.body.appendChild(makeValueRow({
          name: displayName(key),
          desc: report.Options.Flavors[key],
          min: 0, max: 100, step: 5, ticks,
          getCurrent: () => current.flavor(key),
          getStaged: () => state.staged.Flavors[key],
          setStaged: (v) => stageValue("Flavors", key, v, current.flavor(key))
        }));
      }
      pane.appendChild(group.details);
    }
  }

  function renderResearchPane(pane) {
    pane.appendChild(el("p", "pane-intro",
      "Choose what your scientists research next. The in-game AI handles everything after this single choice. " +
      "Help text is the same the LLM strategists receive."));
    const options = Object.entries(report.Options.Technologies).map(([key, desc]) => ({
      key, desc,
      name: key,
      icon: display.techIcons[key] || "🔬",
      rationale: key === current.technology() ? report.Technology.Rationale : undefined
    }));
    renderOptionList(pane, options, current.technology(), state.staged.Technology, (key) => {
      state.staged.Technology = key === current.technology() ? undefined : key;
    });
  }

  function renderPolicyPane(pane) {
    pane.appendChild(el("p", "pane-intro",
      "Choose the next social policy your culture will adopt. Opening a new branch commits you to " +
      "its theme; continuing a branch deepens it. Leave this category unchanged to keep the current choice."));
    const options = Object.entries(report.Options.Policies).map(([key, desc]) => ({
      key,
      name: key,
      desc: Array.isArray(desc) ? desc.join("\n") : desc,
      icon: display.policyIcons[shortPolicy(key)] || "📜",
      rationale: key === current.policy() ? report.Policy.Rationale : undefined
    }));
    renderOptionList(pane, options, current.policy(), state.staged.Policy, (key) => {
      state.staged.Policy = key === current.policy() ? undefined : key;
    });
  }

  function renderPersonaPane(pane) {
    pane.appendChild(el("p", "pane-intro",
      "Persona shapes how your civilization behaves diplomatically — how bold, loyal, forgiving, or " +
      "competitive the in-game AI acts on your behalf. Values run 1 (low) to 10 (high)."));
    const ticks = ["1 low", "5 moderate", "10 high"];
    for (let g = 0; g < display.personaGroups.length; g++) {
      const groupCfg = display.personaGroups[g];
      const group = makeGroup(groupCfg.title, isGroupOpen(groupCfg.title, true), "");
      const refreshMeta = () => {
        const changed = groupCfg.keys.filter(k => state.staged.Persona[k] !== undefined).length;
        group.meta.textContent = changed > 0 ? `● ${changed} changed` : `${groupCfg.keys.length} traits`;
        group.meta.classList.toggle("nav-badge", changed > 0);
      };
      groupMetaRefreshers.push(refreshMeta);
      refreshMeta();
      for (const key of groupCfg.keys) {
        group.body.appendChild(makeValueRow({
          name: displayName(key),
          desc: display.personaDescriptions[key],
          min: 1, max: 10, step: 1, ticks,
          getCurrent: () => current.persona(key),
          getStaged: () => state.staged.Persona[key],
          setStaged: (v) => stageValue("Persona", key, v, current.persona(key))
        }));
      }
      pane.appendChild(group.details);
    }
  }

  function renderRelationsPane(pane) {
    pane.appendChild(el("p", "pane-intro",
      "Your stance toward each civilization you have met. Public is the stance your diplomats show openly; " +
      "Private steers how your empire actually treats them. Values run −100 (hostile) to +100 (devoted)."));
    const ticks = ["−100 hostile", "0 neutral", "+100 devoted"];
    for (const civ of display.metCivs) {
      const cur = current.relationship(civ.name);
      const card = el("div", "rel-card");
      const left = el("div", "rel-left");
      const portrait = el("div", "portrait portrait-sm", civ.monogram);
      portrait.style.background = civ.color;
      left.append(portrait, el("div", "rel-leader", civ.leader), el("div", "rel-civ", civ.name));
      const right = el("div", "rel-right");
      if (cur.Rationale) {
        right.appendChild(el("div", "rel-note", `Set on turn ${cur.UpdatedTurn}: “${cur.Rationale}”`));
      } else {
        right.appendChild(el("div", "rel-note", "No stance set yet — both values at neutral."));
      }
      const refreshCard = () => card.classList.toggle("changed", state.staged.Relationships[civ.name] !== undefined);
      for (const dim of ["Public", "Private"]) {
        const line = makeValueRow({
          name: dim,
          min: -100, max: 100, step: 5, ticks,
          getCurrent: () => current.relationship(civ.name)[dim],
          getStaged: () => (state.staged.Relationships[civ.name] || {})[dim],
          setStaged: (v) => {
            const bucket = state.staged.Relationships;
            if (v === current.relationship(civ.name)[dim]) {
              if (bucket[civ.name]) {
                delete bucket[civ.name][dim];
                if (Object.keys(bucket[civ.name]).length === 0) delete bucket[civ.name];
              }
            } else {
              bucket[civ.name] = bucket[civ.name] || {};
              bucket[civ.name][dim] = v;
            }
            refreshCard();
          }
        });
        right.appendChild(line);
      }
      refreshCard();
      card.append(left, right);
      pane.appendChild(card);
    }
  }

  // -------------------------------------------------------- shell rendering

  let groupMetaRefreshers = [];
  let groupOpenSnapshot = {};

  /** Remember which collapsible groups are open across pane re-renders. */
  function isGroupOpen(title, fallback) {
    return groupOpenSnapshot[title] !== undefined ? groupOpenSnapshot[title] : fallback;
  }

  function renderPane() {
    const pane = $("category-pane");
    groupOpenSnapshot = {};
    for (const group of pane.querySelectorAll("details.group")) {
      groupOpenSnapshot[group.dataset.group] = group.open;
    }
    groupMetaRefreshers = [];
    const category = categories.find(c => c.id === state.activeCategory);
    pane.innerHTML = "";
    category.render(pane);
  }

  function renderNav() {
    const nav = $("category-nav");
    nav.innerHTML = "";
    for (const category of categories) {
      const item = el("button", "nav-item" + (category.id === state.activeCategory ? " active" : ""));
      item.type = "button";
      const title = el("div", "nav-item-title", category.title);
      if (category.changed()) title.appendChild(el("span", "nav-badge", "●"));
      item.appendChild(title);
      item.appendChild(el("div", "nav-item-summary", category.summary()));
      item.addEventListener("click", () => {
        state.activeCategory = category.id;
        renderNav();
        renderPane();
      });
      nav.appendChild(item);
    }
  }

  function renderChips() {
    const container = $("changes-chips");
    container.innerHTML = "";
    const changes = listChanges();
    if (changes.length === 0) {
      container.appendChild(el("span", "no-changes", "none yet — submitting now would keep the status quo"));
      return;
    }
    for (const change of changes) {
      const chip = el("span", "change-chip", change.label);
      const undo = el("button", "chip-undo", "✕");
      undo.type = "button";
      undo.title = "Undo this change";
      undo.addEventListener("click", () => {
        change.undo();
        renderPane();
        updateShell();
      });
      chip.appendChild(undo);
      container.appendChild(chip);
    }
  }

  function updateFooterButtons() {
    const changes = listChanges().length;
    const rationale = $("rationale").value.trim();
    const submit = $("submit-btn");
    const statusQuo = $("status-quo-btn");
    submit.disabled = changes === 0 || rationale === "";
    submit.title = changes === 0 ? "Stage at least one change first (or use Keep Status Quo)"
      : rationale === "" ? "Type a rationale first — it is recorded with every change"
      : `Submit ${changes} change${changes > 1 ? "s" : ""} with your rationale`;
    statusQuo.disabled = rationale === "";
    statusQuo.title = rationale === "" ? "Type a rationale first — keeping the status quo is recorded as a real decision"
      : "Keep everything as it is";
  }

  function updateShell() {
    renderNav();
    renderChips();
    updateFooterButtons();
    for (const refresh of groupMetaRefreshers) refresh();
  }

  // --------------------------------------------------- session-state machine

  function setDialogOpen(open) {
    state.dialogOpen = open;
    $("decision-dialog").classList.toggle("hidden", !open);
    $("dialog-backdrop").classList.toggle("hidden", !open);
  }

  function updateCorner() {
    const pending = state.phase === "pending";
    $("trigger-btn").classList.toggle("hidden", !pending);
    $("autoplay-chip").classList.toggle("hidden", pending);
    $("autoplay-last").textContent = `last decision T${state.lastDecision.turn}: ${state.lastDecision.summary} ✓`;
    $("topbar-turn").textContent = state.turn;
    $("dev-turn").textContent = state.phase === "pending" ? state.turn : state.lastDecision.turn + 4;
  }

  /**
   * A decision arrives from the strategist (present-decision → LuaEvent). This
   * surfaces the trigger button but does NOT open the dialog: the human opens it
   * themselves by clicking the trigger, and that click is what starts their
   * deliberation timer (so the clock measures active engagement, not the moment
   * the decision was merely surfaced). Re-arriving while already pending is a
   * no-op for the same reason.
   */
  function decisionArrives() {
    if (state.phase === "accepted") return; // accepted animation still playing
    if (state.phase === "pending") return;  // trigger already up; human opens it
    state.turn = state.lastDecision.turn === display.session.lastDecision.turn && state.lastDecision.summary === display.session.lastDecision.summary
      ? display.session.turn
      : state.lastDecision.turn + 4;
    state.phase = "pending";
    state.deliberationStarted = false;
    clearStaged();
    // Pre-fill last turn's rationale so Keep Status Quo is not blocked on
    // retyping one each turn; the human can edit or replace it.
    $("rationale").value = state.lastRationale;
    $("accepted-overlay").classList.add("hidden");
    state.activeCategory = "strategy";
    updateCorner();
    renderPane();
    updateShell();
  }

  /** Open the dialog from the trigger; the first open starts deliberation. */
  function openFromTrigger() {
    if (!state.deliberationStarted) {
      state.deliberationStarted = true;
      // Later plans: this is where the in-game panel signals the strategist that
      // the human began deliberating, anchoring the recorded decision timer.
    }
    setDialogOpen(true);
  }

  /** Build the HumanDecision payload (the panel's Game.BroadcastEvent body). */
  function buildPayload(statusQuo) {
    const payload = {
      PlayerID: display.human.playerID,
      Turn: state.turn,
      Rationale: $("rationale").value.trim()
    };
    if (statusQuo) {
      payload.StatusQuo = true;
      return payload;
    }
    const s = state.staged;
    if (s.GrandStrategy !== undefined) payload.GrandStrategy = s.GrandStrategy;
    if (Object.keys(s.Flavors).length > 0) payload.Flavors = { ...s.Flavors };
    if (s.Technology !== undefined) payload.Technology = s.Technology;
    if (s.Policy !== undefined) payload.Policy = s.Policy;
    if (Object.keys(s.Persona).length > 0) payload.Persona = { ...s.Persona };
    const relCivs = Object.keys(s.Relationships);
    if (relCivs.length > 0) {
      // set-relationship needs both dimensions, so unchanged ones ride along
      // at their current values. TargetID comes from the game's player table.
      payload.Relationships = relCivs.map(civName => {
        const met = display.metCivs.find(c => c.name === civName);
        const cur = current.relationship(civName);
        const staged = s.Relationships[civName];
        return {
          TargetID: met.targetID,
          Public: staged.Public !== undefined ? staged.Public : cur.Public,
          Private: staged.Private !== undefined ? staged.Private : cur.Private
        };
      });
    }
    return payload;
  }

  /** One-line summary of a submission for the status line / autoplay chip. */
  function summarizePayload(payload) {
    if (payload.StatusQuo) return "Kept the status quo";
    const bits = [];
    if (payload.GrandStrategy) bits.push(`Grand Strategy → ${displayName(payload.GrandStrategy)}`);
    if (payload.Technology) bits.push(`Research → ${payload.Technology}`);
    if (payload.Policy) bits.push(`Policy → ${shortPolicy(payload.Policy)}`);
    if (payload.Flavors) bits.push(`${Object.keys(payload.Flavors).length} flavor${Object.keys(payload.Flavors).length > 1 ? "s" : ""}`);
    if (payload.Persona) bits.push(`${Object.keys(payload.Persona).length} persona trait${Object.keys(payload.Persona).length > 1 ? "s" : ""}`);
    if (payload.Relationships) bits.push(`${payload.Relationships.length} relationship${payload.Relationships.length > 1 ? "s" : ""}`);
    return bits.slice(0, 3).join(" · ") + (bits.length > 3 ? ` · +${bits.length - 3} more` : "");
  }

  /**
   * Fold the submission back into the report so the NEXT decision turn
   * pre-fills from it — in the real pipeline this happens naturally because
   * present-decision re-fetches get-options, whose current values now include
   * the enacted changes.
   */
  function applyToReport(payload) {
    if (payload.StatusQuo) return;
    if (payload.GrandStrategy) report.Strategy.GrandStrategy = payload.GrandStrategy;
    if (payload.Flavors) Object.assign(report.Strategy.Flavors, payload.Flavors);
    if (payload.GrandStrategy || payload.Flavors) report.Strategy.Rationale = payload.Rationale;
    if (payload.Technology) report.Technology = { Next: payload.Technology, Rationale: payload.Rationale };
    if (payload.Policy) report.Policy = { Next: payload.Policy, Rationale: payload.Rationale };
    if (payload.Persona) Object.assign(report.Persona, payload.Persona);
    if (payload.Relationships) {
      report.Relationships = report.Relationships || {};
      for (const rel of payload.Relationships) {
        const met = display.metCivs.find(c => c.targetID === rel.TargetID);
        report.Relationships[met.name] = {
          Public: rel.Public, Private: rel.Private,
          Rationale: payload.Rationale, UpdatedTurn: payload.Turn
        };
      }
    }
  }

  function submit(statusQuo) {
    const payload = buildPayload(statusQuo);
    const summary = summarizePayload(payload);

    // What the in-game panel fires (travels DLL → bridge → MCP → strategist).
    logBroadcast(payload);

    applyToReport(payload);
    state.lastDecision = { turn: state.turn, summary };
    state.lastRationale = payload.Rationale;   // pre-fills the next decision turn
    state.phase = "accepted";

    $("accepted-summary").textContent = summary + ` — “${payload.Rationale}”`;
    $("accepted-overlay").classList.remove("hidden");

    window.setTimeout(() => {
      state.phase = "autoplay";
      clearStaged();
      $("rationale").value = "";
      $("accepted-overlay").classList.add("hidden");
      setDialogOpen(false);
      updateCorner();
      renderPane();
      updateShell();
    }, 2600);
  }

  function logBroadcast(payload) {
    const body = $("dev-log-body");
    const entry = `Game.BroadcastEvent("HumanDecision", ${JSON.stringify(payload, null, 2)})`;
    body.textContent = body.textContent.startsWith("—") ? entry : entry + "\n\n" + body.textContent;
    $("dev-log").open = true;
  }

  // ------------------------------------------------------------------ wiring

  function init() {
    // Leader context row (the human's own civ — the only civ the panel describes).
    const portrait = $("leader-portrait");
    portrait.textContent = display.human.monogram;
    portrait.style.background = display.human.color;
    portrait.title = "Placeholder — the real panel shows the leader portrait";
    $("leader-name").textContent = `${display.human.leader} — ${display.human.civ}`;

    // Leader trait + unique components — the same data the EUI leader-choose
    // dialog shows at pre-game. Placeholder copy/icons here; the real panel
    // reads the game's text/civ database and renders icons via IconHookup.
    $("leader-trait-name").textContent = display.human.trait.name;
    $("leader-trait-desc").textContent = display.human.trait.description;
    const uniques = $("leader-uniques");
    for (const u of display.human.uniques) {
      const chip = el("div", "unique-chip");
      chip.title = `${u.name} (replaces ${u.replaces}) — ${u.description}`;
      chip.append(
        el("div", "option-icon", u.icon),
        el("div", "unique-name", u.name),
        el("div", "unique-kind", u.kind)
      );
      uniques.appendChild(chip);
    }

    $("trigger-btn").addEventListener("click", openFromTrigger);
    $("hide-btn").addEventListener("click", () => setDialogOpen(false));
    $("dialog-backdrop").addEventListener("click", () => setDialogOpen(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.dialogOpen && state.phase === "pending") setDialogOpen(false);
    });

    $("rationale").addEventListener("input", updateFooterButtons);
    $("submit-btn").addEventListener("click", () => submit(false));
    $("status-quo-btn").addEventListener("click", () => {
      const changes = listChanges().length;
      if (changes > 0 && !window.confirm(`Discard ${changes} staged change${changes > 1 ? "s" : ""} and keep the status quo?`)) return;
      clearStaged();
      submit(true);
    });

    $("dev-arrive").addEventListener("click", decisionArrives);
    $("dev-reset").addEventListener("click", () => window.location.reload());

    updateCorner();
    renderPane();
    updateShell();

    // Land the reviewer in the interesting state: a decision arrives shortly
    // after the page loads (as if present-decision just fired).
    window.setTimeout(decisionArrives, 1200);
  }

  init();
})();
