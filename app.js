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
  isAuthenticated: false
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
  document.querySelectorAll(".nav-btn").forEach(button => button.classList.remove("active"));
  document.getElementById("app-content").innerHTML = `
    <div class="login-card">
      <div class="login-title">Welcome to HouseFlow</div>
      <div class="login-subtitle">Enter your HouseFlow password to continue on this device.</div>
      <input id="password-input" class="password-input" type="password" placeholder="Password" autocomplete="current-password" />
      <button class="complete-btn" onclick="attemptLogin()">Sign In</button>
      ${message ? `<div class="login-error">${message}</div>` : ""}
    </div>
  `;
  const input = document.getElementById("password-input");
  if (input) {
    input.focus();
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
  const allTasks = [...(data.today || []), ...(data.week || [])];
  const totalScore = allTasks.reduce((sum, task) => sum + Number(task.score || 0), 0);
  const missingHealth = Math.max(0, 100 - Number(data.health?.overall || 100));
  const addGain = task => {
    const score = Number(task.score || 0);
    let gainPercent = 0;
    if (totalScore > 0 && missingHealth > 0) {
      gainPercent = Math.max(1, Math.round((score / totalScore) * missingHealth));
    }
    return { ...task, gainPercent };
  };
  return {
    ...data,
    today: (data.today || []).map(addGain),
    week: (data.week || []).map(addGain),
    quick: (data.quick || []).map(group => ({ ...group, tasks: (group.tasks || []).map(addGain) })),
    projects: data.projects || [],
    routines: data.routines || [],
    completedRoutinesToday: data.completedRoutinesToday || []
  };
}

function render() {
  if (!state.isAuthenticated) return renderLogin();
  if (state.loading) return renderLoading();
  if (state.error) return renderError(state.error);

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === state.tab);
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

  if (state.tab === "routines") {
    title.textContent = "Routines";
    html = renderRoutines();
  }

  if (state.tab === "health") {
    title.textContent = "Home Health";
    html = renderHomeHealth();
  }

  if (state.tab === "projects") {
    title.textContent = "Projects";
    html = renderProjects();
  }

  if (state.tab === "diagnostics") {
    title.textContent = "Diagnostics";
    html = renderDiagnostics();
  }

  content.innerHTML = html + renderCompletionModal();
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

function renderToday() {
  const individualToday = state.data.today || [];
  const individualWeek = state.data.week || [];
  const routines = state.data.routines || [];
  const workItems = getTodayWorkItems(individualToday, individualWeek, routines);
  const currentItems = workItems.filter(item => ["critical", "overdue", "today"].includes(item.status));
  const weekItems = workItems.filter(item => item.status === "week");
  const completed = state.data.completedToday || [];
  const completedRoutines = state.data.completedRoutinesToday || [];
  const currentMinutes = currentItems.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const health = state.data.health?.overall ?? 100;

  let html = `
    <div class="health-card">
      <div>Home Health</div>
      <div class="health-percent">${health}%</div>
      <div class="health-detail">${currentItems.length} current items • ${currentMinutes} minutes</div>
      ${state.oneThingMode ? "" : `
        <button class="complete-btn" onclick="startWorking()">View All Tasks</button>
        <button class="complete-btn" onclick="doOneThing()">Do One Thing</button>
      `}
      <button class="sign-out-btn" onclick="signOut()">Sign Out</button>
    </div>
    ${renderWeeklyMomentumCard()}
  `;

  if (state.oneThingMode) {
    html += renderGuidedMode(sortByDueDate(individualToday), sortByDueDate(individualWeek));
  } else if (state.showWork) {
    html += `
      <div class="summary-card">
        ${summaryItem("Critical", countWorkItemsByStatus(workItems, "critical"))}
        ${summaryItem("Overdue", countWorkItemsByStatus(workItems, "overdue"))}
        ${summaryItem("Due Today", countWorkItemsByStatus(workItems, "today"))}
        ${summaryItem("This Week", countWorkItemsByStatus(workItems, "week"))}
      </div>
    `;

    if (workItems.length === 0) {
      html += `<div class="empty">No current or upcoming work. 🎉</div>`;
    } else {
      html += `<div class="section-title">Work List</div>`;
      workItems.forEach(item => html += workItemCard(item));
    }
  }

  if (completedRoutines.length > 0) {
    html += `<div class="section-title">Completed Routines Today</div>`;
    completedRoutines.forEach(routine => html += completedRoutineCard(routine));
  }

  if (completed.length > 0) {
    html += `<div class="section-title">Completed Tasks Today</div>`;
    completed.forEach(task => html += completedCard(task));
  }

  return html;
}

