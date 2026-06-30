let state = {
  tab: "today",
  data: null,
  selectedQuickPick: null,
  selectedZone: null,
  showWork: false,
  oneThingMode: false,
  loading: true,
  error: "",
  localCompleted: []
};

document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => {
    state.tab = button.dataset.tab;
    state.selectedQuickPick = null;
    state.selectedZone = null;
    state.oneThingMode = false;
    render();
  });
});

function callApi(action, params = {}) {
  const query = new URLSearchParams({
    action,
    callback: "houseflowCallback",
    ...params
  });

  return fetch(CONFIG.apiUrl + "?" + query.toString(), {
    method: "GET",
    redirect: "follow"
  })
    .then(response => response.text())
    .then(text => {
      const jsonText = text
        .replace(/^houseflowCallback\(/, "")
        .replace(/\);?$/, "");

      const data = JSON.parse(jsonText);

      if (!data.ok) {
        throw new Error(data.error || "Unknown API error");
      }

      return data;
    });
}

function loadData() {
  state.loading = true;
  renderLoading();

  callApi("getData")
    .then(data => {
      state.data = data;
      state.loading = false;
      render();
    })
    .catch(error => {
      state.error = error;
      state.loading = false;
      renderError(error);
    });
}

function render() {
  if (state.loading) return renderLoading();
  if (state.error) return renderError(state.error);

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === state.tab);
  });

  const title = document.getElementById("page-title");
  const content = document.getElementById("app-content");

  if (state.tab === "today") {
    title.textContent = "Today";
    content.innerHTML = renderToday();
  }

  if (state.tab === "quick") {
    title.textContent = "Quick Picks";
    content.innerHTML = renderQuickPicks();
  }

  if (state.tab === "health") {
    title.textContent = "Home Health";
    content.innerHTML = renderHomeHealth();
  }
}

function renderLoading() {
  document.getElementById("app-content").innerHTML = `<div class="empty">Loading HouseFlow...</div>`;
}

function renderError(message) {
  document.getElementById("app-content").innerHTML = `<div class="empty">Error: ${message}</div>`;
}

