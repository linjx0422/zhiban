// ==================== 全局状态管理 ====================
let staffList = [];
let historySchedules = {};
let currentYear = 2026;
let currentMonth = 9;
let monthDays = [];

// 内存中缓存各年份的日历规则：{ 2026: { holidays: {...}, workdays: {...} } }
const yearRulesCache = {};

// 内置完整兜底数据
const FALLBACK_RULES = {
  holidays: {
    '2026-01-01': '元旦', '2026-01-02': '元旦', '2026-01-03': '元旦',
    '2026-02-16': '除夕', '2026-02-17': '春节', '2026-02-18': '春节', '2026-02-19': '春节',
    '2026-02-20': '春节', '2026-02-21': '春节', '2026-02-22': '春节', '2026-02-23': '春节',
    '2026-04-04': '清明节', '2026-04-05': '清明节', '2026-04-06': '清明节',
    '2026-05-01': '劳动节', '2026-05-02': '劳动节', '2026-05-03': '劳动节', '2026-05-04': '劳动节', '2026-05-05': '劳动节',
    '2026-06-19': '端午节', '2026-06-20': '端午节', '2026-06-21': '端午节',
    '2026-09-25': '中秋节', '2026-09-26': '中秋节', '2026-09-27': '中秋节',
    '2026-10-01': '国庆节', '2026-10-02': '国庆节', '2026-10-03': '国庆节', '2026-10-04': '国庆节',
    '2026-10-05': '国庆节', '2026-10-06': '国庆节', '2026-10-07': '国庆节'
  },
  workdays: {
    '2026-02-14': '调休上班', '2026-02-28': '调休上班', '2026-04-26': '调休上班',
    '2026-05-09': '调休上班', '2026-09-20': '调休上班', '2026-10-10': '调休上班'
  }
};

// 非阻塞 Toast 提示框
function showToast(text, isError = false) {
  const toast = document.getElementById('sidebar-toast');
  if (!toast) return;
  toast.innerText = text;
  toast.style.display = 'block';
  toast.style.background = isError ? '#fee2e2' : '#dcfce7';
  toast.style.color = isError ? '#b91c1c' : '#15803d';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.display = 'none';
  }, 2500);
}

// 持久化存储至本地硬盘
async function persist() {
  const monthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
  historySchedules[monthKey] = monthDays;
  if (window.api && window.api.saveData) {
    await window.api.saveData({ staffList, historySchedules });
  }
}

// 加载指定年份的节假日规则
async function loadYearRules(year, forceOnline = false) {
  if (!forceOnline && yearRulesCache[year]) {
    return yearRulesCache[year];
  }

  const statusEl = document.getElementById('sub-status');
  if (statusEl) {
    statusEl.innerText = forceOnline ? '正在从在线订阅更新...' : '正在检查节假日...';
    statusEl.className = 'status-badge status-offline';
  }

  try {
    const res = await window.api.fetchIcsRules(year, forceOnline);
    if (res.success && (Object.keys(res.data.holidays).length > 0 || Object.keys(res.data.workdays).length > 0)) {
      yearRulesCache[year] = res.data;
      if (statusEl) {
        statusEl.innerText = res.fromOnline ? '✅ 在线订阅已同步' : '📁 已载入离线缓存';
        statusEl.className = 'status-badge status-online';
      }
      return yearRulesCache[year];
    }
  } catch (err) {
    console.warn('获取在线日历规则异常:', err);
  }

  if (statusEl) {
    statusEl.innerText = '⚠️ 内置离线规则';
    statusEl.className = 'status-badge status-offline';
  }
  yearRulesCache[year] = FALLBACK_RULES;
  return yearRulesCache[year];
}

// 判定日期类型与节日名称
function getDayInfo(dateStr, rules) {
  if (rules.holidays && rules.holidays[dateStr]) {
    return { type: 'holiday', name: rules.holidays[dateStr] };
  }
  if (rules.workdays && rules.workdays[dateStr]) {
    return { type: 'workday', name: rules.workdays[dateStr] };
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const dayOfWeek = new Date(y, m - 1, d).getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { type: 'weekend', name: '' };
  }
  return { type: 'workday', name: '' };
}