function getTodayWorkItems(individualToday, individualWeek, routines) {
  const taskItems = [...individualToday, ...individualWeek].map(task => ({
    kind: "task",
    id: `task-${task.taskId}`,
    status: task.status,
    due: task.due,
    minutes: Number(task.minutes || 0),
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
        title: routine.name,
        routine: routine
      };
    });

  return [...taskItems, ...routineItems].sort(sortWorkItems);
}

function sortWorkItems(a, b) {
  const dateDiff = getSortableDate(a.due) - getSortableDate(b.due);
  if (dateDiff !== 0) return dateDiff;

  const statusOrder = {
    critical: 1,
    overdue: 2,
    today: 3,
    week: 4
  };

  const statusDiff = (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
  if (statusDiff !== 0) return statusDiff;

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
  const taskList = (routine.tasks || []).map(task => todayRoutineTaskLine(task)).join("");
  const remainingMinutes = remainingTasks.reduce((sum, task) => sum + Number(task.minutes || 0), 0);
  const minutes = remainingMinutes || Number(routine.totalMinutes || 0);

  return `
    <div class="task-card routine-work-card ${routine.status}">
      <div class="task-title">▶ ${routine.name}</div>
      <div class="task-meta">${routine.zone || "No zone"} • ${routine.area || "No area"} • ${minutes} min • Due ${formatDisplayDate(routine.nextDue)}</div>
      <div class="routine-detail">Occurrence ${routine.currentStep} of ${routine.totalSteps} • ${routine.doneCount || 0} done • ${routine.remainingCount || 0} remaining</div>
      <div class="routine-progress-wrap"><div class="routine-progress-bar" style="width:${Math.min(100, Math.max(0, Number(routine.progressPercent || 0)))}%"></div></div>
      <div class="routine-inline-list">${taskList}</div>
      <button class="complete-btn" onclick="event.stopPropagation(); completeFullRoutine('${escapeQuotes(routine.routineId)}')">
        ${Number(routine.doneCount || 0) > 0 ? "Complete Remaining Routine" : "Complete Full Routine"}
      </button>
    </div>
  `;
}

function todayRoutineTaskLine(task) {
  const rowClass = task.done ? "done" : task.status;
  const label = task.done ? "Done" : getTaskStatusLabel(task.status);

  return `
    <div class="today-routine-task-line ${rowClass}">
      <div>
        <strong>${task.taskOrder}. ${task.task}</strong>
        <span>${task.minutes} min • ${label}</span>
      </div>
      ${task.status === "missing" || task.done ? "" : `<button class="small-complete-btn" onclick="event.stopPropagation(); openCompletionPrompt('${escapeQuotes(task.taskId)}')">Complete</button>`}
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
    const plan = buildMinutePlan(items, minutes);

    if (plan.length > 0) {
      groups.push({
        name: `${minutes} Minutes`,
        description: `One suggested work plan totaling about ${minutes} minutes or less.`,
        items: plan
      });
    }
  });

  const sameArea = buildSameAreaQuickPickGroup(items);

  if (sameArea) {
    groups.push(sameArea);
  }

  const routineItems = items
    .filter(item => item.kind === "routine")
    .slice(0, 8);

  if (routineItems.length > 0) {
    groups.push({
      name: "Routine Work",
      description: "Due routines and routine occurrences that are coming up soon.",
      items: routineItems
    });
  }

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

function buildMinutePlan(items, targetMinutes) {
  const plan = [];
  let total = 0;

  items.forEach(item => {
    const minutes = Number(item.minutes || 0);

    if (minutes <= 0) return;

    if (total + minutes <= targetMinutes) {
      plan.push(item);
      total += minutes;
    }
  });

  if (plan.length === 0) {
    const smallest = items
      .filter(item => Number(item.minutes || 0) > 0)
      .sort((a, b) => Number(a.minutes || 0) - Number(b.minutes || 0))[0];

    if (smallest) plan.push(smallest);
  }

  return plan;
}


function getPlanMinutes(items) {
  return (items || []).reduce((sum, item) => sum + Number(item.minutes || 0), 0);
}

function getQuickPickWorkItems() {
  const taskItems = [...(state.data.today || []), ...(state.data.week || [])]
    .map(task => ({
      kind: "task",
      id: `task-${task.taskId}`,
      status: task.status,
      due: task.due,
      minutes: Number(task.minutes || 0),
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

      return {
        kind: "routine",
        id: `routine-${routine.routineId}`,
        status: routine.status,
        due: routine.nextDue,
        minutes: remainingMinutes || Number(routine.totalMinutes || 0),
        zone: routine.zone || "",
        area: routine.area || "",
        title: routine.name,
        routine: routine
      };
    });

  return [...taskItems, ...routineItems].sort(sortWorkItems);
}

function buildSameAreaQuickPickGroup(items) {
  const areaMap = {};

  items.forEach(item => {
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

  const best = Object.values(areaMap)
    .filter(group => group.items.length >= 2)
    .sort((a, b) => {
      const countDiff = b.items.length - a.items.length;
      if (countDiff !== 0) return countDiff;

      const minuteDiff = a.items.reduce((sum, item) => sum + Number(item.minutes || 0), 0) -
        b.items.reduce((sum, item) => sum + Number(item.minutes || 0), 0);

      return minuteDiff;
    })[0];

  if (!best) return null;

  return {
    name: "Same Area",
    description: `${best.area}: one grouped plan for when you are already there.`,
    items: buildMinutePlan(best.items, 30)
  };
}

function quickPickItemCard(item) {
  if (item.kind === "routine") {
    return todayRoutineCard(item.routine);
  }

  return taskCard(item.task);
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
  if (!health) return `<div class="empty">No health data available.</div>`;
  let html = `
    <div class="health-card">
      <div>Overall</div>
      <div class="health-percent">${health.overall}%</div>
      <div class="health-bar-wrap"><div class="health-bar" style="width:${health.overall}%"></div></div>
    </div>
  `;
  health.zones.forEach(zone => {
    const isSelected = state.selectedZone === zone.zone;
    const zoneTasks = getZoneTasks(zone.zone);
    const bestTask = getBestTask(zoneTasks, []);
    const otherTasks = bestTask ? zoneTasks.filter(task => task.row !== bestTask.row) : zoneTasks;
    html += `
      <div class="health-card ${isSelected ? "selected-zone" : ""}" onclick="selectZone('${escapeQuotes(zone.zone)}')">
        <strong>${isSelected ? "▼" : "▶"} ${zone.zone}</strong>
        <div class="health-percent">${zone.percent}%</div>
        <div class="health-bar-wrap"><div class="health-bar" style="width:${zone.percent}%"></div></div>
        <div class="health-detail">${zone.dueCount} tasks due</div>
        <div class="zone-task-list ${isSelected ? "expanded" : ""}">
          ${isSelected ? renderExpandedZone(bestTask, otherTasks) : ""}
        </div>
      </div>
    `;
  });
  return html;
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
  return [...(state.data.today || []), ...(state.data.week || [])].filter(task => task.zone === zoneName);
}

function taskCard(task) {
  return `
    <div class="task-card ${task.status}">
      <div class="task-title">${task.task}</div>
      <div class="task-meta">${task.zone} • ${task.area} • ${task.minutes} min • Due ${formatDisplayDate(task.due)}</div>
      <div class="task-notes">${task.notes || ""}</div>
      <div class="task-gain">🏡 ${formatGain(task.gainPercent)} Home Health</div>
      <button class="complete-btn" onclick="event.stopPropagation(); openCompletionPrompt('${escapeQuotes(task.taskId)}')">Complete</button>
    </div>
  `;
}

function formatGain(gainPercent) {
  const gain = Number(gainPercent || 0);
  if (gain <= 0) return "+0%";
  return `+${gain}%`;
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
        <input id="actual-minutes-input" class="minutes-input" type="number" min="1" max="240" step="1" inputmode="numeric" placeholder="Optional" />
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

  setTimeout(() => {
    const input = document.getElementById("actual-minutes-input");
    if (input) input.focus();
  }, 50);
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