function renderToday() {
  const today = state.data.today || [];
  const week = state.data.week || [];
  const completed = [...state.localCompleted, ...(state.data.completedToday || [])];
  const currentMinutes = today.reduce((sum, task) => sum + Number(task.minutes || 0), 0);
  const health = state.data.health?.overall ?? 100;

  let html = `
    <div class="health-card">
      <div>Home Health</div>
      <div class="health-percent">${health}%</div>
      <div class="health-detail">${today.length} current tasks • ${currentMinutes} minutes</div>
      ${
        state.oneThingMode
          ? ""
          : `
            <button class="complete-btn" onclick="startWorking()">Start Working</button>
            <button class="complete-btn" onclick="doOneThing()">Do One Thing</button>
          `
      }
    </div>
  `;

  if (state.oneThingMode) {
    html += renderOneThing(today, week);
  } else if (state.showWork) {
    html += `
      <div class="summary-card">
        ${summaryItem("Critical", countByStatus([...today, ...week], "critical"))}
        ${summaryItem("Overdue", countByStatus([...today, ...week], "overdue"))}
        ${summaryItem("Due Today", countByStatus([...today, ...week], "today"))}
        ${summaryItem("This Week", week.length)}
      </div>
    `;

    if (today.length === 0) {
      html += `<div class="empty">No current tasks. 🎉</div>`;
    } else {
      html += `<div class="section-title">Current Work</div>`;
      today.forEach(task => html += taskCard(task));
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

function renderOneThing(today, week) {
  const task = getBestTask(today, week);

  if (!task) {
    return `<div class="empty">No task to recommend right now. 🎉</div>`;
  }

  return `
    <div class="section-title">Do One Thing</div>
    ${taskCard(task)}
    <button class="undo-btn" onclick="exitOneThingMode()">Show Full List</button>
  `;
}

function getBestTask(today, week) {
  const all = [...today, ...week];
  if (all.length === 0) return null;

  return all
    .slice()
    .sort((a, b) => {
      const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return Number(a.minutes || 999) - Number(b.minutes || 999);
    })[0];
}

function renderQuickPicks() {
  const groups = state.data.quick || [];
  if (groups.length === 0) return `<div class="empty">No quick picks right now.</div>`;

  let html = `<div class="quick-grid">`;

  groups.forEach(group => {
    html += `
      <div class="quick-card">
        <button class="quick-btn" onclick="selectQuickPick('${escapeQuotes(group.name)}')">${group.name}</button>
      </div>
    `;
  });

  html += `</div>`;

  if (state.selectedQuickPick) {
    const group = groups.find(g => g.name === state.selectedQuickPick);
    html += `<div class="section-title">${state.selectedQuickPick}</div>`;

    if (!group || group.tasks.length === 0) {
      html += `<div class="empty">No tasks found.</div>`;
    } else {
      group.tasks.forEach(task => html += taskCard(task));
    }
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
    html += `
      <div class="health-card" onclick="selectZone('${escapeQuotes(zone.zone)}')">
        <strong>${zone.zone}</strong>
        <div class="health-percent">${zone.percent}%</div>
        <div class="health-bar-wrap"><div class="health-bar" style="width:${zone.percent}%"></div></div>
        <div class="health-detail">${zone.dueCount} tasks due</div>
      </div>
    `;
  });

  if (state.selectedZone) html += renderZoneTasks(state.selectedZone);
  return html;
}

function renderZoneTasks(zoneName) {
  const tasks = [...(state.data.today || []), ...(state.data.week || [])].filter(task => task.zone === zoneName);
  let html = `<div class="section-title">${zoneName} Tasks</div>`;
  html += tasks.length ? tasks.map(taskCard).join("") : `<div class="empty">No tasks due here.</div>`;
  return html;
}

function taskCard(task) {
  return `
    <div class="task-card ${task.status}">
      <div class="task-title">${task.task}</div>
      <div class="task-meta">${task.zone} • ${task.area} • ${task.minutes} min • Due ${formatDisplayDate(task.due)}</div>
      <div class="task-notes">${task.notes || ""}</div>
      <button class="complete-btn" onclick="completeTask(${task.row})">Complete</button>
    </div>
  `;
}

function completedCard(task) {
  return `
    <div class="completed-card">
      <strong>${task.task}</strong>
      <div class="task-meta">${task.zone || ""}${task.area ? " • " + task.area : ""}</div>
      <button class="undo-btn" onclick="undoLast()">Undo Last Completion</button>
    </div>
  `;
}

function completeTask(row) {
  const task = [...(state.data.today || []), ...(state.data.week || [])].find(t => t.row === row);
  renderLoading();

  callApi("complete", { row })
    .then(data => {
      state.data = data;
      if (task) state.localCompleted.unshift(task);
      state.showWork = true;
      render();
    })
    .catch(error => renderError(error));
}

function undoLast() {
  renderLoading();

  callApi("undo")
    .then(data => {
      state.data = data;
      state.localCompleted.shift();
      render();
    })
    .catch(error => renderError(error));
}

function startWorking() {
  state.showWork = true;
  state.oneThingMode = false;
  render();
}

function doOneThing() {
  state.showWork = false;
  state.oneThingMode = true;
  render();
}

function exitOneThingMode() {
  state.oneThingMode = false;
  state.showWork = true;
  render();
}

function selectQuickPick(name) {
  state.selectedQuickPick = name;
  render();
}

function selectZone(zone) {
  state.selectedZone = zone;
  render();
}

function summaryItem(label, number) {
  return `
    <div class="summary-item">
      <div class="summary-number">${number}</div>
      <div class="summary-label">${label}</div>
    </div>
  `;
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

loadData();