// ==================== 人员名单管理 ====================
function renderStaff() {
  const container = document.getElementById('staff-list');
  if (!container) return;

  if (staffList.length === 0) {
    container.innerHTML = '<div style="color:#94a3b8; font-size:12px; text-align:center; padding:15px;">暂无人员，请在上方添加</div>';
  } else {
    container.innerHTML = staffList.map((name, index) => `
      <div class="staff-item">
        <span><strong>${index + 1}.</strong> ${name}</span>
        <div>
          <button onclick="moveStaff(${index}, -1)" title="上移">↑</button>
          <button onclick="moveStaff(${index}, 1)" title="下移">↓</button>
          <button onclick="removeStaff(${index})" style="color:#ef4444;" title="删除">×</button>
        </div>
      </div>
    `).join('');
  }
  updateSelectOptions();
}

window.moveStaff = (index, dir) => {
  const target = index + dir;
  if (target < 0 || target >= staffList.length) return;
  const temp = staffList[index];
  staffList[index] = staffList[target];
  staffList[target] = temp;
  renderStaff();
  renderCalendar();
  persist();
};

window.removeStaff = (index) => {
  const removed = staffList.splice(index, 1)[0];
  renderStaff();
  renderCalendar();
  persist();
  showToast(`已移除人员: ${removed}`);
};

function addSingleStaff() {
  const input = document.getElementById('single-name-input');
  const val = input.value.trim();
  if (!val) return;

  if (staffList.includes(val)) {
    showToast(`人员 [${val}] 已存在`, true);
    input.focus();
    return;
  }

  staffList.push(val);
  input.value = '';
  renderStaff();
  renderCalendar();
  persist();
  showToast(`成功添加: ${val}`);
  input.focus();
}

document.getElementById('btn-single-add').addEventListener('click', addSingleStaff);
document.getElementById('single-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addSingleStaff();
  }
});

document.getElementById('btn-batch-add').addEventListener('click', () => {
  const inputEl = document.getElementById('batch-staff-input');
  const rawText = inputEl.value.trim();
  if (!rawText) return;

  const names = rawText
    .split(/[,，、\s\n\r\t]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  let addedCount = 0;
  names.forEach(name => {
    if (!staffList.includes(name)) {
      staffList.push(name);
      addedCount++;
    }
  });

  inputEl.value = '';
  renderStaff();
  renderCalendar();
  persist();
  showToast(`批量添加完成，新增 ${addedCount} 人`);
});

let clearClickCount = 0;
let clearTimer = null;
document.getElementById('btn-clear-all').addEventListener('click', () => {
  clearClickCount++;
  if (clearClickCount === 1) {
    showToast('⚠️ 再次点击【清空全员】以确认清空', true);
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { clearClickCount = 0; }, 3000);
  } else if (clearClickCount >= 2) {
    clearClickCount = 0;
    staffList = [];
    renderStaff();
    renderCalendar();
    persist();
    showToast('已清空全部名单');
  }
});

// ==================== 跨月顺延与未来月份构建 ====================
function getLastPersonOfPreviousMonth(streamType) {
  let prevY = currentYear;
  let prevM = currentMonth - 1;
  if (prevM === 0) {
    prevM = 12;
    prevY -= 1;
  }
  const prevKey = `${prevY}-${String(prevM).padStart(2, '0')}`;
  const prevMonthData = historySchedules[prevKey];
  if (!prevMonthData || !prevMonthData.length) return null;

  for (let i = prevMonthData.length - 1; i >= 0; i--) {
    const item = prevMonthData[i];
    if (item.type === streamType && item.assignedPerson) {
      return item.assignedPerson;
    }
  }
  return null;
}

function getNextPerson(person) {
  if (!person || !staffList.includes(person)) return staffList[0] || '';
  const idx = staffList.indexOf(person);
  return staffList[(idx + 1) % staffList.length];
}

