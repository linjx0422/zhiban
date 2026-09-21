const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const userDataDir = app.getPath('userData');
const dataFilePath = path.join(userDataDir, 'roster_data.json');
const icsCacheDir = path.join(userDataDir, 'ics_cache');

if (!fs.existsSync(icsCacheDir)) {
  fs.mkdirSync(icsCacheDir, { recursive: true });
}

// 优化的网络下载模块
function fetchOnlineText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 6000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchOnlineText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve(raw));
    }).on('error', reject).on('timeout', function() {
      this.destroy();
      reject(new Error('网络请求超时'));
    });
  });
}

// 精准展开 ICS 多日区间的解析器
function parseICSContent(icsText) {
  const holidays = {};
  const workdays = {};

  const events = icsText.split('BEGIN:VEVENT');
  for (let i = 1; i < events.length; i++) {
    const block = events[i].split('END:VEVENT')[0];

    const startMatch = block.match(/DTSTART(?:;VALUE=DATE)?:(\d{8})/);
    const endMatch = block.match(/DTEND(?:;VALUE=DATE)?:(\d{8})/);
    const sumMatch = block.match(/SUMMARY:(.+?)[\r\n]/);
    const descMatch = block.match(/DESCRIPTION:(.+?)[\r\n]/);

    if (!startMatch || !sumMatch) continue;

    const startStr = startMatch[1];
    const summary = sumMatch[1].trim();
    const desc = descMatch ? descMatch[1].trim() : '';

    const isWorkday = summary.includes('班') || summary.includes('上班') || 
                      summary.includes('补班') || desc.includes('上班') || desc.includes('工作日');

    const startDate = new Date(
      parseInt(startStr.slice(0, 4), 10),
      parseInt(startStr.slice(4, 6), 10) - 1,
      parseInt(startStr.slice(6, 8), 10)
    );

    let endDate;
    if (endMatch) {
      const endStr = endMatch[1];
      endDate = new Date(
        parseInt(endStr.slice(0, 4), 10),
        parseInt(endStr.slice(4, 6), 10) - 1,
        parseInt(endStr.slice(6, 8), 10)
      );
    } else {
      endDate = new Date(startDate.getTime() + 86400000);
    }

    let curr = new Date(startDate);
    while (curr < endDate) {
      const y = curr.getFullYear();
      const m = String(curr.getMonth() + 1).padStart(2, '0');
      const d = String(curr.getDate()).padStart(2, '0');
      const dStr = `${y}-${m}-${d}`;

      if (isWorkday) {
        workdays[dStr] = summary.replace(/调休|上班|\(班\)/g, '').trim() || '调休上班';
      } else {
        holidays[dStr] = summary.replace(/放假|\(休\)/g, '').trim() || '法定假期';
      }
      curr.setDate(curr.getDate() + 1);
    }
  }

  return { holidays, workdays };
}

// 获取日历规则
async function getCalendarRules(year, forceOnline = false) {
  const cacheFile = path.join(icsCacheDir, `${year}.ics`);
  const icsUrl = `https://cdn.jsdelivr.net/npm/chinese-days/dist/years/${year}.ics`;

  let icsText = '';
  let fromOnline = false;

  if (forceOnline || !fs.existsSync(cacheFile)) {
    try {
      icsText = await fetchOnlineText(icsUrl);
      fs.writeFileSync(cacheFile, icsText, 'utf-8');
      fromOnline = true;
    } catch (err) {
      console.warn(`[ICS] 拉取 ${year} 在线日历失败:`, err.message);
    }
  }

  if (!icsText && fs.existsSync(cacheFile)) {
    try {
      icsText = fs.readFileSync(cacheFile, 'utf-8');
    } catch (e) {
      console.error('[ICS] 读取本地缓存失败:', e);
    }
  }

  if (icsText) {
    const parsed = parseICSContent(icsText);
    return { success: true, fromOnline, data: parsed };
  }

  return { success: false, fromOnline: false, data: { holidays: {}, workdays: {} } };
}

function loadData() {
  try {
    if (fs.existsSync(dataFilePath)) {
      return JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
    }
  } catch (err) {
    console.error('加载本地存储失败:', err);
  }
  return {
    staffList: ['张三', '李四', '王五', '赵六', '钱七', '孙八'],
    historySchedules: {}
  };
}

function saveData(data) {
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('保存数据失败:', err);
    return false;
  }
}

function createWindow() {
  // 全局彻底禁用/删除顶部菜单栏 (File, Edit 等)
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1450,
    height: 940,
    autoHideMenuBar: true, // 隐藏菜单栏
    title: '智能排班日历系统',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.removeMenu(); // 移除当前窗口菜单
  win.loadFile('index.html');
}

ipcMain.handle('get-saved-data', async () => loadData());
ipcMain.handle('save-all-data', async (event, data) => saveData(data));
ipcMain.handle('fetch-ics-rules', async (event, { year, forceOnline }) => getCalendarRules(year, forceOnline));

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});