let state = {
  tab: "today",
  data: null,
  selectedQuickPick: null,
  selectedZone: null,
  selectedProject: null,
  selectedRoutine: null,
  editingProjectRow: null,
  showAddProject: false,
  showCompletedProjects: false,
  projectError: "",
  showWork: false,
  oneThingMode: false,
  guidedLastZone: null,
  guidedLastArea: null,
  guidedJustCompleted: null,
  loading: true,
  error: "",
  localCompleted: [],
  pendingCompletionTask: null,
  completionError: "",
  isAuthenticated: false,
  houseIQRange: 30,
  upcomingExpanded: false,
  completedExpanded: false,
  selectedForecastDate: null
};

const AUTH_KEY = "houseflow_authenticated_v1";

document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => {
    if (!state.isAuthenticated) return;
    state.tab = button.dataset.tab;
    state.selectedQuickPick = null;
    state.selectedZone = null;
    state.selectedProject = null;
    state.selectedRoutine = null;
    state.selectedForecastDate = null;
    state.editingProjectRow = null;
    state.showAddProject = false;
    state.projectError = "";
    if (state.tab !== "projects") state.showCompletedProjects = false;
    state.oneThingMode = false;
    state.guidedJustCompleted = null;
    render();
  });
});

function initApp() {
  state.isAuthenticated = localStorage.getItem(AUTH_KEY) === "true";
  if (!state.isAuthenticated) {
    renderLogin();
    return;
  }
  loadData();
}

function renderLogin(message = "") {
  document.getElementById("page-title").textContent = "Sign In";
  const systemButton = document.getElementById("system-button");
  if (systemButton) systemButton.hidden = true;
  document.querySelectorAll(".nav-btn").forEach(button => button.classList.remove("active"));
  document.getElementById("app-content").innerHTML = `
    <div class="login-card">
      <div class="login-title">Welcome to HouseFlow</div>
      <div class="login-subtitle">Enter your HouseFlow password to continue on this device.</div>
      <label class="password-field-wrap" for="password-input">
        <span class="sr-only">Password</span>
        <input
          id="password-input"
          class="password-input"
          type="password"
          inputmode="text"
          placeholder="Password"
          autocomplete="current-password"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
        />
      </label>
      <button class="complete-btn" onclick="attemptLogin()">Sign In</button>
      ${message ? `<div class="login-error">${message}</div>` : ""}
    </div>
  `;
  const input = document.getElementById("password-input");
  if (input) {
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") attemptLogin();
    });
  }
}

function attemptLogin() {
  const input = document.getElementById("password-input");
  const value = input ? input.value : "";
  if (!CONFIG.appPassword || CONFIG.appPassword === "CHANGE_THIS_PASSWORD") {
    renderLogin("Set your app password in api/config.js first.");
    return;
  }
  if (value === CONFIG.appPassword) {
    localStorage.setItem(AUTH_KEY, "true");
    state.isAuthenticated = true;
    loadData();
    return;
  }
  renderLogin("Incorrect password.");
}

function signOut() {
  localStorage.removeItem(AUTH_KEY);
  state.isAuthenticated = false;
  state.data = null;
  renderLogin();
}

function callApi(action, params = {}) {
  const query = new URLSearchParams({ action, callback: "houseflowCallback", ...params });
  return fetch(CONFIG.apiUrl + "?" + query.toString(), { method: "GET", redirect: "follow" })
    .then(response => response.text())
    .then(text => {
      const jsonText = text.replace(/^houseflowCallback\(/, "").replace(/\);?$/, "");
      const data = JSON.parse(jsonText);
      if (!data.ok) throw new Error(data.error || "Unknown API error");
      return data;
    });
}

function loadData() {
  state.loading = true;
  renderLoading();
  callApi("getData")
    .then(data => {
      state.data = addGainPercentages(data);
      state.loading = false;
      render();
    })
    .catch(error => {
      state.error = error;
      state.loading = false;
      renderError(error);
    });
}

function addGainPercentages(data) {
  const health = data.health || {};
  const totalWeight = Math.max(0, Number(health.totalWeight || 0));

  const taskWeight = minutes => {
    const value = Math.max(0, Number(minutes || 0));

    if (value <= 5) return 0.5;
    if (value <= 15) return 1;
    if (value <= 30) return 1.5;

    return 2;
  };

  const routineRemainingWeight = routine => {
    const tasks = (routine.tasks || [])
      .filter(task => task.status !== "missing")
      .map(task => ({
        done: !!task.done,
        rawWeight: taskWeight(task.minutes)
      }));

    const rawTotal = tasks.reduce((sum, task) => sum + task.rawWeight, 0);
    if (rawTotal <= 0) return 0;

    const cappedTotal = Math.min(4, rawTotal);
    const scale = cappedTotal / rawTotal;

    return tasks
      .filter(task => !task.done)
      .reduce((sum, task) => sum + task.rawWeight * scale, 0);
  };

  const toGainPercent = weight => {
    if (totalWeight <= 0 || weight <= 0) return 0;
    return Math.round((weight / totalWeight) * 1000) / 10;
  };

  const addTaskGain = task => {
    const isCurrentlyDue = ["critical", "overdue", "today"].includes(task.status);

    return {
      ...task,
      gainPercent: isCurrentlyDue
        ? toGainPercent(taskWeight(task.minutes))
        : 0
    };
  };

  const addRoutineGain = routine => {
    const isCurrentlyDue = ["critical", "overdue", "today"].includes(routine.status);

    return {
      ...routine,
      gainPercent: isCurrentlyDue
        ? toGainPercent(routineRemainingWeight(routine))
        : 0
    };
  };

  return {
    ...data,
    today: (data.today || []).map(addTaskGain),
    week: (data.week || []).map(addTaskGain),
    quick: (data.quick || []).map(group => ({
      ...group,
      tasks: (group.tasks || []).map(addTaskGain)
    })),
    projects: data.projects || [],
    routines: (data.routines || []).map(addRoutineGain),
    completedRoutinesToday: data.completedRoutinesToday || []
  };
}

function render() {
  if (!state.isAuthenticated) return renderLogin();
  if (state.loading) return renderLoading();
  if (state.error) return renderError(state.error);

  const systemButton = document.getElementById("system-button");
  if (systemButton) systemButton.hidden = false;

  const primaryTab = getPrimaryTabForState();

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === primaryTab);
  });

  const title = document.getElementById("page-title");
  const content = document.getElementById("app-content");
  let html = "";

  if (state.tab === "today") {
    title.textContent = "Today";
    html = renderToday();
  }

  if (state.tab === "quick") {
    title.textContent = "Quick Picks";
    html = renderQuickPicks();
  }

  if (state.tab === "forecast") {
    title.textContent = "Forecast";
    html = renderForecast();
  }

  if (state.tab === "projects") {
    title.textContent = "Projects";
    html = renderProjects();
  }

  if (state.tab === "health") {
    title.textContent = "Home Health";
    html = renderBackButton("Today", "backToToday()") + renderHomeHealth();
  }

  if (state.tab === "houseiq") {
    title.textContent = "House IQ";
    html = renderBackButton("Today", "backToToday()") + renderHouseIQ();
  }

  if (state.tab === "system") {
    title.textContent = "System";
    html = renderSystem();
  }

  if (state.tab === "routines") {
    title.textContent = "All Routines";
    html = renderBackButton("System", "backToSystem()") + renderRoutines();
  }

  if (state.tab === "diagnostics") {
    title.textContent = "Diagnostics";
    html = renderBackButton("System", "backToSystem()") + renderDiagnostics();
  }

  content.innerHTML = html + renderCompletionModal();
}

function getPrimaryTabForState() {
  if (["health", "houseiq", "system", "routines", "diagnostics"].includes(state.tab)) {
    return "today";
  }

  return state.tab;
}

function openHomeHealth() {
  state.tab = "health";
  state.selectedZone = null;
  render();
}

function openHouseIQ() {
  state.tab = "houseiq";
  state.selectedZone = null;
  render();
}

function openSystem() {
  if (!state.isAuthenticated) return;
  state.tab = "system";
  state.selectedRoutine = null;
  render();
}

function openAllRoutines() {
  state.tab = "routines";
  state.selectedRoutine = null;
  render();
}

function openDiagnostics() {
  state.tab = "diagnostics";
  render();
}

function backToToday() {
  state.tab = "today";
  state.selectedZone = null;
  render();
}

function backToSystem() {
  state.tab = "system";
  state.selectedRoutine = null;
  render();
}

function renderBackButton(label, action) {
  return `
    <button class="page-back-button" onclick="${action}">
      ← Back to ${label}
    </button>
  `;
}

function renderSystem() {
  const diagnostics = state.data.diagnostics || {};

  return `
    ${renderBackButton("Today", "backToToday()")}

    <div class="system-card">
      <div class="system-card-title">HouseFlow Tools</div>
      <button class="system-link-button" onclick="openAllRoutines()">
        <span>All Routines</span>
        <strong>›</strong>
      </button>
      <button class="system-link-button" onclick="openDiagnostics()">
        <span>Diagnostics</span>
        <strong>›</strong>
      </button>
    </div>

    <div class="system-card">
      <div class="system-card-title">System Information</div>
      <div class="system-info-row">
        <span>App version</span>
        <strong>${diagnostics.appVersion || "Unknown"}</strong>
      </div>
      <div class="system-info-row">
        <span>Last sync</span>
        <strong>${diagnostics.lastSync || "Unknown"}</strong>
      </div>
    </div>

    <button class="system-sign-out-button" onclick="signOut()">Sign Out</button>
  `;
}

function renderLoading() {
  document.getElementById("app-content").innerHTML = `<div class="empty">Loading HouseFlow...</div>`;
}

function renderError(message) {
  document.getElementById("app-content").innerHTML = `<div class="empty">Error: ${message}</div>`;
}


function sortByDueDate(tasks) {
  return tasks.slice().sort((a, b) => {
    const dateDiff = getSortableDate(a.due) - getSortableDate(b.due);
    if (dateDiff !== 0) return dateDiff;

    return Number(b.score || 0) - Number(a.score || 0);
  });
}

