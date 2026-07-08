let state = {
  tab: "today",
  data: null,
  selectedQuickPick: null,
  selectedZone: null,
  selectedProject: null,
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
    projects: data.projects || []
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
  const currentWork = state.data.today || [];
  const criticalTasks = currentWork.filter(task => task.status === "critical");
  const overdueTasks = currentWork.filter(task => task.status === "overdue");
  const todayTasks = currentWork.filter(task => task.status === "today");
  const today = [
    ...sortByDueDate(criticalTasks),
    ...sortByDueDate(overdueTasks),
    ...sortByDueDate(todayTasks)
  ];

  const week = sortByDueDate(state.data.week || []);
  const completed = state.data.completedToday || [];
  const currentMinutes = currentWork.reduce((sum, task) => sum + Number(task.minutes || 0), 0);
  const health = state.data.health?.overall ?? 100;

  let html = `
    <div class="health-card">
      <div>Home Health</div>
      <div class="health-percent">${health}%</div>
      <div class="health-detail">${currentWork.length} current tasks • ${currentMinutes} minutes</div>
      ${state.oneThingMode ? "" : `
        <button class="complete-btn" onclick="startWorking()">View All Tasks</button>
        <button class="complete-btn" onclick="doOneThing()">Do One Thing</button>
      `}
      <button class="sign-out-btn" onclick="signOut()">Sign Out</button>
    </div>
    ${renderWeeklyMomentumCard()}
  `;

  if (state.oneThingMode) {
    html += renderGuidedMode(today, week);
  } else if (state.showWork) {
    html += `
      <div class="summary-card">
        ${summaryItem("Critical", criticalTasks.length)}
        ${summaryItem("Overdue", overdueTasks.length)}
        ${summaryItem("Due Today", todayTasks.length)}
        ${summaryItem("This Week", week.length)}
      </div>
    `;

    if (currentWork.length === 0) {
      html += `<div class="empty">No current tasks. 🎉</div>`;
    } else {
      html += renderCurrentWorkGroup("Critical", criticalTasks);
      html += renderCurrentWorkGroup("Overdue", overdueTasks);
      html += renderCurrentWorkGroup("Due Today", todayTasks);
    }

    if (week.length > 0) {
      html += `<div class="section-title">Coming Up This Week</div>`;
      week.slice(0, 8).forEach(task => html += taskCard(task));
    }
  }

  if (completed.length > 0) {
    html += `<div class="section-title">Completed Today</div>`;
    completed.forEach(task => html += completedCard(task));
  }

  return html;
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
  const groups = state.data.quick || [];
  const filteredGroups = groups.filter(group => group.name !== "Surprise me");
  if (filteredGroups.length === 0) return `<div class="empty">No quick picks right now.</div>`;
  let html = `<div class="quick-grid">`;
  filteredGroups.forEach(group => {
    html += `<div class="quick-card"><button class="quick-btn" onclick="selectQuickPick('${escapeQuotes(group.name)}')">${group.name}</button></div>`;
  });
  html += `</div>`;
  if (state.selectedQuickPick) {
    const group = filteredGroups.find(g => g.name === state.selectedQuickPick);
    html += `<div class="section-title">${state.selectedQuickPick}</div>`;
    if (!group || group.tasks.length === 0) html += `<div class="empty">No tasks found.</div>`;
    else group.tasks.forEach(task => html += taskCard(task));
  }
  return html;
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

  if (warnings.length === 0) warnings.push("No warnings found.");

  return warnings;
}

function renderProjects() {
  const projects = state.data.projects || [];
  if (projects.length === 0) return `<div class="empty">No projects yet.</div>`;
  let html = "";
  const activeProjects = projects.filter(project => project.status !== "Completed");
  const completedProjects = projects.filter(project => project.status === "Completed");
  if (activeProjects.length > 0) {
    html += `<div class="section-title">Active Projects</div>`;
    activeProjects.forEach(project => html += projectCard(project));
  }
  if (completedProjects.length > 0) {
    html += `<div class="section-title">Completed Projects</div>`;
    completedProjects.forEach(project => html += projectCard(project));
  }
  return html;
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
        </div>
      ` : ""}
    </div>
  `;
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
  state.selectedProject = state.selectedProject === row ? null : row;
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