function updateRecommendedStarters() {
  const streams = [
    { type: 'workday', selectId: 'select-workday-start', hintId: 'hint-workday' },
    { type: 'weekend', selectId: 'select-weekend-start', hintId: 'hint-weekend' },
    { type: 'holiday', selectId: 'select-holiday-start', hintId: 'hint-holiday' }
  ];

  streams.forEach(({ type, selectId, hintId }) => {
    const lastPerson = getLastPersonOfPreviousMonth(type);
    const hintEl = document.getElementById(hintId);
    const selectEl = document.getElementById(selectId);

    const firstAssigned = monthDays.find(d => d.type === type && d.assignedPerson);

    if (firstAssigned) {
      selectEl.value = firstAssigned.assignedPerson;
      hintEl.innerText = `当月首位: ${firstAssigned.assignedPerson}`;
      hintEl.style.color = '#2563eb';
    } else if (lastPerson) {
      const nextPerson = getNextPerson(lastPerson);
      selectEl.value = nextPerson;
      hintEl.innerText = `上月最后: ${lastPerson} ➔ 顺延推荐: ${nextPerson}`;
      hintEl.style.color = '#15803d';
    } else {
      hintEl.innerText = '上月无记录，默认首位';
      hintEl.style.color = '#64748b';
    }
  });
}

async function getOrBuildMonthDays(year, month) {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  if (historySchedules[monthKey] && historySchedules[monthKey].length > 0) {
    return historySchedules[monthKey];
  }

  const rules = await loadYearRules(year);
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const info = getDayInfo(dStr, rules);
    const dayOfWeek = new Date(year, month - 1, d).getDay();

    days.push({
      dateStr: dStr,
      day: d,
      dayOfWeek,
      type: info.type,
      holidayName: info.name,
      assignedPerson: ''
    });
  }

  historySchedules[monthKey] = days;
  return days;
}

// 核心：单类排班计算，自动接续顺延直到当年年底 12月31日
async function calculateStream(streamType, startPerson) {
  if (!staffList.length) {
    showToast('请先输入添加值班人员名单！', true);
    return;
  }

  let staffIndex = staffList.indexOf(startPerson);
  if (staffIndex === -1) staffIndex = 0;

  const targetYear = currentYear;

  // 从当前选定月份，一直连续排到当年 12 月
  for (let m = currentMonth; m <= 12; m++) {
    const days = (m === currentMonth) ? monthDays : await getOrBuildMonthDays(targetYear, m);
    const targetDays = days.filter(d => d.type === streamType);

    for (let dayObj of targetDays) {
      dayObj.assignedPerson = staffList[staffIndex];
      staffIndex = (staffIndex + 1) % staffList.length;
    }

    const monthKey = `${targetYear}-${String(m).padStart(2, '0')}`;
    historySchedules[monthKey] = days;
  }

  renderCalendar();
  await persist();
  updateRecommendedStarters();
  showToast(`已成功从 ${currentMonth}月 接续顺延排至当年 12月31日！`);
}

// 三个计算按钮事件绑定
document.getElementById('btn-calc-workday').addEventListener('click', async () => {
  await calculateStream('workday', document.getElementById('select-workday-start').value);
});

document.getElementById('btn-calc-weekend').addEventListener('click', async () => {
  await calculateStream('weekend', document.getElementById('select-weekend-start').value);
});

document.getElementById('btn-calc-holiday').addEventListener('click', async () => {
  await calculateStream('holiday', document.getElementById('select-holiday-start').value);
});