function getSortableDate(value) {
  if (!value) return new Date(2999, 11, 31).getTime();

  const text = String(value).trim();
  const parts = text.split("/");

  if (parts.length === 3) {
    const month = Number(parts[0]) - 1;
    const day = Number(parts[1]);
    const year = Number(parts[2]);

    if (!isNaN(month) && !isNaN(day) && !isNaN(year)) {
      return new Date(year, month, day).getTime();
    }
  }

  const date = new Date(value);
  if (isNaN(date.getTime())) return new Date(2999, 11, 31).getTime();

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function renderCurrentWorkGroup(title, tasks) {
  if (tasks.length === 0) return "";

  let html = `<div class="section-title">${title} (${tasks.length})</div>`;
  sortByDueDate(tasks).forEach(task => html += taskCard(task));
  return html;
}

function formatRemainingTaskCount(count) {
  const value = Number(count || 0);
  return `${value} ${value === 1 ? "task" : "tasks"} remaining`;
}

function formatTaskBreakdown(individualCount, routineTaskCount) {
  const individual = Number(individualCount || 0);
  const routine = Number(routineTaskCount || 0);

  const individualLabel =
    `${individual} individual ${individual === 1 ? "task" : "tasks"}`;
  const routineLabel =
    `${routine} routine ${routine === 1 ? "task" : "tasks"}`;

  return `${individualLabel} • ${routineLabel}`;
}

function renderToday() {
  const individualToday = state.data.today || [];
  const individualWeek = state.data.week || [];
  const routines = state.data.routines || [];
  const workItems = getTodayWorkItems(individualToday, individualWeek, routines);
  const currentItems = workItems.filter(item =>
    ["critical", "overdue", "today"].includes(item.status)
  );
  const upcomingItems = workItems.filter(item => {
    const days = getDaysFromToday(item.due);
    return days >= 1 && days <= 2;
  });
  const completed = state.data.completedToday || [];
  const completedRoutines = state.data.completedRoutinesToday || [];
  const currentMinutes = currentItems.reduce(
    (sum, item) => sum + Number(item.minutes || 0),
    0
  );
  const remainingIndividualTasks = currentItems.filter(
    item => item.kind === "task"
  ).length;
  const remainingRoutineTasks = currentItems
    .filter(item => item.kind === "routine")
    .reduce((sum, item) => {
      const unfinishedTasks = (item.routine?.tasks || []).filter(
        task => !task.done && task.status !== "missing"
      ).length;

      return sum + unfinishedTasks;
    }, 0);
  const totalRemainingTasks =
    remainingIndividualTasks + remainingRoutineTasks;
  const health = state.data.health || {};
  const healthScore = Number(health.overall ?? 100);
  const houseIQ = state.data.houseIQ || {};
  const houseIQScore = Number(houseIQ.score ?? 80);
  const houseIQLabel = houseIQ.label || "Building rhythm";

  let html = `
    <div class="today-score-grid">
      <div class="health-card today-health-card">
        <div class="house-iq-eyebrow">Home Health</div>
        <div class="health-percent">${healthScore}%</div>
        <div class="health-detail health-task-total">
          ${formatRemainingTaskCount(totalRemainingTasks)}
        </div>
        <div class="health-detail">
          ${formatTaskBreakdown(
            remainingIndividualTasks,
            remainingRoutineTasks
          )}
        </div>
        <button class="secondary-btn" onclick="openHomeHealth()">View Home Health</button>
      </div>

      <div class="health-card house-iq-summary-card">
        <div class="house-iq-eyebrow">House IQ</div>
        <div class="health-percent">${houseIQScore}%</div>
        <div class="house-iq-label">${houseIQLabel}</div>
        <div class="health-detail">
          ${Number(houseIQ.history?.onTimeRecords || 0)} of
          ${Number(houseIQ.history?.totalRecords || 0)} recent completions on time
        </div>
        <button class="secondary-btn" onclick="openHouseIQ()">View House IQ</button>
      </div>
    </div>

    <div class="today-action-panel">
      ${state.oneThingMode ? "" : `
        <button class="complete-btn today-action-btn" onclick="startWorking()">View All Tasks</button>
        <button class="complete-btn today-action-btn" onclick="doOneThing()">Do One Thing</button>
      `}
    </div>

    ${renderWeeklyMomentumCard()}
  `;

  if (state.oneThingMode) {
    html += renderGuidedMode(sortByDueDate(individualToday), sortByDueDate(individualWeek));
  } else if (state.showWork) {
    html += `
      <div class="summary-card">
        ${summaryItem("Critical", countWorkItemsByStatus(currentItems, "critical"))}
        ${summaryItem("Overdue", countWorkItemsByStatus(currentItems, "overdue"))}
        ${summaryItem("Due Today", countWorkItemsByStatus(currentItems, "today"))}
        ${summaryItem("Upcoming", upcomingItems.length)}
      </div>
    `;

    html += renderWorkItemGroup(
      "Critical",
      currentItems.filter(item => item.status === "critical")
    );
    html += renderWorkItemGroup(
      "Overdue",
      currentItems.filter(item => item.status === "overdue")
    );
    html += renderWorkItemGroup(
      "Due Today",
      currentItems.filter(item => item.status === "today")
    );

    if (currentItems.length === 0) {
      html += `<div class="empty">No work currently due. 🎉</div>`;
    }
  }

  if (!state.oneThingMode) {
    html += renderUpcomingAccordion(upcomingItems);
  }

  html += renderCompletedAccordion(completedRoutines, completed);

  return html;
}

function renderWorkItemGroup(title, items) {
  if (!items || items.length === 0) return "";

  let html = `<div class="section-title">${title} (${items.length})</div>`;
  items.slice().sort(sortTodayWorkItems).forEach(item => {
    html += workItemCard(item);
  });

  return html;
}

function toggleUpcomingAccordion() {
  state.upcomingExpanded = !state.upcomingExpanded;
  render();
}

function renderUpcomingAccordion(items) {
  const upcomingItems = items || [];
  const totalMinutes = upcomingItems.reduce(
    (sum, item) => sum + Number(item.minutes || 0),
    0
  );

  let html = `
    <div class="today-accordion-card">
      <button class="today-accordion-header" onclick="toggleUpcomingAccordion()">
        <div>
          <strong>${state.upcomingExpanded ? "▼" : "▶"} Upcoming (${upcomingItems.length})</strong>
          <span>Next 2 days${upcomingItems.length ? ` • ${totalMinutes} min` : ""}</span>
        </div>
      </button>
  `;

  if (state.upcomingExpanded) {
    if (upcomingItems.length === 0) {
      html += `<div class="accordion-empty">Nothing is due during the next two days.</div>`;
    } else {
      [1, 2].forEach(daysAhead => {
        const dayItems = upcomingItems.filter(
          item => getDaysFromToday(item.due) === daysAhead
        );

        if (dayItems.length === 0) return;

        const label = daysAhead === 1 ? "Tomorrow" : "Day After Tomorrow";
        const minutes = dayItems.reduce(
          (sum, item) => sum + Number(item.minutes || 0),
          0
        );

        html += `
          <div class="upcoming-day-header">
            <strong>${label}</strong>
            <span>${dayItems.length} items • ${minutes} min</span>
          </div>
        `;

        dayItems.slice().sort(sortTodayWorkItems).forEach(item => {
          html += workItemCard(item);
        });
      });
    }
  }

  html += `</div>`;
  return html;
}

function toggleCompletedAccordion() {
  state.completedExpanded = !state.completedExpanded;
  render();
}

function renderCompletedAccordion(completedRoutines, completedTasks) {
  const routines = completedRoutines || [];
  const tasks = completedTasks || [];
  const total = routines.length + tasks.length;

  let html = `
    <div class="today-accordion-card completed-accordion">
      <button class="today-accordion-header" onclick="toggleCompletedAccordion()">
        <div>
          <strong>${state.completedExpanded ? "▼" : "▶"} Completed Today (${total})</strong>
          <span>${routines.length} routines • ${tasks.length} individual tasks</span>
        </div>
      </button>
  `;

  if (state.completedExpanded) {
    if (total === 0) {
      html += `<div class="accordion-empty">Nothing completed yet today.</div>`;
    } else {
      if (routines.length > 0) {
        html += `<div class="subsection-title accordion-subsection">Completed Routines</div>`;
        routines.forEach(routine => {
          html += completedRoutineCard(routine);
        });
      }

      if (tasks.length > 0) {
        html += `<div class="subsection-title accordion-subsection">Completed Individual Tasks</div>`;
        tasks.forEach(task => {
          html += completedCard(task);
        });
      }
    }
  }

  html += `</div>`;
  return html;
}

function getTodayWorkItems(individualToday, individualWeek, routines) {
  const taskItems = [...individualToday, ...individualWeek].map(task => ({
    kind: "task",
    id: `task-${task.taskId}`,
    status: task.status,
    due: task.due,
    minutes: Number(task.minutes || 0),
    score: Number(task.score || 0),
    title: task.task,
    task: task
  }));

  const routineItems = (routines || [])
    .filter(routine => ["critical", "overdue", "today", "week"].includes(routine.status))
    .map(routine => {
      const remainingTasks = (routine.tasks || []).filter(task => !task.done && task.status !== "missing");
      const remainingMinutes = remainingTasks.reduce((sum, task) => sum + Number(task.minutes || 0), 0);

      return {
        kind: "routine",
        id: `routine-${routine.routineId}`,
        status: routine.status,
        due: routine.nextDue,
        minutes: remainingMinutes || Number(routine.totalMinutes || 0),
        score: Number(routine.score || 0),
        title: routine.name,
        routine: routine
      };
    });

  const uniqueItems = dedupeWorkItems([...taskItems, ...routineItems]);
  return uniqueItems.sort(sortTodayWorkItems);
}

function sortTodayWorkItems(a, b) {
  const statusOrder = {
    critical: 1,
    overdue: 2,
    today: 3,
    week: 4
  };

  const statusDiff = (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
  if (statusDiff !== 0) return statusDiff;

  const dateDiff = getSortableDate(a.due) - getSortableDate(b.due);
  if (dateDiff !== 0) return dateDiff;

  const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
  if (scoreDiff !== 0) return scoreDiff;

  return String(a.title || "").localeCompare(String(b.title || ""));
}

function dedupeWorkItems(items) {
  const seen = new Set();

  return (items || []).filter(item => {
    const key = `${item.kind || "item"}:${item.id || item.title || ""}`;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function sortWorkItems(a, b) {
  const statusOrder = {
    critical: 1,
    overdue: 2,
    today: 3,
    week: 4
  };

  const statusDiff = (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
  if (statusDiff !== 0) return statusDiff;

  const dateDiff = getSortableDate(a.due) - getSortableDate(b.due);
  if (dateDiff !== 0) return dateDiff;

  const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
  if (scoreDiff !== 0) return scoreDiff;

  if (a.kind !== b.kind) {
    return a.kind === "routine" ? -1 : 1;
  }

  return String(a.title || "").localeCompare(String(b.title || ""));
}

function countWorkItemsByStatus(items, status) {
  return items.filter(item => item.status === status).length;
}

function workItemCard(item) {
  if (item.kind === "routine") return todayRoutineCard(item.routine);
  return taskCard(item.task);
}

function todayRoutineCard(routine) {
  const statusLabel = getRoutineStatusLabel(routine.status);
  const remainingTasks = (routine.tasks || []).filter(task => !task.done && task.status !== "missing");
  const taskList = (routine.tasks || [])
    .map(task => todayRoutineTaskLine(task, routine.status))
    .join("");
  const remainingMinutes = remainingTasks.reduce((sum, task) => sum + Number(task.minutes || 0), 0);
  const minutes = remainingMinutes || Number(routine.totalMinutes || 0);

  return `
    <div class="task-card routine-work-card ${routine.status}">
      <div class="task-title">▶ ${routine.name}</div>
      <div class="task-meta">${routine.zone || "No zone"} • ${routine.area || "No area"} • ${minutes} min • Due ${formatDisplayDate(routine.nextDue)}</div>
      <div class="routine-detail">Occurrence ${routine.currentStep} of ${routine.totalSteps} • ${routine.doneCount || 0} done • ${routine.remainingCount || 0} remaining</div>
      <div class="routine-progress-wrap"><div class="routine-progress-bar" style="width:${Math.min(100, Math.max(0, Number(routine.progressPercent || 0)))}%"></div></div>
      <div class="routine-inline-list">${taskList}</div>
      ${Number(routine.gainPercent || 0) > 0
        ? `<div class="task-gain">🏡 ${formatGain(routine.gainPercent)} Home Health</div>`
        : ""}
      <button class="complete-btn" onclick="event.stopPropagation(); completeFullRoutine('${escapeQuotes(routine.routineId)}')">
        ${Number(routine.doneCount || 0) > 0 ? "Complete Remaining Routine" : "Complete Full Routine"}
      </button>
    </div>
  `;
}

function todayRoutineTaskLine(task, routineStatus) {
  const isMissing = task.status === "missing";
  const rowClass = task.done ? "done" : (isMissing ? "missing" : routineStatus);
  const detail = isMissing
    ? `${Number(task.minutes || 0)} min • Missing task`
    : `${Number(task.minutes || 0)} min`;

  return `
    <div class="today-routine-task-line ${rowClass}">
      <div>
        <strong>${task.taskOrder}. ${task.task}</strong>
        <span>${detail}</span>
      </div>
      ${isMissing || task.done
        ? ""
        : `<button class="small-complete-btn" onclick="event.stopPropagation(); openCompletionPrompt('${escapeQuotes(task.taskId)}')">Complete</button>`}
    </div>
  `;
}

function renderWeeklyMomentumCard() {
  const momentum = state.data.weeklyMomentum;
  if (!momentum) return "";

  const percent = Number(momentum.percent ?? 0);
  const completed = Number(momentum.completedThisWeek || 0);
  const total = Number(momentum.totalWorkload || 0);
  const current = Number(momentum.remainingCurrent || 0);
  const upcoming = Number(momentum.remainingUpcoming || 0);

  return `
    <div class="momentum-card">
      <div class="momentum-header">
        <div>
          <div class="momentum-label">Weekly Momentum</div>
          <div class="momentum-detail">${completed} of ${total} tasks cleared this week</div>
        </div>
        <div class="momentum-percent">${percent}%</div>
      </div>
      <div class="momentum-bar-wrap">
        <div class="momentum-bar" style="width:${Math.min(100, Math.max(0, percent))}%"></div>
      </div>
      <div class="momentum-breakdown">${current} current • ${upcoming} upcoming</div>
    </div>
  `;
}

function renderGuidedMode(today, week) {
  const all = [...today, ...week];
  const task = getGuidedTask(all);

  if (!task) {
    return `
      <div class="guided-message">
        <div class="guided-message-title">All caught up. 🎉</div>
        <div class="guided-message-detail">There are no current tasks to recommend right now.</div>
      </div>
      <button class="secondary-btn" onclick="exitOneThingMode()">Exit Guided Mode</button>
    `;
  }

  let html = `<div class="section-title">Do One Thing</div>`;

  if (state.guidedJustCompleted) {
    html += renderGuidedMessage(task);
  }

  html += taskCard(task);
  html += `<button class="secondary-btn" onclick="exitOneThingMode()">Exit Guided Mode</button>`;

  return html;
}

function renderGuidedMessage(nextTask) {
  const completed = state.guidedJustCompleted;
  let detail = "Here is the next best task.";

  if (completed && nextTask.area && completed.area && nextTask.area === completed.area) {
    detail = `Since you're already in ${nextTask.area}, here is another task nearby.`;
  } else if (completed && nextTask.zone && completed.zone && nextTask.zone === completed.zone) {
    detail = `Since you're already in ${nextTask.zone}, here is another task in the same zone.`;
  } else if (nextTask.area || nextTask.zone) {
    detail = `Next stop: ${nextTask.area || nextTask.zone}.`;
  }

  return `
    <div class="guided-message">
      <div class="guided-message-title">Nice work!</div>
      <div class="guided-message-detail">${detail}</div>
    </div>
  `;
}

function getGuidedTask(tasks) {
  if (!tasks || tasks.length === 0) return null;

  if (state.guidedLastArea) {
    const sameArea = tasks.filter(task => task.area === state.guidedLastArea);
    if (sameArea.length > 0) return getBestTask(sameArea, []);
  }

  if (state.guidedLastZone) {
    const sameZone = tasks.filter(task => task.zone === state.guidedLastZone);
    if (sameZone.length > 0) return getBestTask(sameZone, []);
  }

  return getBestTask(tasks, []);
}

function getBestTask(today, week) {
  const all = [...today, ...week];
  if (all.length === 0) return null;
  return all.slice().sort((a, b) => {
    const gainDiff = Number(b.gainPercent || 0) - Number(a.gainPercent || 0);
    if (gainDiff !== 0) return gainDiff;
    const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return Number(a.minutes || 999) - Number(b.minutes || 999);
  })[0];
}

function renderQuickPicks() {
  const groups = buildQuickPickGroups();

  if (groups.length === 0) {
    return `<div class="empty">No quick picks right now.</div>`;
  }

  let html = `<div class="quick-grid">`;

  groups.forEach(group => {
    html += `
      <div class="quick-card">
        <button class="quick-btn" onclick="selectQuickPick('${escapeQuotes(group.name)}')">
          ${group.name}
        </button>
      </div>
    `;
  });

  html += `</div>`;

  if (state.selectedQuickPick) {
    const group = groups.find(g => g.name === state.selectedQuickPick);

    if (group) {
      html += `<div class="section-title">${state.selectedQuickPick}</div>`;
      html += `<div class="quick-detail">${group.description || ""}</div>`;
      html += `<div class="quick-plan-meta">${getPlanMinutes(group.items)} estimated minutes total</div>`;

      if (!group.items || group.items.length === 0) {
        html += `<div class="empty">No work found.</div>`;
      } else {
        group.items.forEach(item => html += quickPickItemCard(item));
      }
    }
  }

  return html;
}

function buildQuickPickGroups() {
  const items = getQuickPickWorkItems();
  const groups = [];

  [5, 10, 20, 30].forEach(minutes => {
    const plan = buildSmartMinutePlan(items, minutes);

    if (plan.length > 0) {
      groups.push({
        name: `${minutes} Minutes`,
        description: `One suggested work plan totaling about ${minutes} minutes or less. Same-area bundles are preferred when they make sense.`,
        items: plan
      });
    }
  });

  return dedupeQuickPickGroups(groups);
}

function dedupeQuickPickGroups(groups) {
  const seen = {};
  return groups.filter(group => {
    if (seen[group.name]) return false;
    seen[group.name] = true;
    return true;
  });
}


function buildSmartMinutePlan(items, targetMinutes) {
  const eligibleItems = getEligibleQuickPickItems(items, targetMinutes);
  const candidates = [];

  const routineAreaPlan = buildBestRoutineAreaPlan(eligibleItems, targetMinutes);
  if (routineAreaPlan.length > 0) candidates.push(routineAreaPlan);

  const bestSingle = buildBestSingleItemPlan(eligibleItems, targetMinutes);
  if (bestSingle.length > 0) candidates.push(bestSingle);

  const sameAreaPlan = buildBestSameAreaMinutePlan(eligibleItems, targetMinutes);
  if (sameAreaPlan.length > 0) candidates.push(sameAreaPlan);

  const mixedPlan = buildPriorityMinutePlan(eligibleItems, targetMinutes);
  if (mixedPlan.length > 0) candidates.push(mixedPlan);

  if (candidates.length === 0) return [];

  return candidates.sort((a, b) => scoreQuickPickPlan(b, targetMinutes) - scoreQuickPickPlan(a, targetMinutes))[0];
}

function getEligibleQuickPickItems(items, targetMinutes) {
  return (items || []).filter(item => {
    if (targetMinutes <= 5) return true;

    const isSelf = String(item.zone || "").toLowerCase() === "self" ||
      String(item.area || "").toLowerCase() === "self";

    if (!isSelf) return true;

    return isPastDueDate(item.due);
  });
}

function isPastDueDate(value) {
  if (!value) return false;

  const due = new Date(value);
  if (isNaN(due.getTime())) return false;

  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  return due < today;
}

function buildBestRoutineAreaPlan(items, targetMinutes) {
  const routines = (items || [])
    .filter(item => item.kind === "routine")
    .filter(item => Number(item.minutes || 0) > 0 && Number(item.minutes || 0) <= targetMinutes)
    .sort(compareQuickPickItems);

  const plans = routines.map(routine => {
    const areaItems = (items || [])
      .filter(item => item.id !== routine.id)
      .filter(item => item.zone === routine.zone && item.area === routine.area)
      .filter(item => Number(item.minutes || 0) > 0)
      .sort(compareQuickPickItems);

    const plan = [routine];
    let total = Number(routine.minutes || 0);

    areaItems.forEach(item => {
      const minutes = Number(item.minutes || 0);

      if (total + minutes <= targetMinutes) {
        plan.push(item);
        total += minutes;
      }
    });

    return plan;
  });

  return plans
    .filter(plan => plan.length > 0)
    .sort((a, b) => scoreRoutineAreaPlan(b, targetMinutes) - scoreRoutineAreaPlan(a, targetMinutes))[0] || [];
}

function scoreRoutineAreaPlan(plan, targetMinutes) {
  const baseScore = scoreQuickPickPlan(plan, targetMinutes);
  const routineAnchorBonus = (plan || []).some(item => item.kind === "routine") ? 4500 : 0;
  const relatedTaskBonus = Math.max(0, plan.length - 1) * 1800;
  const sameAreaBonus = isSingleAreaPlan(plan) ? 2500 : 0;
  const fillBonus = getPlanMinutes(plan) >= targetMinutes * 0.75 ? 1000 : 0;

  return baseScore + routineAnchorBonus + relatedTaskBonus + sameAreaBonus + fillBonus;
}

function buildBestSingleItemPlan(items, targetMinutes) {
  const best = (items || [])
    .filter(item => Number(item.minutes || 0) > 0 && Number(item.minutes || 0) <= targetMinutes)
    .sort(compareQuickPickItems)[0];

  return best ? [best] : [];
}

function buildPriorityMinutePlan(items, targetMinutes) {
  const plan = [];
  let total = 0;

  (items || [])
    .filter(item => Number(item.minutes || 0) > 0 && Number(item.minutes || 0) <= targetMinutes)
    .sort(compareQuickPickItems)
    .forEach(item => {
      const minutes = Number(item.minutes || 0);

      if (total + minutes <= targetMinutes) {
        plan.push(item);
        total += minutes;
      }
    });

  if (plan.length === 0) {
    const smallest = (items || [])
      .filter(item => Number(item.minutes || 0) > 0)
      .sort((a, b) => Number(a.minutes || 0) - Number(b.minutes || 0))[0];

    if (smallest) plan.push(smallest);
  }

  return plan;
}

function compareQuickPickItems(a, b) {
  const scoreDiff = scoreQuickPickItem(b) - scoreQuickPickItem(a);
  if (scoreDiff !== 0) return scoreDiff;

  const dateDiff = getSortableDate(a.due) - getSortableDate(b.due);
  if (dateDiff !== 0) return dateDiff;

  return Number(a.minutes || 0) - Number(b.minutes || 0);
}

function scoreQuickPickItem(item) {
  const statusBonus = {
    critical: 10000,
    overdue: 8000,
    today: 6000,
    week: 3000
  }[item.status] || 0;

  const routineBonus = item.kind === "routine" ? 1600 : 0;
  const priorityScore = Number(item.score || 0) * 15;
  const minutes = Math.max(1, Number(item.minutes || 1));

  return statusBonus + routineBonus + priorityScore - minutes;
}

function scoreQuickPickPlan(plan, targetMinutes) {
  const totalMinutes = getPlanMinutes(plan);
  const itemScore = (plan || []).reduce((sum, item) => sum + scoreQuickPickItem(item), 0);
  const fillScore = Math.min(totalMinutes, targetMinutes) * 20;
  const overPenalty = totalMinutes > targetMinutes ? (totalMinutes - targetMinutes) * 500 : 0;
  const tinyLowValuePenalty = totalMinutes < targetMinutes * 0.5 ? 500 : 0;
  const areaScatterPenalty = getPlanAreaCount(plan) > 1 ? (getPlanAreaCount(plan) - 1) * 2200 : 0;
  const sameAreaBonus = isSingleAreaPlan(plan) && plan.length >= 2 ? 1800 : 0;

  return itemScore + fillScore + sameAreaBonus - overPenalty - tinyLowValuePenalty - areaScatterPenalty;
}

function getPlanAreaCount(plan) {
  const areas = {};

  (plan || []).forEach(item => {
    const key = `${item.zone || "Other"}||${item.area || "Other"}`;
    areas[key] = true;
  });

  return Object.keys(areas).length;
}

function isSingleAreaPlan(plan) {
  return getPlanAreaCount(plan) === 1;
}

function buildMinutePlan(items, targetMinutes) {
  return buildPriorityMinutePlan(items, targetMinutes);
}

function getPlanMinutes(items) {
  return (items || []).reduce((sum, item) => sum + Number(item.minutes || 0), 0);
}

function buildBestSameAreaMinutePlan(items, targetMinutes) {
  const areaMap = {};

  (items || []).forEach(item => {
    const key = `${item.zone || "Other"}||${item.area || "Other"}`;

    if (!areaMap[key]) {
      areaMap[key] = {
        zone: item.zone || "Other",
        area: item.area || "Other",
        items: []
      };
    }

    areaMap[key].items.push(item);
  });

  const plans = Object.values(areaMap)
    .filter(group => group.items.length >= 2)
    .map(group => {
      const plan = buildPriorityMinutePlan(group.items, targetMinutes);

      return {
        ...group,
        plan: plan,
        totalMinutes: getPlanMinutes(plan)
      };
    })
    .filter(group => group.plan.length >= 2)
    .sort((a, b) => {
      const planDiff = scoreQuickPickPlan(b.plan, targetMinutes) - scoreQuickPickPlan(a.plan, targetMinutes);
      if (planDiff !== 0) return planDiff;

      return String(a.area || "").localeCompare(String(b.area || ""));
    });

  return plans[0]?.plan || [];
}


function getQuickPickWorkItems() {
  const taskItems = [...(state.data.today || []), ...(state.data.week || [])]
    .map(task => ({
      kind: "task",
      id: `task-${task.taskId}`,
      status: task.status,
      due: task.due,
      minutes: Number(task.minutes || 0),
      score: Number(task.score || 0),
      zone: task.zone || "",
      area: task.area || "",
      title: task.task,
      task: task
    }));

  const routineItems = (state.data.routines || [])
    .filter(routine => ["critical", "overdue", "today", "week"].includes(routine.status))
    .map(routine => {
      const remainingTasks = (routine.tasks || []).filter(task => !task.done && task.status !== "missing");
      const remainingMinutes = remainingTasks.reduce((sum, task) => sum + Number(task.minutes || 0), 0);
      const remainingScore = remainingTasks.reduce((sum, task) => sum + Number(task.score || 0), 0);

      return {
        kind: "routine",
        id: `routine-${routine.routineId}`,
        status: routine.status,
        due: routine.nextDue,
        minutes: remainingMinutes || Number(routine.totalMinutes || 0),
        score: remainingScore,
        zone: routine.zone || "",
        area: routine.area || "",
        title: routine.name,
        routine: routine
      };
    });

  return [...taskItems, ...routineItems].sort(sortWorkItems);
}



function quickPickItemCard(item) {
  if (item.kind === "routine") {
    return todayRoutineCard(item.routine);
  }

  return taskCard(item.task);
}


function renderForecast() {
  const workItems = getTodayWorkItems(
    state.data.today || [],
    state.data.week || [],
    state.data.routines || []
  ).filter(item => {
    const days = getDaysFromToday(item.due);
    return days >= 1 && days <= 7;
  });

  let html = `
    <div class="forecast-intro-card">
      <div class="forecast-intro-title">Next 7 Days</div>
      <div class="forecast-intro-detail">
        Upcoming on Today shows only the next two days. Forecast shows the full week.
      </div>
    </div>
  `;

  for (let daysAhead = 1; daysAhead <= 7; daysAhead++) {
    const date = addClientDays(new Date(), daysAhead);
    const dateKey = getClientDateKey(date);
    const dayItems = workItems
      .filter(item => getDaysFromToday(item.due) === daysAhead)
      .sort(sortTodayWorkItems);
    const minutes = dayItems.reduce(
      (sum, item) => sum + Number(item.minutes || 0),
      0
    );
    const routines = dayItems.filter(item => item.kind === "routine").length;
    const tasks = dayItems.filter(item => item.kind === "task").length;
    const isSelected = state.selectedForecastDate === dateKey;
    const workload = getForecastWorkload(minutes);

    html += `
      <div class="forecast-day-card ${isSelected ? "selected" : ""}">
        <button class="forecast-day-header" onclick="toggleForecastDay('${dateKey}')">
          <div>
            <strong>${isSelected ? "▼" : "▶"} ${formatForecastDate(date, daysAhead)}</strong>
            <span>${tasks} tasks • ${routines} routines • ${minutes} min</span>
          </div>
          <div class="forecast-workload ${workload.className}">${workload.label}</div>
        </button>
        ${isSelected ? renderForecastDayItems(dayItems) : ""}
      </div>
    `;
  }

  return html;
}

function toggleForecastDay(dateKey) {
  state.selectedForecastDate =
    state.selectedForecastDate === dateKey ? null : dateKey;
  render();
}

function renderForecastDayItems(items) {
  if (!items || items.length === 0) {
    return `<div class="accordion-empty">No scheduled work.</div>`;
  }

  let html = `<div class="forecast-day-items">`;

  items.forEach(item => {
    html += workItemCard(item);
  });

  html += `</div>`;
  return html;
}

function getForecastWorkload(minutes) {
  const value = Number(minutes || 0);

  if (value === 0) {
    return { label: "Clear", className: "clear" };
  }

  if (value < 20) {
    return { label: "Light", className: "light" };
  }

  if (value <= 45) {
    return { label: "Moderate", className: "moderate" };
  }

  return { label: "Heavy", className: "heavy" };
}

function formatForecastDate(date, daysAhead) {
  if (daysAhead === 1) return "Tomorrow";
  if (daysAhead === 2) return "Day After Tomorrow";

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric"
  });
}

function getDaysFromToday(value) {
  const timestamp = getSortableDate(value);

  if (!Number.isFinite(timestamp) || timestamp >= new Date(2999, 0, 1).getTime()) {
    return 999;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.round((timestamp - today.getTime()) / 86400000);
}

function addClientDays(dateValue, days) {
  const date = new Date(dateValue);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

function getClientDateKey(dateValue) {
  const date = new Date(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function renderRoutines() {
  const routines = state.data.routines || [];

  if (routines.length === 0) {
    return `
      <div class="empty">
        No routine cycles yet.<br><br>
        Add rows to Routine Master and Routine Steps to create looping routines.
      </div>
    `;
  }

  let html = "";

  routines.forEach(routine => {
    html += routineCard(routine);
  });

  return html;
}

function routineCard(routine) {
  const isSelected = state.selectedRoutine === routine.routineId;
  const taskLabel = routine.tasks.length === 1 ? "1 task" : `${routine.tasks.length} tasks`;
  const statusLabel = getRoutineStatusLabel(routine.status);

  return `
    <div class="routine-card ${isSelected ? "selected-routine" : ""}" onclick="selectRoutine('${escapeQuotes(routine.routineId)}')">
      <div class="routine-title">${isSelected ? "▼" : "▶"} ${routine.name}</div>
      <div class="routine-meta">${routine.zone || "No zone"} • ${routine.area || "No area"}</div>
      <div class="routine-detail">Occurrence ${routine.currentStep} of ${routine.totalSteps} • ${taskLabel} • ${routine.totalMinutes} min</div>
      <div class="routine-detail">${routine.doneCount || 0} done • ${routine.remainingCount || 0} remaining</div>
      <div class="routine-progress-wrap"><div class="routine-progress-bar" style="width:${Math.min(100, Math.max(0, Number(routine.progressPercent || 0)))}%"></div></div>
      <div class="routine-detail">${statusLabel}${routine.nextDue ? ` • Due ${formatDisplayDate(routine.nextDue)}` : ""}</div>
      ${routine.notes ? `<div class="routine-notes">${routine.notes}</div>` : ""}
      ${isSelected ? renderRoutineTasks(routine) : ""}
    </div>
  `;
}

function renderRoutineTasks(routine) {
  let html = `<div class="routine-task-list">`;

  routine.tasks.forEach(task => {
    html += routineTaskRow(task);
  });

  html += `
    <button class="complete-btn" onclick="event.stopPropagation(); completeFullRoutine('${escapeQuotes(routine.routineId)}')">
      ${Number(routine.doneCount || 0) > 0 ? "Complete Remaining Routine" : "Complete Full Routine"}
    </button>
  `;

  html += `</div>`;
  return html;
}

function routineTaskRow(task) {
  const statusLabel = task.done ? "Done" : getTaskStatusLabel(task.status);
  const rowClass = task.done ? "done" : task.status;
  const completedText = task.done && task.completedAt ? ` • Completed ${formatDisplayDate(task.completedAt)}` : "";

  return `
    <div class="routine-task-row ${rowClass}">
      <div>
        <div class="routine-task-title">${task.taskOrder}. ${task.task}</div>
        <div class="routine-task-meta">${task.minutes} min • ${statusLabel}${completedText}${!task.done && task.due ? ` • Task due ${formatDisplayDate(task.due)}` : ""}</div>
      </div>
      ${task.status === "missing" || task.done ? "" : `<button class="small-complete-btn" onclick="event.stopPropagation(); openCompletionPrompt('${escapeQuotes(task.taskId)}')">Complete</button>`}
    </div>
  `;
}

function getRoutineStatusLabel(status) {
  const labels = {
    critical: "Critical",
    overdue: "Overdue",
    today: "Due today",
    week: "Due this week",
    later: "Not due yet"
  };

  return labels[status] || "Not due yet";
}

function getTaskStatusLabel(status) {
  const labels = {
    critical: "Critical",
    overdue: "Overdue",
    today: "Due today",
    week: "This week",
    later: "Not due",
    missing: "Missing task"
  };

  return labels[status] || "Not due";
}

function completeFullRoutine(routineId) {
  const previousTab = state.tab;
  renderLoading();

  callApi("completeRoutine", { routineId })
    .then(data => {
      state.data = addGainPercentages(data);
      state.completedExpanded = true;
      state.selectedRoutine = routineId;
      state.tab = previousTab;
      render();
    })
    .catch(error => renderError(error));
}

function selectRoutine(id) {
  state.selectedRoutine = state.selectedRoutine === id ? null : id;
  render();
}

function renderHomeHealth() {
  const health = state.data.health;

  if (!health) {
    return `<div class="empty">No Home Health data available.</div>`;
  }

  let html = `
    <div class="health-card home-health-overview-card">
      <div class="house-iq-eyebrow">Home Health</div>
      <div class="health-percent">${Number(health.overall ?? 100)}%</div>
      <div class="health-detail">
        ${formatHealthWeight(health.completedWeight)} of
        ${formatHealthWeight(health.totalWeight)} current effort complete
      </div>
      <div class="health-detail">
        ${Number(health.individualDue || 0)} individual tasks remaining •
        ${Number(health.routineDue || 0)} routines in progress or remaining
      </div>
    </div>

    <div class="section-title">Health by Zone</div>
  `;

  (health.zones || []).forEach(zone => {
    const isSelected = state.selectedZone === zone.zone;
    const zoneTasks = getZoneTasks(zone.zone);
    const zoneRoutines = getZoneRoutines(zone.zone);
    const bestTask = getBestTask(zoneTasks, []);
    const otherTasks = bestTask
      ? zoneTasks.filter(task => task.row !== bestTask.row)
      : zoneTasks;

    html += `
      <div class="health-card ${isSelected ? "selected-zone" : ""}" onclick="selectZone('${escapeQuotes(zone.zone)}')">
        <strong>${isSelected ? "▼" : "▶"} ${zone.zone}</strong>
        <div class="health-percent">${zone.percent}%</div>
        <div class="health-bar-wrap"><div class="health-bar" style="width:${zone.percent}%"></div></div>
        <div class="health-detail">
          ${formatHealthWeight(zone.completedWeight)} of
          ${formatHealthWeight(zone.totalWeight)} current effort complete
        </div>
        <div class="health-detail">
          ${Number(zone.individualDueCount || 0)} tasks remaining •
          ${Number(zone.routineDueCount || 0)} routines in progress or remaining
        </div>
        <div class="zone-task-list ${isSelected ? "expanded" : ""}">
          ${isSelected ? renderExpandedHealthZone(zoneRoutines, bestTask, otherTasks) : ""}
        </div>
      </div>
    `;
  });

  return html;
}

function renderExpandedHealthZone(routines, bestTask, otherTasks) {
  const routineList = routines || [];
  const remainingTasks = otherTasks || [];
  let html = "";

  if (routineList.length > 0) {
    html += `<div class="subsection-title">Routines Due</div>`;
    routineList.forEach(routine => html += todayRoutineCard(routine));
  }

  if (bestTask) {
    html += `<div class="biggest-card"><div class="biggest-label">⭐ Biggest Individual Improvement</div>${taskCard(bestTask)}</div>`;
  }

  if (remainingTasks.length > 0) {
    html += `<div class="subsection-title">Other Individual Tasks</div><div class="while-here-list">`;
    remainingTasks.forEach(task => html += taskCard(task));
    html += `</div>`;
  }

  if (routineList.length === 0 && !bestTask && remainingTasks.length === 0) {
    return `<div class="empty">No work currently due here.</div>`;
  }

  return html;
}

function renderHouseIQ() {
  const houseIQ = state.data.houseIQ;
  const trends = state.data.houseIQTrends || {};
  const snapshots = trends.snapshots || [];

  if (!houseIQ) {
    return `<div class="empty">No House IQ data available.</div>`;
  }

  const current = houseIQ.components?.currentControl || {};
  const individual = houseIQ.components?.individualTimeliness || {};
  const routine = houseIQ.components?.routineRhythm || {};
  const overdueNow =
    Number(houseIQ.current?.overdueTasks || 0) +
    Number(houseIQ.current?.overdueRoutines || 0);

  return `
    <div class="house-iq-card">
      <div class="house-iq-header">
        <div>
          <div class="house-iq-eyebrow">House IQ</div>
          <div class="house-iq-label">${houseIQ.label || "Building rhythm"}</div>
        </div>
        <div class="house-iq-score">${Number(houseIQ.score || 0)}%</div>
      </div>
      <div class="house-iq-main-bar"><div style="width:${Math.min(100, Math.max(0, Number(houseIQ.score || 0)))}%"></div></div>
      <div class="house-iq-explainer">
        Based on current overdue work and the last ${houseIQ.windowDays || 28} days of individual task and routine completions.
        Projects are excluded.
      </div>
      <div class="house-iq-current">
        ${overdueNow} overdue now •
        ${Number(houseIQ.history?.onTimeRecords || 0)} of
        ${Number(houseIQ.history?.totalRecords || 0)} recent completions on time
      </div>
    </div>

    ${renderHouseIQTrend(trends, snapshots)}

    <div class="house-iq-record-grid">
      ${renderIQRecord("Best IQ", `${Number(trends.summary?.bestScore || houseIQ.score || 0)}%`, formatTrendDate(trends.summary?.bestDate))}
      ${renderIQRecord("Current Streak", `${Number(trends.summary?.currentStreak || 0)} days`, "IQ 90 or higher")}
      ${renderIQRecord("Longest Streak", `${Number(trends.summary?.longestStreak || 0)} days`, "IQ 90 or higher")}
      ${renderIQRecord("History", `${Number(trends.summary?.snapshotDays || 0)} days`, "Daily snapshots")}
    </div>

    ${renderHouseIQWeeklySummary(trends.weekly || {})}

    <div class="section-title">Current Score Breakdown</div>

    ${renderHouseIQComponent(
      "Current Control",
      current.score,
      "40%",
      `${Number(current.overdueTasks || 0)} overdue tasks • ${Number(current.overdueRoutines || 0)} overdue routines`
    )}

    ${renderHouseIQComponent(
      "Individual Timeliness",
      individual.score,
      "30%",
      individual.records
        ? `${Number(individual.onTime || 0)} of ${Number(individual.records || 0)} completed on time`
        : "Building data from future completions"
    )}

    ${renderHouseIQComponent(
      "Routine Rhythm",
      routine.score,
      "30%",
      routine.records
        ? `${Number(routine.onTime || 0)} of ${Number(routine.records || 0)} completed on time`
        : "Building data from future routine completions"
    )}

    ${renderHouseIQInsights(trends.insights || [])}
  `;
}

function setHouseIQRange(days) {
  state.houseIQRange = Number(days) || 30;
  render();
}

function renderHouseIQTrend(trends, snapshots) {
  const range = Number(state.houseIQRange || 30);
  const visible = getVisibleIQSnapshots(snapshots, range);
  const change = Number(trends.summary?.thirtyDayChange || 0);
  const changeText = change > 0 ? `+${change}` : String(change);
  const changeClass = change > 0 ? "up" : (change < 0 ? "down" : "steady");

  return `
    <div class="iq-trend-card">
      <div class="iq-trend-header">
        <div>
          <div class="section-card-title">House IQ Trend</div>
          <div class="iq-trend-change ${changeClass}">${changeText} over available 30 day history</div>
        </div>
        <div class="iq-range-buttons">
          ${renderIQRangeButton(30, "30D")}
          ${renderIQRangeButton(90, "90D")}
          ${renderIQRangeButton(365, "1Y")}
        </div>
      </div>
      ${visible.length >= 2
        ? renderIQLineChart(visible)
        : `<div class="iq-history-empty">
            Today’s snapshot has been saved. The trend line will appear after another day is recorded.
          </div>`}
    </div>
  `;
}

function renderIQRangeButton(days, label) {
  return `
    <button
      class="iq-range-btn ${Number(state.houseIQRange || 30) === days ? "active" : ""}"
      onclick="setHouseIQRange(${days})"
    >${label}</button>
  `;
}

function getVisibleIQSnapshots(snapshots, rangeDays) {
  if (!snapshots || snapshots.length === 0) return [];

  const lastDate = new Date(snapshots[snapshots.length - 1].date + "T12:00:00");
  const cutoff = new Date(lastDate);
  cutoff.setDate(cutoff.getDate() - Math.max(1, Number(rangeDays || 30)) + 1);

  return snapshots.filter(snapshot => {
    const date = new Date(snapshot.date + "T12:00:00");
    return date >= cutoff;
  });
}

function renderIQLineChart(points) {
  const width = 600;
  const height = 210;
  const padLeft = 34;
  const padRight = 12;
  const padTop = 14;
  const padBottom = 28;
  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;
  const minScore = Math.max(0, Math.min(...points.map(point => Number(point.score || 0))) - 5);
  const maxScore = Math.min(100, Math.max(...points.map(point => Number(point.score || 0))) + 5);
  const range = Math.max(10, maxScore - minScore);

  const coords = points.map((point, index) => {
    const x = padLeft + (points.length === 1 ? chartWidth / 2 : index * chartWidth / (points.length - 1));
    const y = padTop + (maxScore - Number(point.score || 0)) * chartHeight / range;
    return { x, y, point };
  });

  const polyline = coords.map(coord => `${coord.x},${coord.y}`).join(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];
  const midIndex = Math.floor((coords.length - 1) / 2);
  const mid = coords[midIndex];

  return `
    <div class="iq-chart-wrap">
      <svg class="iq-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="House IQ trend">
        <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${height - padBottom}" class="iq-grid-axis" />
        <line x1="${padLeft}" y1="${height - padBottom}" x2="${width - padRight}" y2="${height - padBottom}" class="iq-grid-axis" />
        <line x1="${padLeft}" y1="${padTop + chartHeight / 2}" x2="${width - padRight}" y2="${padTop + chartHeight / 2}" class="iq-grid-line" />
        <polyline points="${polyline}" class="iq-line" />
        ${coords.map(coord => `<circle cx="${coord.x}" cy="${coord.y}" r="4" class="iq-point"><title>${coord.point.displayDate}: ${coord.point.score}%</title></circle>`).join("")}
        <text x="4" y="${padTop + 5}" class="iq-axis-label">${Math.round(maxScore)}</text>
        <text x="4" y="${height - padBottom + 4}" class="iq-axis-label">${Math.round(minScore)}</text>
        <text x="${first.x}" y="${height - 8}" text-anchor="start" class="iq-axis-label">${first.point.displayDate}</text>
        <text x="${mid.x}" y="${height - 8}" text-anchor="middle" class="iq-axis-label">${mid.point.displayDate}</text>
        <text x="${last.x}" y="${height - 8}" text-anchor="end" class="iq-axis-label">${last.point.displayDate}</text>
      </svg>
    </div>
  `;
}

function renderIQRecord(title, value, detail) {
  return `
    <div class="iq-record-card">
      <div class="iq-record-title">${title}</div>
      <div class="iq-record-value">${value}</div>
      <div class="iq-record-detail">${detail || ""}</div>
    </div>
  `;
}

function formatTrendDate(value) {
  if (!value) return "Building history";

  const date = new Date(value + "T12:00:00");
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderHouseIQWeeklySummary(weekly) {
  const change = Number(weekly.change || 0);
  const changeText = change > 0 ? `+${change}` : String(change);
  const changeClass = change > 0 ? "up" : (change < 0 ? "down" : "steady");

  return `
    <div class="iq-week-card">
      <div class="iq-week-header">
        <div>
          <div class="section-card-title">Last 7 Days</div>
          <div class="iq-week-recorded">${Number(weekly.daysRecorded || 0)} days recorded</div>
        </div>
        <div class="iq-week-score">
          <strong>${Number(weekly.averageIQ || 0)}%</strong>
          <span class="${changeClass}">${changeText} vs. previous week</span>
        </div>
      </div>
      <div class="iq-week-grid">
        <div><strong>${Number(weekly.completedTasks || 0)}</strong><span>Tasks completed</span></div>
        <div><strong>${Number(weekly.completedRoutines || 0)}</strong><span>Routines completed</span></div>
        <div><strong>${Number(weekly.averageHomeHealth || 0)}%</strong><span>Average Home Health</span></div>
      </div>
    </div>
  `;
}

function renderHouseIQInsights(insights) {
  if (!insights || insights.length === 0) return "";

  return `
    <div class="section-title">HouseFlow Insights</div>
    ${insights.map(insight => `
      <div class="iq-insight-card ${insight.type || "info"}">
        <strong>${insight.title || "Insight"}</strong>
        <span>${insight.detail || ""}</span>
      </div>
    `).join("")}
  `;
}

function renderHouseIQComponent(title, scoreValue, weightLabel, detail) {
  const score = Math.min(100, Math.max(0, Number(scoreValue || 0)));

  return `
    <div class="house-iq-component">
      <div class="house-iq-component-header">
        <div>
          <strong>${title}</strong>
          <span>${weightLabel} of House IQ</span>
        </div>
        <div class="house-iq-component-score">${score}%</div>
      </div>
      <div class="house-iq-component-bar"><div style="width:${score}%"></div></div>
      <div class="house-iq-component-detail">${detail}</div>
    </div>
  `;
}

function renderExpandedZone(bestTask, otherTasks) {
  if (!bestTask && otherTasks.length === 0) return `<div class="empty">No tasks due here.</div>`;
  let html = "";
  if (bestTask) {
    html += `<div class="biggest-card"><div class="biggest-label">⭐ Biggest Improvement</div>${taskCard(bestTask)}</div>`;
  }
  if (otherTasks.length > 0) {
    html += `<div class="subsection-title">While You're Here</div><div class="while-here-list">`;
    otherTasks.forEach(task => html += taskCard(task));
    html += `</div>`;
  }
  return html;
}


function renderDiagnostics() {
  const d = state.data.diagnostics;

  if (!d) {
    return `<div class="empty">No diagnostics data available.</div>`;
  }

  let html = `
    <div class="diagnostic-card">
      <div class="diagnostic-title">System Status</div>
      ${diagnosticRow("App Version", d.appVersion || "Unknown", "ok")}
      ${diagnosticRow("API Connected", "Yes", "ok")}
      ${diagnosticRow("Last Sync", d.lastSync || "", "ok")}
      ${diagnosticRow("Tasks Loaded", d.taskCounts?.totalTasks ?? 0, "ok")}
      ${diagnosticRow("Individual Tasks", d.taskCounts?.individualTasks ?? 0, "ok")}
      ${diagnosticRow("Routine Controlled Tasks", d.taskCounts?.routineControlledTasks ?? 0, "ok")}
      ${diagnosticRow("Projects Loaded", d.projectCounts?.totalProjects ?? 0, "ok")}
      ${diagnosticRow("History Records", d.historyCounts?.totalRecords ?? 0, "ok")}
    </div>

    <div class="diagnostic-card">
      <div class="diagnostic-title">Current Work</div>
      ${diagnosticRow("Critical", d.taskCounts?.critical ?? 0, statusForCount(d.taskCounts?.critical))}
      ${diagnosticRow("Overdue", d.taskCounts?.overdue ?? 0, statusForCount(d.taskCounts?.overdue))}
      ${diagnosticRow("Due Today", d.taskCounts?.today ?? 0, "ok")}
      ${diagnosticRow("This Week", d.taskCounts?.week ?? 0, "ok")}
    </div>

    <div class="diagnostic-card">
      <div class="diagnostic-title">Routine Health</div>
      ${diagnosticRow("Routines", d.routineCounts?.totalRoutines ?? 0, "ok")}
      ${diagnosticRow("Active Routines", d.routineCounts?.activeRoutines ?? 0, "ok")}
      ${diagnosticRow("Routine Step Rows", d.routineCounts?.stepRows ?? 0, "ok")}
      ${diagnosticRow("Routine History Records", d.routineCounts?.historyRecords ?? 0, "ok")}
      ${diagnosticRow("Missing Task IDs", d.routineCounts?.missingTaskIds ?? 0, statusForCount(d.routineCounts?.missingTaskIds))}
      ${diagnosticRow("Individual Tasks Inside Routines", d.routineCounts?.individualTasksInRoutines ?? 0, statusForCount(d.routineCounts?.individualTasksInRoutines))}
      ${diagnosticRow("Missing Routine IDs", d.routineCounts?.missingRoutineIds ?? 0, statusForCount(d.routineCounts?.missingRoutineIds))}
    </div>

    <div class="diagnostic-card">
      <div class="diagnostic-title">Weekly Momentum</div>
      ${diagnosticRow("Momentum", `${d.weeklyMomentum?.percent ?? 0}%`, "ok")}
      ${diagnosticRow("Completed This Week", d.weeklyMomentum?.completedThisWeek ?? 0, "ok")}
      ${diagnosticRow("Remaining Current", d.weeklyMomentum?.remainingCurrent ?? 0, "ok")}
      ${diagnosticRow("Remaining Upcoming", d.weeklyMomentum?.remainingUpcoming ?? 0, "ok")}
      ${diagnosticRow("Weekly Workload", d.weeklyMomentum?.totalWorkload ?? 0, "ok")}
    </div>

    <div class="diagnostic-card">
      <div class="diagnostic-title">Task Data Health</div>
      ${diagnosticRow("Blank Task IDs", d.taskIssues?.blankTaskIds ?? 0, statusForCount(d.taskIssues?.blankTaskIds))}
      ${diagnosticRow("Duplicate Task IDs", d.taskIssues?.duplicateTaskIds ?? 0, statusForCount(d.taskIssues?.duplicateTaskIds))}
      ${diagnosticRow("Blank Task Names", d.taskIssues?.blankTaskNames ?? 0, statusForCount(d.taskIssues?.blankTaskNames))}
      ${diagnosticRow("Missing Due Dates", d.taskIssues?.missingDueDates ?? 0, statusForCount(d.taskIssues?.missingDueDates))}
      ${diagnosticRow("Invalid Preferred Months", d.taskIssues?.invalidPreferredMonths ?? 0, statusForCount(d.taskIssues?.invalidPreferredMonths))}
      ${diagnosticRow("Missing Estimated Minutes", d.taskIssues?.missingEstimatedMinutes ?? 0, statusForCount(d.taskIssues?.missingEstimatedMinutes))}
      ${diagnosticRow("Negative or Blank Intervals", d.taskIssues?.badIntervals ?? 0, statusForCount(d.taskIssues?.badIntervals))}
      ${diagnosticRow("Unknown Task Types", d.taskIssues?.unknownTaskTypes ?? 0, statusForCount(d.taskIssues?.unknownTaskTypes))}
      ${diagnosticRow("Invalid Schedule Modes", d.taskIssues?.invalidScheduleModes ?? 0, statusForCount(d.taskIssues?.invalidScheduleModes))}
      ${diagnosticRow("Blank Schedule Modes", d.taskCounts?.blankScheduleModes ?? 0, "ok")}
    </div>

    <div class="diagnostic-card">
      <div class="diagnostic-title">History Health</div>
      ${diagnosticRow("Completed Today", d.historyCounts?.completedToday ?? 0, "ok")}
      ${diagnosticRow("Actual Time Entries", d.historyCounts?.actualTimeEntries ?? 0, "ok")}
      ${diagnosticRow("Actual Time Entries Today", d.historyCounts?.actualTimeEntriesToday ?? 0, "ok")}
      ${diagnosticRow("Average Actual Minutes", formatDiagnosticMinutes(d.historyCounts?.averageActualMinutes), "ok")}
      ${diagnosticRow("History IDs Missing from Task Master", d.historyIssues?.orphanedTaskIds ?? 0, statusForCount(d.historyIssues?.orphanedTaskIds))}
    </div>

    <div class="diagnostic-card">
      <div class="diagnostic-title">Projects</div>
      ${diagnosticRow("Active", d.projectCounts?.active ?? 0, "ok")}
      ${diagnosticRow("On Hold", d.projectCounts?.onHold ?? 0, "ok")}
      ${diagnosticRow("Completed", d.projectCounts?.completed ?? 0, "ok")}
      ${diagnosticRow("Missing Status", d.projectIssues?.missingStatus ?? 0, statusForCount(d.projectIssues?.missingStatus))}
    </div>
  `;

  const warnings = collectDiagnosticWarnings(d);

  if (warnings.length > 0) {
    html += `
      <div class="diagnostic-card">
        <div class="diagnostic-title">Warnings</div>
        ${warnings.map(warning => `<div class="diagnostic-warning">${warning}</div>`).join("")}
      </div>
    `;
  }

  return html;
}

function diagnosticRow(label, value, status = "ok") {
  const statusClass = status === "warn" ? "warn" : "ok";
  const symbol = status === "warn" ? "⚠" : "✓";

  return `
    <div class="diagnostic-row">
      <span>${label}</span>
      <strong class="${statusClass}">${value} ${symbol}</strong>
    </div>
  `;
}

function statusForCount(value) {
  return Number(value || 0) > 0 ? "warn" : "ok";
}

function formatDiagnosticMinutes(value) {
  const num = Number(value || 0);
  if (!num) return "None yet";
  return `${Math.round(num)} min`;
}

function collectDiagnosticWarnings(d) {
  const warnings = [];

  if ((d.taskIssues?.duplicateTaskIds || 0) > 0) warnings.push("Duplicate Task IDs can cause completions to attach to the wrong task.");
  if ((d.taskIssues?.missingDueDates || 0) > 0) warnings.push("Some tasks are missing Next Due dates.");
  if ((d.taskIssues?.invalidPreferredMonths || 0) > 0) warnings.push("Some Preferred Months values are not valid.");
  if ((d.historyIssues?.orphanedTaskIds || 0) > 0) warnings.push("Some History records refer to Task IDs that are no longer in Task Master.");
  if ((d.projectIssues?.missingStatus || 0) > 0) warnings.push("Some projects are missing a status.");
  if ((d.taskIssues?.invalidScheduleModes || 0) > 0) warnings.push("Some tasks have invalid Schedule Mode values.");
  if ((d.routineCounts?.individualTasksInRoutines || 0) > 0) warnings.push("Some routine step tasks are still marked Individual. Mark them Routine to prevent duplicate scheduling.");

  if (warnings.length === 0) warnings.push("No warnings found.");

  return warnings;
}

function renderProjects() {
  const projects = state.data.projects || [];

  let html = `
    <button class="complete-btn" onclick="toggleAddProjectForm()">
      ${state.showAddProject ? "Close Add Project" : "Add Project"}
    </button>
    ${state.showAddProject ? renderAddProjectForm() : ""}
  `;

  html += renderProjectSummary(projects);

  if (projects.length === 0) {
    html += `<div class="empty">No projects yet.</div>`;
    return html;
  }

  const activeProjects = sortProjects(projects.filter(project => project.status !== "Completed"));
  const completedProjects = sortProjects(projects.filter(project => project.status === "Completed"));

  if (activeProjects.length > 0) {
    html += `<div class="section-title">Active Projects</div>`;
    activeProjects.forEach(project => html += projectCard(project));
  }

  if (completedProjects.length > 0) {
    html += `
      <button class="secondary-btn" onclick="toggleCompletedProjects()">
        ${state.showCompletedProjects ? "Hide Completed Projects" : `Show Completed Projects (${completedProjects.length})`}
      </button>
    `;

    if (state.showCompletedProjects) {
      html += `<div class="section-title">Completed Projects</div>`;
      completedProjects.forEach(project => html += projectCard(project));
    }
  }

  return html;
}

function toggleCompletedProjects() {
  state.showCompletedProjects = !state.showCompletedProjects;
  render();
}

function renderProjectSummary(projects) {
  const counts = {
    notStarted: projects.filter(project => !project.status || project.status === "Not Started").length,
    inProgress: projects.filter(project => project.status === "In Progress").length,
    onHold: projects.filter(project => project.status === "On Hold").length,
    completed: projects.filter(project => project.status === "Completed").length
  };

  return `
    <div class="summary-card project-summary-card">
      ${summaryItem("In Progress", counts.inProgress)}
      ${summaryItem("Not Started", counts.notStarted)}
      ${summaryItem("On Hold", counts.onHold)}
      ${summaryItem("Completed", counts.completed)}
    </div>
  `;
}

function sortProjects(projects) {
  const statusOrder = {
    "In Progress": 1,
    "Not Started": 2,
    "": 2,
    "On Hold": 3,
    "Completed": 4
  };

  return projects.slice().sort((a, b) => {
    const aStatus = a.status || "";
    const bStatus = b.status || "";
    const statusDiff = (statusOrder[aStatus] || 99) - (statusOrder[bStatus] || 99);
    if (statusDiff !== 0) return statusDiff;

    return String(a.project || "").localeCompare(String(b.project || ""));
  });
}

function renderAddProjectForm() {
  return `
    <div class="project-form-card">
      <div class="form-title">Add Project</div>

      <label class="form-label">Project Name</label>
      <input id="project-name-input" class="form-input" type="text" placeholder="Install dishwasher" />

      <label class="form-label">Area</label>
      <input id="project-area-input" class="form-input" type="text" placeholder="Kitchen" />

      <label class="form-label">Status</label>
      <select id="project-status-input" class="form-input">
        <option>Not Started</option>
        <option>In Progress</option>
        <option>On Hold</option>
        <option>Completed</option>
      </select>

      <label class="form-label">Estimated Hours</label>
      <input id="project-hours-input" class="form-input" type="text" placeholder="Optional" />

      <label class="form-label">Estimated Cost</label>
      <input id="project-cost-input" class="form-input" type="text" placeholder="Optional" />

      <label class="form-label">Notes</label>
      <textarea id="project-notes-input" class="form-textarea" placeholder="Optional"></textarea>

      ${state.projectError ? `<div class="modal-error">${state.projectError}</div>` : ""}

      <button class="complete-btn" onclick="addProject()">Save Project</button>
    </div>
  `;
}

function projectCard(project) {
  const isSelected = state.selectedProject === project.row;
  const statusClass = getStatusClass(project.status);

  return `
    <div class="project-card ${isSelected ? "selected-project" : ""}" onclick="selectProject(${project.row})">
      <div class="project-title">${isSelected ? "▼" : "▶"} ${project.project}</div>
      <div class="project-meta">${project.area || "No area listed"}</div>
      <div class="project-status ${statusClass}">${project.status || "Not Started"}</div>
      ${isSelected ? `
        <div class="project-detail-list">
          ${project.hours ? `<div class="project-row"><strong>Hours</strong> ${project.hours}</div>` : ""}
          ${project.cost ? `<div class="project-row"><strong>Cost</strong> ${formatCost(project.cost)}</div>` : ""}
          ${project.notes ? `<div class="project-notes">${project.notes}</div>` : ""}

          <div class="subsection-title">Change Status</div>
          <div class="status-button-grid" onclick="event.stopPropagation()">
            ${projectStatusButton(project, "Not Started")}
            ${projectStatusButton(project, "In Progress")}
            ${projectStatusButton(project, "On Hold")}
            ${projectStatusButton(project, "Completed")}
          </div>

          <button class="secondary-btn" onclick="event.stopPropagation(); toggleEditProject(${project.row})">
            ${state.editingProjectRow === project.row ? "Close Details Editor" : "Edit Details"}
          </button>

          ${state.editingProjectRow === project.row ? renderEditProjectForm(project) : ""}
        </div>
      ` : ""}
    </div>
  `;
}

function projectStatusButton(project, status) {
  const active = project.status === status || (!project.status && status === "Not Started");

  return `
    <button class="status-btn ${active ? "active-status" : ""}" onclick="updateProjectStatus(${project.row}, '${escapeQuotes(status)}')">
      ${status}
    </button>
  `;
}

function toggleAddProjectForm() {
  state.showAddProject = !state.showAddProject;
  state.projectError = "";
  render();
}

function addProject() {
  const project = getInputValue("project-name-input");
  const area = getInputValue("project-area-input");
  const status = getInputValue("project-status-input") || "Not Started";
  const hours = getInputValue("project-hours-input");
  const cost = getInputValue("project-cost-input");
  const notes = getInputValue("project-notes-input");

  if (!project) {
    state.projectError = "Project name is required.";
    render();
    return;
  }

  renderLoading();

  callApi("addProject", {
    project,
    area,
    status,
    hours,
    cost,
    notes
  })
    .then(data => {
      state.data = addGainPercentages(data);
      state.showAddProject = false;
      state.projectError = "";
      state.tab = "projects";
      render();
    })
    .catch(error => renderError(error));
}

function updateProjectStatus(row, status) {
  renderLoading();

  callApi("updateProjectStatus", { row, status })
    .then(data => {
      state.data = addGainPercentages(data);
      state.selectedProject = row;
      state.tab = "projects";
      render();
    })
    .catch(error => renderError(error));
}

function getInputValue(id) {
  const element = document.getElementById(id);
  return element ? String(element.value || "").trim() : "";
}


function renderEditProjectForm(project) {
  return `
    <div class="project-edit-card" onclick="event.stopPropagation()">
      <div class="form-title">Edit Project Details</div>

      <label class="form-label">Project Name</label>
      <input id="edit-project-name-${project.row}" class="form-input" type="text" value="${escapeHtmlAttribute(project.project || "")}" />

      <label class="form-label">Area</label>
      <input id="edit-project-area-${project.row}" class="form-input" type="text" value="${escapeHtmlAttribute(project.area || "")}" />

      <label class="form-label">Estimated Hours</label>
      <input id="edit-project-hours-${project.row}" class="form-input" type="text" value="${escapeHtmlAttribute(project.hours || "")}" />

      <label class="form-label">Estimated Cost</label>
      <input id="edit-project-cost-${project.row}" class="form-input" type="text" value="${escapeHtmlAttribute(project.cost || "")}" />

      <label class="form-label">Notes</label>
      <textarea id="edit-project-notes-${project.row}" class="form-textarea">${escapeHtmlText(project.notes || "")}</textarea>

      ${state.projectError ? `<div class="modal-error">${state.projectError}</div>` : ""}

      <button class="complete-btn" onclick="saveProjectDetails(${project.row})">Save Details</button>
    </div>
  `;
}

function toggleEditProject(row) {
  state.editingProjectRow = state.editingProjectRow === row ? null : row;
  state.projectError = "";
  render();
}

function saveProjectDetails(row) {
  const project = getInputValue(`edit-project-name-${row}`);
  const area = getInputValue(`edit-project-area-${row}`);
  const hours = getInputValue(`edit-project-hours-${row}`);
  const cost = getInputValue(`edit-project-cost-${row}`);
  const notes = getInputValue(`edit-project-notes-${row}`);

  if (!project) {
    state.projectError = "Project name is required.";
    render();
    return;
  }

  renderLoading();

  callApi("updateProjectDetails", {
    row,
    project,
    area,
    hours,
    cost,
    notes
  })
    .then(data => {
      state.data = addGainPercentages(data);
      state.selectedProject = row;
      state.editingProjectRow = null;
      state.projectError = "";
      state.tab = "projects";
      render();
    })
    .catch(error => renderError(error));
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getStatusClass(status) {
  const value = String(status || "").toLowerCase();
  if (value === "in progress") return "in-progress";
  if (value === "on hold") return "on-hold";
  if (value === "completed") return "completed";
  return "";
}

function formatCost(value) {
  const num = Number(value);
  if (isNaN(num)) return value;
  return "$" + num.toLocaleString("en-US");
}

function getZoneTasks(zoneName) {
  return (state.data.today || []).filter(task => task.zone === zoneName);
}

function getZoneRoutines(zoneName) {
  return (state.data.routines || []).filter(routine =>
    routine.zone === zoneName &&
    ["critical", "overdue", "today"].includes(routine.status)
  );
}

function taskCard(task) {
  return `
    <div class="task-card ${task.status}">
      <div class="task-title">${task.task}</div>
      <div class="task-meta">${task.zone} • ${task.area} • ${task.minutes} min • Due ${formatDisplayDate(task.due)}</div>
      <div class="task-notes">${task.notes || ""}</div>
      ${Number(task.gainPercent || 0) > 0
        ? `<div class="task-gain">🏡 ${formatGain(task.gainPercent)} Home Health</div>`
        : ""}
      <button class="complete-btn" onclick="event.stopPropagation(); openCompletionPrompt('${escapeQuotes(task.taskId)}')">Complete</button>
    </div>
  `;
}

function formatHealthWeight(value) {
  const number = Number(value || 0);

  if (Number.isInteger(number)) return String(number);

  return String(Math.round(number * 100) / 100);
}

function formatGain(gainPercent) {
  const gain = Number(gainPercent || 0);
  if (gain <= 0) return "+0%";

  const rounded = Math.round(gain * 10) / 10;
  return `+${rounded}%`;
}

function completedCard(task) {
  return `
    <div class="completed-card">
      <strong>${task.task}</strong>
      <div class="task-meta">${task.zone || ""}${task.area ? " • " + task.area : ""}</div>
      <button class="undo-btn" onclick="undoCompletion(${task.historyRow})">Undo Completion</button>
    </div>
  `;
}


function completedRoutineCard(routine) {
  return `
    <div class="completed-card routine-completed-card">
      <strong>${routine.routineName}</strong>
      <div class="task-meta">${routine.zone || ""}${routine.area ? " • " + routine.area : ""}</div>
      <div class="task-meta">Occurrence ${routine.cycleStep} of ${routine.totalSteps} • ${routine.completionType || "Routine Completed"}</div>
      <div class="task-meta">${routine.completedTaskNames || ""}</div>
      <button class="undo-btn" onclick="undoRoutineCompletion(${routine.routineHistoryRow})">Undo Routine Completion</button>
    </div>
  `;
}

function undoRoutineCompletion(routineHistoryRow) {
  if (!routineHistoryRow) {
    renderError("Unable to undo this routine completion because its Routine History row was not found.");
    return;
  }

  renderLoading();

  callApi("undoRoutine", { routineHistoryRow })
    .then(data => {
      state.data = addGainPercentages(data);
      render();
    })
    .catch(error => renderError(error));
}


function renderCompletionModal() {
  const task = state.pendingCompletionTask;
  if (!task) return "";

  return `
    <div class="modal-overlay" onclick="closeCompletionPrompt()">
      <div class="completion-modal" onclick="event.stopPropagation()">
        <div class="modal-eyebrow">Complete Task</div>
        <div class="modal-title">${task.task || "Task"}</div>
        <div class="modal-question">How many minutes did this take?</div>
        <input
          id="actual-minutes-input"
          class="minutes-input"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          enterkeyhint="done"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="Optional"
          onclick="focusMinutesInput()"
        />
        ${state.completionError ? `<div class="modal-error">${state.completionError}</div>` : ""}
        <div class="modal-actions">
          <button class="secondary-btn modal-btn" onclick="skipCompletionMinutes()">Skip</button>
          <button class="complete-btn modal-btn" onclick="saveCompletionMinutes()">Save</button>
        </div>
      </div>
    </div>
  `;
}

function openCompletionPrompt(taskId) {
  const task = [...(state.data.today || []), ...(state.data.week || [])].find(t => String(t.taskId) === String(taskId));
  state.pendingCompletionTask = task || { taskId: taskId, task: "Task" };
  state.completionError = "";
  render();

  focusMinutesInput();

  requestAnimationFrame(() => {
    const input = document.getElementById("actual-minutes-input");
    if (input && document.activeElement !== input) {
      input.focus({ preventScroll: true });
    }
  });
}

function focusMinutesInput() {
  const input = document.getElementById("actual-minutes-input");
  if (!input) return;

  input.focus({ preventScroll: true });

  try {
    const end = String(input.value || "").length;
    input.setSelectionRange(end, end);
  } catch (error) {
    // Selection ranges are optional on some mobile browsers.
  }
}

function closeCompletionPrompt() {
  state.pendingCompletionTask = null;
  state.completionError = "";
  render();
}

function skipCompletionMinutes() {
  if (!state.pendingCompletionTask) return;
  completeTask(state.pendingCompletionTask.taskId, "");
}

function saveCompletionMinutes() {
  if (!state.pendingCompletionTask) return;

  const input = document.getElementById("actual-minutes-input");
  const value = input ? String(input.value || "").trim() : "";

  if (value === "") {
    completeTask(state.pendingCompletionTask.taskId, "");
    return;
  }

  const minutes = Number(value);

  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
    state.completionError = "Enter a whole number from 1 to 240, or leave it blank.";
    render();
    return;
  }

  completeTask(state.pendingCompletionTask.taskId, minutes);
}

function completeTask(taskId, actualMinutes = "") {
  const task = state.pendingCompletionTask || [...(state.data.today || []), ...(state.data.week || [])].find(t => String(t.taskId) === String(taskId));
  state.pendingCompletionTask = null;
  state.completionError = "";
  renderLoading();

  callApi("complete", { taskId, actualMinutes })
    .then(data => {
      state.data = addGainPercentages(data);
      state.completedExpanded = true;

      if (task) {
        if (state.oneThingMode) {
          state.guidedLastZone = task.zone || null;
          state.guidedLastArea = task.area || null;
          state.guidedJustCompleted = task;
          state.showWork = false;
        } else {
          state.showWork = true;
        }
      }

      render();
    })
    .catch(error => renderError(error));
}

function undoCompletion(historyRow) {
  if (!historyRow) {
    renderError("Unable to undo this completion because its History row was not found.");
    return;
  }

  renderLoading();

  callApi("undo", { historyRow })
    .then(data => {
      state.data = addGainPercentages(data);
      state.guidedJustCompleted = null;
      render();
    })
    .catch(error => renderError(error));
}

function startWorking() {
  state.showWork = true;
  state.oneThingMode = false;
  state.guidedJustCompleted = null;
  render();
}

function doOneThing() {
  state.showWork = false;
  state.oneThingMode = true;
  state.guidedLastZone = null;
  state.guidedLastArea = null;
  state.guidedJustCompleted = null;
  render();
}

function exitOneThingMode() {
  state.oneThingMode = false;
  state.showWork = true;
  state.guidedJustCompleted = null;
  render();
}

function selectQuickPick(name) {
  state.selectedQuickPick = name;
  render();
}

function selectZone(zone) {
  state.selectedZone = state.selectedZone === zone ? null : zone;
  render();
}

function selectProject(row) {
  const nextSelection = state.selectedProject === row ? null : row;
  state.selectedProject = nextSelection;
  if (state.editingProjectRow !== nextSelection) {
    state.editingProjectRow = null;
  }
  render();
}

function summaryItem(label, number) {
  return `<div class="summary-item"><div class="summary-number">${number}</div><div class="summary-label">${label}</div></div>`;
}

function countByStatus(tasks, status) {
  return tasks.filter(task => task.status === status).length;
}

function formatDisplayDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
}

function escapeQuotes(text) {
  return String(text).replace(/'/g, "\\'");
}

initApp();