// ==================== 日历网格渲染与月份切换 ====================
async function initMonth(year, month) {
  currentYear = year;
  currentMonth = month;
  document.getElementById('current-month-display').innerText = `${year}年 ${month}月`;

  // 同步更新顶部跳转选择器的选中项
  const jumpY = document.getElementById('jump-year-select');
  const jumpM = document.getElementById('jump-month-select');
  if (jumpY) jumpY.value = year;
  if (jumpM) jumpM.value = month;

  const rules = await loadYearRules(year);
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  if (historySchedules[monthKey] && historySchedules[monthKey].length > 0) {
    monthDays = historySchedules[monthKey];
    monthDays.forEach(d => {
      const info = getDayInfo(d.dateStr, rules);
      d.type = info.type;
      d.holidayName = info.name;
    });
  } else {
    monthDays = [];
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const info = getDayInfo(dStr, rules);
      const dayOfWeek = new Date(year, month - 1, d).getDay();

      monthDays.push({
        dateStr: dStr,
        day: d,
        dayOfWeek,
        type: info.type,
        holidayName: info.name,
        assignedPerson: ''
      });
    }
  }

  updateRecommendedStarters();
  renderCalendar();
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (monthDays.length === 0) return;

  const firstDayWeek = (monthDays[0].dayOfWeek + 6) % 7;
  for (let i = 0; i < firstDayWeek; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'calendar-cell other-month';
    grid.appendChild(emptyCell);
  }

  monthDays.forEach((item, index) => {
    const cell = document.createElement('div');
    cell.className = `calendar-cell ${item.type}`;

    let badgeHtml = '';
    if (item.type === 'holiday') {
      badgeHtml = `<span class="type-badge badge-holiday">${item.holidayName || '休'}</span>`;
    } else if (item.type === 'weekend') {
      badgeHtml = `<span class="type-badge badge-weekend">周末</span>`;
    } else {
      badgeHtml = `<span class="type-badge badge-workday">${item.holidayName || '工作日'}</span>`;
    }

    const optionsHtml = staffList.map(name => `
      <option value="${name}" ${item.assignedPerson === name ? 'selected' : ''}>${name}</option>
    `).join('');

    cell.innerHTML = `
      <div class="cell-top">
        <span class="date-num">${item.day}</span>
        ${badgeHtml}
      </div>
      <div class="duty-box">
        <select class="duty-select ${item.assignedPerson ? 'assigned' : ''}" onchange="onManualChange(${index}, this.value)">
          <option value="">--未排班--</option>
          ${optionsHtml}
        </select>
      </div>
    `;

    grid.appendChild(cell);
  });
}

window.onManualChange = (dayIndex, newPerson) => {
  monthDays[dayIndex].assignedPerson = newPerson;
  renderCalendar();
  persist();
};

function updateSelectOptions() {
  const ids = ['select-workday-start', 'select-weekend-start', 'select-holiday-start'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const oldVal = el.value;
    el.innerHTML = staffList.map(s => `<option value="${s}">${s}</option>`).join('');
    if (staffList.includes(oldVal)) el.value = oldVal;
  });
}

// 初始化顶部跳转选择器选项
function initJumpSelectors() {
  const yearSelect = document.getElementById('jump-year-select');
  const monthSelect = document.getElementById('jump-month-select');

  // 生成近5年年份选项
  const startY = currentYear - 2;
  yearSelect.innerHTML = '';
  for (let y = startY; y <= startY + 5; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.innerText = `${y}年`;
    if (y === currentYear) opt.selected = true;
    yearSelect.appendChild(opt);
  }

  // 生成 1~12 月选项
  monthSelect.innerHTML = '';
  for (let m = 1; m <= 12; m++) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.innerText = `${m}月`;
    if (m === currentMonth) opt.selected = true;
    monthSelect.appendChild(opt);
  }

  // 绑定跳转按钮
  document.getElementById('btn-jump-month').addEventListener('click', () => {
    const targetY = parseInt(yearSelect.value, 10);
    const targetM = parseInt(monthSelect.value, 10);
    initMonth(targetY, targetM);
  });
}

// 一键强制同步更新节假日
document.getElementById('btn-sync-holidays')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-sync-holidays');
  btn.disabled = true;
  btn.innerText = '正在获取...';

  const rules = await loadYearRules(currentYear, true);
  btn.disabled = false;
  btn.innerText = '🔄 更新节假日';

  monthDays.forEach(d => {
    const info = getDayInfo(d.dateStr, rules);
    d.type = info.type;
    d.holidayName = info.name;
  });

  renderCalendar();
  persist();
  showToast(`已更新 ${currentYear} 年节假日数据！`);
});

// 上下月切换
document.getElementById('prev-month-btn').addEventListener('click', () => {
  let m = currentMonth - 1;
  let y = currentYear;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  initMonth(y, m);
});

document.getElementById('next-month-btn').addEventListener('click', () => {
  let m = currentMonth + 1;
  let y = currentYear;
  if (m === 13) {
    m = 1;
    y += 1;
  }
  initMonth(y, m);
});

// 启动入口
window.onload = async () => {
  try {
    const saved = await window.api.loadData();
    staffList = saved.staffList || ['张三', '李四', '王五', '赵六', '钱七', '孙八'];
    historySchedules = saved.historySchedules || {};
  } catch (err) {
    console.error('加载本地数据出错:', err);
  }

  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth() + 1;

  initJumpSelectors();
  renderStaff();
  await initMonth(currentYear, currentMonth);
};